-- ============================================================================
-- 롤백: 20260725000000_dorm_data_scope_rls.sql
--   이번에 추가한 RESTRICTIVE 정책·함수·인덱스만 제거한다.
--   기존 permissive 정책/데이터/기존 RLS 는 건드리지 않는다(occupants/dorms 기존 접근 원복).
--   ※ 자동 실행 금지. 검토 후 SQL Editor 에서 1회 실행.
-- ============================================================================
begin;
drop policy if exists occupants_scope_restrict on public.occupants;
drop policy if exists dorms_scope_restrict on public.dorms;
drop index if exists public.occupants_site_gender_dorm_idx;
drop function if exists public.crs_dorm_row_allowed(text,text,text,uuid);
drop function if exists public.crs_user_restricts_dorm();
drop function if exists public.crs_active_dorm_scopes();
notify pgrst, 'reload schema';
commit;
