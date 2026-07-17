-- ============================================================================
-- 롤백: 20260723000000_permission_system_repair.sql
--
-- ⚠️⚠️ 위험 경고 ⚠️⚠️
--   이 스크립트는 권한관리 테이블(custom_roles / custom_role_permissions /
--   custom_role_scopes / user_custom_roles / custom_role_audit_logs /
--   security_audit_logs)과 관련 함수/트리거를 삭제합니다.
--   → 저장된 "사용자 정의 권한 · 배정 · 메뉴/기능 권한 · 데이터 범위 · 감사로그"가 함께 사라집니다.
--   기존 profiles / 시스템 role / 하자접수 계정 / 기존 업무 테이블·RLS 는 건드리지 않습니다.
--
-- ※ 자동 실행되지 않습니다. 반드시 필요할 때만, 내용을 검토한 뒤 Supabase SQL Editor 에서
--   수동으로 1회 실행하세요. 되돌릴 수 없습니다(백업 권장).
--
-- ※ "기존 정상 테이블/데이터"는 절대 대상이 아닙니다. 이 스크립트는 이번 복구 마이그레이션이
--   생성한 신규 객체만 제거합니다. DROP TABLE 은 신규 6개 테이블에만 적용합니다.
-- ============================================================================

-- 1) 마지막-admin 보호 트리거는 이 복구 파일에서 생성하지 않는다(별도 20260723010000).
--    필요 시 그 파일의 롤백 주석을 사용하세요. 여기서는 profiles 를 건드리지 않는다.

-- 2) 테이블 참조 권한 함수 + 무결성/tenant helper
drop function if exists public.can_user_manage_roles();
drop function if exists public.can_user_access_process(text);
drop function if exists public.can_user_access_dorm(text);
drop function if exists public.can_user_access_gender(text);
drop function if exists public.can_user_access_region(text);
drop function if exists public.crs_user_scope_allows(text, text);
drop function if exists public.crp_user_has_permission(text);
drop function if exists public.cr_user_is_active(uuid);
drop function if exists public.cr_role_in_tenant(uuid, text);
drop function if exists public.crp_is_grantable_key(text);
drop function if exists public.current_user_tenant_id();

-- 3) 정책(테이블 삭제 전 제거 — CASCADE 사용 안 함)
drop policy if exists security_audit_insert on public.security_audit_logs;
drop policy if exists security_audit_select on public.security_audit_logs;
drop policy if exists custom_role_scopes_update on public.custom_role_scopes;
drop policy if exists custom_role_scopes_insert on public.custom_role_scopes;
drop policy if exists custom_role_scopes_select on public.custom_role_scopes;
drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
drop policy if exists custom_role_permissions_select on public.custom_role_permissions;
drop policy if exists user_custom_roles_update on public.user_custom_roles;
drop policy if exists user_custom_roles_insert on public.user_custom_roles;
drop policy if exists user_custom_roles_select on public.user_custom_roles;
drop policy if exists custom_role_audit_insert on public.custom_role_audit_logs;
drop policy if exists custom_role_audit_select on public.custom_role_audit_logs;
drop policy if exists custom_roles_update on public.custom_roles;
drop policy if exists custom_roles_insert on public.custom_roles;
drop policy if exists custom_roles_select on public.custom_roles;

-- 4) 신규 테이블 삭제(의존 순서: 자식 → 부모). CASCADE 미사용.
drop table if exists public.security_audit_logs;
drop table if exists public.custom_role_scopes;
drop table if exists public.custom_role_permissions;
drop table if exists public.user_custom_roles;
drop table if exists public.custom_role_audit_logs;
drop table if exists public.custom_roles;

-- 5) 독립 helper (다른 롤백에서 공유될 수 있으니 마지막에, 필요 시에만 주석 해제)
-- drop function if exists public.is_custom_role_admin();

notify pgrst, 'reload schema';
