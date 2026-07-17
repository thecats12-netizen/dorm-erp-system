-- ============================================================================
-- [선택 · 비파괴] Storage 정책 최소 강화 — inventory-proof / cleaning-photos
--
-- [현재 상태]
--   두 버킷은 public=true 이고, 앱은 DB 에 "Public URL" 을 저장해 <img src=publicUrl> 로
--   직접 표시한다(20260714010000). 따라서 버킷을 private 로 바꾸거나 read 를 authenticated
--   전용으로 바꾸면 기존 사진/증빙 표시가 즉시 깨진다. → read(public) 는 그대로 둔다.
--
-- [이번 강화(비파괴)]
--   - 쓰기(insert/update/delete)는 "authenticated + 활성 프로필 보유자" 로 최소 강화한다.
--     (익명/삭제된 계정 업로드·삭제 차단. 기존 로그인 사용자 업로드는 그대로 동작.)
--   - 진정한 다운로드 범위 강제(서명 URL + record 단위 권한)는 앱측 대량 수정이 필요하므로
--     이번 단계에서 강제하지 않는다(다음 단계 권장). 아래는 그 방향의 준비다.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 검토 후 1회 실행. 선택 사항입니다.
--    롤백: 20260722010000_storage_policy_hardening_rollback.sql
-- ============================================================================

-- 활성 로그인 사용자 판정(삭제/비활성 계정 쓰기 차단용).
create or replace function public.is_active_authenticated()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and coalesce(p.is_active, true)
  );
$$;

-- read: 기존 public 유지(이미지 표시 보존). 정책 이름 동일하게 재생성(재실행 안전).
drop policy if exists "op_files_read" on storage.objects;
create policy "op_files_read" on storage.objects
  for select to public
  using (bucket_id in ('inventory-proof', 'cleaning-photos'));

-- insert/update/delete: authenticated + 활성 프로필.
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
