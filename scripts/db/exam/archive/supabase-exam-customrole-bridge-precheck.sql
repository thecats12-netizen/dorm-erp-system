-- ============================================================================
-- 시험 브리지 실행 "전" precheck + rollback snapshot (READ-ONLY · PII 미출력)
-- 실행: Supabase Dashboard → (Production) → SQL Editor. SELECT/조회만.
-- ⚠ user id/email/name/데이터 값 출력 금지 — 메타/정의/개수만.
-- ============================================================================

-- (A) 변경 대상 함수의 "현재 Production 정의" 백업 = rollback source (반드시 결과를 저장해 둘 것)
--     이 3개 정의를 그대로 복사해 rollback SQL 로 보관한다(repo 추측 금지).
select pg_get_functiondef('public.exam_role_of(uuid)'::regprocedure)        as exam_role_of_def;
select pg_get_functiondef('public.exam_scope_readable(uuid,uuid)'::regprocedure)      as exam_scope_readable_def;
select pg_get_functiondef('public.exam_scope_allows(uuid,uuid,text)'::regprocedure)   as exam_scope_allows_def;

-- (B) 함수 속성(정의 외): owner · security_definer · search_path · ACL
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
       p.proconfig as config, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('exam_role_of','exam_scope_readable','exam_scope_allows',
                    'exam_custom_role_has_perm','exam_custom_role_scope','my_custom_scope_values')
order by p.proname;
-- 기대: 최초 적용이면 exam_custom_role_* 2개 미존재(정상). 나머지 owner=postgres, definer=true, search_path=public.

-- (C) 어떤 정책이 이 helper 들을 호출하는지(정책 본문에서 참조 확인 · 정책 자체는 변경 안 함)
select schemaname, tablename, policyname, cmd,
       (qual ilike '%exam_scope_%' or with_check ilike '%exam_scope_%'
        or qual ilike '%exam_role_of%' or with_check ilike '%exam_role_of%'
        or qual ilike '%exam_is_%' or with_check ilike '%exam_is_%') as uses_exam_helper
from pg_policies
where schemaname='public' and tablename like 'exam_%'
order by tablename, policyname;

-- (D) exam 테이블 RLS 활성 상태
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'exam_%' and c.relkind='r'
order by c.relname;

-- (E) 기준선 row count(개수만 · 변경 후 동일해야 함)
select 'exam_user_process_scopes' as t, count(*) n from public.exam_user_process_scopes
union all select 'user_custom_roles', count(*) from public.user_custom_roles
union all select 'custom_role_scopes', count(*) from public.custom_role_scopes
union all select 'custom_role_permissions', count(*) from public.custom_role_permissions;

-- (F) 성능 관련 인덱스 존재 확인(없어도 이번 단계에서 생성하지 않음 · 필요성만 기록)
select indexname, tablename from pg_indexes
where schemaname='public'
  and tablename in ('user_custom_roles','custom_role_scopes','custom_role_permissions','exam_user_process_scopes')
order by tablename, indexname;
-- 기대(기존): user_custom_roles_user_idx / custom_role_scopes_role_idx / custom_role_scopes_type_idx
--            custom_role_permissions_role_idx / idx_eups_user / idx_eups_process
