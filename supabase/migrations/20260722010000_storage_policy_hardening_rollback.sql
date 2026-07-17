-- ============================================================================
-- 롤백: 20260722010000_storage_policy_hardening.sql
--   Storage 쓰기 정책을 20260714010000 원본(authenticated only)으로 되돌린다.
--   read(public) 는 원본과 동일하므로 그대로 둔다. 파일 데이터는 무영향.
--   ※ 자동 실행되지 않습니다.
-- ============================================================================

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

drop function if exists public.is_active_authenticated();
