-- ============================================================================
-- [검증 · 비파괴] 시험관리 보안 전수 점검 (10단계 통합 검수)
--   실행: Supabase SQL Editor 에서 조회만 수행. 데이터/정책 변경 없음.
--   목적: RLS 커버리지·정책·익명 접근·service_role·SECURITY DEFINER·물리삭제 차단을 한 번에 확인.
-- ============================================================================

-- [1] 시험관리 관련 테이블 RLS 활성화 여부 (relrowsecurity = true 여야 안전)
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (c.relname like 'exam\_%' escape '\'
       or c.relname in ('pm_certifications','dm_certifications','employee_license_plan',
                        'custom_roles','user_custom_roles','custom_role_permissions',
                        'custom_role_scopes','exam_user_process_scopes'))
order by c.relrowsecurity, c.relname;
-- 기대: 모든 행 rls_enabled = true. false 가 있으면 RLS 미적용 테이블(취약).

-- [2] 테이블별 정책 목록 (cmd = SELECT/INSERT/UPDATE/DELETE, permissive/restrictive)
select tablename, policyname, cmd, permissive, roles
from pg_policies
where schemaname = 'public'
  and (tablename like 'exam\_%' escape '\'
       or tablename in ('pm_certifications','dm_certifications','employee_license_plan',
                       'custom_roles','user_custom_roles','custom_role_permissions',
                       'custom_role_scopes','exam_user_process_scopes'))
order by tablename, cmd, policyname;
-- 확인: INSERT/UPDATE 정책이 관리자 판정(is_exam_admin 등)을 사용하는지, DELETE 정책 부재(물리삭제 차단)인지.

-- [3] DELETE 정책 존재 테이블 (물리삭제 허용 → soft delete 정책과 상충 여부 검토)
select tablename, policyname from pg_policies
where schemaname='public' and cmd='DELETE'
  and (tablename like 'exam\_%' escape '\' or tablename in ('pm_certifications','dm_certifications','employee_license_plan'))
order by tablename;
-- 기대: 0행(물리삭제 금지, soft delete=UPDATE 로만).

-- [4] anon(익명) 역할에 부여된 테이블 권한 (있으면 취약 — 로그인 없이 접근 가능)
select table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee='anon'
  and (table_name like 'exam\_%' escape '\' or table_name in ('pm_certifications','dm_certifications','employee_license_plan'))
order by table_name, privilege_type;
-- 기대: 0행. anon 은 시험 테이블 접근 불가여야 함.

-- [5] 권한 판정/보안 함수의 SECURITY DEFINER + search_path 고정 여부
select p.proname,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '(none)') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('is_exam_admin','can_read_exam_master','is_custom_role_admin',
                    'crs_dorm_row_allowed','crs_active_dorm_scopes','crs_user_restricts_dorm')
order by p.proname;
-- 확인: security_definer=true 인 함수는 config 에 search_path=public 이 포함되어야 안전(검색경로 하이재킹 방지).

-- [6] anon/public 에 EXECUTE 부여된 보안 함수 (있으면 취약)
select routine_name, grantee from information_schema.routine_privileges
where routine_schema='public' and grantee in ('anon','public')
  and routine_name in ('is_exam_admin','can_read_exam_master','crs_dorm_row_allowed');
-- 기대: 0행(authenticated 에게만 EXECUTE).

-- [7] tenant 격리 점검(단일 테넌트 'default' 전제) — tenant_id 분포 확인
select 'exam_personnel' as t, tenant_id, count(*) from public.exam_personnel group by tenant_id
union all select 'employee_license_plan', tenant_id, count(*) from public.employee_license_plan group by tenant_id
order by 1,2;
-- 주의: 현재 RLS 는 tenant_id = 'default' 단일 테넌트 기준(정책은 tenant_id NOT NULL 만 강제).
--       멀티테넌트로 확장 시 "tenant_id = 사용자 소속 tenant" 조건 추가가 필요(현재는 미적용).

-- [8] 감사로그 테이블 존재/행수(작업 추적 가능 여부)
select 'exam_audit_logs' as t, count(*) as rows from public.exam_audit_logs
union all select 'security_audit_logs', count(*) from public.security_audit_logs;

notify pgrst, 'reload schema';
-- 완료. 위 결과를 docs/exam-security-audit.md 의 체크리스트와 대조하세요.
