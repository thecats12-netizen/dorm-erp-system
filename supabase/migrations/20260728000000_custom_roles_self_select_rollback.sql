-- ============================================================================
-- 롤백: custom_roles_select 를 admin 전용(20260718 원본)으로 되돌린다.
--   주의: 되돌리면 비관리자 로그인의 custom role 반영 버그가 재발한다.
-- ============================================================================

drop policy if exists custom_roles_select on public.custom_roles;
create policy custom_roles_select on public.custom_roles
  for select to authenticated
  using (public.is_custom_role_admin());
