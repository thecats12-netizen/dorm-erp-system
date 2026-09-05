-- ============================================================================
-- resource-aware APPLY 사후 검증 — POSTCHECK (SELECT ONLY · 실행해도 무변경)
--   apply 직후 실행. 신규 helper/정책/ACL 존재 + 기존 정책 불변 + 데이터 무변경 확인.
--   ⚠ 조회만. 블록 단위 실행.
-- ============================================================================

-- [Q1] 신규 helper 3개 존재 + owner + security_definer + search_path.
--   기대: 셋 다 존재 · security_definer=true · settings 에 search_path=public.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       r.rolname as owner, p.prosecdef as security_definer, p.proconfig as settings
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname in ('exam_custom_menu_ok','exam_custom_process_ok','exam_has_any_custom_perm')
 order by p.proname;

-- [Q2] 신규 helper 실행 ACL — anon 실행 불가 · authenticated 만.
select p.proname, p.proacl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('exam_custom_menu_ok','exam_custom_process_ok','exam_has_any_custom_perm')
 order by p.proname;

-- [Q3] 신규 정책 존재 확인 — 7 테이블 각각 restrict select/insert/update(전부 RESTRICTIVE).
--   기대: 테이블당 3개 RESTRICTIVE. 신규 PERMISSIVE 정책 없음(0).
select c.relname as table_name,
       count(*) filter (where pol.polname='exam_cr_restrict_select' and not pol.polpermissive) as r_select,
       count(*) filter (where pol.polname='exam_cr_restrict_insert' and not pol.polpermissive) as r_insert,
       count(*) filter (where pol.polname='exam_cr_restrict_update' and not pol.polpermissive) as r_update,
       count(*) filter (where pol.polname like 'exam_cr_%' and pol.polpermissive)              as new_permissive_should_be_0
  from pg_class c
  left join pg_policy pol on pol.polrelid=c.oid
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 group by c.relname order by c.relname;

-- [Q4] 신규 정책 표현식 확인(resource literal 정확 · 게이트(not exam_has_any_custom_perm) 존재 · 우회 여부).
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and pol.polname in ('exam_cr_restrict_select','exam_cr_restrict_insert','exam_cr_restrict_update')
 order by c.relname, pol.polname;

-- [Q5] 기존 정책 불변 확인 — exam_master_*/exam_scope_*/can_read_exam_master 계열이 그대로 존재.
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
   and (pol.polname like 'exam_master_%' or pol.polname like 'exam_scope_%')
 order by c.relname, pol.polname;

-- [Q6] 기존 재사용 함수 원문 불변 확인(apply 가 crp/scope/role 함수를 건드리지 않았어야 함).
select p.proname, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('crp_user_has_permission','exam_scope_readable','exam_scope_allows','exam_role_of')
 order by p.proname;

-- [Q7] 데이터 무변경 확인 — 비즈니스 테이블 행수 vs 적용 전 스냅샷 기대값.
--   기대(2026-09-03 적용 전 스냅샷): exam_personnel=751 · exam_applications=1 · pm_certifications=1
--     · dm_certifications=1 · exam_annual_targets=0 · exam_monthly_results=0 · exam_results=0
--   → actual 이 expected 와 다르면(match=false) 데이터 변동 발생 = 조사 필요(정상은 전부 true).
select t, actual, expected, (actual = expected) as match
  from (
    select 'exam_personnel'       as t, count(*) as actual, 751 as expected from public.exam_personnel
    union all select 'exam_applications',    count(*), 1 from public.exam_applications
    union all select 'pm_certifications',    count(*), 1 from public.pm_certifications
    union all select 'dm_certifications',    count(*), 1 from public.dm_certifications
    union all select 'exam_annual_targets',  count(*), 0 from public.exam_annual_targets
    union all select 'exam_monthly_results', count(*), 0 from public.exam_monthly_results
    union all select 'exam_results',         count(*), 0 from public.exam_results
  ) s
 order by t;

-- [Q7b] 부가 테이블 행수(참고 · 스냅샷 기대값 미지정).
select 'exam_user_process_scopes' as t, count(*) c from public.exam_user_process_scopes
union all select 'custom_role_scopes', count(*) from public.custom_role_scopes
order by t;

-- [Q8] direct scope 데이터 무변경(행수 · legacy assigned 무변경) — 개수만.
select count(*) as eups_rows, count(*) filter (where is_active) as eups_active
  from public.exam_user_process_scopes;
