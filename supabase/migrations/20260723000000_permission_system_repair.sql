-- ============================================================================
-- 권한관리 DB 구조 통합 복구 (단일 · 의존성 순서 · 재실행 안전 · tenant/보안 강화)
--
-- [실제 시스템 역할 — 코드 검증 결과]
--   domain.ts UserRole = 'admin' | 'viewer' | 'dorm_manager' | 'maintenance_reporter'
--   → super_admin / operator / manager 는 존재하지 않는다(코드 주석에도 "super_admin 없음" 명시).
--   따라서 최고관리자 = 'admin' 뿐이며 is_custom_role_admin() 은 role='admin' 로 판정한다.
--
-- [tenant 구조 — 코드 검증 결과]
--   profiles 에는 tenant_id 컬럼이 없다(App.tsx:6532 "profiles 는 tenant_id 컬럼이 없을 수 있어").
--   앱은 클라이언트 상수 tenantId='default' 단일 tenant 로 동작한다.
--   → current_user_tenant_id() 는 활성 인증 사용자에 대해 'default' 를 반환(향후 실제 컬럼 도입 시 이 함수만 교체).
--   → 그럼에도 신규 테이블의 WITH CHECK 에서 tenant_id = current_user_tenant_id() 로 "외부 tenant 값 주입"을
--     차단하고, 연결 대상(custom_role_id 등)의 tenant 일치를 강제해 멀티테넌트 확장에 대비한다.
--
-- [프론트 계약]
--   custom_role_permissions 는 permission_key(TEXT) 를 직접 저장(permission_id/permissions 마스터 없음).
--
-- [안전 원칙]
--   create table/index/function if not exists · create or replace · drop policy if exists 후 재생성만 사용.
--   drop table / drop column / truncate / cascade / 기존 role 업데이트 / 데이터 삭제 없음. anon 쓰기 없음.
--   기존 profiles/시스템 role/하자접수/기존 업무 RLS 무변경. 자동 배정/변환 없음.
--   ※ profiles 를 변경하는 마지막-admin 보호 트리거는 이 파일에서 제외 →
--     supabase/migrations/20260723010000_protect_last_admin.sql (별도, 자동 실행 금지).
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 이 파일 전체를 1회 실행하세요.
--    롤백: supabase/rollback/20260723000000_permission_system_repair_rollback.sql
--    검증: supabase/diagnostics/permission_system_verify.sql
-- ============================================================================

begin;

-- ── 0) extension ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── 1) 독립 helper (테이블 미참조 또는 profiles 만 참조 → 정책보다 먼저) ────────
-- 최고관리자 판정: 이 프로젝트의 유일한 최상위 role 은 'admin'.
create or replace function public.is_custom_role_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin' and coalesce(p.is_active, true)
  );
$$;

-- 현재 사용자 tenant: profiles.tenant_id 컬럼이 없어 단일 tenant 'default' 반환(활성 사용자만).
--  → WITH CHECK 에서 외부 tenant 값 주입 차단 + 활성 인증 사용자만 쓰기 허용.
create or replace function public.current_user_tenant_id()
returns text language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, true)
  ) then 'default' else null end;
$$;

-- 권한상승 차단(순수 문자열 판정 · immutable). 관리자 전용 탭 기능 + admin_config 액션은 부여 금지.
--  permissionCatalog 실제 키 형식 = `${tabKey}.${action}` (예: users.admin_config, permissions.admin_config,
--  settings.admin_config, cleaningReports.create). 정상 조회/쓰기 키는 허용, 관리자 전용만 차단.
create or replace function public.crp_is_grantable_key(p_key text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when split_part(p_key, '.', 1) in ('users','permissions','settings','recycleBin','militarySettings') then false
    when split_part(p_key, '.', 2) in ('admin_config','audit_view') then false   -- 관리자 설정/감사로그 열람은 부여 금지
    else true
  end;
$$;

-- ── 2) custom_roles + 감사로그 (CHECK 제약 포함) ──────────────────────────────
create table if not exists public.custom_roles (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'default',
  code                  text not null,
  name                  text not null,
  description           text,
  base_system_role      text,
  role_type             text not null default 'custom' check (role_type = 'custom'),
  is_active             boolean not null default true,
  is_deleted            boolean not null default false,
  deleted_at            timestamptz,
  deleted_by            uuid,
  cloned_from_role_code text,
  notes                 text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_at            timestamptz not null default now()
);
alter table public.custom_roles add column if not exists description text;
alter table public.custom_roles add column if not exists base_system_role text;
alter table public.custom_roles add column if not exists role_type text not null default 'custom';
alter table public.custom_roles add column if not exists is_active boolean not null default true;
alter table public.custom_roles add column if not exists is_deleted boolean not null default false;
alter table public.custom_roles add column if not exists deleted_at timestamptz;
alter table public.custom_roles add column if not exists deleted_by uuid;
alter table public.custom_roles add column if not exists cloned_from_role_code text;
alter table public.custom_roles add column if not exists notes text;
alter table public.custom_roles add column if not exists created_by uuid;
alter table public.custom_roles add column if not exists updated_by uuid;

create table if not exists public.custom_role_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'default',
  role_id       uuid,
  action        text not null,
  before_data   jsonb,
  after_data    jsonb,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);

-- ── 3) custom_role_permissions (custom_roles 참조 · on delete restrict) ──────
create table if not exists public.custom_role_permissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete restrict,
  permission_key text not null check (length(btrim(permission_key)) > 0),
  effect         text not null default 'allow' check (effect = 'allow'),
  is_active      boolean not null default true,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
alter table public.custom_role_permissions add column if not exists effect text not null default 'allow';
alter table public.custom_role_permissions add column if not exists is_active boolean not null default true;
alter table public.custom_role_permissions add column if not exists deleted_at timestamptz;

-- ── 4) custom_role_scopes (custom_roles 참조 · on delete restrict) ───────────
create table if not exists public.custom_role_scopes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete restrict,
  scope_type     text not null check (length(btrim(scope_type)) > 0),
  scope_value    text not null check (length(btrim(scope_value)) > 0),
  action_scope   text not null default 'all',
  is_active      boolean not null default true,
  valid_from     timestamptz,
  valid_until    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint custom_role_scopes_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
alter table public.custom_role_scopes add column if not exists action_scope text not null default 'all';
alter table public.custom_role_scopes add column if not exists valid_from timestamptz;
alter table public.custom_role_scopes add column if not exists valid_until timestamptz;
alter table public.custom_role_scopes add column if not exists deleted_at timestamptz;

-- ── 5) user_custom_roles (custom_roles 참조 · on delete restrict 유지) ───────
create table if not exists public.user_custom_roles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  user_id        uuid not null,
  custom_role_id uuid not null references public.custom_roles(id) on delete restrict,
  is_active      boolean not null default true,
  valid_from     timestamptz,
  valid_until    timestamptz,
  assigned_by    uuid,
  assigned_at    timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint user_custom_roles_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
alter table public.user_custom_roles add column if not exists valid_from timestamptz;
alter table public.user_custom_roles add column if not exists valid_until timestamptz;
alter table public.user_custom_roles add column if not exists deleted_at timestamptz;

-- ── 6) security_audit_logs ───────────────────────────────────────────────────
create table if not exists public.security_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  actor_user_id  uuid,
  target_user_id uuid,
  action         text not null,
  resource_type  text,
  resource_id    text,
  permission_key text,
  result         text,
  reason         text,
  user_agent     text,
  created_at     timestamptz not null default now()
);

-- ── 7) 유니크 / 인덱스 ────────────────────────────────────────────────────────
create unique index if not exists custom_roles_tenant_code_active_uniq
  on public.custom_roles (tenant_id, code) where is_deleted = false;
create index if not exists custom_roles_tenant_idx on public.custom_roles (tenant_id);
create index if not exists custom_role_audit_role_idx on public.custom_role_audit_logs (role_id);

create unique index if not exists custom_role_permissions_uniq
  on public.custom_role_permissions (tenant_id, custom_role_id, permission_key);
create index if not exists crp_role_active_idx on public.custom_role_permissions (custom_role_id, is_active);

create unique index if not exists custom_role_scopes_uniq
  on public.custom_role_scopes (tenant_id, custom_role_id, scope_type, scope_value, action_scope);
create index if not exists crs_role_type_idx on public.custom_role_scopes (custom_role_id, scope_type, scope_value);

create unique index if not exists user_custom_roles_uniq
  on public.user_custom_roles (tenant_id, user_id, custom_role_id);
create index if not exists ucr_user_active_idx on public.user_custom_roles (user_id, tenant_id, is_active);

create index if not exists security_audit_tenant_idx on public.security_audit_logs (tenant_id, created_at desc);
create index if not exists security_audit_actor_idx on public.security_audit_logs (actor_user_id);

-- ── 8) 연결 무결성 helper (테이블 이후, 정책 이전) ─────────────────────────────
-- custom_role_id 가 같은 tenant 의 custom_roles 를 가리키는지(타 tenant role 연결 차단).
create or replace function public.cr_role_in_tenant(p_role_id uuid, p_tenant text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.custom_roles r where r.id = p_role_id and r.tenant_id = p_tenant);
$$;
-- 배정 대상 user_id 가 활성 프로필인지(존재/활성 검증). profiles 에 tenant_id 가 없어 tenant 대조는 불가 →
-- 활성 프로필 존재만 강제(단일 tenant 'default' 전제). 향후 컬럼 도입 시 tenant 대조 추가.
create or replace function public.cr_user_is_active(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and coalesce(p.is_active, true));
$$;

-- ── 9) RLS 활성화 ─────────────────────────────────────────────────────────────
alter table public.custom_roles            enable row level security;
alter table public.custom_role_audit_logs  enable row level security;
alter table public.custom_role_permissions enable row level security;
alter table public.custom_role_scopes      enable row level security;
alter table public.user_custom_roles       enable row level security;
alter table public.security_audit_logs     enable row level security;

-- ── 10) 정책 (tenant 검증 포함 · 물리 DELETE 정책 없음) ───────────────────────
-- custom_roles: admin + 동일 tenant
drop policy if exists custom_roles_select on public.custom_roles;
create policy custom_roles_select on public.custom_roles for select to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id());
drop policy if exists custom_roles_insert on public.custom_roles;
create policy custom_roles_insert on public.custom_roles for insert to authenticated
  with check (public.is_custom_role_admin() and role_type = 'custom' and tenant_id = public.current_user_tenant_id());
drop policy if exists custom_roles_update on public.custom_roles;
create policy custom_roles_update on public.custom_roles for update to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
  with check (public.is_custom_role_admin() and role_type = 'custom' and tenant_id = public.current_user_tenant_id());

-- custom_role_audit_logs: admin + 동일 tenant
drop policy if exists custom_role_audit_select on public.custom_role_audit_logs;
create policy custom_role_audit_select on public.custom_role_audit_logs for select to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id());
drop policy if exists custom_role_audit_insert on public.custom_role_audit_logs;
create policy custom_role_audit_insert on public.custom_role_audit_logs for insert to authenticated
  with check (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id());

-- user_custom_roles: admin(동일 tenant) 또는 본인 배정 조회 / 쓰기 시 role·user tenant 무결성
drop policy if exists user_custom_roles_select on public.user_custom_roles;
create policy user_custom_roles_select on public.user_custom_roles for select to authenticated
  using (
    (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
    or user_id = auth.uid()
  );
drop policy if exists user_custom_roles_insert on public.user_custom_roles;
create policy user_custom_roles_insert on public.user_custom_roles for insert to authenticated
  with check (
    public.is_custom_role_admin()
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
    and public.cr_user_is_active(user_id)
  );
drop policy if exists user_custom_roles_update on public.user_custom_roles;
create policy user_custom_roles_update on public.user_custom_roles for update to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
  with check (
    public.is_custom_role_admin()
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
    and public.cr_user_is_active(user_id)
  );

-- custom_role_permissions: admin(동일 tenant) 또는 본인 배정 역할 조회 / 권한상승 차단 + role tenant 무결성
drop policy if exists custom_role_permissions_select on public.custom_role_permissions;
create policy custom_role_permissions_select on public.custom_role_permissions for select to authenticated
  using (
    (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
    or exists (select 1 from public.user_custom_roles ucr
                where ucr.custom_role_id = custom_role_permissions.custom_role_id
                  and ucr.user_id = auth.uid() and ucr.is_active
                  and ucr.tenant_id = custom_role_permissions.tenant_id)
  );
drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
create policy custom_role_permissions_insert on public.custom_role_permissions for insert to authenticated
  with check (
    public.is_custom_role_admin() and effect = 'allow'
    and public.crp_is_grantable_key(permission_key)
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
  );
drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
create policy custom_role_permissions_update on public.custom_role_permissions for update to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
  with check (
    public.is_custom_role_admin() and effect = 'allow'
    and public.crp_is_grantable_key(permission_key)
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
  );

-- custom_role_scopes: admin(동일 tenant) 또는 본인 배정 역할 조회 / role tenant 무결성
drop policy if exists custom_role_scopes_select on public.custom_role_scopes;
create policy custom_role_scopes_select on public.custom_role_scopes for select to authenticated
  using (
    (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
    or exists (select 1 from public.user_custom_roles ucr
                where ucr.custom_role_id = custom_role_scopes.custom_role_id
                  and ucr.user_id = auth.uid() and ucr.is_active
                  and ucr.tenant_id = custom_role_scopes.tenant_id)
  );
drop policy if exists custom_role_scopes_insert on public.custom_role_scopes;
create policy custom_role_scopes_insert on public.custom_role_scopes for insert to authenticated
  with check (
    public.is_custom_role_admin()
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
  );
drop policy if exists custom_role_scopes_update on public.custom_role_scopes;
create policy custom_role_scopes_update on public.custom_role_scopes for update to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id())
  with check (
    public.is_custom_role_admin()
    and tenant_id = public.current_user_tenant_id()
    and public.cr_role_in_tenant(custom_role_id, tenant_id)
  );

-- security_audit_logs: admin 조회(동일 tenant) / 본인·admin 삽입(동일 tenant)
drop policy if exists security_audit_select on public.security_audit_logs;
create policy security_audit_select on public.security_audit_logs for select to authenticated
  using (public.is_custom_role_admin() and tenant_id = public.current_user_tenant_id());
drop policy if exists security_audit_insert on public.security_audit_logs;
create policy security_audit_insert on public.security_audit_logs for insert to authenticated
  with check (
    (actor_user_id = auth.uid() or public.is_custom_role_admin())
    and tenant_id = public.current_user_tenant_id()
  );

-- ── 11) 실제 권한/범위 판정 함수 (만료·삭제·비활성·tenant 전부 검증) ─────────────
create or replace function public.crp_user_has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_permissions crp
      join public.user_custom_roles ucr on ucr.custom_role_id = crp.custom_role_id
      join public.custom_roles r        on r.id = crp.custom_role_id
     where crp.permission_key = p_key
       and crp.is_active and crp.effect = 'allow' and crp.deleted_at is null
       and ucr.user_id = auth.uid() and ucr.is_active and ucr.deleted_at is null
       and (ucr.valid_from  is null or ucr.valid_from  <= now())
       and (ucr.valid_until is null or ucr.valid_until >= now())
       and r.is_active and r.is_deleted = false and r.deleted_at is null
       and crp.tenant_id = ucr.tenant_id and r.tenant_id = ucr.tenant_id
       and ucr.tenant_id = public.current_user_tenant_id()
  );
$$;

create or replace function public.crs_user_scope_allows(p_type text, p_value text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_scopes s
      join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id
      join public.custom_roles r        on r.id = s.custom_role_id
     where s.scope_type = p_type and (s.scope_value = p_value or s.scope_value = 'all')
       and s.is_active and s.deleted_at is null
       and (s.valid_from  is null or s.valid_from  <= now())
       and (s.valid_until is null or s.valid_until >= now())
       and ucr.user_id = auth.uid() and ucr.is_active and ucr.deleted_at is null
       and (ucr.valid_from  is null or ucr.valid_from  <= now())
       and (ucr.valid_until is null or ucr.valid_until >= now())
       and r.is_active and r.is_deleted = false and r.deleted_at is null
       and s.tenant_id = ucr.tenant_id and r.tenant_id = ucr.tenant_id
       and ucr.tenant_id = public.current_user_tenant_id()
  );
$$;

create or replace function public.can_user_access_region(p_region text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin() or public.crs_user_scope_allows('region', p_region);
$$;
create or replace function public.can_user_access_gender(p_gender text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin() or public.crs_user_scope_allows('gender', p_gender);
$$;
create or replace function public.can_user_access_dorm(p_dorm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin() or public.crs_user_scope_allows('dorm', p_dorm);
$$;
-- 공정 범위: custom_role_scopes 만 참조(운영중 exam_user_process_scopes 는 기존 20260717 함수/RLS 가 강제).
create or replace function public.can_user_access_process(p_process text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin() or public.crs_user_scope_allows('process', p_process);
$$;
create or replace function public.can_user_manage_roles()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin();
$$;

-- ── 12) 테이블 grant (authenticated 만 · anon 쓰기 없음) ─────────────────────
grant select, insert, update on public.custom_roles            to authenticated;
grant select, insert         on public.custom_role_audit_logs  to authenticated;
grant select, insert, update on public.custom_role_permissions to authenticated;
grant select, insert, update on public.custom_role_scopes      to authenticated;
grant select, insert, update on public.user_custom_roles       to authenticated;
grant select, insert         on public.security_audit_logs     to authenticated;

-- ── 13) 함수 EXECUTE 권한 제한 (PUBLIC 회수 → authenticated 만) ──────────────
revoke all on function public.is_custom_role_admin()                     from public;
revoke all on function public.current_user_tenant_id()                   from public;
revoke all on function public.crp_is_grantable_key(text)                 from public;
revoke all on function public.cr_role_in_tenant(uuid, text)              from public;
revoke all on function public.cr_user_is_active(uuid)                    from public;
revoke all on function public.crp_user_has_permission(text)              from public;
revoke all on function public.crs_user_scope_allows(text, text)          from public;
revoke all on function public.can_user_access_region(text)               from public;
revoke all on function public.can_user_access_gender(text)               from public;
revoke all on function public.can_user_access_dorm(text)                 from public;
revoke all on function public.can_user_access_process(text)              from public;
revoke all on function public.can_user_manage_roles()                    from public;

grant execute on function public.is_custom_role_admin()                  to authenticated;
grant execute on function public.current_user_tenant_id()                to authenticated;
grant execute on function public.crp_is_grantable_key(text)              to authenticated;
grant execute on function public.cr_role_in_tenant(uuid, text)           to authenticated;
grant execute on function public.cr_user_is_active(uuid)                 to authenticated;
grant execute on function public.crp_user_has_permission(text)           to authenticated;
grant execute on function public.crs_user_scope_allows(text, text)       to authenticated;
grant execute on function public.can_user_access_region(text)            to authenticated;
grant execute on function public.can_user_access_gender(text)            to authenticated;
grant execute on function public.can_user_access_dorm(text)              to authenticated;
grant execute on function public.can_user_access_process(text)           to authenticated;
grant execute on function public.can_user_manage_roles()                 to authenticated;

-- ── 14) PostgREST 스키마 캐시 리로드(404 즉시 해소) ──────────────────────────
notify pgrst, 'reload schema';

commit;

-- 완료. 재실행해도 안전(idempotent). 마지막-admin 보호 트리거는 20260723010000 별도 파일 참고.
