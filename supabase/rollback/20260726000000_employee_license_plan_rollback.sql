-- ============================================================================
-- 롤백: 20260726000000_employee_license_plan.sql
--   이번에 추가한 신규 테이블/트리거/함수만 제거한다.
--   exam_rules.required_months 컬럼은 데이터 손실 방지를 위해 기본적으로 남겨둔다(주석 처리).
--   ※ 자동 실행 금지. 검토 후 SQL Editor 에서 1회 실행.
-- ============================================================================
begin;

drop trigger  if exists trg_emp_license_plan_updated_at on public.employee_license_plan;
drop function if exists public.set_emp_license_plan_updated_at();
drop table    if exists public.employee_license_plan;   -- 신규 테이블 전체 제거(데이터 포함)

-- exam_rules.required_months 는 기존 테이블 컬럼이므로 데이터 보존을 위해 남긴다.
-- 완전 원복이 반드시 필요할 때만 아래 주석을 해제해 실행(그 컬럼 데이터는 삭제됨):
-- alter table public.exam_rules drop column if exists required_months;

notify pgrst, 'reload schema';
commit;
