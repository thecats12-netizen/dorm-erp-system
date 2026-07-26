-- ============================================================================
-- ROLLBACK — 20260746000000_exam_applications_line.sql
--   순서: (1) index 제거 → (2) line_id 컬럼(동반 FK) 제거. 기존 데이터/컬럼/identity 무변경.
--   ⚠ line_id 컬럼 제거 시 응시 라인 스냅샷 값은 사라진다(부가 축이므로 응시 identity·상태계산엔 영향 없음).
-- ============================================================================
drop index if exists public.ix_exam_applications_tenant_line;

alter table public.exam_applications drop column if exists line_id;
