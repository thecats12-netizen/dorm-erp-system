-- ============================================================================
-- [Storage DR · Release-Prep] 작업/감사 테이블 + 아카이브 버킷 + tenant 경계 강화
--   · storage_dr_jobs: 서버 아카이브/복원 작업의 감사·idempotency 원장.
--   · dr-archive 버킷(Private): 서버(service_role)만 접근. 기본 어댑터 목적지(외부 provider 전까지).
--   · current_tenant_id(): auth.uid() → profiles.tenant_id (SECURITY DEFINER).
--   · contract-files: 이미 {tenantId}/... 경로 → 1번째 폴더=tenant RLS 강제(교차테넌트 차단).
--     cleaning-photos/inventory-proof 는 레거시 경로(tenant 없음) → 여기서 건드리지 않는다(호환 보존).
--
--   안전: DROP TABLE/DELETE/TRUNCATE 없음. insert on conflict do nothing. 정책은 이름 교체(비중복).
--   ⚠ LOCAL 재현/검증용. Production 적용은 사용자 수동 결정.
-- ============================================================================

begin;

-- ── 0) tenant 헬퍼 ───────────────────────────────────────────────────────────
create or replace function public.current_tenant_id()
returns text language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid();
$$;

-- ── 1) 작업/감사 원장 ────────────────────────────────────────────────────────
create table if not exists public.storage_dr_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,          -- idempotency 키(동일 요청 재실행 방지)
  tenant_id text not null,
  action text not null check (action in ('archive','restore')),
  status text not null default 'running' check (status in ('running','completed','failed','partial')),
  started_by uuid,                          -- auth.uid()
  adapter text,                             -- 어댑터 이름(민감정보 아님)
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total int not null default 0,
  archived int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  total_bytes bigint not null default 0,
  retries int not null default 0,
  failed_objects jsonb,                     -- [{bucket,objectPath,error}] — URL/token 미포함
  note text
);
create index if not exists ix_storage_dr_jobs_tenant on public.storage_dr_jobs (tenant_id, started_at desc);

alter table public.storage_dr_jobs enable row level security;

-- 조회: 같은 tenant 의 활성 관리자만(감사 열람). 쓰기는 서버(service_role, RLS 우회)만.
drop policy if exists "sdj_select" on public.storage_dr_jobs;
create policy "sdj_select" on public.storage_dr_jobs
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and coalesce(p.is_active, true) and p.deleted_at is null)
  );

-- ── 2) 아카이브 목적지 버킷(Private) — 서버 전용 ────────────────────────────────
--   authenticated/anon 정책을 만들지 않는다 → RLS 기본 거부. service_role 만 접근(원본 바이너리 보호).
insert into storage.buckets (id, name, public)
values ('dr-archive', 'dr-archive', false)
on conflict (id) do nothing;

-- ── 3) contract-files tenant 경로 RLS 강제(이미 {tenantId}/... 구조 → 호환 안전) ──
--   기존 is_active_authenticated 조건에 "1번째 폴더 = 내 tenant" 를 추가해 교차테넌트 차단.
drop policy if exists "contract_files_read" on storage.objects;
create policy "contract_files_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated()
         and (storage.foldername(name))[1] = public.current_tenant_id());

drop policy if exists "contract_files_insert" on storage.objects;
create policy "contract_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-files' and public.is_active_authenticated()
              and (storage.foldername(name))[1] = public.current_tenant_id());

drop policy if exists "contract_files_update" on storage.objects;
create policy "contract_files_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated()
         and (storage.foldername(name))[1] = public.current_tenant_id())
  with check (bucket_id = 'contract-files' and public.is_active_authenticated()
              and (storage.foldername(name))[1] = public.current_tenant_id());

drop policy if exists "contract_files_delete" on storage.objects;
create policy "contract_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated()
         and (storage.foldername(name))[1] = public.current_tenant_id());

commit;

-- ── 롤백(참고 · 수동) ────────────────────────────────────────────────────────
--   drop table if exists public.storage_dr_jobs;  -- (감사 이력 보존 필요 시 미실행)
--   -- contract_files_* 정책은 20260901000000 버전(테넌트 조건 없는 형태)으로 되돌릴 수 있음.
--   -- dr-archive 버킷/object 는 데이터 보존을 위해 자동 삭제하지 않는다.
