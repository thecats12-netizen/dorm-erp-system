-- ============================================================================
-- 월별 TO 시뮬레이션 — 시나리오 저장/불러오기/복제/비교 (신규 테이블 · 검토용 · 자동 실행 금지)
--   ⚠ base forecast/운영 원본 데이터는 저장하지 않는다. 사용자 가정(adjustments)만 저장 → 로드 시 현재 base 로 재계산.
--   ⚠ 멀티테넌트: tenant_id text 격리(현재 표준 'default', JWT tenant_id 클레임 있으면 일치 강제).
--   ⚠ 역할: 관리자(is_custom_role_admin)는 tenant 전체 관리, 그 외는 본인 소유(created_by=auth.uid())만 수정/삭제.
--      viewer 읽기 전용은 클라이언트 canEdit + INSERT 정책(created_by 강제)으로 보완(세밀 역할은 custom_role 권한체계로 확장).
--   ⚠ Supabase SQL Editor 에서 검토 후 1회 실행. 운영 DB 자동 적용 금지. 선행: 20260723(custom_roles/is_custom_role_admin).
-- ============================================================================
begin;

-- ── 시나리오(헤더) ─────────────────────────────────────────────────────────
create table if not exists public.operation_simulation_scenarios (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'default',
  name        text not null,
  base_year   int  not null,
  description text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_opsim_scn_tenant on public.operation_simulation_scenarios (tenant_id) where is_active;
-- tenant+base_year 당 기본안 1개(부분 유니크). is_default=false 는 제약 없음.
create unique index if not exists ux_opsim_scn_default on public.operation_simulation_scenarios (tenant_id, base_year) where is_default and is_active;

-- ── 조정값(가정) ───────────────────────────────────────────────────────────
create table if not exists public.operation_simulation_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default 'default',
  scenario_id         uuid not null references public.operation_simulation_scenarios(id) on delete cascade,
  target_year         int  not null,
  target_month        int  not null check (target_month between 1 and 12),
  region              text,               -- '전체'|'평택'|'천안'
  gender              text,               -- '전체'|'남'|'여'
  dormitory_id        uuid,               -- nullable(지역/성별 집계 기준 · 특정 기숙사 지정 시 사용)
  adjustment_type     text not null,      -- 직접 인원 증감/신규입주 증가·감소/퇴거±/천안이동±/해지 증가/추가입차/TO±
  quantity            int  not null,
  repeat_until_year   int,                -- nullable(반복 종료)
  repeat_until_month  int  check (repeat_until_month between 1 and 12),
  notes               text,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists ix_opsim_adj_scn on public.operation_simulation_adjustments (scenario_id);
create index if not exists ix_opsim_adj_tenant on public.operation_simulation_adjustments (tenant_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.operation_simulation_scenarios   enable row level security;
alter table public.operation_simulation_adjustments enable row level security;

-- JWT tenant_id 클레임이 있으면 일치(멀티테넌트 대비), 없으면 통과(현재 단일 'default'). 활성 로그인 필수.
create or replace function public.opsim_tenant_ok(p_tenant text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
     and (p_tenant is not null and p_tenant <> '')
     and (coalesce(auth.jwt() ->> 'tenant_id', p_tenant) = p_tenant);
$$;

-- [시나리오] SELECT: 같은 tenant 인증 사용자(viewer 포함 조회).
drop policy if exists opsim_scn_select on public.operation_simulation_scenarios;
create policy opsim_scn_select on public.operation_simulation_scenarios for select
  using (public.opsim_tenant_ok(tenant_id));
-- INSERT: 같은 tenant + created_by=본인(위조 방지).
drop policy if exists opsim_scn_insert on public.operation_simulation_scenarios;
create policy opsim_scn_insert on public.operation_simulation_scenarios for insert
  with check (public.opsim_tenant_ok(tenant_id) and created_by = auth.uid());
-- UPDATE/DELETE: 본인 소유 또는 관리자.
drop policy if exists opsim_scn_update on public.operation_simulation_scenarios;
create policy opsim_scn_update on public.operation_simulation_scenarios for update
  using (public.opsim_tenant_ok(tenant_id) and (created_by = auth.uid() or public.is_custom_role_admin()))
  with check (public.opsim_tenant_ok(tenant_id));
drop policy if exists opsim_scn_delete on public.operation_simulation_scenarios;
create policy opsim_scn_delete on public.operation_simulation_scenarios for delete
  using (public.opsim_tenant_ok(tenant_id) and (created_by = auth.uid() or public.is_custom_role_admin()));

-- [조정값] 부모 시나리오 소유/관리자 기준(같은 tenant). SELECT 는 tenant 조회.
drop policy if exists opsim_adj_select on public.operation_simulation_adjustments;
create policy opsim_adj_select on public.operation_simulation_adjustments for select
  using (public.opsim_tenant_ok(tenant_id));
drop policy if exists opsim_adj_write on public.operation_simulation_adjustments;
create policy opsim_adj_write on public.operation_simulation_adjustments for all
  using (public.opsim_tenant_ok(tenant_id) and exists (
    select 1 from public.operation_simulation_scenarios s
     where s.id = scenario_id and (s.created_by = auth.uid() or public.is_custom_role_admin())))
  with check (public.opsim_tenant_ok(tenant_id) and exists (
    select 1 from public.operation_simulation_scenarios s
     where s.id = scenario_id and (s.created_by = auth.uid() or public.is_custom_role_admin())));

grant select, insert, update, delete on public.operation_simulation_scenarios   to authenticated;
grant select, insert, update, delete on public.operation_simulation_adjustments to authenticated;

commit;

-- ── 롤백 ────────────────────────────────────────────────────────────────────
--   drop table if exists public.operation_simulation_adjustments;
--   drop table if exists public.operation_simulation_scenarios;
--   drop function if exists public.opsim_tenant_ok(text);
