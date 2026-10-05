-- ============================================================================
-- [Storage DR] 버킷 프로비저닝 재현성 — idempotent (파괴적 작업 없음)
--   목적: 재해 시 새 Supabase 환경에서도 4개 버킷 + 정책을 "재현"할 수 있게 한다.
--   대상 버킷: cleaning-photos, inventory-proof, contract-files, generated-pdfs
--
--   안전 원칙(필수):
--     · DROP TABLE / DELETE / TRUNCATE / 버킷 재생성 없음 → 기존 버킷·object 완전 보존.
--     · insert ... on conflict (id) do nothing → 이미 있으면 그대로 둠(public 여부도 보존).
--     · 정책은 canonical 이름으로 drop-if-exists + create (= 중복이 아니라 "동일 이름 교체").
--       기존 migration(20260714010000 / 20260722010000 / 20260736000000)과 같은 이름·같은 의미를
--       사용하므로 중복 정책이 생기지 않는다. generated-pdfs 만 신규 이름을 쓴다.
--     · file_size_limit / allowed_mime_types 는 Production 과 동일하게 NULL 유지(기존 업로드 거부 방지).
--
--   ⚠ 이 파일은 LOCAL 재현/검증용으로 추가되었다. Production 적용은 사용자가 수동으로 결정한다.
-- ============================================================================

begin;

-- ── 0) 활성 인증 사용자 헬퍼(이미 있으면 재사용 · create or replace = 비중복) ──────────
create or replace function public.is_active_authenticated()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, true));
$$;

-- ── 1) 버킷 4종 보장(누락분만 생성, 기존은 보존) ────────────────────────────────
--   public 값은 Production 확인 결과와 동일: 공개 2 / 비공개 2.
insert into storage.buckets (id, name, public) values
  ('cleaning-photos', 'cleaning-photos', true),
  ('inventory-proof', 'inventory-proof', true),
  ('contract-files',  'contract-files',  false),
  ('generated-pdfs',  'generated-pdfs',  false)
on conflict (id) do nothing;

-- ── 2) 공개 버킷 정책(inventory-proof / cleaning-photos) — 하드닝본과 동일 ──────────
--   read 는 공개(공개 버킷), 쓰기(insert/update/delete)는 활성 인증 사용자만.
drop policy if exists "op_files_read" on storage.objects;
create policy "op_files_read" on storage.objects
  for select
  using (bucket_id in ('inventory-proof', 'cleaning-photos'));

drop policy if exists "op_files_insert" on storage.objects;
create policy "op_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('inventory-proof', 'cleaning-photos') and public.is_active_authenticated());

drop policy if exists "op_files_update" on storage.objects;
create policy "op_files_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('inventory-proof', 'cleaning-photos') and public.is_active_authenticated())
  with check (bucket_id in ('inventory-proof', 'cleaning-photos') and public.is_active_authenticated());

drop policy if exists "op_files_delete" on storage.objects;
create policy "op_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('inventory-proof', 'cleaning-photos') and public.is_active_authenticated());

-- ── 3) contract-files(Private) 정책 — DRAFT 승격(동일 이름·의미) ────────────────
--   공개 read 없음 → 활성 인증 사용자 + 서명 URL 전용.
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

-- ── 4) generated-pdfs(Private, 일시 산출물) 정책 — 신규 이름(중복 없음) ──────────
--   공개 read 없음. 활성 인증 사용자만 업로드/서명/정리. 영구 DR 아카이브 대상 아님(EPHEMERAL).
drop policy if exists "generated_pdfs_read" on storage.objects;
create policy "generated_pdfs_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'generated-pdfs' and public.is_active_authenticated());

drop policy if exists "generated_pdfs_insert" on storage.objects;
create policy "generated_pdfs_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'generated-pdfs' and public.is_active_authenticated());

drop policy if exists "generated_pdfs_update" on storage.objects;
create policy "generated_pdfs_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'generated-pdfs' and public.is_active_authenticated())
  with check (bucket_id = 'generated-pdfs' and public.is_active_authenticated());

drop policy if exists "generated_pdfs_delete" on storage.objects;
create policy "generated_pdfs_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'generated-pdfs' and public.is_active_authenticated());

commit;

-- ── 롤백(참고 · 수동) ────────────────────────────────────────────────────────
--   아래는 정책만 제거한다. 버킷/object 는 데이터 보존을 위해 자동 삭제하지 않는다.
--   drop policy if exists "generated_pdfs_read"   on storage.objects;
--   drop policy if exists "generated_pdfs_insert" on storage.objects;
--   drop policy if exists "generated_pdfs_update" on storage.objects;
--   drop policy if exists "generated_pdfs_delete" on storage.objects;
