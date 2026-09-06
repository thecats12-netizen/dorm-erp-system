-- ============================================================================
-- 군대관리 v2 2G — Phase D (FINAL RLS · self-contained · Production 승인 후 SQL Editor 에서 직접 실행)
-- 전제: Phase A(can_read_military_raw + sanitized RPC) + Phase B RPC v2 + Phase B frontend(viewer=RPC) 가
--       Production 에서 정상 확인된 이후에만 적용.
-- 동작: Production broad baseline(정책 2개)을 "정확 일치(name+permissive+cmd+roles+qual+with_check)"로 검증한 뒤
--       한 transaction 에서 active-admin-only(SELECT/INSERT/UPDATE) + DELETE 없음 으로 원자 교체.
--   → viewer/dorm/maint/inactive/anon = raw 테이블 접근 전부 deny. viewer 는 sanitized RPC 로만 read.
-- 금지: RLS disable · publication/replica identity 변경 · table GRANT 변경 · 데이터 write · is_admin() 사용.
-- ⚠ 이 파일 자체는 실행/commit 하지 않음(사용자가 SQL Editor 에서 직접 실행).
-- ============================================================================
begin;

-- ── 0) helper 선재 확인: can_read_military_raw 존재해야 함(Phase A 미적용 시 중단) ──
do $$
begin
  if to_regprocedure('public.can_read_military_raw()') is null then
    raise exception '[중단] can_read_military_raw() 미존재. Phase A(additive) 를 먼저 적용하세요.';
  end if;
end $$;

-- ── 1) EXACT baseline guard: name+permissive+cmd+roles+qual+with_check + 총개수 + RLS 를 "정확히" 검증 ──
--   이름만 검사 금지. 하나라도 다르면 RAISE → 전체 rollback(부분 적용 없음).
do $$
declare
  n_total int;
  r_all record;
  r_sel record;
  expected_qual constant text := '(tenant_id = ''default''::text)';
begin
  -- 총 정책 개수(예상 외 정책 존재 차단)
  select count(*) into n_total from pg_policies
   where schemaname='public' and tablename='military_module_data';
  if n_total <> 2 then
    raise exception '[중단] 정책 총 %개(기대 2). 예상 외 정책 존재 가능 — 실행 금지.', n_total;
  end if;

  -- broad #1: military_module_data_admin_all (ALL / PERMISSIVE / {authenticated} / qual=with_check=tenant='default')
  select policyname, permissive, cmd, roles::text as roles_t, qual, with_check
    into r_all from pg_policies
   where schemaname='public' and tablename='military_module_data' and policyname='military_module_data_admin_all';
  if not found then raise exception '[중단] military_module_data_admin_all 미존재.'; end if;
  if r_all.permissive <> 'PERMISSIVE' or r_all.cmd <> 'ALL' or r_all.roles_t <> '{authenticated}'
     or r_all.qual is distinct from expected_qual or r_all.with_check is distinct from expected_qual then
    raise exception '[중단] admin_all 정의 불일치: permissive=% cmd=% roles=% qual=% with_check=%',
      r_all.permissive, r_all.cmd, r_all.roles_t, coalesce(r_all.qual,'(null)'), coalesce(r_all.with_check,'(null)');
  end if;

  -- broad #2: military_module_data_select (SELECT / PERMISSIVE / {authenticated} / qual=tenant='default' / with_check=NULL)
  select policyname, permissive, cmd, roles::text as roles_t, qual, with_check
    into r_sel from pg_policies
   where schemaname='public' and tablename='military_module_data' and policyname='military_module_data_select';
  if not found then raise exception '[중단] military_module_data_select 미존재.'; end if;
  if r_sel.permissive <> 'PERMISSIVE' or r_sel.cmd <> 'SELECT' or r_sel.roles_t <> '{authenticated}'
     or r_sel.qual is distinct from expected_qual or r_sel.with_check is not null then
    raise exception '[중단] select 정의 불일치: permissive=% cmd=% roles=% qual=% with_check=%',
      r_sel.permissive, r_sel.cmd, r_sel.roles_t, coalesce(r_sel.qual,'(null)'), coalesce(r_sel.with_check,'(null)');
  end if;

  -- RLS 활성 확인
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relname='military_module_data' and c.relrowsecurity is true
  ) then
    raise exception '[중단] military_module_data RLS 가 활성 상태가 아님.';
  end if;
end $$;

-- ── 2) 신규 정책 생성(active-admin only · tenant 고정 · can_read_military_raw) ──
create policy military_module_select on public.military_module_data
  for select to authenticated
  using (tenant_id = 'default' and public.can_read_military_raw());
create policy military_module_insert on public.military_module_data
  for insert to authenticated
  with check (tenant_id = 'default' and public.can_read_military_raw());
create policy military_module_update on public.military_module_data
  for update to authenticated
  using (tenant_id = 'default' and public.can_read_military_raw())
  with check (tenant_id = 'default' and public.can_read_military_raw());
-- DELETE 정책 없음 = 물리삭제 차단(RLS default deny)

-- ── 3) 기존 broad 정책 제거(permissive OR 무력화 방지) ──
drop policy military_module_data_admin_all on public.military_module_data;
drop policy military_module_data_select    on public.military_module_data;

-- ── 4) postcondition guard: 최종 상태를 정확히 검증(실패 시 rollback) ──
do $$
declare n_total int; n_broad int; n_del int; sel_qual text; ins_wc text; upd_qual text;
begin
  select count(*) into n_total from pg_policies where schemaname='public' and tablename='military_module_data';
  if n_total <> 3 then raise exception '[검증실패] 최종 정책 %개(기대 3).', n_total; end if;

  select count(*) into n_broad from pg_policies
   where schemaname='public' and tablename='military_module_data'
     and policyname in ('military_module_data_admin_all','military_module_data_select');
  if n_broad <> 0 then raise exception '[검증실패] broad 정책 잔존 %개.', n_broad; end if;

  select count(*) into n_del from pg_policies
   where schemaname='public' and tablename='military_module_data' and cmd='DELETE';
  if n_del <> 0 then raise exception '[검증실패] DELETE 정책 존재(%개).', n_del; end if;

  -- 3개가 정확히 select/insert/update 이고 모두 can_read_military_raw 사용
  select qual into sel_qual from pg_policies where tablename='military_module_data' and policyname='military_module_select';
  select with_check into ins_wc from pg_policies where tablename='military_module_data' and policyname='military_module_insert';
  select qual into upd_qual from pg_policies where tablename='military_module_data' and policyname='military_module_update';
  if sel_qual is null or position('can_read_military_raw' in sel_qual)=0
     or ins_wc  is null or position('can_read_military_raw' in ins_wc )=0
     or upd_qual is null or position('can_read_military_raw' in upd_qual)=0 then
    raise exception '[검증실패] 신규 정책이 can_read_military_raw 를 사용하지 않음(select/insert/update 중 하나 이상).';
  end if;

  -- RLS 여전히 활성
  if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
     where ns.nspname='public' and c.relname='military_module_data' and c.relrowsecurity is true) then
    raise exception '[검증실패] RLS 비활성.';
  end if;
end $$;

commit;
-- 확인: select policyname, permissive, cmd, roles, qual, with_check from pg_policies where tablename='military_module_data' order by cmd;
