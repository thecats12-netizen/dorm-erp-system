-- ============================================================================
-- ROLLBACK — 20260745000000_exam_personnel_line.sql
--   순서: (1) index 제거 → (2) line_id 컬럼(동반 FK) 제거. 기존 데이터/컬럼/unique 무변경.
--   ⚠ line_id 컬럼 제거 시 입력된 주 라인 분류값은 사라진다(부가 축이므로 직원 identity·CRUD엔 영향 없음).
-- ============================================================================
drop index if exists public.ix_exam_personnel_line;

alter table public.exam_personnel drop column if exists line_id;
