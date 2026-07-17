-- ============================================================================
-- 롤백: 20260724000000_custom_roles_permission_mode.sql
--   이번 마이그레이션이 "새로 추가한" permission_mode 컬럼과 CHECK 제약만 제거한다.
--   기존 컬럼/데이터/role/RLS 는 건드리지 않는다.
--
-- ⚠ 주의: 이 컬럼에 저장된 restrictive/additive 구분값이 함께 사라진다(기능 기반 제거).
--   ※ 자동 실행되지 않습니다. 필요 시 검토 후 Supabase SQL Editor 에서 수동 1회 실행.
-- ============================================================================

begin;

alter table public.custom_roles drop constraint if exists custom_roles_permission_mode_chk;
alter table public.custom_roles drop column if exists permission_mode;

notify pgrst, 'reload schema';

commit;
