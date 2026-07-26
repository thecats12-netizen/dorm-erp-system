-- ============================================================================
-- 시험 응시(exam_applications)에 "응시 생성 당시 라인" 스냅샷 컬럼 추가 — line_id (nullable)
--   · line_id 는 응시 생성 시점 personnel.line_id 를 복사한 "스냅샷"이다(이후 personnel 변경과 무관).
--   · 응시 identity/중복키/상태계산과 무관한 부가 스냅샷 축(조회·필터·분류용).
--   · additive only: 기존 행 UPDATE/DELETE 없음, 자동 백필 없음(과거 응시 line_id=null 유지), default 없음.
--
--   ⚠ 운영 DB 자동 적용 금지. exam_lines(20260739) 선행 필요(이미 적용).
-- ============================================================================

-- (1) line_id(nullable FK → exam_lines) 추가. on delete set null. default 없음.
begin;

alter table public.exam_applications
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

commit;

-- (2) 일반 조회 index — (tenant_id, line_id) 부분 index. 기존 unique/dedup index 는 손대지 않는다.
begin;

create index if not exists ix_exam_applications_tenant_line on public.exam_applications (tenant_id, line_id) where deleted_at is null;

commit;

-- (schema cache 갱신이 필요하면 · 선택): notify pgrst, 'reload schema';

-- ── 검증(SELECT 전용 · 선택 실행) ──────────────────────────────────────────
-- 컬럼/타입/nullable:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_schema='public' and table_name='exam_applications' and column_name='line_id';
-- FK(대상 exam_lines · on delete set null):
--   select tc.table_name, ccu.table_name ref, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
--     join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
--     join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
--    where tc.constraint_type='FOREIGN KEY' and kcu.column_name='line_id' and tc.table_name='exam_applications';
-- 적용 직후 전량 NULL:
--   select count(*) filter (where line_id is null) line_null, count(*) total
--     from public.exam_applications where deleted_at is null;
-- tenant 불일치 line 참조(0행 기대 · 후속 보안 점검용):
--   select a.id from public.exam_applications a join public.exam_lines l on l.id=a.line_id
--    where a.line_id is not null and l.tenant_id <> a.tenant_id;
