-- ============================================================================
-- 사용자 정의 권한(Custom Role) 관리 — 신규 테이블 2개 + RLS
--
-- [목적]
--   시스템 > 권한관리 화면에서 관리자가 "사용자 정의 권한"만 생성/복제/수정/사용중지/
--   Soft Delete 할 수 있게 하는 저장소를 추가한다.
--
-- [보호 원칙 — 매우 중요]
--   - 기존 profiles.role(System Role: admin/viewer/dorm_manager/maintenance_reporter)
--     컬럼과 값, 기존 RLS, 기존 테이블은 일절 건드리지 않는다.
--   - System Role 은 코드 상수로만 존재하며 이 테이블에 복사 저장하지 않는다(읽기 표시 전용).
--   - 이 마이그레이션은 신규 테이블 2개(custom_roles, custom_role_audit_logs)만 추가한다.
--   - custom_roles 는 아직 어떤 계정에도 배정되지 않는다(계정 연결은 다음 단계).
--
-- [권한 모델]
--   - 관리자 판정은 기존과 동일하게 profiles.role = 'admin' (App.tsx canEditData 기준).
--   - JWT 커스텀 클레임을 새로 만들지 않는다(config.toml 훅 비활성 유지).
--   - USING(true)/WITH CHECK(true), anon 쓰기, RLS 비활성화 없음.
--   - 물리 DELETE 정책 없음 → is_deleted=true 로 Soft Delete 만 허용.
--   - tenant_id 격리: 본인 tenant 행만 조회/쓰기.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    롤백: 20260718000000_custom_roles_rollback.sql
-- ============================================================================

-- ── 1) 관리자 판정 헬퍼 ──────────────────────────────────────────────────────
-- 정책 안에서 profiles 를 직접 조회하면 profiles 자신의 RLS 에 걸리므로 SECURITY DEFINER 로 감싼다.
-- (재귀 없음: profiles 정책은 custom_roles 를 참조하지 않는다.)
create or replace function public.is_custom_role_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'                 -- 기존 canEditData()/canManageUsers() 와 동일 기준
       and coalesce(p.is_active, true)
  );
$$;

-- ── 2) custom_roles 테이블 ───────────────────────────────────────────────────
create table if not exists public.custom_roles (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'default',
  code                 text not null,                 -- 소문자/숫자/_ , 첫 글자 영문 (앱에서 검증)
  name                 text not null,
  description          text,
  base_system_role     text,                          -- 템플릿으로 참조한 System Role 코드(문자열 스냅샷)
  role_type            text not null default 'custom', -- 항상 'custom' (System Role 은 저장하지 않음)
  is_active            boolean not null default true,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid,
  cloned_from_role_code text,                          -- 복제 출처(system 코드 또는 custom code)
  notes                text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);

-- tenant 내에서 활성(미삭제) 코드 유니크. 삭제된 코드는 재사용 가능하도록 부분 유니크 인덱스 사용.
create unique index if not exists custom_roles_tenant_code_active_uniq
  on public.custom_roles (tenant_id, code)
  where is_deleted = false;

create index if not exists custom_roles_tenant_idx on public.custom_roles (tenant_id);

-- ── 3) custom_role_audit_logs 테이블 ─────────────────────────────────────────
create table if not exists public.custom_role_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'default',
  role_id       uuid,
  action        text not null,             -- create | update | clone | deactivate | activate | soft_delete | restore
  before_data   jsonb,
  after_data    jsonb,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);

create index if not exists custom_role_audit_role_idx on public.custom_role_audit_logs (role_id);
create index if not exists custom_role_audit_tenant_idx on public.custom_role_audit_logs (tenant_id);

-- ── 4) RLS ───────────────────────────────────────────────────────────────────
alter table public.custom_roles enable row level security;
alter table public.custom_role_audit_logs enable row level security;

-- custom_roles: admin 만, 동일 tenant 만. SELECT/INSERT/UPDATE 분리. DELETE 정책 없음(물리삭제 차단).
drop policy if exists custom_roles_select on public.custom_roles;
create policy custom_roles_select on public.custom_roles
  for select to authenticated
  using (public.is_custom_role_admin());

drop policy if exists custom_roles_insert on public.custom_roles;
create policy custom_roles_insert on public.custom_roles
  for insert to authenticated
  with check (public.is_custom_role_admin() and role_type = 'custom');

drop policy if exists custom_roles_update on public.custom_roles;
create policy custom_roles_update on public.custom_roles
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin() and role_type = 'custom');

-- 감사로그: admin 삽입/조회만. 수정/삭제 정책 없음(불변 로그).
drop policy if exists custom_role_audit_select on public.custom_role_audit_logs;
create policy custom_role_audit_select on public.custom_role_audit_logs
  for select to authenticated
  using (public.is_custom_role_admin());

drop policy if exists custom_role_audit_insert on public.custom_role_audit_logs;
create policy custom_role_audit_insert on public.custom_role_audit_logs
  for insert to authenticated
  with check (public.is_custom_role_admin());

-- ── 5) 권한 부여 ─────────────────────────────────────────────────────────────
grant select, insert, update on public.custom_roles to authenticated;
grant select, insert on public.custom_role_audit_logs to authenticated;
-- anon 에는 어떤 쓰기 권한도 부여하지 않는다.

-- 재실행 안전(idempotent): 모든 오브젝트가 if not exists / or replace / drop-if-exists 로 보호됨.
