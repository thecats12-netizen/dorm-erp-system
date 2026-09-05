-- ============================================================================
-- 시험 custom-role SELECT 수정(v3) — ROLLBACK 초안 (⚠ 실행 금지 · 승인 후에만)
--   selectfix-apply 는 7개 SELECT 정책만 교체(함수/기타 정책/데이터 무변경).
--   따라서 롤백 = 7개 SELECT 정책을 "수정 직전(v2) 원문"으로 되돌리면 완전 복구.
--
--   ⚠ 아래 CREATE POLICY 는 "직전 배포된 v2(게이트 없이 exam_is_viewer_all 독립분기 포함)" 정의를 복원한다.
--     적용 직전 precheck [S1] 로 캡처한 Production 원문과 반드시 대조하고, 다르면 [S1] 캡처본을 우선 사용할 것.
--     (repo 추정이 아니라 [S1] 실측 원문이 최종 rollback 기준.)
-- ============================================================================
begin;

drop policy if exists exam_cr_restrict_select on public.exam_personnel;
create policy exam_cr_restrict_select on public.exam_personnel as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPersonnel','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.exam_applications;
create policy exam_cr_restrict_select on public.exam_applications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or (process_id is not null and public.exam_scope_readable(auth.uid(), process_id))
   or (process_id is not null and public.exam_custom_menu_ok('examApplications','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.pm_certifications;
create policy exam_cr_restrict_select on public.pm_certifications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.dm_certifications;
create policy exam_cr_restrict_select on public.dm_certifications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examDmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.exam_annual_targets;
create policy exam_cr_restrict_select on public.exam_annual_targets as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examAnnualTargets','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.exam_monthly_results;
create policy exam_cr_restrict_select on public.exam_monthly_results as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examMonthlyResults','view') and public.exam_custom_process_ok(process_id,'view'))
);

drop policy if exists exam_cr_restrict_select on public.exam_results;
create policy exam_cr_restrict_select on public.exam_results as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or exists (
        select 1 from public.exam_personnel ep
         where ep.id = exam_results.personnel_id and ep.process_id is not null
           and ( public.exam_scope_readable(auth.uid(), ep.process_id)
                 or (public.exam_custom_menu_ok('examApplications','view') and public.exam_custom_process_ok(ep.process_id,'view')) ))
);

commit;
