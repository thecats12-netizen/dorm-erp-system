-- ============================================================================
-- [검증 · 비파괴] 20260725000000_dorm_data_scope_rls.sql 적용 확인
--   ※ 실제 RLS 강제는 authenticated 세션에서만 정확히 검증됨(SQL Editor 는 상위 권한이라 우회).
-- ============================================================================

-- 1) 함수 존재 확인
select proname from pg_proc where pronamespace='public'::regnamespace
  and proname in ('crs_active_dorm_scopes','crs_user_restricts_dorm','crs_dorm_row_allowed') order by proname;

-- 2) RESTRICTIVE 정책 존재 + permissive 정책 보존 확인
select tablename, policyname, permissive, cmd
from pg_policies where schemaname='public' and tablename in ('occupants','dorms') order by tablename, permissive;
-- 기대: 기존 permissive 정책 그대로 + *_scope_restrict (permissive='RESTRICTIVE') 각 1개.

-- 3) anon 에 함수 EXECUTE 없어야(0행 정상)
select routine_name, grantee from information_schema.routine_privileges
where routine_schema='public' and grantee in ('anon','public')
  and routine_name in ('crs_active_dorm_scopes','crs_dorm_row_allowed','crs_user_restricts_dorm');

-- 4) 범위 없는 사용자 무영향(함수 로직) — 임의 값으로 admin 세션에서 호출 시 true(관리자 우회) 확인
select public.crs_dorm_row_allowed('평택','남','00000000-0000-0000-0000-000000000000', auth.uid()) as admin_should_be_true;

-- 5) 인덱스 확인
select indexname from pg_indexes where schemaname='public' and indexname='occupants_site_gender_dorm_idx';

-- 6) 기존 데이터 무변경(행 수 참고) — 정책 추가는 데이터를 바꾸지 않는다
select count(*) as occupants_rows from public.occupants;
select count(*) as dorms_rows from public.dorms;

notify pgrst, 'reload schema';
