-- ============================================================================
-- profiles RLS 정책 — 사용자관리/담당자 지정(삭제·복구·권한·dorm_id·is_deleted)이 영구 반영되도록 보정
-- (Supabase SQL Editor 에 붙여넣어 실행. 기존 데이터/행 삭제 없음. 멱등)
-- ----------------------------------------------------------------------------
-- 증상:
--   - 신입사원 "기숙사 담당자로 지정" 시 "담당자 지정 중 오류" 발생
--   - 사용자관리 삭제(is_active/is_deleted) 가 반영되지 않음
-- 원인 1 (가장 흔함): 무한 재귀(42P17)
--   - admin 판별을 위해 profiles 정책 안에서 다시 profiles 를 SELECT 하면
--     "infinite recursion detected in policy for relation profiles" 오류로 모든 접근 실패.
--   - 해결: SECURITY DEFINER 함수(public.is_admin)로 RLS 를 우회해 admin 판별.
-- 원인 2: admin 이 "다른 사용자 행"을 UPDATE/INSERT 할 정책 부재.
--   - 해결: 아래 update/insert 정책으로 admin 전체 허용.
-- ============================================================================

alter table public.profiles enable row level security;

-- ---- admin 판별 함수 (SECURITY DEFINER → 내부 SELECT 는 RLS 우회 → 재귀 없음) ----
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ---------------------------- SELECT ----------------------------
-- 본인 행은 항상 조회. admin 은 전체 조회.
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- ---------------------------- UPDATE ----------------------------
-- 본인 행 또는 admin. admin 은 role / is_active / dorm_id / is_deleted / deleted_at 등 전체 컬럼 수정 가능.
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------- INSERT ----------------------------
-- admin 은 profiles 행 생성 가능(담당자 자동 생성 fallback). 본인 행 생성도 허용.
drop policy if exists profiles_insert_admin on public.profiles;
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid() or public.is_admin());

-- (실제 삭제는 하지 않으므로 DELETE 정책 없음 — is_deleted=true 로 숨김 처리)

-- 확인:
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'profiles';
-- select public.is_admin();
