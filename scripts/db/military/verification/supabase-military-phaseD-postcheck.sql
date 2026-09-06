-- ============================================================================
-- 군대관리 v2 2G — Phase D 실행 "후" postcheck (READ-ONLY · PII/data JSONB 미출력)
-- 실행: Supabase Dashboard → (Production) → SQL Editor. SELECT only.
-- ============================================================================

-- (A) RLS 상태 — 기대: rls_enabled=true 유지(Phase D 는 RLS 를 끄지 않음). force_rls 는 precheck 와 동일해야 함.
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (B) 정책 exact snapshot — 기대: 정확히 3행(모두 to authenticated · can_read_military_raw 사용)
--   military_module_select  | SELECT | using  = (tenant_id='default' AND can_read_military_raw())
--   military_module_insert  | INSERT | check  = (tenant_id='default' AND can_read_military_raw())
--   military_module_update  | UPDATE | using/check = (tenant_id='default' AND can_read_military_raw())
--   ⚠ 기대: broad 2정책(admin_all/select) 없음 · DELETE 정책 없음 · viewer raw 정책 없음 · 예상 외 정책 없음
select policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (C) 정책 총 개수 — 기대: 3
select count(*) as policy_count
from pg_policies where schemaname='public' and tablename='military_module_data';

-- (D) broad 잔존/DELETE 정책 검사 — 기대: 둘 다 0
select
  (select count(*) from pg_policies where tablename='military_module_data'
     and policyname in ('military_module_data_admin_all','military_module_data_select')) as broad_remaining,
  (select count(*) from pg_policies where tablename='military_module_data' and cmd='DELETE') as delete_policies;

-- (E) helper 정상 재확인 — 기대: precheck 와 동일(security_definer=true · owner=postgres · search_path=public · anon ACL 없음)
select p.proname, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner, p.proconfig as config, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_read_military_raw','get_military_module_for_current_user')
order by p.proname;

-- (F) row count — 기대: precheck (E) 와 동일(변화 0 · 데이터 write 없음)
select count(*) as military_row_count from public.military_module_data;

-- (G) publication membership — 기대: precheck (F) 와 동일(Phase D 변경 없음)
select schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='military_module_data';
