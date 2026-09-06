-- ============================================================================
-- 군대관리 v2 2G — Phase A/D postcheck (조회 전용 · PII/원문 JSONB 미출력)
-- LOCAL/STAGING/Production 모두 안전(SELECT only · mutation 없음).
-- ⚠ 'select data', 'select *' 로 JSONB 원문을 출력하지 않는다. 존재/속성만 확인.
-- ============================================================================

-- (A) helper / RPC 속성 확인: security definer · owner(신뢰 role) · search_path · ACL(anon 없음)
select p.proname,
       p.prosecdef                    as security_definer,   -- 기대: helper/RPC = true
       p.provolatile                  as volatility,         -- stable=s / immutable=i
       pg_get_userbyid(p.proowner)    as owner,              -- 기대: postgres(신뢰)
       p.proconfig                    as config,             -- 기대: {search_path=public}
       p.proacl                       as execute_acl         -- 기대: anon 없음 · authenticated=execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('can_read_military_raw','get_military_module_for_current_user',
                    'mask_military_phone','mask_military_birth_date','mil_safe_array')
order by p.proname;

-- (B) 전역 is_admin() 이 SELECT 정책에 쓰이지 않는지(군대 정책은 can_read_military_raw 만) — Phase D 이후
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (C) RLS 활성/강제 상태
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (D) Realtime publication 포함 여부(Phase E 검증 대상 · 값 아님)
select schemaname, tablename
from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='military_module_data';

-- ── 수동 대조 기대값 ────────────────────────────────────────────────────────
--  (A) 5개 함수 모두 owner=postgres · search_path=public · proacl 에 anon 없음.
--       can_read_military_raw / get_...current_user : security_definer=true.
--  (B) Phase D 이후: 정책 정확히 3개(select/insert/update), 모두 can_read_military_raw,
--       DELETE 정책 없음, is_admin/can_view_military 미사용. Phase A 만 적용된 상태면 broad 2개 그대로(정상).
--  (C) rls_enabled=true.
--  (D) Phase E 에서 viewer 2-세션 실측으로 raw event 미수신 확인 전까지 HIGH 유지.
