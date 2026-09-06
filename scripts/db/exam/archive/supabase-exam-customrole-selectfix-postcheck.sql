-- ============================================================================
-- 시험 custom-role SELECT 수정(v3) — POSTCHECK (SELECT ONLY · 실행 무변경)
-- ============================================================================

-- [T1] 7개 select 정책 모두 RESTRICTIVE 로 존재하는지.
select c.relname as table_name, count(*) filter (where pol.polname='exam_cr_restrict_select' and not pol.polpermissive) as r_select
  from pg_class c left join pg_policy pol on pol.polrelid=c.oid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 group by c.relname order by c.relname;

-- [T2] ⭐ 버그 제거 확인 — exam_is_viewer_all 독립분기 0 · not exam_has_any_custom_perm 게이트 7.
select c.relname as table_name,
       (pg_get_expr(pol.polqual, pol.polrelid) ilike '%exam_is_viewer_all%')             as still_has_viewer_all_expected_false,
       (pg_get_expr(pol.polqual, pol.polrelid) ilike '%not %exam_has_any_custom_perm%')  as has_gate_expected_true,
       (pg_get_expr(pol.polqual, pol.polrelid) ilike '%exam_custom_process_ok%')          as has_custom_scope_expected_true
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and pol.polname='exam_cr_restrict_select'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname;

-- [T3] INSERT/UPDATE·기존 정책 불변 확인(수정이 SELECT 만 건드렸는지).
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' else pol.polcmd::text end as cmd
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
   and (pol.polname like 'exam_cr_restrict_%' or pol.polname like 'exam_master_%' or pol.polname like 'exam_scope_%')
 order by c.relname, cmd, pol.polname;

-- [T4] 데이터 무변경 확인(스냅샷 기대: exam_personnel=751 · applications/pm/dm=1 · targets/results/exam_results=0).
select t, actual, expected, (actual=expected) as match from (
  select 'exam_personnel' as t, count(*) as actual, 751 as expected from public.exam_personnel
  union all select 'exam_applications', count(*), 1 from public.exam_applications
  union all select 'pm_certifications', count(*), 1 from public.pm_certifications
  union all select 'dm_certifications', count(*), 1 from public.dm_certifications
  union all select 'exam_annual_targets', count(*), 0 from public.exam_annual_targets
  union all select 'exam_monthly_results', count(*), 0 from public.exam_monthly_results
  union all select 'exam_results', count(*), 0 from public.exam_results
) s order by t;
