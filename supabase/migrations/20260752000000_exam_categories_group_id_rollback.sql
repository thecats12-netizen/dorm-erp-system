-- ============================================================================
-- ROLLBACK — exam_categories.group_id (20260752000000)
--   신규 컬럼/인덱스만 제거. 기존 데이터/컬럼(exam_groups.category_id) 영향 없음.
--   ⚠ group_id 에 backfill/입력된 값이 있으면 그 값은 삭제됨(그 외 데이터 무영향).
-- ============================================================================
begin;
drop index if exists public.ix_exam_categories_group;
alter table public.exam_categories drop column if exists group_id;
commit;
