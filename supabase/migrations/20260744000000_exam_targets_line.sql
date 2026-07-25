-- ============================================================================
-- 시험 목표(연간/월간)에 라인 분류 축 추가 — line_id (nullable · 부가 축)
--   · public.exam_annual_targets  / public.exam_monthly_results 에 line_id 추가.
--   · line_id 는 목표를 구분하는 identity 가 아니라 조회·필터·분류용 부가 축이다.
--     → 기존 unique index / identity / dedup / 통계식 / 20260743 scope 충돌키 전부 불변.
--   · additive only: 기존 행 UPDATE/DELETE 없음, 자동 백필 없음, default 없음(전량 NULL).
--   · 20260742000000_exam_targets_line_DRAFT.sql 의 검수 완료 내용을 정식 migration 으로 반영한 것.
--
--   ⚠ 운영 DB 자동 적용 금지. 적용 전 사전 진단(아래 주석) 및 20260743 공존 진단 실행 권장.
-- ============================================================================

-- (1) line_id(nullable FK → exam_lines) 추가 — 두 테이블. on delete set null. default 없음.
begin;

alter table public.exam_annual_targets
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

alter table public.exam_monthly_results
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

commit;

-- (2) 일반 조회 index — (tenant_id, line_id) 부분 index. 기존 unique/index 는 손대지 않는다.
--     ⚠ line_id 를 포함한 unique index 는 만들지 않는다(라인은 identity 가 아님).
begin;

create index if not exists ix_annual_targets_line  on public.exam_annual_targets  (tenant_id, line_id) where deleted_at is null;
create index if not exists ix_monthly_results_line on public.exam_monthly_results (tenant_id, line_id) where deleted_at is null;

commit;

-- (schema cache 갱신이 필요하면 · 선택): notify pgrst, 'reload schema';

-- ── 사전/사후 진단(SELECT 전용 · 선택 실행) ────────────────────────────────
-- 라인 목록:           select id, code, name from public.exam_lines where deleted_at is null order by sort_order;
-- 컬럼/타입/nullable:  select table_name, column_name, data_type, is_nullable from information_schema.columns
--                       where table_schema='public' and column_name='line_id'
--                         and table_name in ('exam_annual_targets','exam_monthly_results');
-- FK(대상·삭제규칙):   select tc.table_name, ccu.table_name ref, rc.delete_rule
--                       from information_schema.table_constraints tc
--                       join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
--                       join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
--                       join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
--                      where tc.constraint_type='FOREIGN KEY' and kcu.column_name='line_id'
--                        and tc.table_name in ('exam_annual_targets','exam_monthly_results');
-- 적용 직후 전량 NULL: select count(*) filter (where line_id is null) line_null, count(*) total
--                       from public.exam_annual_targets where deleted_at is null;   -- monthly 동일
-- tenant 불일치 참조(0행 기대 · 후속 보안 점검용):
--   select t.id from public.exam_annual_targets t join public.exam_lines l on l.id=t.line_id
--    where t.line_id is not null and l.tenant_id <> t.tenant_id;                     -- monthly 동일
