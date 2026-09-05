-- ============================================================================
-- resource-aware APPLY 롤백 — ROLLBACK 초안 v2 (⚠ 실행 금지 · 승인 후에만)
--
-- [완전성 근거]  apply v2 는 "순수 additive":
--   · 신규 함수 3개만 생성(exam_custom_menu_ok / exam_custom_process_ok / exam_has_any_custom_perm).
--   · 신규 RESTRICTIVE 정책만 생성(테이블당 exam_cr_restrict_select/insert/update = 3, 신규 PERMISSIVE 없음).
--   · 기존 함수(crp_user_has_permission / exam_scope_readable/allows / exam_role_of / is_exam_admin
--     / exam_is_admin / exam_is_viewer_all / can_read_exam_master / current_user_tenant_id) 무변경.
--   · 기존 정책(exam_master_* / exam_scope_* / can_read_exam_master 계열) 무변경.
--   ⇒ 롤백 = 신규 정책 DROP(21) + 신규 함수 DROP(3). apply 이전과 100% 동일. 원본 복원 불필요.
--
-- [원본 복원이 필요한 경우]  기존 객체를 수정한 apply 변형을 적용했을 때만.
--   repo 과거 migration 이 아니라 audit [A]/[C] 로 캡처한 "적용 직전 Production 원문"을 복원한다.
--   이 additive apply 에서는 사용하지 않는다(아래 선택 섹션 참고).
--
-- ⚠ 의존성 순서: 신규 정책을 먼저 DROP 한 뒤 신규 함수를 DROP.
-- ============================================================================
begin;

-- ── 1) 신규 RESTRICTIVE 정책 제거(7 테이블 × 3) — 함수보다 먼저 ─────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_personnel;
drop policy if exists exam_cr_restrict_insert on public.exam_personnel;
drop policy if exists exam_cr_restrict_update on public.exam_personnel;

drop policy if exists exam_cr_restrict_select on public.exam_applications;
drop policy if exists exam_cr_restrict_insert on public.exam_applications;
drop policy if exists exam_cr_restrict_update on public.exam_applications;

drop policy if exists exam_cr_restrict_select on public.pm_certifications;
drop policy if exists exam_cr_restrict_insert on public.pm_certifications;
drop policy if exists exam_cr_restrict_update on public.pm_certifications;

drop policy if exists exam_cr_restrict_select on public.dm_certifications;
drop policy if exists exam_cr_restrict_insert on public.dm_certifications;
drop policy if exists exam_cr_restrict_update on public.dm_certifications;

drop policy if exists exam_cr_restrict_select on public.exam_annual_targets;
drop policy if exists exam_cr_restrict_insert on public.exam_annual_targets;
drop policy if exists exam_cr_restrict_update on public.exam_annual_targets;

drop policy if exists exam_cr_restrict_select on public.exam_monthly_results;
drop policy if exists exam_cr_restrict_insert on public.exam_monthly_results;
drop policy if exists exam_cr_restrict_update on public.exam_monthly_results;

drop policy if exists exam_cr_restrict_select on public.exam_results;
drop policy if exists exam_cr_restrict_insert on public.exam_results;
drop policy if exists exam_cr_restrict_update on public.exam_results;

-- ── 2) 신규 helper 제거(정책 제거 후) ───────────────────────────────────────────────────
drop function if exists public.exam_has_any_custom_perm();
drop function if exists public.exam_custom_process_ok(uuid,text);
drop function if exists public.exam_custom_menu_ok(text,text);

commit;

-- ── (선택 · 이 additive apply 에서는 미사용) 기존 객체를 수정한 변형을 되돌릴 때만 ─────────────
--   audit [A]/[C] 로 캡처한 "적용 직전 Production 원문"을 그대로 붙여 복원한다. repo 과거 migration 금지.

-- ⚠ 롤백 후 postcheck 재사용: 신규 helper/정책 소멸, 기존 exam_master_*/exam_scope_*/can_read_exam_master 불변,
--    비즈니스 데이터 행수 불변 확인.
