-- ============================================================================
-- profiles RLS 정책 — 사용자관리 삭제(비활성)/복구/권한수정이 영구 반영되도록 보정
-- (Supabase SQL Editor 에 붙여넣어 실행. 기존 데이터/행 삭제 없음)
-- ----------------------------------------------------------------------------
-- 증상:
--   - 사용자관리에서 "삭제"(is_active=false) 후 즉시 또는 새로고침 시 다시 나타남
-- 원인:
--   - profiles 에 RLS 가 켜져 있으나 admin 이 "다른 사용자 행"을 UPDATE 할 수 있는
--     정책이 없으면, UPDATE 가 0행만 매칭되어(오류 없이) 사실상 무시됨.
--     → 클라이언트는 성공처럼 보이지만 DB 의 is_active 는 그대로라 새로고침 시 복귀.
--
-- 해결:
--   - 본인 행은 항상 read/update 허용
--   - role='admin' 사용자는 전체 행 read/update 허용
--   - (실제 삭제는 하지 않으므로 DELETE 정책은 추가하지 않음)
-- ============================================================================

alter table public.profiles enable row level security;

-- 본인 프로필 조회
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- admin 은 전체 프로필 조회
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 본인 프로필 수정
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- admin 은 전체 프로필 수정 (is_active 비활성/복구, 권한/담당기숙사 변경)
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 확인: 아래로 현재 정책 목록 조회
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'profiles';
