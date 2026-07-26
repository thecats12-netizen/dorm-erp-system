-- ROLLBACK — 20260747000000_exam_levels_tier.sql (신규 컬럼/index 만 제거. 기존 데이터 무변경)
drop index if exists public.ix_exam_levels_tier;
alter table public.exam_levels
  drop column if exists requires_approval,
  drop column if exists parent_level_id,
  drop column if exists tier;
