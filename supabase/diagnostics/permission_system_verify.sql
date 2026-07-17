-- ============================================================================
-- [적용 후 검증] 20260723000000_permission_system_repair.sql 결과 확인
--   §A~§H 는 읽기 전용/순수함수 검증(안전, 즉시 실행 가능).
--   §I 는 RLS 실제 강제 검증용 tx-rollback 템플릿(선택 · 반드시 rollback).
--   ※ SQL Editor 는 상위 권한으로 실행되어 RLS 를 우회하므로, admin 격리/사용자 격리 같은
--     "실제 차단" 검증은 앱에서 authenticated 세션으로 확인하거나 §I 템플릿을 참고하세요.
-- ============================================================================

-- §A) 6개 테이블 존재 + RLS 활성화 --------------------------------------------
select c.relname as table_name,
       case when c.relname is null then '❌ 없음' else '✅ 존재' end as exists_status,
       c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('custom_roles','custom_role_audit_logs','custom_role_permissions',
                    'custom_role_scopes','user_custom_roles','security_audit_logs')
order by c.relname;
-- 기대: 6행 모두 rls_enabled = true.

-- §B) 핵심 컬럼(프론트 계약) ---------------------------------------------------
select chk.expected, case when ok then '✅' else '❌' end as status from (
  select 'custom_role_permissions.permission_key(text)' as expected,
         exists(select 1 from information_schema.columns where table_schema='public'
                and table_name='custom_role_permissions' and column_name='permission_key' and data_type='text') as ok
  union all select 'custom_role_scopes.scope_type',
         exists(select 1 from information_schema.columns where table_schema='public' and table_name='custom_role_scopes' and column_name='scope_type')
  union all select 'user_custom_roles.custom_role_id',
         exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_custom_roles' and column_name='custom_role_id')
  union all select 'custom_roles.is_deleted',
         exists(select 1 from information_schema.columns where table_schema='public' and table_name='custom_roles' and column_name='is_deleted')
) chk;

-- §C) CHECK 제약 존재 ---------------------------------------------------------
select tc.table_name, cc.check_clause
from information_schema.check_constraints cc
join information_schema.table_constraints tc on tc.constraint_name = cc.constraint_name
where tc.table_schema='public'
  and tc.table_name in ('custom_roles','custom_role_permissions','custom_role_scopes','user_custom_roles')
order by tc.table_name;
-- 기대: role_type='custom', effect='allow', permission_key/scope_* 공백금지, valid_until>=valid_from 등.

-- §D) 유니크 인덱스 -----------------------------------------------------------
select indexname from pg_indexes
where schemaname='public'
  and indexname in ('custom_roles_tenant_code_active_uniq','custom_role_permissions_uniq',
                    'custom_role_scopes_uniq','user_custom_roles_uniq')
order by indexname;
-- 기대: 4개 모두 존재.

-- §E) 정책 개수(테이블별) -----------------------------------------------------
select tablename, count(*) as policy_count
from pg_policies where schemaname='public'
  and tablename in ('custom_roles','custom_role_permissions','custom_role_scopes',
                    'user_custom_roles','custom_role_audit_logs','security_audit_logs')
group by tablename order by tablename;

-- §F) 함수 존재 + 함수 EXECUTE 권한(anon 없어야) ------------------------------
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in ('is_custom_role_admin','current_user_tenant_id','crp_is_grantable_key',
                    'cr_role_in_tenant','cr_user_is_active','crp_user_has_permission',
                    'crs_user_scope_allows','can_user_access_region','can_user_access_gender',
                    'can_user_access_dorm','can_user_access_process','can_user_manage_roles')
order by p.proname;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public' and grantee in ('anon','public')
  and routine_name in ('crp_user_has_permission','crs_user_scope_allows','is_custom_role_admin',
                       'can_user_access_region','current_user_tenant_id')
order by routine_name, grantee;
-- 기대: anon/public 에 EXECUTE 없음(0행이면 정상).

-- §G) 위험 권한 키 차단(순수 함수 — 즉시 검증) --------------------------------
select 'permissions.admin_config → false' as case, public.crp_is_grantable_key('permissions.admin_config') as result
union all select 'users.admin_config → false', public.crp_is_grantable_key('users.admin_config')
union all select 'settings.admin_config → false', public.crp_is_grantable_key('settings.admin_config')
union all select 'recycleBin.delete → false', public.crp_is_grantable_key('recycleBin.delete')
union all select 'examApplications.approve → true', public.crp_is_grantable_key('examApplications.approve')
union all select 'cleaningReports.create → true', public.crp_is_grantable_key('cleaningReports.create')
union all select 'examPersonnel.excel_download → true', public.crp_is_grantable_key('examPersonnel.excel_download');
-- 기대: admin_config/시스템탭 = false, 일반 업무 = true.

-- §H) 기존 무결성(변경 없음) --------------------------------------------------
-- profiles.role 분포(복구 전후 동일해야 함 · admin/viewer/dorm_manager/maintenance_reporter 만)
select role, count(*) as cnt, sum((coalesce(is_active,true))::int) as active_cnt
from public.profiles group by role order by role;
-- 기존 계정 자동 custom role 배정이 없어야 함(0 이어야 정상)
select count(*) as auto_assigned_should_be_0 from public.user_custom_roles;
-- 하자접수 계정 role 값 무변경(전부 maintenance_reporter 유지)
select id, role, is_active from public.profiles where role = 'maintenance_reporter' order by id;

-- §I) [선택 · tx-rollback] RLS/만료/삭제/tenant 실제 차단 동작 검증 템플릿 -------
--   실제 authenticated 세션에서만 정확히 검증됩니다(SQL Editor 상위 권한은 RLS 우회).
--   아래는 함수 로직(만료/삭제/비활성/tenant 제외)을 안전하게 확인하는 예시이며, 반드시 rollback.
/*
begin;
  -- 테스트용 활성 사용자(실제 존재하는 admin id 로 대체) 를 jwt sub 로 가장.
  set local request.jwt.claims = '{"sub":"<REPLACE_ACTIVE_ADMIN_UUID>","role":"authenticated"}';

  -- 임시 데이터(모두 tenant 'default').
  with r as (
    insert into public.custom_roles(tenant_id,code,name,role_type)
    values ('default','__verify_tmp__','검증임시',' custom') returning id
  )
  insert into public.custom_role_permissions(tenant_id,custom_role_id,permission_key)
    select 'default', id, 'cleaningReports.view' from r;

  -- 만료된 배정은 crp_user_has_permission 이 false 여야 한다(직접 rows 로 함수 로직 확인).
  -- (상세 시나리오는 앱 통합테스트로 검증 권장.)
rollback;   -- ★ 반드시 rollback. Production 데이터 변경 없음.
*/

-- §J) PostgREST 스키마 리로드 --------------------------------------------------
notify pgrst, 'reload schema';
