-- ============================================================================
-- 군대관리 v2 RLS 정책 교체 (LOCAL/STAGING 검증용 · Production 은 별도 승인 후)
-- ⚠ PRODUCTION 실행 금지 — 로컬/스테이징 검증 PASS 후에만 동일본을 승인받아 Production 적용.
-- 목표 권한:
--   admin  : SELECT O · INSERT O · UPDATE O · DELETE X
--   viewer : SELECT O · 나머지 X
--   dorm_manager / maintenance_reporter / anon / inactive : 전부 X
-- 전제(Production 진단): RLS 이미 ON · 기존 정책 2개(admin_all/select) · tenant_id='default' 단일.
--   → ENABLE RLS / GRANT hardening / tenant UNIQUE / 타 모듈 함수 수정 없음.
-- 원자 적용: safety guard 불일치 시 RAISE EXCEPTION 으로 전체 롤백(부분 적용 없음).
-- ============================================================================
begin;

-- ── 1) helper (SECURITY DEFINER · fail-closed: is_active IS TRUE) ──
create or replace function public.can_view_military()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','viewer') and p.is_active is true);
$$;
revoke all on function public.can_view_military() from public, anon;
grant execute on function public.can_view_military() to authenticated;

create or replace function public.can_edit_military()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active is true);
$$;
revoke all on function public.can_edit_military() from public, anon;
grant execute on function public.can_edit_military() to authenticated;

-- ── 2) safety guard: 진단(기존 정책 정의)과 정확히 일치할 때만 진행 ──
do $$
declare
  n_all int; n_sel int; n_conflict int;
begin
  -- 기존 admin_all: cmd=ALL, roles={authenticated}
  select count(*) into n_all from pg_policies
   where schemaname='public' and tablename='military_module_data'
     and policyname='military_module_data_admin_all' and cmd='ALL' and roles = '{authenticated}';
  -- 기존 select: cmd=SELECT, roles={authenticated}
  select count(*) into n_sel from pg_policies
   where schemaname='public' and tablename='military_module_data'
     and policyname='military_module_data_select' and cmd='SELECT' and roles = '{authenticated}';
  if n_all <> 1 or n_sel <> 1 then
    raise exception '[중단] 기존 정책이 진단과 다릅니다(admin_all=%, select=%). 수동 검토 필요.', n_all, n_sel;
  end if;
  -- 신규 정책명이 이미 있으면 이전 시도 잔여물 → 중단
  select count(*) into n_conflict from pg_policies
   where schemaname='public' and tablename='military_module_data'
     and policyname in ('military_module_select','military_module_insert','military_module_update');
  if n_conflict <> 0 then
    raise exception '[중단] 신규 정책명이 이미 존재(%건). rollback 후 재시도.', n_conflict;
  end if;
end $$;

-- ── 3) 신규 정책(admin/viewer 분리 · tenant_id 고정) ──
create policy military_module_select on public.military_module_data
  for select to authenticated
  using (tenant_id = 'default' and public.can_view_military());
create policy military_module_insert on public.military_module_data
  for insert to authenticated
  with check (tenant_id = 'default' and public.can_edit_military());
create policy military_module_update on public.military_module_data
  for update to authenticated
  using (tenant_id = 'default' and public.can_edit_military())
  with check (tenant_id = 'default' and public.can_edit_military());
-- DELETE 정책 없음 = 물리삭제 차단(RLS default deny)

-- ── 4) 기존 broad 정책 제거(permissive OR 무력화 방지) ──
drop policy military_module_data_admin_all on public.military_module_data;
drop policy military_module_data_select    on public.military_module_data;

-- ── 5) 사후 검증: 최종 정책 정확히 3개 ──
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='military_module_data';
  if n <> 3 then raise exception '[검증실패] 최종 정책 %건(기대 3건).', n; end if;
end $$;

commit;
-- 확인: select policyname, cmd, roles from pg_policies where tablename='military_module_data';
