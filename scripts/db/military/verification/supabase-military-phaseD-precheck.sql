-- ============================================================================
-- 군대관리 v2 2G — Phase D 실행 "전" precheck (READ-ONLY · PII/data JSONB 미출력)
-- 목적: broad baseline 이 Phase D safety guard 와 "정확히" 일치하는지 육안 확인 + 이후 postcheck 대조 기준 기록.
-- 실행: Supabase Dashboard → (Production) → SQL Editor. SELECT only.
-- ============================================================================

-- (A) RLS 상태 — 기대: rls_enabled=true (force_rls 값은 기록해두고 Phase D 후 동일해야 함)
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (B) 정책 exact snapshot — 기대: 정확히 2행
--   1) military_module_data_admin_all | PERMISSIVE | ALL    | {authenticated} | qual=(tenant_id = 'default'::text) | with_check=(tenant_id = 'default'::text)
--   2) military_module_data_select    | PERMISSIVE | SELECT | {authenticated} | qual=(tenant_id = 'default'::text) | with_check=NULL
--   위와 하나라도 다르면(qual/with_check/permissive 포함) Phase D 실행 금지.
select policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (C) 정책 총 개수 — 기대: 2 (예상 외 정책 0)
select count(*) as policy_count
from pg_policies where schemaname='public' and tablename='military_module_data';

-- (D) helper 재검증(can_read_military_raw) — 기대: security_definer=true · owner=postgres · search_path=public · anon ACL 없음
select p.proname, p.prosecdef as security_definer, p.provolatile as volatility,
       pg_get_userbyid(p.proowner) as owner, p.proconfig as config, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_read_military_raw','get_military_module_for_current_user')
order by p.proname;

-- (E) row count 기준선(개수만) — Phase D 후 동일해야 함
select count(*) as military_row_count from public.military_module_data;

-- (F) publication membership(기록용 · Phase D 는 변경하지 않음)
select schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='military_module_data';
