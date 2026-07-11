-- ============================================================================
-- 시험관리 연간목표 / 월간실적 — 컬럼 추가(신규 컬럼만).
-- 기존 데이터/컬럼·타 테이블 미변경. 재실행 안전(add column if not exists).
-- ============================================================================

begin;

-- ── 연간목표 ────────────────────────────────────────────────────────────────
alter table public.exam_annual_targets add column if not exists year int;                                                     -- 연도
alter table public.exam_annual_targets add column if not exists group_name text;                                             -- 그룹
alter table public.exam_annual_targets add column if not exists product_group text;                                          -- 제품군
alter table public.exam_annual_targets add column if not exists part_name text;                                              -- 파트
alter table public.exam_annual_targets add column if not exists level_id uuid references public.exam_levels(id) on delete set null; -- 인증레벨(기준정보)
alter table public.exam_annual_targets add column if not exists current_count int;                                           -- 현재인원
alter table public.exam_annual_targets add column if not exists target_count int;                                            -- 목표인원
alter table public.exam_annual_targets add column if not exists notes text;                                                  -- 비고

create unique index if not exists ux_annual_targets_key
  on public.exam_annual_targets (tenant_id, year, group_name, product_group, part_name, level_id)
  where deleted_at is null and year is not null;
create index if not exists ix_annual_targets_year on public.exam_annual_targets (tenant_id, year);

-- ── 월간실적(D.M 월간 실적) ──────────────────────────────────────────────────
alter table public.exam_monthly_results add column if not exists year int;                                                    -- 연도
alter table public.exam_monthly_results add column if not exists group_name text;                                            -- 그룹
alter table public.exam_monthly_results add column if not exists product_group text;                                         -- 제품군
alter table public.exam_monthly_results add column if not exists part_name text;                                             -- 파트
alter table public.exam_monthly_results add column if not exists level_id uuid references public.exam_levels(id) on delete set null; -- 인증레벨
alter table public.exam_monthly_results add column if not exists m1 int;
alter table public.exam_monthly_results add column if not exists m2 int;
alter table public.exam_monthly_results add column if not exists m3 int;
alter table public.exam_monthly_results add column if not exists m4 int;
alter table public.exam_monthly_results add column if not exists m5 int;
alter table public.exam_monthly_results add column if not exists m6 int;
alter table public.exam_monthly_results add column if not exists m7 int;
alter table public.exam_monthly_results add column if not exists m8 int;
alter table public.exam_monthly_results add column if not exists m9 int;
alter table public.exam_monthly_results add column if not exists m10 int;
alter table public.exam_monthly_results add column if not exists m11 int;
alter table public.exam_monthly_results add column if not exists m12 int;
alter table public.exam_monthly_results add column if not exists target_count int;                                           -- 목표
alter table public.exam_monthly_results add column if not exists notes text;                                                 -- 비고

create unique index if not exists ux_monthly_results_key
  on public.exam_monthly_results (tenant_id, year, group_name, product_group, part_name, level_id)
  where deleted_at is null and year is not null;
create index if not exists ix_monthly_results_year on public.exam_monthly_results (tenant_id, year);

commit;
