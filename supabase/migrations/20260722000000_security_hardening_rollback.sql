-- ============================================================================
-- 롤백: 20260722000000_security_hardening.sql
--   신규 함수/트리거/테이블/인덱스를 제거하고, custom_role_permissions 정책을
--   20260720 원본(권한상승 차단 조건 없는 버전)으로 되돌린다.
--   기존 업무 테이블/RLS/데이터/profiles 구조는 무영향.
--   ※ 자동 실행되지 않습니다. 필요 시 Supabase SQL Editor 에서 1회 실행해주세요.
-- ============================================================================

-- 트리거/함수
drop trigger if exists trg_protect_last_admin on public.profiles;
drop function if exists public.protect_last_admin();

-- custom_role_permissions 정책 원복(20260720 버전)
drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
create policy custom_role_permissions_insert on public.custom_role_permissions
  for insert to authenticated
  with check (public.is_custom_role_admin() and effect = 'allow');
drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
create policy custom_role_permissions_update on public.custom_role_permissions
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin() and effect = 'allow');

-- 보안 감사로그
drop policy if exists security_audit_insert on public.security_audit_logs;
drop policy if exists security_audit_select on public.security_audit_logs;
drop table if exists public.security_audit_logs;

-- 권한 함수
drop function if exists public.crp_is_grantable_key(text);
drop function if exists public.can_user_manage_roles();
drop function if exists public.can_user_access_process(text);
drop function if exists public.can_user_access_dorm(text);
drop function if exists public.can_user_access_gender(text);
drop function if exists public.can_user_access_region(text);
drop function if exists public.crs_user_scope_allows(text, text);
drop function if exists public.crp_user_has_permission(text);

-- 인덱스
drop index if exists public.ucr_user_active_idx;
drop index if exists public.crp_role_active_idx;
drop index if exists public.crs_role_type_idx;
drop index if exists public.eups_user_proc_active_idx;
