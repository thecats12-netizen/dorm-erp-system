-- 비품 증빙파일 / 청소사진 Supabase Storage 버킷 + 정책 생성
-- 목적: Base64/DB 직접 저장 대신 Storage 에 업로드하고 DB 에는 Public URL 만 저장(용량/속도 개선).
-- 정책: service_role_key 미사용(anon/authenticated + RLS). 공개 버킷(Public URL) 사용.
-- 적용: Supabase SQL Editor 에서 아래 전체를 1회 실행. (자동 실행하지 않음 — 관리자 검토 후 수동 적용)
--       버킷/정책이 없으면 앱은 기존 base64 저장으로 자동 폴백하므로, 이 SQL 적용 전에도 저장은 정상 동작한다.

-- 1) 공개 버킷 생성(이미 있으면 public 만 보정).
insert into storage.buckets (id, name, public)
values
  ('inventory-proof', 'inventory-proof', true),
  ('cleaning-photos', 'cleaning-photos', true)
on conflict (id) do update set public = excluded.public;

-- 2) 오브젝트 접근 정책(로그인 사용자 업로드/수정/삭제, 공개 읽기). 재실행 안전하게 drop 후 create.
drop policy if exists "op_files_read" on storage.objects;
create policy "op_files_read" on storage.objects
  for select to public
  using (bucket_id in ('inventory-proof', 'cleaning-photos'));

drop policy if exists "op_files_insert" on storage.objects;
create policy "op_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('inventory-proof', 'cleaning-photos'));

drop policy if exists "op_files_update" on storage.objects;
create policy "op_files_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('inventory-proof', 'cleaning-photos'))
  with check (bucket_id in ('inventory-proof', 'cleaning-photos'));

drop policy if exists "op_files_delete" on storage.objects;
create policy "op_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('inventory-proof', 'cleaning-photos'));
