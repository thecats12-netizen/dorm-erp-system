-- ============================================================================
-- 롤백: 20260718000000_custom_roles.sql
--   신규로 추가한 테이블/헬퍼만 제거한다. 기존 테이블/RLS/데이터는 건드리지 않는다.
--   ※ 자동 실행되지 않습니다. 필요 시 Supabase SQL Editor 에서 1회 실행해주세요.
--   ※ custom_roles/custom_role_audit_logs 에 저장된 사용자 정의 권한 데이터가 함께 삭제됩니다.
-- ============================================================================

drop policy if exists custom_role_audit_insert on public.custom_role_audit_logs;
drop policy if exists custom_role_audit_select on public.custom_role_audit_logs;
drop policy if exists custom_roles_update on public.custom_roles;
drop policy if exists custom_roles_insert on public.custom_roles;
drop policy if exists custom_roles_select on public.custom_roles;

drop table if exists public.custom_role_audit_logs;
drop table if exists public.custom_roles;

drop function if exists public.is_custom_role_admin();
