-- ============================================================================
-- 군대관리 v2 — military_module_data TABLE-LEVEL GRANT 진단 (READ-ONLY · 진단 전용)
-- ⚠ GRANT/REVOKE/ALTER/DROP/CREATE POLICY/데이터 write 없음. SELECT only. Production 안전.
-- 목적: RLS(행 수준)와 별개로 role 별 table privilege(테이블 수준)를 정확히 파악(defense-in-depth 점검).
-- 실행: Supabase Dashboard → (Production) → SQL Editor. PII/데이터 미출력(권한 메타만).
-- ============================================================================

-- (A) role 별 table privilege 매트릭스 — grantee(anon/authenticated/service_role/postgres 등) × privilege_type
--     기대 참고: Supabase 기본은 anon/authenticated 에 SELECT/INSERT/UPDATE/DELETE 를 부여하고 RLS 로 행을 통제.
--     TRUNCATE/REFERENCES/TRIGGER 는 보통 소유자(postgres)만 — anon/authenticated 에 있으면 과도(점검 대상).
select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema='public' and table_name='military_module_data'
order by grantee, privilege_type;

-- (B) 위를 role×privilege "표" 형태로 요약(있으면 Y) — 한눈에 보기용
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
group by grantee
order by grantee;

-- (C) 테이블 소유자 + RLS 상태(참고 · GRANT 와 구분해 기록)
select c.relname, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (D) 현재 RLS 정책(행 수준 · Phase D 결과 확인용 · GRANT 와 별개)
select policyname, cmd, roles, qual is not null as has_qual, with_check is not null as has_with_check
from pg_policies
where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (E) 함수 EXECUTE 권한(sanitized RPC 경로 참고 · viewer 는 이 RPC 로만 read)
select p.proname, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_military_module_for_current_user','can_read_military_raw','mask_military_phone','mask_military_birth_date','mil_safe_array')
order by p.proname;

-- ── 판정 가이드(수동 대조) ──────────────────────────────────────────────────
--  * anon 에 어떤 write(INSERT/UPDATE/DELETE/TRUNCATE) 든 있으면 → 과도(제품은 anon 로 군대 데이터 쓰지 않음).
--  * anon/authenticated 에 TRUNCATE/REFERENCES/TRIGGER 있으면 → 과도(클라이언트 불필요).
--  * authenticated 의 SELECT/INSERT/UPDATE 는 admin 기능에 필요(RLS 가 행을 통제) — 즉시 REVOKE 금지.
--  * viewer 는 raw table 을 쓰지 않고 SECURITY DEFINER RPC(owner=postgres)로만 read → viewer 개인 grant 는 read 경로에 불필요.
--  * ⚠ REVOKE 는 PostgREST/Supabase 동작을 깨뜨릴 수 있으므로 이 진단만으로 실행하지 않는다(별도 승인·검증 후).
