-- ============================================================================
-- [읽기 전용 · 진단] 권한관리 DB 구조 현재 상태 점검
--   이 파일은 SELECT 만 수행한다. 어떤 객체도 생성/수정/삭제하지 않는다.
--   Supabase SQL Editor 에서 각 블록을 실행해 현재 무엇이 존재/누락됐는지 확인한다.
-- ============================================================================

-- 1) 권한 관련 테이블 존재 여부 --------------------------------------------------
select t.expected as table_name,
       case when c.table_name is null then '❌ 없음' else '✅ 존재' end as status
from (values
  ('custom_roles'), ('custom_role_audit_logs'), ('custom_role_permissions'),
  ('custom_role_scopes'), ('user_custom_roles'), ('security_audit_logs'),
  ('exam_user_process_scopes'), ('profiles')
) as t(expected)
left join information_schema.tables c
       on c.table_schema = 'public' and c.table_name = t.expected
order by t.expected;

-- 2) 각 테이블의 컬럼(프론트가 기대하는 핵심 컬럼 확인용) ------------------------
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('custom_roles','custom_role_permissions','custom_role_scopes',
                     'user_custom_roles','custom_role_audit_logs','security_audit_logs')
order by table_name, ordinal_position;

-- 3) 외래키 / 유니크 / 체크 제약 -------------------------------------------------
select tc.table_name, tc.constraint_type, tc.constraint_name
from information_schema.table_constraints tc
where tc.table_schema = 'public'
  and tc.table_name in ('custom_roles','custom_role_permissions','custom_role_scopes',
                        'user_custom_roles','custom_role_audit_logs','security_audit_logs')
order by tc.table_name, tc.constraint_type;

-- 4) 인덱스 ---------------------------------------------------------------------
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('custom_roles','custom_role_permissions','custom_role_scopes',
                    'user_custom_roles','custom_role_audit_logs','security_audit_logs',
                    'exam_user_process_scopes')
order by tablename, indexname;

-- 5) RLS 활성화 여부 ------------------------------------------------------------
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('custom_roles','custom_role_permissions','custom_role_scopes',
                  'user_custom_roles','custom_role_audit_logs','security_audit_logs')
order by relname;

-- 6) 정책(policy) 목록 ----------------------------------------------------------
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('custom_roles','custom_role_permissions','custom_role_scopes',
                    'user_custom_roles','custom_role_audit_logs','security_audit_logs')
order by tablename, cmd, policyname;

-- 7) 권한 함수 존재 여부 --------------------------------------------------------
select p.proname as function_name
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_custom_role_admin','crp_user_has_permission','crs_user_scope_allows',
                    'can_user_access_region','can_user_access_gender','can_user_access_dorm',
                    'can_user_access_process','can_user_manage_roles','crp_is_grantable_key',
                    'protect_last_admin','my_custom_scope_values')
order by p.proname;

-- 8) anon/authenticated 권한(grant) 확인 ---------------------------------------
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('custom_roles','custom_role_permissions','custom_role_scopes',
                     'user_custom_roles','security_audit_logs')
  and grantee in ('anon','authenticated')
order by table_name, grantee, privilege_type;
-- ⚠ 기대: anon 에는 어떤 INSERT/UPDATE/DELETE 도 없어야 한다.

-- 9) 기존 시스템 권한 무결성(변경 없음 확인) -----------------------------------
--    profiles.role 분포. admin/viewer/dorm_manager/maintenance_reporter 만 존재해야 정상.
select role, count(*) as cnt, sum((coalesce(is_active,true))::int) as active_cnt
from public.profiles
group by role
order by role;

-- 10) 기존 계정에 custom role 자동 배정이 없었는지(있으면 관리자가 직접 배정한 것만) -
--     user_custom_roles 가 없으면 이 쿼리는 실패(정상 — 아직 미생성 의미).
-- select count(*) as assigned_rows from public.user_custom_roles;
