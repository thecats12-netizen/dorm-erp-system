-- ============================================================================
-- 시험 브리지 — 결과 확인 전용 snapshot (READ-ONLY · 단일 결과셋 · PII 없음)
-- 한 번 붙여넣고 Run 하면 아래가 1개 표로 나온다:
--   function_def(3함수 원문=rollback source) · function_meta(owner/definer/search_path/acl) · row_count(4테이블)
-- SELECT / pg_get_functiondef / count 만 사용. DB/데이터/RLS/GRANT 변경 없음.
-- ============================================================================
select section, item, detail
from (
  -- (1) 함수 원문 정의 — rollback 에 그대로 사용(생략 없이 detail 컬럼 전체 복사)
  select 1 as ord, 'function_def' as section, 'exam_role_of' as item,
         pg_get_functiondef('public.exam_role_of(uuid)'::regprocedure) as detail
  union all
  select 1, 'function_def', 'exam_scope_readable',
         pg_get_functiondef('public.exam_scope_readable(uuid,uuid)'::regprocedure)
  union all
  select 1, 'function_def', 'exam_scope_allows',
         pg_get_functiondef('public.exam_scope_allows(uuid,uuid,text)'::regprocedure)

  -- (2) 함수 메타 — owner / security_definer / search_path(config) / ACL
  union all
  select 2, 'function_meta',
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'owner=' || pg_get_userbyid(p.proowner)
           || ' | security_definer=' || p.prosecdef::text
           || ' | config=' || coalesce(p.proconfig::text, '(none)')
           || ' | acl='   || coalesce(p.proacl::text, '(default: anon 확인)')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('exam_role_of','exam_scope_readable','exam_scope_allows')

  -- (3) 기준선 row count(개수만 · 실데이터 미출력)
  union all select 3, 'row_count', 'exam_user_process_scopes', (select count(*)::text from public.exam_user_process_scopes)
  union all select 3, 'row_count', 'user_custom_roles',        (select count(*)::text from public.user_custom_roles)
  union all select 3, 'row_count', 'custom_role_scopes',       (select count(*)::text from public.custom_role_scopes)
  union all select 3, 'row_count', 'custom_role_permissions',  (select count(*)::text from public.custom_role_permissions)
) t
order by ord, item;
