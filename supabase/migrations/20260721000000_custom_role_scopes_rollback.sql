-- ============================================================================
-- 롤백: 20260721000000_custom_role_scopes.sql
--   신규 범위 테이블/헬퍼만 제거. 기존 테이블/RLS/데이터, exam_user_process_scopes 무영향.
--   ※ 자동 실행되지 않습니다. 필요 시 Supabase SQL Editor 에서 1회 실행해주세요.
--   ※ 사용자 정의 권한의 데이터 범위 설정이 함께 삭제됩니다(기존 role/site/gender/dorm 무영향).
-- ============================================================================

drop function if exists public.my_custom_scope_values(text);

drop policy if exists custom_role_scopes_update on public.custom_role_scopes;
drop policy if exists custom_role_scopes_insert on public.custom_role_scopes;
drop policy if exists custom_role_scopes_select on public.custom_role_scopes;

drop table if exists public.custom_role_scopes;
