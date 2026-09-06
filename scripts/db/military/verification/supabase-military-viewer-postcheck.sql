-- ============================================================================
-- 군대관리 v2 2E — viewer PII 차단 postcheck (조회 전용 · 데이터/PII 미출력)
-- LOCAL/STAGING/Production 모두 안전(SELECT only).
-- ============================================================================

-- (A) RLS 상태 + 정책(SELECT 가 is_admin 인지 확인)
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='military_module_data' order by cmd, policyname;

-- (B) RPC / mask / role helper 존재 + SECURITY DEFINER + owner + EXECUTE ACL
select p.proname, p.prosecdef as security_definer, p.provolatile as volatility,
       pg_get_userbyid(p.proowner) as owner, p.proacl as execute_acl,
       (p.proconfig::text) as config   -- search_path 확인
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_military_module_for_current_user','mask_military_phone','mask_military_birth_date','is_admin','can_edit_military','can_view_military')
order by p.proname;

-- (C) 기대 검증(수동 대조):
--   - military_module_select.qual 에 is_admin() 포함, can_view_military() 없음
--   - military_module_insert/update.with_check 에 can_edit_military()
--   - DELETE 정책 없음
--   - get_military_module_for_current_user: security_definer=true, config 에 search_path=public, owner=postgres(신뢰), acl 에 anon 없음/authenticated execute
--   - ⚠ select data / select * 로 JSONB 원문 출력 금지
