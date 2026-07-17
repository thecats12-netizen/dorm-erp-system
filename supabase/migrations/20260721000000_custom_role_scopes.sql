-- ============================================================================
-- 사용자 정의 권한의 데이터 범위 — custom_role_scopes 테이블 + RLS + 인덱스
--
-- [목적]
--   custom_roles(사용자 정의 권한)에 데이터 범위(조직/지역/성별/기숙사/공정/소유)를
--   저장한다. 예: (region, 평택, read), (dorm, <uuid>, all), (owner, created_by_me, all).
--
-- [설계 결정]
--   - 시험관리 "공정 범위"는 이미 존재하는 exam_user_process_scopes(20260717000000)를
--     그대로 재사용한다(중복 테이블을 만들지 않음). 여기서는 process 를 참조 표기용으로만
--     선택 저장할 수 있으나, 실제 공정 접근 강제는 exam_user_process_scopes + 기존 RLS 가 담당.
--   - region/gender/dorm/owner/organization 범위는 custom_role_scopes 에 저장한다.
--   - add-only(합집합) 오버레이. 기존 role 의 지역/성별/담당기숙사 범위를 축소/제거하지 않는다.
--
-- [보호 원칙]
--   - 기존 profiles(role/site_access/gender_access/dorm_id) 컬럼·RLS·업무 테이블 무변경.
--   - 물리 DELETE 정책 없음 → is_active=false + deleted_at(Soft Delete).
--   - custom_roles(20260718000000) 선행 필요.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260718000000_custom_roles.sql
--    롤백: 20260721000000_custom_role_scopes_rollback.sql
-- ============================================================================

create table if not exists public.custom_role_scopes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete cascade,
  scope_type     text not null,             -- organization | region | gender | dorm | process | owner
  scope_value    text not null,             -- all | 평택 | 천안 | 남 | 여 | <dorm uuid> | assigned | created_by_me | assigned_to_me | approver_me
  action_scope   text not null default 'all', -- read | write | all (조회 전용 = read)
  is_active      boolean not null default true,
  valid_from     timestamptz,
  valid_until    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- 동일 역할에 같은 (범위종류,값,액션) 중복 금지.
create unique index if not exists custom_role_scopes_uniq
  on public.custom_role_scopes (tenant_id, custom_role_id, scope_type, scope_value, action_scope);

-- RLS/조회 성능 인덱스.
create index if not exists custom_role_scopes_role_idx on public.custom_role_scopes (tenant_id, custom_role_id) where is_active;
create index if not exists custom_role_scopes_type_idx on public.custom_role_scopes (tenant_id, scope_type) where is_active;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.custom_role_scopes enable row level security;

-- admin(is_custom_role_admin) 전체 관리. 본인에게 배정된 역할의 범위는 SELECT 로 읽어 병합에 사용.
drop policy if exists custom_role_scopes_select on public.custom_role_scopes;
create policy custom_role_scopes_select on public.custom_role_scopes
  for select to authenticated
  using (
    public.is_custom_role_admin()
    or exists (
      select 1 from public.user_custom_roles ucr
       where ucr.custom_role_id = custom_role_scopes.custom_role_id
         and ucr.user_id = auth.uid()
         and ucr.is_active
    )
  );

drop policy if exists custom_role_scopes_insert on public.custom_role_scopes;
create policy custom_role_scopes_insert on public.custom_role_scopes
  for insert to authenticated
  with check (public.is_custom_role_admin());

drop policy if exists custom_role_scopes_update on public.custom_role_scopes;
create policy custom_role_scopes_update on public.custom_role_scopes
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin());

grant select, insert, update on public.custom_role_scopes to authenticated;
-- anon 쓰기 없음.

-- ── (선택) 현재 사용자 허용 범위 조회 헬퍼 ────────────────────────────────────
-- 향후 업무 테이블 RLS 확장 시 재사용할 수 있는 SECURITY DEFINER 헬퍼(지금은 정의만).
--  기존 정책은 건드리지 않는다. 이 함수를 참조하는 정책은 이번 마이그레이션에서 만들지 않는다.
create or replace function public.my_custom_scope_values(p_scope_type text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select s.scope_value
    from public.custom_role_scopes s
    join public.user_custom_roles ucr
      on ucr.custom_role_id = s.custom_role_id
     and ucr.user_id = auth.uid()
     and ucr.is_active
   where s.scope_type = p_scope_type
     and s.is_active
     and coalesce(s.deleted_at is null, true)
     and (s.valid_from is null or s.valid_from <= now())
     and (s.valid_until is null or s.valid_until >= now());
$$;

-- 재실행 안전(idempotent).
