-- ============================================================================
-- 모바일/태블릿 PDF 다운로드용 Storage 버킷 (Supabase SQL Editor 에서 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 모바일에서 blob URL 다운로드가 "파일에 액세스할 수 없음" 오류를 내므로,
-- 생성한 PDF/인쇄문서를 이 버킷에 임시 업로드한 뒤 10분 signed URL 로 연다.
-- - private 버킷(public=false) + signed URL 권장.
-- - 클라이언트는 anon key + 아래 RLS 로만 접근(service_role_key 노출 금지).
-- - 앱은 `${tenant_id}/pdf-temp/...` 경로에 업로드한다.
-- ============================================================================

-- 1) 버킷 생성(비공개)
insert into storage.buckets (id, name, public)
  values ('generated-pdfs', 'generated-pdfs', false)
  on conflict (id) do nothing;

-- 2) RLS 정책: 로그인(authenticated) 사용자에게 이 버킷에 대한 CRUD 허용.
--    (tenant 단위 경로 제한을 강화하려면 아래 정책의 using/with check 에 경로 조건을 추가.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'generated_pdfs_authenticated_all'
  ) then
    create policy generated_pdfs_authenticated_all
      on storage.objects
      for all
      to authenticated
      using (bucket_id = 'generated-pdfs')
      with check (bucket_id = 'generated-pdfs');
  end if;
end $$;

-- (선택) tenant 경로 격리 강화 예시 — 폴더 첫 세그먼트를 tenant_id 로 쓰는 경우:
--   using (bucket_id = 'generated-pdfs' and (storage.foldername(name))[1] = auth.jwt()->>'tenant_id')
--   with check (bucket_id = 'generated-pdfs' and (storage.foldername(name))[1] = auth.jwt()->>'tenant_id')

-- (선택) 오래된 임시 PDF 정리: 스토리지 사용량 관리를 위해 주기적으로 실행하거나
--        Storage 수명주기 규칙을 설정하세요. 앱은 signed URL(10분)만 사용하므로 파일은 남습니다.
-- delete from storage.objects
--   where bucket_id = 'generated-pdfs' and created_at < now() - interval '7 days';
