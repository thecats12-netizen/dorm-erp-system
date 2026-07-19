-- ============================================================================
-- 롤백: 20260732 일정 컬럼.
--   ⚠ 컬럼 DROP 은 입력된 일정 데이터를 영구 삭제한다. 적용 후 값을 입력했다면 되돌리지 말거나 먼저 백업.
--   기본 롤백은 "신규 인덱스만" 제거(데이터 보존). 컬럼까지 되돌리려면 아래 블록을 검토 후 수동 실행.
-- ============================================================================

begin;

-- 1) 안전한 기본 롤백: 신규 인덱스만 제거(컬럼/데이터 보존).
drop index if exists public.ix_exam_applications_exam_date;

-- 2) (선택·위험) 컬럼까지 완전 제거 — 데이터 삭제됨. 필요 시에만 주석 해제.
-- alter table public.exam_applications
--   drop column if exists exam_date, drop column if exists exam_time, drop column if exists exam_round,
--   drop column if exists exam_type, drop column if exists exam_location, drop column if exists proctor,
--   drop column if exists schedule_notes;

commit;

notify pgrst, 'reload schema';
