-- ============================================================================
-- 군대관리 v2 2E — RLS v3: raw military_module_data 를 admin 전용 SELECT 로 (viewer 는 RPC 로만 sanitized read)
-- ⚠ PRODUCTION 실행 금지 · rollout 마지막 단계(Phase D) — RPC 배포 + 프론트 RPC 대응 + viewer 구독 제거가 선행되어야 함.
-- 전제: 2B-3 확정본이 적용돼 정책이 military_module_select/insert/update 3개인 상태.
--   (아직 2B broad 정책 상태라면 먼저 2B-3 policy-v2 로 교체 후 이 v3 를 적용)
-- 변경점(v2 대비): SELECT 정책 조건 can_view_military()(admin+viewer) → is_admin()(admin 전용).
-- ============================================================================
begin;

-- safety guard: v2 상태(정책 3개 + select 가 can_view_military 사용)일 때만 진행
do $$
declare n int; sel_qual text;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='military_module_data';
  if n <> 3 then raise exception '[중단] 정책이 3개(v2 상태)가 아님(%건). 2B-3 먼저 적용 필요.', n; end if;
  select qual into sel_qual from pg_policies
   where schemaname='public' and tablename='military_module_data' and policyname='military_module_select';
  if sel_qual is null or position('can_view_military' in sel_qual) = 0 then
    raise exception '[중단] SELECT 정책이 예상(can_view_military)과 다름: %', coalesce(sel_qual,'(null)');
  end if;
end $$;

-- SELECT 정책만 교체: viewer 제외(admin 전용). INSERT/UPDATE(can_edit_military)/DELETE(없음)는 v2 그대로 유지.
drop policy military_module_select on public.military_module_data;
create policy military_module_select on public.military_module_data
  for select to authenticated
  using (tenant_id = 'default' and public.is_admin());

-- 사후 검증: 정책 여전히 3개
do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname='public' and tablename='military_module_data';
  if n <> 3 then raise exception '[검증실패] 최종 정책 %건(기대 3건).', n; end if;
end $$;

commit;
-- 확인: select policyname, cmd, qual from pg_policies where tablename='military_module_data';
