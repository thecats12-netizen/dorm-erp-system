-- ============================================================================
-- 롤백: 20260733 실기 평가 컬럼.
--   ⚠ 컬럼 DROP 은 입력된 실기 평가 데이터를 영구 삭제한다. 적용 후 값을 저장했다면 되돌리지 말거나 먼저 백업.
--   기본 롤백은 "신규 인덱스만" 제거(데이터 보존). 컬럼까지 되돌리려면 아래 블록을 검토 후 수동 실행.
-- ============================================================================

begin;

-- 1) 안전한 기본 롤백: 신규 인덱스만 제거(컬럼/데이터 보존).
drop index if exists public.ux_exam_results_practical_eval;
drop index if exists public.ix_exam_results_eval_status;

-- 2) (선택·위험) 컬럼까지 완전 제거 — 데이터 삭제됨. 필요 시에만 주석 해제.
-- alter table public.exam_results
--   drop column if exists equipment_id, drop column if exists evaluator, drop column if exists evaluator_no,
--   drop column if exists max_score, drop column if exists checklist, drop column if exists eval_status,
--   drop column if exists result_type, drop column if exists score_variance,
--   drop column if exists finalized_at, drop column if exists finalized_by;

commit;

notify pgrst, 'reload schema';
