-- ============================================================================
-- 군대관리 v2 2G — Phase D ROLLBACK (security-preserving)
-- 원칙: rollback 이 viewer raw SELECT 를 자동으로 다시 허용하지 않는다(원문 PII 재노출 금지).
--   - Frontend Phase B 문제 → Frontend rollback 우선(이 SQL 불필요). RPC/RLS 유지해도 보안 수준 지켜짐.
--   - RLS 자체를 되돌려야 하는 최후의 경우에도 baseline(broad)로의 복원은 PII 재노출이므로 기본 제공하지 않는다.
-- ⚠ 'disable row level security' 금지(RLS ON 운영 유지). 'db reset --linked' 금지.
-- ============================================================================

-- (기본) SQL rollback 없이 Frontend 만 이전 버전으로 되돌린다.
--   Phase D 정책(active-admin only)은 그대로 두어도 admin 기능은 정상이며 viewer 는 RPC 로 계속 read.

-- (예외) admin 기능 자체가 막힌 긴급 상황에서만: 정책을 유지하되 helper 판정을 점검한다.
--   먼저 원인 진단(정책 삭제가 아니라 helper/profiles 문제일 가능성):
--   select policyname, cmd, qual from pg_policies where tablename='military_module_data';
--   select proname, prosecdef, pg_get_userbyid(proowner) owner from pg_proc where proname='can_read_military_raw';
--   select id, role, is_active from public.profiles where role='admin';   -- 활성 admin 존재 확인(PII 아님)

-- (최후수단 · 신중) Phase D 정책을 제거하고 이전 broad baseline 으로 되돌린다.
--   ⚠ 이 경우 viewer/기타 role 이 raw SELECT 로 원문 PII 를 다시 볼 수 있으므로,
--     반드시 그 전에 Frontend 를 raw read 를 하지 않는 상태로 되돌려 두어야 한다. 승인 필수.
-- begin;
--   drop policy if exists military_module_select on public.military_module_data;
--   drop policy if exists military_module_insert on public.military_module_data;
--   drop policy if exists military_module_update on public.military_module_data;
--   create policy military_module_data_admin_all on public.military_module_data
--     for all to authenticated using (tenant_id='default') with check (tenant_id='default');
--   create policy military_module_data_select on public.military_module_data
--     for select to authenticated using (tenant_id='default');
-- commit;

-- Phase A 함수 제거(선택 · 타 경로 미사용 확인 후에만):
--   drop function if exists public.get_military_module_for_current_user();
--   drop function if exists public.can_read_military_raw();
--   drop function if exists public.mask_military_phone(text);
--   drop function if exists public.mask_military_birth_date(text);
--   drop function if exists public.mil_safe_array(jsonb);
