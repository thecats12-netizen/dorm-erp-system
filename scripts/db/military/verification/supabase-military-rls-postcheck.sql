-- ============================================================================
-- 군대관리 v2 RLS postcheck — 조회 전용 상태 검증 (데이터 무수정)
-- LOCAL/STAGING/Production 모두 안전(SELECT only). PII JSONB 는 출력하지 않는다.
-- ============================================================================

-- (A) RLS on/off · force · replica identity
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls, c.relreplident as replica_identity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (B) 정책 목록(기대: 교체 후 select/insert/update 3개, admin_all/data_select 없음)
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (C) helper 존재 + SECURITY DEFINER
select p.proname, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_view_military','can_edit_military','is_admin')
order by p.proname;

-- (D) row count(전체 · tenant별) — 개인정보 미출력
select count(*) as total_rows from public.military_module_data;
select tenant_id, count(*) as rows from public.military_module_data group by tenant_id order by tenant_id;

-- (E) realtime publication + replica identity(realtime)
select pubname from pg_publication_tables where schemaname='public' and tablename='military_module_data';

-- ⚠ 절대 금지: select data ... / select * ...  (JSONB 개인정보 원문 출력 금지)
