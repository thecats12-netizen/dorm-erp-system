-- ============================================================================
-- 군대관리 v2 — GRANT hardening 실행 "전" precheck (READ-ONLY · SELECT only · PII 미출력)
-- 실행: Supabase Dashboard → (Production) → SQL Editor. 데이터/JSONB 미출력.
-- ============================================================================

-- (A) 대상 테이블/소유자/RLS
select c.relname, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (B) 현재 GRANT matrix(hardening 기준선) — 기대(실측): anon/authenticated 모두 7개 전권
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

-- (C) Phase D RLS 정책 상태(하드닝은 RLS/정책을 바꾸지 않음 · 전제 확인용)
--     기대: 정책 3개(select/insert/update) · DELETE 정책 없음
select policyname, cmd, roles from pg_policies
where schemaname='public' and tablename='military_module_data' order by cmd, policyname;

-- (D) 필수 helper/RPC 존재(하드닝 후에도 viewer sanitized 경로 유지 확인)
select p.proname, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_read_military_raw','get_military_module_for_current_user')
order by p.proname;

-- (E) row count 기준선(개수만) — 하드닝 후 동일해야 함
select count(*) as military_row_count from public.military_module_data;

-- (F) default privileges 재부여 가능성 조사(READ-ONLY · ALTER 하지 않음)
--     이 테이블 권한이 default ACL 에서 재생성될 소지가 있는지 확인만.
--     ⚠ 결과가 있어도 이번 단계에서 ALTER DEFAULT PRIVILEGES 는 실행하지 않는다(별도 후속).
select d.defaclrole::regrole as owner_role, d.defaclobjtype as objtype, d.defaclacl as default_acl
from pg_default_acl d
where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r';  -- r = 테이블

-- ── 기대(수동 대조) ─────────────────────────────────────────────────────────
--  (A) rls_enabled=true · owner=postgres
--  (B) anon=1111111, authenticated=1111111 (실측과 일치해야 hardening 진행)
--  (C) 정책 3개(select/insert/update) · DELETE 없음
--  (D) 두 함수 security_definer=true · owner=postgres
--  (F) public 테이블 default_acl 에 anon/authenticated write 가 잡히면 → 별도 후속(이번엔 미변경)
