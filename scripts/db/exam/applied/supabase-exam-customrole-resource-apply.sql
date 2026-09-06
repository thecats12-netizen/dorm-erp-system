-- ============================================================================
-- 시험관리 custom-role 서버 강제 연결 — resource-aware APPLY 초안 (v2 · 게이트 방식)
--   ⚠⚠ 실행 금지. 검수/설계용. Production 적용은 별도 승인 후에만.
--   ⚠ 반드시 precheck 통과 후에만 적용.
--
-- [v2 변경 배경 — can_read_exam_master() 실제 의미 확정]
--   Production 원문: "활성 profiles 로그인 사용자면 exam READ 광범위 허용"(admin/viewer/role 판정 아님).
--   → 단순 RESTRICTIVE SELECT 를 추가하면 이 "기존 일반 사용자 broad READ"를 깨뜨린다(회귀).
--   → SELECT 는 "게이트" 로 재설계: custom 시험 권한을 실제로 가진 사용자만 scope 강제,
--      그 외(비-custom 활성 사용자·admin·viewer·direct)는 기존 broad READ 그대로 통과.
--
-- [핵심 결정] PERMISSIVE 우회 차단 = RESTRICTIVE 정책 추가(순수 additive · 기존 객체 무변경).
--   PostgreSQL: 최종허용 = (PERMISSIVE OR) AND (RESTRICTIVE AND).
--   · INSERT/UPDATE(최우선 취약점): 쓰기 permissive(exam_master: admin|crp메뉴권한) 가 process scope 없이 통과.
--       → RESTRICTIVE write 로 "admin | direct | (custom 메뉴권한 AND custom process scope)" 강제.
--         (쓰기는 애초에 일반 사용자에게 열려있지 않으므로 게이트 불필요.)
--   · SELECT: baseline(can_read_exam_master)=활성자 broad read. 이를 보존하되 custom 사용자만 좁힌다.
--       → RESTRICTIVE select = "NOT 활성custom시험권한자  OR  admin|viewer|direct  OR  (custom 메뉴권한 AND scope)".
--         비-custom 사용자는 첫 분기 true → 기존 broad read 유지(회귀 0).
--         custom 시험권한자는 첫 분기 false → 반드시 resource 메뉴권한 AND process scope 필요.
--
-- [적용 대상 7 테이블 → resource_tab]
--   exam_personnel→examPersonnel · exam_applications→examApplications(process_id nullable)
--   pm_certifications→examPmCertifications · dm_certifications→examDmCertifications
--   exam_annual_targets→examAnnualTargets · exam_monthly_results→examMonthlyResults
--   exam_results(process_id 없음)→examApplications (personnel_id→exam_personnel.process_id 경유)
--
-- [권한/스코프 — 재사용(무변경) & 신규]
--   재사용: crp_user_has_permission(text) · exam_is_admin/is_exam_admin · exam_is_viewer_all
--           · exam_scope_readable/allows(direct 원문 보존) · current_user_tenant_id()
--   신규:  exam_custom_menu_ok(resource,perm) · exam_custom_process_ok(process,perm) · exam_has_any_custom_perm()
--
-- [action 매핑] view→list|detail(menu_view 금지) · create→create · update→update · approve→approve
--               · status_change→status_change · export→csv/excel/pdf/print/file_download
-- [action_scope] read=view · write=view/create/update/status_change · all=+approve/export
-- [scope_value='all'] view(read) 전용(미래 공정 자동 포함). 쓰기/승인/내보내기는 특정 process_id 필요.
--
-- 안전: SECURITY DEFINER · search_path=public · dynamic SQL 없음 · 비즈니스 데이터 mutation 없음
--       · exam_user_process_scopes/legacy 무변경 · DROP TABLE 없음.
--   ※ 'exam%' wildcard 는 아래 exam_has_any_custom_perm() "게이트 판정"에만 1곳 사용(권한 부여 아님 · 접근을 여는 게 아니라 좁히는 용도).
--     실제 권한 부여(grant) 경로는 전부 resource literal(examPersonnel 등)만 사용 → cross-tab 부여 없음.
-- ============================================================================
begin;

-- ── 0) 신규 helper: custom role 메뉴권한(resource 한정 · menu_view 미사용) ─────────────
create or replace function public.exam_custom_menu_ok(p_resource text, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_perm
    when 'view'          then public.crp_user_has_permission(p_resource || '.list')
                          or public.crp_user_has_permission(p_resource || '.detail')
    when 'create'        then public.crp_user_has_permission(p_resource || '.create')
    when 'update'        then public.crp_user_has_permission(p_resource || '.update')
    when 'approve'       then public.crp_user_has_permission(p_resource || '.approve')
    when 'status_change' then public.crp_user_has_permission(p_resource || '.status_change')
    when 'export'        then public.crp_user_has_permission(p_resource || '.excel_download')
                          or public.crp_user_has_permission(p_resource || '.pdf_download')
                          or public.crp_user_has_permission(p_resource || '.csv_download')
                          or public.crp_user_has_permission(p_resource || '.print')
                          or public.crp_user_has_permission(p_resource || '.file_download')
    else false
  end;
$$;

-- ── 0b) 신규 helper: custom role process scope(action_scope + 'all'=read-only 규칙) ────────
create or replace function public.exam_custom_process_ok(p_process uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_scopes s
      join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id
      join public.custom_roles r        on r.id = s.custom_role_id
     where s.scope_type = 'process'
       and s.is_active and s.deleted_at is null
       and (s.valid_from  is null or s.valid_from  <= now())
       and (s.valid_until is null or s.valid_until >= now())
       and ucr.user_id = auth.uid() and ucr.is_active and ucr.deleted_at is null
       and (ucr.valid_from  is null or ucr.valid_from  <= now())
       and (ucr.valid_until is null or ucr.valid_until >= now())
       and r.is_active and r.is_deleted = false and r.deleted_at is null
       and s.tenant_id = ucr.tenant_id and r.tenant_id = ucr.tenant_id
       and ucr.tenant_id = public.current_user_tenant_id()
       and (
         ( p_perm = 'view' and s.scope_value = 'all' and s.action_scope in ('read','write','all') )
         or ( p_process is not null and s.scope_value = p_process::text
              and case p_perm
                    when 'view'          then s.action_scope in ('read','write','all')
                    when 'create'        then s.action_scope in ('write','all')
                    when 'update'        then s.action_scope in ('write','all')
                    when 'status_change' then s.action_scope in ('write','all')
                    when 'approve'       then s.action_scope = 'all'
                    when 'export'        then s.action_scope = 'all'
                    else false
                  end )
       )
  );
$$;

-- ── 0c) 신규 helper(게이트): 사용자가 "활성 custom 시험 권한"을 실제로 가졌는가 ──────────────
--   ⚠ 여기의 permission_key like 'exam%' 는 "이 사용자를 scope 대상으로 볼지" 판정하는 게이트다.
--      접근을 여는(grant) 용도가 아니라, 좁히는(scope 강제) 대상 식별용. 실제 부여는 resource literal 만.
--   custom 시험 권한이 하나도 없으면 false → SELECT restrictive 에서 기존 broad read 를 그대로 통과시킨다.
create or replace function public.exam_has_any_custom_perm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_permissions crp
      join public.user_custom_roles ucr on ucr.custom_role_id = crp.custom_role_id
      join public.custom_roles r        on r.id = crp.custom_role_id
     where crp.is_active and crp.effect = 'allow' and crp.deleted_at is null
       and split_part(crp.permission_key, '.', 1) like 'exam%'
       and ucr.user_id = auth.uid() and ucr.is_active and ucr.deleted_at is null
       and (ucr.valid_from  is null or ucr.valid_from  <= now())
       and (ucr.valid_until is null or ucr.valid_until >= now())
       and r.is_active and r.is_deleted = false and r.deleted_at is null
       and crp.tenant_id = ucr.tenant_id and r.tenant_id = ucr.tenant_id
       and ucr.tenant_id = public.current_user_tenant_id()
  );
$$;

-- ── 1) 신규 helper ACL(anon 실행 불가 · authenticated 최소) ─────────────────────────────
revoke all on function public.exam_custom_menu_ok(text,text),
                     public.exam_custom_process_ok(uuid,text),
                     public.exam_has_any_custom_perm()
  from public, anon;
grant execute on function public.exam_custom_menu_ok(text,text),
                          public.exam_custom_process_ok(uuid,text),
                          public.exam_has_any_custom_perm()
  to authenticated;

-- ============================================================================
-- 2) 스코프 테이블별 RESTRICTIVE 정책(각 3: select/insert/update)
--    · SELECT  : 게이트(비-custom 은 broad read 유지) + admin/viewer/direct + (custom 메뉴권한 AND scope)
--    · INSERT/UPDATE : admin/direct + (custom 메뉴권한 AND scope)  — 쓰기는 게이트 불필요
--    ※ 기존 exam_master_*/exam_scope_*/can_read_exam_master 정책은 그대로 둔다(무변경).
--    ※ PERMISSIVE 신규 정책 없음 — custom 사용자의 read permissive 경로는 기존 can_read_exam_master 가 담당.
-- ============================================================================

-- ── 2-1) exam_personnel → examPersonnel ────────────────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_personnel;
create policy exam_cr_restrict_select on public.exam_personnel as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPersonnel','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.exam_personnel;
create policy exam_cr_restrict_insert on public.exam_personnel as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'create')
   or (public.exam_custom_menu_ok('examPersonnel','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.exam_personnel;
create policy exam_cr_restrict_update on public.exam_personnel as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examPersonnel','update') or public.exam_custom_menu_ok('examPersonnel','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examPersonnel','update') or public.exam_custom_menu_ok('examPersonnel','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-2) exam_applications → examApplications (process_id nullable) ─────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_applications;
create policy exam_cr_restrict_select on public.exam_applications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or (process_id is not null and public.exam_scope_readable(auth.uid(), process_id))
   or (process_id is not null and public.exam_custom_menu_ok('examApplications','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.exam_applications;
create policy exam_cr_restrict_insert on public.exam_applications as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or (process_id is not null and public.exam_scope_allows(auth.uid(), process_id, 'create'))
   or (process_id is not null and public.exam_custom_menu_ok('examApplications','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.exam_applications;
create policy exam_cr_restrict_update on public.exam_applications as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or (process_id is not null and (public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve')))
   or (process_id is not null
       and (public.exam_custom_menu_ok('examApplications','update') or public.exam_custom_menu_ok('examApplications','approve') or public.exam_custom_menu_ok('examApplications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or (process_id is not null and (public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve')))
   or (process_id is not null
       and (public.exam_custom_menu_ok('examApplications','update') or public.exam_custom_menu_ok('examApplications','approve') or public.exam_custom_menu_ok('examApplications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-3) pm_certifications → examPmCertifications ───────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.pm_certifications;
create policy exam_cr_restrict_select on public.pm_certifications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examPmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.pm_certifications;
create policy exam_cr_restrict_insert on public.pm_certifications as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'create')
   or (public.exam_custom_menu_ok('examPmCertifications','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.pm_certifications;
create policy exam_cr_restrict_update on public.pm_certifications as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examPmCertifications','update') or public.exam_custom_menu_ok('examPmCertifications','approve') or public.exam_custom_menu_ok('examPmCertifications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examPmCertifications','update') or public.exam_custom_menu_ok('examPmCertifications','approve') or public.exam_custom_menu_ok('examPmCertifications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-4) dm_certifications → examDmCertifications ───────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.dm_certifications;
create policy exam_cr_restrict_select on public.dm_certifications as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examDmCertifications','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.dm_certifications;
create policy exam_cr_restrict_insert on public.dm_certifications as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'create')
   or (public.exam_custom_menu_ok('examDmCertifications','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.dm_certifications;
create policy exam_cr_restrict_update on public.dm_certifications as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examDmCertifications','update') or public.exam_custom_menu_ok('examDmCertifications','approve') or public.exam_custom_menu_ok('examDmCertifications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examDmCertifications','update') or public.exam_custom_menu_ok('examDmCertifications','approve') or public.exam_custom_menu_ok('examDmCertifications','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-5) exam_annual_targets → examAnnualTargets ───────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_annual_targets;
create policy exam_cr_restrict_select on public.exam_annual_targets as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examAnnualTargets','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.exam_annual_targets;
create policy exam_cr_restrict_insert on public.exam_annual_targets as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'create')
   or (public.exam_custom_menu_ok('examAnnualTargets','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.exam_annual_targets;
create policy exam_cr_restrict_update on public.exam_annual_targets as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examAnnualTargets','update') or public.exam_custom_menu_ok('examAnnualTargets','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examAnnualTargets','update') or public.exam_custom_menu_ok('examAnnualTargets','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-6) exam_monthly_results → examMonthlyResults ─────────────────────────────────────
drop policy if exists exam_cr_restrict_select on public.exam_monthly_results;
create policy exam_cr_restrict_select on public.exam_monthly_results as restrictive for select to authenticated
using (
      not public.exam_has_any_custom_perm()
   or public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_is_viewer_all(auth.uid())
   or public.exam_scope_readable(auth.uid(), process_id)
   or (public.exam_custom_menu_ok('examMonthlyResults','view') and public.exam_custom_process_ok(process_id,'view'))
);
drop policy if exists exam_cr_restrict_insert on public.exam_monthly_results;
create policy exam_cr_restrict_insert on public.exam_monthly_results as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'create')
   or (public.exam_custom_menu_ok('examMonthlyResults','create') and public.exam_custom_process_ok(process_id,'create'))
);
drop policy if exists exam_cr_restrict_update on public.exam_monthly_results;
create policy exam_cr_restrict_update on public.exam_monthly_results as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examMonthlyResults','update') or public.exam_custom_menu_ok('examMonthlyResults','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or public.exam_scope_allows(auth.uid(), process_id, 'update')
   or public.exam_scope_allows(auth.uid(), process_id, 'approve')
   or ((public.exam_custom_menu_ok('examMonthlyResults','update') or public.exam_custom_menu_ok('examMonthlyResults','status_change'))
       and public.exam_custom_process_ok(process_id,'update'))
);

-- ── 2-7) exam_results → examApplications (process_id 없음: personnel_id→exam_personnel.process_id) ──
--   EXISTS 기반(personnel PK 인덱스) → N+1 회피.
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
drop policy if exists exam_cr_restrict_insert on public.exam_results;
create policy exam_cr_restrict_insert on public.exam_results as restrictive for insert to authenticated
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or exists (
        select 1 from public.exam_personnel ep
         where ep.id = exam_results.personnel_id and ep.process_id is not null
           and ( public.exam_scope_allows(auth.uid(), ep.process_id, 'create')
                 or (public.exam_custom_menu_ok('examApplications','create') and public.exam_custom_process_ok(ep.process_id,'create')) ))
);
drop policy if exists exam_cr_restrict_update on public.exam_results;
create policy exam_cr_restrict_update on public.exam_results as restrictive for update to authenticated
using (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or exists (
        select 1 from public.exam_personnel ep
         where ep.id = exam_results.personnel_id and ep.process_id is not null
           and ( public.exam_scope_allows(auth.uid(), ep.process_id, 'update')
                 or public.exam_scope_allows(auth.uid(), ep.process_id, 'approve')
                 or ((public.exam_custom_menu_ok('examApplications','update') or public.exam_custom_menu_ok('examApplications','approve') or public.exam_custom_menu_ok('examApplications','status_change'))
                     and public.exam_custom_process_ok(ep.process_id,'update')) ))
)
with check (
      public.exam_is_admin(auth.uid()) or public.is_exam_admin()
   or exists (
        select 1 from public.exam_personnel ep
         where ep.id = exam_results.personnel_id and ep.process_id is not null
           and ( public.exam_scope_allows(auth.uid(), ep.process_id, 'update')
                 or public.exam_scope_allows(auth.uid(), ep.process_id, 'approve')
                 or ((public.exam_custom_menu_ok('examApplications','update') or public.exam_custom_menu_ok('examApplications','approve') or public.exam_custom_menu_ok('examApplications','status_change'))
                     and public.exam_custom_process_ok(ep.process_id,'update')) ))
);

commit;

-- ⚠ 적용 후 postcheck 실행: 신규 helper 3개 존재/owner/search_path/anon ACL 없음,
--    각 테이블 restrict 3(RESTRICTIVE) 정책 존재, 기존 exam_master_*/exam_scope_*/can_read_exam_master 불변,
--    비즈니스 데이터/행수 불변 확인.
-- ⚠ 문제 시 rollback: scripts/supabase-exam-customrole-resource-rollback.sql
