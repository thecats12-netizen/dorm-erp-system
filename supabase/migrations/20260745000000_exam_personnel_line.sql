-- ============================================================================
-- 인력(exam_personnel)에 "주 라인" 분류 축 추가 — line_id (nullable · 부가 축)
--   · public.exam_personnel 에 line_id 추가(직원의 주 라인 1개).
--   · line_id 는 직원 identity 가 아니라 조회·필터·분류용 부가 축이다.
--     → 기존 employee_no unique(ux_exam_personnel_employee) / identity / process_id 전부 불변.
--   · line_id 와 process_id 는 독립 축(공정으로 라인 추정 금지).
--   · additive only: 기존 행 UPDATE/DELETE 없음, 자동 백필 없음, default 없음(전량 NULL).
--
--   ⚠ 운영 DB 자동 적용 금지. exam_lines(20260739) 선행 필요(이미 적용).
-- ============================================================================

-- (1) line_id(nullable FK → exam_lines) 추가. on delete set null. default 없음.
begin;

alter table public.exam_personnel
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

commit;

-- (2) 일반 조회 index — (tenant_id, line_id) 부분 index. 기존 unique/index 는 손대지 않는다.
--     ⚠ line_id 를 포함한 unique index 는 만들지 않는다(라인은 identity 가 아님).
begin;

create index if not exists ix_exam_personnel_line on public.exam_personnel (tenant_id, line_id) where deleted_at is null;

commit;

-- (schema cache 갱신이 필요하면 · 선택): notify pgrst, 'reload schema';

-- ── 검증(SELECT 전용 · 선택 실행) ──────────────────────────────────────────
-- 컬럼/타입/nullable:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema='public' and table_name='exam_personnel' and column_name='line_id';
-- FK(대상 exam_lines · on delete set null):
--   select tc.table_name, ccu.table_name ref, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
--     join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
--     join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
--    where tc.constraint_type='FOREIGN KEY' and kcu.column_name='line_id' and tc.table_name='exam_personnel';
-- 적용 직후 전량 NULL:
--   select count(*) filter (where line_id is null) line_null, count(*) total
--     from public.exam_personnel where deleted_at is null;
-- 기존 employee_no unique 유지:
--   select indexname, indexdef from pg_indexes where schemaname='public'
--     and tablename='exam_personnel' and indexname='ux_exam_personnel_employee';
-- tenant 불일치 line 참조(0행 기대 · 후속 보안 점검용):
--   select p.id from public.exam_personnel p join public.exam_lines l on l.id=p.line_id
--    where p.line_id is not null and l.tenant_id <> p.tenant_id;
