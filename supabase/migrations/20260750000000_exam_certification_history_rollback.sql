-- ============================================================================
-- ROLLBACK — exam_certification_history (20260750000000)
--   · 신규 append-only 이력 테이블 제거. 기존 테이블/데이터에는 영향 없음.
--   ⚠ 이력 데이터가 영구 삭제됩니다. 운영 적용 전 반드시 확인.
-- ============================================================================
begin;

drop policy if exists "certhist_select" on public.exam_certification_history;
drop policy if exists "certhist_insert" on public.exam_certification_history;
drop table if exists public.exam_certification_history;

commit;
