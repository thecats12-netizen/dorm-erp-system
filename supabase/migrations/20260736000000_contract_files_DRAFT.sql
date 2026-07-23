-- ============================================================================
-- [초안 · 자동 적용 금지] 자산관리 > 계약 관리 — 계약 첨부파일(Private Storage) + 메타 테이블
--   자산관리 단계별 확장 1단계: 계약 첨부파일 + 미리보기.
--
--   ⚠ 이 파일은 검토용 초안입니다. Supabase SQL Editor 에서 직접 실행해야 적용됩니다.
--   ⚠ 기존 dorm_contracts 테이블/컬럼은 건드리지 않습니다(기존 계약 저장 경로 무영향).
--     첨부파일은 별도 테이블 dorm_contract_files 에만 기록 → 기존 upsert 와 완전 분리(PGRST204 위험 없음).
--   ⚠ 버킷은 Private(공개 아님). 조회는 서명 URL(createSignedUrl)로만. service_role_key 미사용.
-- ============================================================================

begin;

-- ── 1) Private Storage 버킷: contract-files ────────────────────────────────
insert into storage.buckets (id, name, public)
values ('contract-files', 'contract-files', false)
on conflict (id) do nothing;

-- 활성 로그인 사용자 판정 헬퍼(이미 있으면 재사용 · 없으면 생성).
create or replace function public.is_active_authenticated()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, true));
$$;

-- read/insert/update/delete 모두 "활성 인증 사용자"로 제한(공개 read 없음 → 서명 URL 필수).
drop policy if exists "contract_files_read" on storage.objects;
create policy "contract_files_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated());

drop policy if exists "contract_files_insert" on storage.objects;
create policy "contract_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-files' and public.is_active_authenticated());

drop policy if exists "contract_files_update" on storage.objects;
create policy "contract_files_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated())
  with check (bucket_id = 'contract-files' and public.is_active_authenticated());

drop policy if exists "contract_files_delete" on storage.objects;
create policy "contract_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-files' and public.is_active_authenticated());

-- ── 2) 첨부 메타 테이블: dorm_contract_files ───────────────────────────────
--   contract_id 는 text(기존 dorm_contracts.id 형식 호환). 기숙사/계약 삭제 시에도 이력 보존(하드 FK·cascade 없음).
--   soft delete(deleted_at)로 휴지통/복구 지원.
create table if not exists public.dorm_contract_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  contract_id text not null,          -- 연결 계약 id(하드 FK 미사용 → 이력 보존)
  storage_path text not null,         -- contract-files 버킷 내 경로
  file_name text,
  mime text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz              -- 휴지통(soft delete)
);
create index if not exists ix_dorm_contract_files_contract on public.dorm_contract_files (tenant_id, contract_id) where deleted_at is null;

alter table public.dorm_contract_files enable row level security;

-- tenant 범위 + 활성 인증 사용자만 접근(다른 tenant 조회/쓰기 차단).
drop policy if exists "dcf_select" on public.dorm_contract_files;
create policy "dcf_select" on public.dorm_contract_files
  for select to authenticated using (public.is_active_authenticated());

drop policy if exists "dcf_insert" on public.dorm_contract_files;
create policy "dcf_insert" on public.dorm_contract_files
  for insert to authenticated with check (public.is_active_authenticated());

drop policy if exists "dcf_update" on public.dorm_contract_files;
create policy "dcf_update" on public.dorm_contract_files
  for update to authenticated using (public.is_active_authenticated()) with check (public.is_active_authenticated());

commit;

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   drop table if exists public.dorm_contract_files;
--   drop policy if exists "contract_files_read"   on storage.objects;
--   drop policy if exists "contract_files_insert" on storage.objects;
--   drop policy if exists "contract_files_update" on storage.objects;
--   drop policy if exists "contract_files_delete" on storage.objects;
--   delete from storage.buckets where id = 'contract-files';  -- (버킷에 파일이 없을 때만)
