-- ============================================================================
-- 군대관리 v2 — GRANT hardening 실행 "후" postcheck (READ-ONLY · SELECT only · PII 미출력)
-- 실행: Supabase Dashboard → (Production) → SQL Editor.
-- ============================================================================

-- (A) GRANT matrix — 기대:
--   anon          : 0 0 0 0 0 0 0
--   authenticated : 1 1 1 0 0 0 0  (SELECT/INSERT/UPDATE 만)
--   service_role  : (변경 없음 · precheck 와 동일)
--   postgres      : (변경 없음)
select grantee,
       max((privilege_type='SELECT')::int)     as "SELECT",
       max((privilege_type='INSERT')::int)     as "INSERT",
       max((privilege_type='UPDATE')::int)     as "UPDATE",
       max((privilege_type='DELETE')::int)     as "DELETE",
       max((privilege_type='TRUNCATE')::int)   as "TRUNCATE",
       max((privilege_type='REFERENCES')::int) as "REFERENCES",
       max((privilege_type='TRIGGER')::int)    as "TRIGGER"
from information_schema.role_table_grants
where table_schema='public' and table_name='military_module_data'
group by grantee order by grantee;

-- (B) anon 잔여 권한(기대: 0행)
select privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='military_module_data' and grantee='anon';

-- (C) RLS/정책 불변 확인 — 기대: rls_enabled=true · 정책 3개 · DELETE 정책 없음
select c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';
select policyname, cmd, roles from pg_policies
where schemaname='public' and tablename='military_module_data' order by cmd, policyname;

-- (D) RPC/helper 불변 확인
select p.proname, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_read_military_raw','get_military_module_for_current_user')
order by p.proname;

-- (E) row count 불변(precheck (E) 와 동일해야 함)
select count(*) as military_row_count from public.military_module_data;

-- (F) publication membership 불변(하드닝은 publication 을 건드리지 않음)
select schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='military_module_data';
