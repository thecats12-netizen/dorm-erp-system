-- ============================================================================
-- 인증 이력(History) — exam_certification_history (신규 · additive · append-only)
--   · 목적: "언제/누가/어떤 단계를/어떤 사유로/어떤 경로로" 취득했는지 영구 보존.
--     pm_certifications 는 최신 상태 관리용으로 그대로 유지, 본 테이블은 append-only 이력.
--   · 기존 테이블/컬럼/RLS/데이터 변경 없음. FK 는 실제 테이블 참조(on delete 로 이력 보존).
--   · RLS: 조회=can_read_exam_master(viewer 이상), append=exam actor(감사로그와 동일 정책).
--     UPDATE/DELETE 정책 없음 = 불변(append-only) 보장.
--   · 표준 헬퍼(can_read_exam_master/is_exam_admin) 선행 필요(20260730).
--   ⚠ 운영 DB 자동 적용 금지. additive only.
-- ============================================================================
begin;

create table if not exists public.exam_certification_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  process_id uuid references public.exam_processes(id) on delete set null,
  certification_type text,                          -- Single/M1~M4/PM/DM/Senior DM/Maestro 등(데이터 · 하드코딩 아님)
  level_id uuid references public.exam_levels(id) on delete set null,
  previous_level_id uuid references public.exam_levels(id) on delete set null,  -- 직전 단계(향후 경과개월 계산 근거)
  approved_at timestamptz,                           -- 확정(승인) 시각
  approved_by uuid,                                  -- 승인자
  source_type text,                                  -- 'pm_certification' / 'manual' / 'exam_application' 등
  source_id uuid,                                    -- 원천 레코드 id(pm_certifications.id 등)
  reason text,
  status text,                                       -- 'approved' 등(이력 시점 상태 스냅샷)
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,                                   -- 이력 기록자(actor)
  created_at timestamptz not null default now()
);

create index if not exists ix_certhist_tenant_person       on public.exam_certification_history (tenant_id, personnel_id);
create index if not exists ix_certhist_tenant_person_proc  on public.exam_certification_history (tenant_id, personnel_id, process_id);
create index if not exists ix_certhist_tenant_level        on public.exam_certification_history (tenant_id, level_id);
create index if not exists ix_certhist_tenant_approved_at  on public.exam_certification_history (tenant_id, approved_at);
create index if not exists ix_certhist_source              on public.exam_certification_history (tenant_id, source_type, source_id);

alter table public.exam_certification_history enable row level security;
drop policy if exists "certhist_select" on public.exam_certification_history;
drop policy if exists "certhist_insert" on public.exam_certification_history;
-- 조회: viewer 이상.
create policy "certhist_select" on public.exam_certification_history
  for select to authenticated using (public.can_read_exam_master());
-- append: exam actor(감사로그와 동일). UPDATE/DELETE 정책 없음 = 불변.
create policy "certhist_insert" on public.exam_certification_history
  for insert to authenticated
  with check ((public.is_exam_admin() or public.can_read_exam_master()) and tenant_id is not null);

commit;

-- notify pgrst, 'reload schema';  -- 선택
