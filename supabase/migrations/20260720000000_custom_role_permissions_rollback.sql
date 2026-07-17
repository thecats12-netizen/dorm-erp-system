-- ============================================================================
-- 롤백: 20260720000000_custom_role_permissions.sql
--   신규 권한 부여 테이블만 제거. 기존 테이블/RLS/데이터, custom_roles 는 무영향.
--   ※ 자동 실행되지 않습니다. 필요 시 Supabase SQL Editor 에서 1회 실행해주세요.
--   ※ 사용자 정의 권한의 메뉴·기능 권한 설정이 함께 삭제됩니다(기존 role 값 무영향).
-- ============================================================================

drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
drop policy if exists custom_role_permissions_select on public.custom_role_permissions;

drop table if exists public.custom_role_permissions;
