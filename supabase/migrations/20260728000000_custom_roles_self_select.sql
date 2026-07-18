-- ============================================================================
-- custom_roles SELECT 자기-조회 보완 (로그인 사용자 권한 반영 버그 수정)
--
-- [증상]
--   viewer(또는 admin 이 아닌) 시스템 역할 계정에 "사용자 정의 권한(선택한 메뉴만
--   허용)"을 배정해도, 로그인 후 Sidebar/권한이 System Role(viewer)만 반영되고
--   custom role 이 무시된다.
--
-- [근본 원인 — RLS 정책 공백]
--   loadMyMenuAccess() 는 세 테이블을 순서대로 읽는다:
--     1) user_custom_roles   ← 20260719: self-read 허용(user_id = auth.uid())  ✅
--     2) custom_roles        ← 20260718: SELECT 가 is_custom_role_admin() 전용   ❌ 공백
--     3) custom_role_permissions ← 20260720: self-read 허용(서브쿼리)            ✅
--   비관리자 로그인은 (2)에서 자신에게 배정된 custom_roles 행을 읽지 못한다.
--   RLS 는 오류가 아니라 "0행"으로 필터하므로 앱은 활성 역할 0건 → 전체 권한을
--   empty 로 폴백 → System Role(viewer) 메뉴만 표시된다.
--
-- [수정 — 최소 범위]
--   custom_roles_select 정책에 "본인에게 활성 배정된 역할" self-read 경로만 추가.
--   기존 admin 조회/INSERT/UPDATE/DELETE-부재 정책은 그대로 둔다.
--   다른 사용자의 custom_roles 는 여전히 읽을 수 없다(본인 배정 행으로 한정).
--   패턴은 20260720 custom_role_permissions_select 와 동일하게 맞춘다.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260718000000_custom_roles.sql, 20260719000000_user_custom_roles.sql
--    롤백: 20260728000000_custom_roles_self_select_rollback.sql
-- ============================================================================

drop policy if exists custom_roles_select on public.custom_roles;
create policy custom_roles_select on public.custom_roles
  for select to authenticated
  using (
    public.is_custom_role_admin()
    or exists (
      select 1 from public.user_custom_roles ucr
       where ucr.custom_role_id = custom_roles.id
         and ucr.user_id = auth.uid()
         and ucr.is_active
    )
  );

-- 재실행 안전(idempotent).
