-- ============================================================================
-- 시험 custom-role SELECT 수정(v3) — APPLY 초안 (⚠ 실행 금지 · 승인 후에만)
--
-- [버그] 현재 exam_cr_restrict_select 에 exam_is_viewer_all() 이 "독립 OR 분기"로 있어,
--        profile.role='viewer' + 활성 custom exam 권한 사용자가 process scope 를 무시하고 전체(751건) READ.
--
-- [수정 원칙] 우선순위 재설계(최소 변경 · SELECT 7개 정책만 교체 · 함수/기타 정책/데이터 무변경):
--   A. admin/super                          → 항상 전권.
--   B/D. custom exam 권한이 "없는" 사용자     → not exam_has_any_custom_perm() 로 기존 broad/viewer/direct READ 그대로(회귀 0).
--   D. direct exam_user_process_scopes       → exam_scope_readable(direct) 분기 유지(custom 겸용자도 보존).
--   C. custom exam 권한이 "있는" 사용자       → resource 메뉴권한 AND process scope 안에서만 READ.
--   ⇒ exam_is_viewer_all() 독립 분기 제거. viewer 는 (B) 비-custom 경로로만 broad, custom viewer 는 (C) 로 제한.
--
-- 안전: RESTRICTIVE SELECT 7개만 drop+create(idempotent). 신규 함수 없음. INSERT/UPDATE·기존 정책·데이터 무변경.
--       exam_master_*/exam_scope_*/can_read_exam_master 무변경. dynamic SQL/DML/service_role 없음.
-- ============================================================================
begin;

-- ── exam_personnel → examPersonnel ─────────────────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_personnel;
create policy exam_cr_restrict_select on public.exam_personnel as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPersonnel','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── exam_applications → examApplications (process_id nullable) ──────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_applications;
create policy exam_cr_restrict_select on public.exam_applications as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or (process_id is not null and public.exam_scope_readable(auth.uid(), process_id))
   or (process_id is not null and public.exam_custom_menu_ok('examApplications','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── pm_certifications → examPmCertifications ────────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.pm_certifications;
create policy exam_cr_restrict_select on public.pm_certifications as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── dm_certifications → examDmCertifications ────────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.dm_certifications;
create policy exam_cr_restrict_select on public.dm_certifications as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examDmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── exam_annual_targets → examAnnualTargets ────────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_annual_targets;
create policy exam_cr_restrict_select on public.exam_annual_targets as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examAnnualTargets','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── exam_monthly_results → examMonthlyResults ──────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_monthly_results;
create policy exam_cr_restrict_select on public.exam_monthly_results as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examMonthlyResults','view') and public.exam_custom_process_ok(process_id,'view'))
);

-- ── exam_results → examApplications (process_id 없음: personnel_id→exam_personnel.process_id) ──
drop policy if exists exam_cr_restrict_select on public.exam_results;
create policy exam_cr_restrict_select on public.exam_results as restrictive for select to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or not public.exam_has_any_custom_perm()
   or exists (
        select 1 from public.exam_personnel ep
         where ep.id = exam_results.personnel_id and ep.process_id is not null
           and ( public.exam_scope_readable(auth.uid(), ep.process_id)
                 or (public.exam_custom_menu_ok('examApplications','view') and public.exam_custom_process_ok(ep.process_id,'view')) ))
);

commit;

-- ⚠ 적용 후 postcheck: 7개 select 정책 모두 RESTRICTIVE · using_expr 에 exam_is_viewer_all 독립분기 없음
--    · not exam_has_any_custom_perm 게이트 존재 · INSERT/UPDATE/기타 정책 불변 · 행수 불변.
-- ⚠ 문제 시 rollback: scripts/supabase-exam-customrole-selectfix-rollback.sql (precheck [S1] 캡처 원문으로 복원 가능)
