-- ============================================================================
-- ROLLBACK — 기준정보 scoped unique (20260753000000)
--   신규 부분 unique index 만 제거. 기존 데이터/컬럼/인덱스 영향 없음.
-- ============================================================================
begin;
drop index if exists public.ux_exam_groups_scoped_code;
drop index if exists public.ux_exam_categories_scoped_code;
drop index if exists public.ux_exam_processes_scoped_code;
drop index if exists public.ux_exam_equipment_scoped_code;
commit;
