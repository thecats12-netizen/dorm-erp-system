-- ============================================================================
-- 롤백: exam_applications.personnel_id / session_id 에 NOT NULL 을 되돌린다.
--   ⚠ 되돌리면 사원번호 기반 응시 등록이 다시 400(23502)으로 실패한다.
--   ⚠ 이미 personnel_id/session_id 가 NULL 인 행이 있으면 이 문장은 실패한다
--      (그 경우 되돌리지 말거나, 먼저 값을 채워야 함). 의도된 안전장치다.
-- ============================================================================

begin;

alter table public.exam_applications alter column personnel_id set not null;
alter table public.exam_applications alter column session_id  set not null;

commit;
