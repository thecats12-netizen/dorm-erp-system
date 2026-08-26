-- ============================================================================
-- [제안 · 자동 실행 금지] 연간목표/월간실적 정규화 축(group_id + category_id) FK 추가
--
-- [배경] 계층 정본은 그룹 → 제품군(category.group_id, 그룹 1개에 제품군 N개). 그러나
--        exam_annual_targets / exam_monthly_results 에는 group_id·category_id 컬럼이 없어
--        식별이 텍스트(group_name/product_group)에 의존했고, 1:N 에서 제품군 축이 빠져 있었다.
--        → 두 테이블에 정규화 FK 를 추가해 식별/중복판정을 FK 기준으로 통일한다.
--
-- [원칙]
--   · add column if not exists 로 컬럼만 추가(비파괴 · 재실행 안전). 기존 텍스트 컬럼/데이터/RLS 불변.
--   · 현재 두 테이블 활성 데이터 0건 → backfill 불필요(데이터 손실/병합 위험 없음).
--   · ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--   · 선행: 20260712000000_create_exam_management.sql, 20260712050000_targets_results_columns.sql
-- ============================================================================

alter table public.exam_annual_targets
  add column if not exists group_id    uuid references public.exam_groups(id)     on delete set null,   -- 정규화: 그룹 FK
  add column if not exists category_id uuid references public.exam_categories(id) on delete set null;   -- 정규화: 제품군 FK(그룹→제품군 1:N)

alter table public.exam_monthly_results
  add column if not exists group_id    uuid references public.exam_groups(id)     on delete set null,
  add column if not exists category_id uuid references public.exam_categories(id) on delete set null;

comment on column public.exam_annual_targets.category_id  is '제품군 FK(정본 category.group_id 계층). 식별 축 = year+group_id+category_id+level_id. product_group 텍스트는 표시 snapshot.';
comment on column public.exam_monthly_results.category_id is '제품군 FK(정본 category.group_id 계층). 식별 축 = year+group_id+category_id+level_id. product_group 텍스트는 표시 snapshot.';

-- 스코프 조회/식별용 부분 index(unique 아님 — 부분/그룹 목표 공존은 앱 로직에서 판정).
create index if not exists ix_annual_targets_scope  on public.exam_annual_targets  (tenant_id, year, group_id, category_id, level_id) where deleted_at is null;
create index if not exists ix_monthly_results_scope on public.exam_monthly_results (tenant_id, year, group_id, category_id, level_id) where deleted_at is null;

-- PostgREST 스키마 캐시 갱신(신규 컬럼 즉시 인식).
notify pgrst, 'reload schema';

-- ============================================================================
-- 롤백(필요 시, 검토 후 수동 · 데이터 보존 위해 컬럼은 기본 유지):
--   drop index if exists ix_annual_targets_scope;  drop index if exists ix_monthly_results_scope;
--   -- alter table public.exam_annual_targets  drop column if exists category_id, drop column if exists group_id;
--   -- alter table public.exam_monthly_results drop column if exists category_id, drop column if exists group_id;
-- ============================================================================
