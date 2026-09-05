-- ============================================================================
-- 군대관리 v2 — military_module_data GRANT hardening (Production 승인 후 SQL Editor 직접 실행)
-- 목표 matrix:
--   anon          : 0 0 0 0 0 0 0   (모든 table privilege 제거 — 제품이 anon 으로 이 테이블을 쓰지 않음)
--   authenticated : SELECT/INSERT/UPDATE 유지 · DELETE/TRUNCATE/REFERENCES/TRIGGER 제거
--   service_role  : 변경 없음
--   postgres(owner): 변경 없음
-- 범위: TABLE privilege(GRANT/REVOKE)만. RLS/policy/function/publication/데이터/ALTER DEFAULT PRIVILEGES 변경 없음.
-- ⚠ 이 파일 자체는 실행/commit 하지 않음(사용자가 SQL Editor 에서 직접 실행).
-- ============================================================================
begin;

-- ── 1) 전제 guard: RLS=true + Phase D 정책 3개 + DELETE 정책 없음 + RPC/helper 존재일 때만 진행 ──
do $$
declare n_pol int; n_del int;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relname='military_module_data' and c.relrowsecurity is true
  ) then raise exception '[중단] military_module_data RLS 가 활성 상태가 아님(하드닝은 RLS 전제).'; end if;

  select count(*) into n_pol from pg_policies where schemaname='public' and tablename='military_module_data';
  if n_pol <> 3 then raise exception '[중단] Phase D 정책이 3개가 아님(%개). RLS 상태 확인 필요.', n_pol; end if;

  select count(*) into n_del from pg_policies
   where schemaname='public' and tablename='military_module_data' and cmd='DELETE';
  if n_del <> 0 then raise exception '[중단] 예상 외 DELETE 정책 존재(%개).', n_del; end if;

  if to_regprocedure('public.can_read_military_raw()') is null
     or to_regprocedure('public.get_military_module_for_current_user()') is null then
    raise exception '[중단] 필수 RPC/helper 미존재 — 하드닝 후 viewer 경로가 깨질 수 있음.';
  end if;
end $$;

-- ── 2) anon: 이 테이블의 모든 table privilege 제거 ──
revoke all privileges on table public.military_module_data from anon;

-- ── 3) authenticated: 불필요 privilege 만 제거(SELECT/INSERT/UPDATE 는 유지) ──
--   제품 admin 경로(save=SELECT/UPDATE/INSERT)에 필요한 3개는 남기고, 미사용 4개만 회수.
revoke delete, truncate, references, trigger on table public.military_module_data from authenticated;

-- service_role / postgres(owner): 변경하지 않음.

-- ── 4) postcondition guard: 목표 matrix 정확 검증(실패 시 rollback) ──
do $$
declare n_anon int;
  a_sel boolean; a_ins boolean; a_upd boolean; a_del boolean; a_tru boolean; a_ref boolean; a_trg boolean;
begin
  -- anon: 잔여 0
  select count(*) into n_anon from information_schema.role_table_grants
   where table_schema='public' and table_name='military_module_data' and grantee='anon';
  if n_anon <> 0 then raise exception '[검증실패] anon 권한 잔존(%건).', n_anon; end if;

  -- authenticated: SELECT/INSERT/UPDATE 유지 · 나머지 4개 없음
  select
    bool_or(privilege_type='SELECT'), bool_or(privilege_type='INSERT'), bool_or(privilege_type='UPDATE'),
    bool_or(privilege_type='DELETE'), bool_or(privilege_type='TRUNCATE'),
    bool_or(privilege_type='REFERENCES'), bool_or(privilege_type='TRIGGER')
  into a_sel, a_ins, a_upd, a_del, a_tru, a_ref, a_trg
  from information_schema.role_table_grants
  where table_schema='public' and table_name='military_module_data' and grantee='authenticated';

  if not (coalesce(a_sel,false) and coalesce(a_ins,false) and coalesce(a_upd,false)) then
    raise exception '[검증실패] authenticated 의 SELECT/INSERT/UPDATE 중 누락(admin 기능 위험) sel=% ins=% upd=%', a_sel, a_ins, a_upd;
  end if;
  if coalesce(a_del,false) or coalesce(a_tru,false) or coalesce(a_ref,false) or coalesce(a_trg,false) then
    raise exception '[검증실패] authenticated 에 회수 대상 잔존 del=% trunc=% ref=% trig=%', a_del, a_tru, a_ref, a_trg;
  end if;

  -- RLS 여전히 활성 + 정책 3개(하드닝이 건드리지 않았음을 재확인)
  if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
     where ns.nspname='public' and c.relname='military_module_data' and c.relrowsecurity is true) then
    raise exception '[검증실패] RLS 비활성.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='military_module_data') <> 3 then
    raise exception '[검증실패] 정책 개수 변동.';
  end if;
end $$;

-- ── 5) effective privilege postcondition: has_table_privilege 로 "실효 권한"까지 검증 ──
--   (직접 grant 외 role membership/PUBLIC 경유까지 포함한 실제 접근 가능 여부를 확인)
do $$
declare tbl constant text := 'public.military_module_data';
begin
  -- anon: 7개 전부 false 여야 함
  if has_table_privilege('anon', tbl, 'SELECT')     then raise exception '[검증실패] anon effective SELECT 잔존.';     end if;
  if has_table_privilege('anon', tbl, 'INSERT')     then raise exception '[검증실패] anon effective INSERT 잔존.';     end if;
  if has_table_privilege('anon', tbl, 'UPDATE')     then raise exception '[검증실패] anon effective UPDATE 잔존.';     end if;
  if has_table_privilege('anon', tbl, 'DELETE')     then raise exception '[검증실패] anon effective DELETE 잔존.';     end if;
  if has_table_privilege('anon', tbl, 'TRUNCATE')   then raise exception '[검증실패] anon effective TRUNCATE 잔존.';   end if;
  if has_table_privilege('anon', tbl, 'REFERENCES') then raise exception '[검증실패] anon effective REFERENCES 잔존.'; end if;
  if has_table_privilege('anon', tbl, 'TRIGGER')    then raise exception '[검증실패] anon effective TRIGGER 잔존.';    end if;

  -- authenticated: SELECT/INSERT/UPDATE=true · DELETE/TRUNCATE/REFERENCES/TRIGGER=false
  if not has_table_privilege('authenticated', tbl, 'SELECT') then raise exception '[검증실패] authenticated effective SELECT 누락(admin 기능 위험).'; end if;
  if not has_table_privilege('authenticated', tbl, 'INSERT') then raise exception '[검증실패] authenticated effective INSERT 누락(admin 기능 위험).'; end if;
  if not has_table_privilege('authenticated', tbl, 'UPDATE') then raise exception '[검증실패] authenticated effective UPDATE 누락(admin 기능 위험).'; end if;
  if has_table_privilege('authenticated', tbl, 'DELETE')     then raise exception '[검증실패] authenticated effective DELETE 잔존.';     end if;
  if has_table_privilege('authenticated', tbl, 'TRUNCATE')   then raise exception '[검증실패] authenticated effective TRUNCATE 잔존.';   end if;
  if has_table_privilege('authenticated', tbl, 'REFERENCES') then raise exception '[검증실패] authenticated effective REFERENCES 잔존.'; end if;
  if has_table_privilege('authenticated', tbl, 'TRIGGER')    then raise exception '[검증실패] authenticated effective TRIGGER 잔존.';    end if;
end $$;

commit;
-- 확인: select grantee, privilege_type from information_schema.role_table_grants
--        where table_name='military_module_data' order by grantee, privilege_type;
