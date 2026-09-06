-- ============================================================================
-- 군대관리 v2 RLS probe — 역할별 SELECT/UPDATE/INSERT/DELETE 결과 한눈에 확인
-- ⚠ PRODUCTION 실행 금지 — LOCAL/STAGING 전용.
-- 데이터 안전: 전체를 하나의 트랜잭션으로 실행하고 마지막에 ROLLBACK 하므로
--   probe 의 UPDATE/INSERT/DELETE 는 실제로 저장되지 않는다(seed 'default' 행 무손상).
-- 사용법:
--   1) 아래 파일 상단의 UUID 를 실제 profiles.id 로 채운다(hardcode 금지 · 각 환경마다 다름).
--   2) 전체를 SQL Editor 에 붙여 실행한다(BEGIN..ROLLBACK 포함).
--   3) 각 select 행의 출력 문자열을 README PASS 표와 대조한다.
-- ============================================================================

-- 역할 판정 helper(트랜잭션 로컬 role/JWT 위장). anon 은 role='anon'.
create or replace function pg_temp.rls_probe(p_uid text, p_role text default 'authenticated')
returns text language plpgsql as $$
declare r text := ''; c int;
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  begin select count(*) into c from public.military_module_data; r := 'SELECT='||c;
    exception when others then r := 'SELECT=BLOCK'; end;
  begin update public.military_module_data set updated_at = now() where tenant_id = 'default';
    r := r||' UPD=OK'; exception when others then r := r||' UPD=BLOCK'; end;
  begin insert into public.military_module_data(tenant_id, data) values ('default', jsonb_build_object('_probe', true));
    r := r||' INSdef=OK'; exception when others then r := r||' INSdef=BLOCK'; end;
  begin insert into public.military_module_data(tenant_id, data) values ('other', jsonb_build_object('_probe', true));
    r := r||' INSoth=OK'; exception when others then r := r||' INSoth=BLOCK'; end;
  begin delete from public.military_module_data where tenant_id = 'default' and (data ? '_probe');  -- probe 행만 대상
    r := r||' DEL=OK'; exception when others then r := r||' DEL=BLOCK'; end;
  perform set_config('role', 'postgres', true);  -- reset(트랜잭션은 어차피 ROLLBACK)
  return r;
end $$;

begin;  -- ↓ 모든 mutation 은 마지막 ROLLBACK 으로 폐기(데이터 무변경)

-- ▼▼ 실제 profiles.id UUID 로 교체 ▼▼
select 'admin'           as role, pg_temp.rls_probe('<admin_active_uid>');
select 'viewer'          as role, pg_temp.rls_probe('<viewer_active_uid>');
select 'dorm_manager'    as role, pg_temp.rls_probe('<dorm_active_uid>');
select 'maintenance'     as role, pg_temp.rls_probe('<maint_active_uid>');
select 'inactive_admin'  as role, pg_temp.rls_probe('<admin_inactive_uid>');
select 'inactive_viewer' as role, pg_temp.rls_probe('<viewer_inactive_uid>');
select 'anon'            as role, pg_temp.rls_probe('00000000-0000-0000-0000-000000000000','anon');

rollback;  -- ★ probe 변경사항 전부 폐기 → seed 'default' 행 무손상
-- 기대값(정책 교체 후):
--   admin           : SELECT=1 UPD=OK    INSdef=OK    INSoth=BLOCK DEL=BLOCK
--   viewer          : SELECT=1 UPD=BLOCK INSdef=BLOCK INSoth=BLOCK DEL=BLOCK
--   dorm/maint/inact: SELECT=0 UPD=BLOCK INSdef=BLOCK INSoth=BLOCK DEL=BLOCK
--   anon            : SELECT=0(또는 BLOCK) 나머지 BLOCK
-- 교체 전(기존 broad 정책)에는 viewer/dorm 의 UPD/INSdef/DEL 가 OK 로 나오는 것이 정상(취약성 재현).
