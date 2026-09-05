-- ============================================================================
-- 군대관리 v2 2E — viewer PII 차단 probe (LOCAL/STAGING · 데이터 무변경)
-- ⚠ PRODUCTION 실행 금지. 전체를 BEGIN..ROLLBACK 으로 감싸 mutation 폐기.
-- 검증: 역할별 raw SELECT 접근 · RPC 접근 · RPC 결과에 금지 key 부재(원문 미출력).
-- 상단 UUID 를 실제 profiles.id 로 채운다.
-- ============================================================================

-- RPC 반환에 금지 key 가 "키 이름"으로 존재하는지 검사(값 미출력 · 존재 여부만).
create or replace function pg_temp.rpc_forbidden_keys(p_uid text)
returns text language plpgsql as $$
declare j jsonb; txt text; bad text := '';
  keys text[] := array['accountNumber','bankName','serviceNumber','emergencyContact','emergencyRelation','workPhone','email','notes','content'];
  k text;
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid)::text, true);
  begin j := public.get_military_module_for_current_user(); exception when others then return 'RPC=BLOCK'; end;
  if j is null then return 'RPC=null(거부)'; end if;
  txt := j::text;                        -- 문자열화(값 출력 아님 · 키 존재만 검사)
  foreach k in array keys loop
    if position(('"'||k||'"') in txt) > 0 then bad := bad || k || ' '; end if;
  end loop;
  perform set_config('role','postgres',true);
  return 'RPC=OK · forbidden_keys=' || case when bad='' then '(없음)' else bad end;
end $$;

-- raw table 접근(역할별) — rls_probe 는 2B probe 재사용 권장. 여기선 RPC 중심.
begin;
select 'admin  raw',  pg_temp.rls_probe('<admin_uid>');            -- 기대: SELECT=1 UPD=OK INSdef=OK INSoth=BLOCK DEL=BLOCK (2B probe 함수 필요)
select 'viewer raw',  pg_temp.rls_probe('<viewer_uid>');           -- 기대: SELECT=0(admin-only) 나머지 BLOCK
select 'admin  rpc',  pg_temp.rpc_forbidden_keys('<admin_uid>');   -- 기대: RPC=OK(원본; admin 은 금지key 존재 가능 — 정상)
select 'viewer rpc',  pg_temp.rpc_forbidden_keys('<viewer_uid>');  -- 기대: RPC=OK · forbidden_keys=(없음)
select 'dorm   rpc',  pg_temp.rpc_forbidden_keys('<dorm_uid>');    -- 기대: RPC=null(거부)
select 'inact  rpc',  pg_temp.rpc_forbidden_keys('<inactive_admin_uid>'); -- 기대: RPC=null(거부)
rollback;

-- 참고: rls_probe(2B) 미로드 상태면 supabase-military-rls-probe.sql 의 함수 먼저 생성.
-- viewer rpc 의 phone/birthDate 는 존재 가능하나 원문이 아니어야 함(마스킹) — 값 출력 대신 UI/DEV 하네스로 육안 확인.
