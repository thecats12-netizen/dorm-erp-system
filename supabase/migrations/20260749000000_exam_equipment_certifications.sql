-- ============================================================================
-- 직원별 설비 취득 — exam_equipment_certifications (신규 · additive)
--   · "승인된 설비 취득"의 유일한 원천(source of truth). applications 는 시험/결과 원천(직접 취득 집계 금지).
--   · 상태(status): eligible/pending/approved/rejected/suspended/revoked/expired (DB 코드값 · UI 는 한글 표시).
--   · line_id 는 응시 스냅샷을 그대로 보존(UI 미표시). tenant_id text('default').
--   · RLS 표준 헬퍼 재사용. 운영 자동 적용 금지.
-- ============================================================================
begin;

create table if not exists public.exam_equipment_certifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  application_id uuid references public.exam_applications(id) on delete set null,   -- 원천 응시(파생 근거)
  category_id uuid references public.exam_categories(id) on delete set null,
  group_id    uuid references public.exam_groups(id)     on delete set null,
  process_id  uuid not null references public.exam_processes(id) on delete cascade,
  equipment_id uuid not null references public.exam_equipment(id) on delete cascade,
  level_id    uuid references public.exam_levels(id) on delete set null,
  acquired_date date,
  status text not null default 'eligible',
  source text not null default 'exam_application',   -- exam_application | manual
  line_id uuid references public.exam_lines(id) on delete set null,   -- 스냅샷(UI 미표시)
  requested_at timestamptz, requested_by uuid,
  approved_at timestamptz, approved_by uuid,
  rejected_at timestamptz, rejected_by uuid, rejection_reason text,
  revoked_at timestamptz, revoked_by uuid, revoke_reason text,
  exception_reason text,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_eqcert_status check (status in ('eligible','pending','approved','rejected','suspended','revoked','expired'))
);

create index if not exists ix_eqcert_tenant       on public.exam_equipment_certifications (tenant_id) where deleted_at is null;
create index if not exists ix_eqcert_person        on public.exam_equipment_certifications (tenant_id, personnel_id) where deleted_at is null;
create index if not exists ix_eqcert_equip         on public.exam_equipment_certifications (tenant_id, equipment_id) where deleted_at is null;
create index if not exists ix_eqcert_process       on public.exam_equipment_certifications (tenant_id, process_id) where deleted_at is null;
create index if not exists ix_eqcert_status        on public.exam_equipment_certifications (tenant_id, status) where deleted_at is null;
create index if not exists ix_eqcert_app           on public.exam_equipment_certifications (application_id) where deleted_at is null;

-- 동일 tenant·personnel·equipment 의 "approved 활성" 취득은 1건만(이력=eligible/pending/rejected/revoked 등은 다건 허용).
create unique index if not exists ux_eqcert_approved_one
  on public.exam_equipment_certifications (tenant_id, personnel_id, equipment_id)
  where deleted_at is null and status = 'approved';
-- 활성 후보(eligible/pending) 중복 억제(동일 조합 1건) — 이력 보존 위해 status 포함하지 않고 부분조건으로 제한.
create unique index if not exists ux_eqcert_open_candidate
  on public.exam_equipment_certifications (tenant_id, personnel_id, equipment_id)
  where deleted_at is null and status in ('eligible','pending');

alter table public.exam_equipment_certifications enable row level security;
drop policy if exists "exam_master_select" on public.exam_equipment_certifications;
drop policy if exists "exam_master_insert" on public.exam_equipment_certifications;
drop policy if exists "exam_master_update" on public.exam_equipment_certifications;
create policy "exam_master_select" on public.exam_equipment_certifications
  for select to authenticated using (public.can_read_exam_master());
create policy "exam_master_insert" on public.exam_equipment_certifications
  for insert to authenticated with check (public.is_exam_admin() and tenant_id is not null);
create policy "exam_master_update" on public.exam_equipment_certifications
  for update to authenticated using (public.is_exam_admin() and tenant_id is not null)
  with check (public.is_exam_admin() and tenant_id is not null);
-- DELETE 정책 없음 = 물리 삭제 차단(soft delete). 승인 취소는 status=revoked 로 이력 보존.

commit;

-- notify pgrst, 'reload schema';  -- 선택
