-- ============================================================================
-- 설비별 인증단계 매핑 — exam_equipment_stage_rules (신규 · additive)
--   · "설비 하나가 어느 기준단계(level)에 해당하는지" 경량 매핑. Single~M4 판정의 "근거 입력"으로 사용
--     (설비 취득=즉시 확정 아님 · 최종 단계는 공정별 exam_rules.criteria 평가).
--   · tenant_id text('default' 표준). FK 는 실제 테이블(exam_categories/groups/processes/equipment/levels).
--   · RLS 표준 헬퍼(can_read_exam_master/is_exam_admin) 재사용 — 20260716 선행 필요.
--   ⚠ 운영 DB 자동 적용 금지.
-- ============================================================================
begin;

create table if not exists public.exam_equipment_stage_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  category_id uuid references public.exam_categories(id) on delete set null,
  group_id    uuid references public.exam_groups(id)     on delete set null,
  process_id  uuid not null references public.exam_processes(id) on delete cascade,
  equipment_id uuid not null references public.exam_equipment(id) on delete cascade,
  level_id    uuid not null references public.exam_levels(id) on delete restrict,
  is_core_equipment boolean not null default false,   -- 주력설비 여부
  sort_order int,
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_eqstage_effective_range check (effective_from is null or effective_to is null or effective_from <= effective_to)
);

create index if not exists ix_eqstage_tenant       on public.exam_equipment_stage_rules (tenant_id) where deleted_at is null;
create index if not exists ix_eqstage_tenant_proc   on public.exam_equipment_stage_rules (tenant_id, process_id) where deleted_at is null;
create index if not exists ix_eqstage_tenant_equip  on public.exam_equipment_stage_rules (tenant_id, equipment_id) where deleted_at is null;
create index if not exists ix_eqstage_tenant_level  on public.exam_equipment_stage_rules (tenant_id, level_id) where deleted_at is null;

-- 동일 tenant·equipment 의 "활성" 규칙 유효기간 겹침 차단.
--  btree_gist 필요(Supabase 지원). 미지원 환경이면 아래 EXCLUDE 를 주석 처리하고 앱 레벨 검증으로 대체.
create extension if not exists btree_gist;
alter table public.exam_equipment_stage_rules
  add constraint ex_eqstage_no_overlap
  exclude using gist (
    tenant_id with =,
    equipment_id with =,
    daterange(coalesce(effective_from, '-infinity'::date), coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (deleted_at is null and is_active);

alter table public.exam_equipment_stage_rules enable row level security;
drop policy if exists "exam_master_select" on public.exam_equipment_stage_rules;
drop policy if exists "exam_master_insert" on public.exam_equipment_stage_rules;
drop policy if exists "exam_master_update" on public.exam_equipment_stage_rules;
create policy "exam_master_select" on public.exam_equipment_stage_rules
  for select to authenticated using (public.can_read_exam_master());
create policy "exam_master_insert" on public.exam_equipment_stage_rules
  for insert to authenticated with check (public.is_exam_admin() and tenant_id is not null);
create policy "exam_master_update" on public.exam_equipment_stage_rules
  for update to authenticated using (public.is_exam_admin() and tenant_id is not null)
  with check (public.is_exam_admin() and tenant_id is not null);
-- DELETE 정책 없음 = 물리 삭제 차단(soft delete 만).

commit;

-- notify pgrst, 'reload schema';  -- 선택
