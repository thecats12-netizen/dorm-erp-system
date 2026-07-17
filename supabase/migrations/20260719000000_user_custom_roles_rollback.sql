-- ============================================================================
-- 롤백: 20260719000000_user_custom_roles.sql
--   신규 연결 테이블만 제거한다. 기존 테이블/RLS/데이터, custom_roles 는 건드리지 않는다.
--   ※ 자동 실행되지 않습니다. 필요 시 Supabase SQL Editor 에서 1회 실행해주세요.
--   ※ 계정에 배정된 추가 권한 연결 데이터가 함께 삭제됩니다(기존 role 값은 무영향).
-- ============================================================================

drop policy if exists user_custom_roles_update on public.user_custom_roles;
drop policy if exists user_custom_roles_insert on public.user_custom_roles;
drop policy if exists user_custom_roles_select on public.user_custom_roles;

drop table if exists public.user_custom_roles;
