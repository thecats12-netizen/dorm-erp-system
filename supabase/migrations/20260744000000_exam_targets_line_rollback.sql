-- ============================================================================
-- ROLLBACK — 20260744000000_exam_targets_line.sql
--   신규 index + line_id 컬럼(동반 FK)만 제거. 기존 데이터/컬럼/identity/index 무변경.
--   ⚠ line_id 컬럼 제거 시 그 컬럼에 입력된 라인 분류값은 사라진다(부가 축이므로 목표 수치·집계엔 영향 없음).
-- ============================================================================
drop index if exists public.ix_annual_targets_line;
drop index if exists public.ix_monthly_results_line;

alter table public.exam_annual_targets  drop column if exists line_id;
alter table public.exam_monthly_results drop column if exists line_id;
