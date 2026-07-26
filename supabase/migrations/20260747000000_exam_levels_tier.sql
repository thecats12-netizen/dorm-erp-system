-- ============================================================================
-- 인증 레벨(exam_levels) 확장 — tier/parent_level_id/requires_approval (additive)
--   · 목표 계층(설비취득→SINGLE/M1~M4→DM→SENIOR_DM→MAESTRO)을 데이터로 표현하기 위한 기반 컬럼.
--   · 하드코딩 금지 원칙 — 단계·요건은 exam_levels 행 + exam_rules.criteria 로 관리.
--   · additive only: 기존 컬럼/데이터/rank_order/auto_promote/is_active 무변경. 초기 행은 별도 seed 파일.
--   ⚠ 운영 DB 자동 적용 금지.
-- ============================================================================
begin;

alter table public.exam_levels
  add column if not exists tier text,                                                        -- SETUP/PM/DM/SENIOR_DM/MAESTRO 등(데이터 · 하드코딩 아님)
  add column if not exists parent_level_id uuid references public.exam_levels(id) on delete set null,  -- 선행 계층(자기참조)
  add column if not exists requires_approval boolean not null default true;                  -- 자동확정 방지(기본 승인 필요)

create index if not exists ix_exam_levels_tier on public.exam_levels (tenant_id, tier) where deleted_at is null;

commit;

-- 검증(SELECT): select column_name,data_type,is_nullable from information_schema.columns
--   where table_schema='public' and table_name='exam_levels' and column_name in ('tier','parent_level_id','requires_approval');
-- 초기 레벨 데이터는 20260747000001_exam_levels_seed.sql (멱등 · code 중복 방지) 참고.
