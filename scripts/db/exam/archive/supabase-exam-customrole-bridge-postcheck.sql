-- ============================================================================
-- 시험 브리지 실행 "후" postcheck (READ-ONLY · PII 미출력)
-- ============================================================================

-- (A) 함수 존재/속성 — 기대: 5개 함수 owner=postgres · security_definer=true · search_path=public · anon ACL 없음
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner,
       p.proconfig as config, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('exam_role_of','exam_scope_readable','exam_scope_allows',
                    'exam_custom_role_has_perm','exam_custom_role_scope')
order by p.proname;

-- (B) 정책 불변 확인 — 기대: precheck (C)/(D)와 동일(개수·이름·cmd·RLS 상태 변화 없음)
select schemaname, tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename like 'exam_%'
order by tablename, policyname;
select c.relname, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'exam_%' and c.relkind='r' order by c.relname;

-- (C) row count 불변 — 기대: precheck (E)와 동일(브리지는 데이터 write 없음)
select 'exam_user_process_scopes' as t, count(*) n from public.exam_user_process_scopes
union all select 'user_custom_roles', count(*) from public.user_custom_roles
union all select 'custom_role_scopes', count(*) from public.custom_role_scopes
union all select 'custom_role_permissions', count(*) from public.custom_role_permissions;

-- (D) 예상 외 정책 추가 여부 — 기대: exam_user_process_scopes 정책은 eups_select/insert/update 그대로
select policyname, cmd from pg_policies
where schemaname='public' and tablename='exam_user_process_scopes' order by policyname;

-- ※ 실제 접근 판정(테스트 매트릭스 A~L)은 실제 계정 JWT 로 스테이징에서 확인(SQL 로 값 출력 금지).
