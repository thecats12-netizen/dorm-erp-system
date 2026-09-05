-- ============================================================================
-- ⚠⚠⚠  STAGING 전용 · PRODUCTION 실행 절대 금지  ⚠⚠⚠
-- 시험 브리지 검증용 "빈 staging 신규 프로젝트" 최소 스키마/helper/RLS 부트스트랩.
--   · 이 파일은 신규 빈 Supabase staging 에서만 실행한다. Production 에서 실행하지 말 것.
--   · Production project ref/URL/실데이터/실사용자 없음. 기존 Production object 를 DROP/ALTER 하지 않는다.
--   · 모두 CREATE (IF NOT EXISTS / OR REPLACE) — 재실행 안전(idempotent).
--   · exam_role_of/exam_scope_readable/exam_scope_allows 는 "Production 원문(2026-09-02 snapshot) = baseline"
--     그대로 넣는다(브리지 미적용 상태). 브리지는 이후 supabase-exam-customrole-bridge-apply.sql 로 별도 적용.
-- ============================================================================

-- ── 1) profiles(최소) ───────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key,                     -- staging Auth users.id 와 매핑(수동)
  tenant_id text not null default 'default',
  role text,                               -- admin | viewer | (기타)
  exam_role text check (exam_role is null or exam_role in ('super','admin','process_owner','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated using (true); -- staging 편의(가짜데이터)

-- ── 2) 사용자 정의 권한 4테이블(최소) ───────────────────────────────────────
create table if not exists public.custom_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  code text not null, name text not null,
  role_type text not null default 'custom',
  permission_mode text default 'additive',
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.user_custom_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  user_id uuid not null,
  custom_role_id uuid not null references public.custom_roles(id) on delete restrict,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  unique (tenant_id, user_id, custom_role_id)
);
create index if not exists user_custom_roles_user_idx on public.user_custom_roles (tenant_id, user_id);
create table if not exists public.custom_role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete cascade,
  permission_key text not null,
  effect text not null default 'allow',
  is_active boolean not null default true,
  unique (tenant_id, custom_role_id, permission_key)
);
create index if not exists custom_role_permissions_role_idx on public.custom_role_permissions (tenant_id, custom_role_id) where is_active;
create table if not exists public.custom_role_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete cascade,
  scope_type text not null,                 -- organization|region|gender|dorm|process|owner
  scope_value text not null,                -- all | <process uuid> | ...
  action_scope text not null default 'all', -- read|write|all
  is_active boolean not null default true,
  valid_from timestamptz, valid_until timestamptz, deleted_at timestamptz,
  unique (tenant_id, custom_role_id, scope_type, scope_value, action_scope)
);
create index if not exists custom_role_scopes_role_idx on public.custom_role_scopes (tenant_id, custom_role_id) where is_active;
create index if not exists custom_role_scopes_type_idx on public.custom_role_scopes (tenant_id, scope_type) where is_active;

-- ── 3) 시험 기준정보(최소) + 운영 테스트 테이블 2개(탭 구분 시뮬레이션) ───────
create table if not exists public.exam_groups (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  code text, name text, is_active boolean default true, deleted_at timestamptz);
create table if not exists public.exam_categories (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  group_id uuid references public.exam_groups(id), code text, name text, is_active boolean default true, deleted_at timestamptz);
create table if not exists public.exam_processes (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  group_id uuid references public.exam_groups(id), category_id uuid references public.exam_categories(id),
  code text, name text, is_active boolean default true, deleted_at timestamptz);
-- 운영 테이블 A(=examApplications 탭 대응) / B(=examPmCertifications 탭 대응) — 둘 다 process-bound, 동일 RLS 패턴(coarse 검증용)
create table if not exists public.exam_test_apps (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  process_id uuid not null references public.exam_processes(id), label text, updated_at timestamptz default now());
create table if not exists public.exam_test_certs (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  process_id uuid not null references public.exam_processes(id), label text, updated_at timestamptz default now());

-- ── 4) exam_user_process_scopes(direct scope · Production 구조 최소) ─────────
create table if not exists public.exam_user_process_scopes (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'default',
  user_id uuid not null references public.profiles(id) on delete cascade,
  process_id uuid not null references public.exam_processes(id) on delete cascade,
  can_view boolean not null default true, can_create boolean not null default false,
  can_update boolean not null default false, can_approve boolean not null default false, can_export boolean not null default false,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, user_id, process_id));
create index if not exists idx_eups_user on public.exam_user_process_scopes(tenant_id, user_id) where is_active;

-- ── 5) 공용 helper ─────────────────────────────────────────────────────────
create or replace function public.is_custom_role_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and coalesce(p.is_active,true)); $$;

create or replace function public.my_custom_scope_values(p_scope_type text)
returns setof text language sql stable security definer set search_path = public as $$
  select s.scope_value from public.custom_role_scopes s
    join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id and ucr.user_id = auth.uid() and ucr.is_active
   where s.scope_type = p_scope_type and s.is_active and coalesce(s.deleted_at is null, true)
     and (s.valid_from is null or s.valid_from <= now()) and (s.valid_until is null or s.valid_until >= now()); $$;

-- ── 6) exam 게이트 helper = Production 원문 baseline(브리지 미적용) ───────────
create or replace function public.exam_role_of(uid uuid)
 returns text language sql stable security definer set search_path to 'public' as $function$
  select case
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin'  and coalesce(p.is_active,true)) then 'super'
    when (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true)) is not null
      then (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true))
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'viewer' and coalesce(p.is_active,true)) then 'viewer'
    else null end;
$function$;
create or replace function public.exam_is_super(uid uuid) returns boolean language sql stable security definer set search_path=public as $$ select public.exam_role_of(uid)='super'; $$;
create or replace function public.exam_is_admin(uid uuid) returns boolean language sql stable security definer set search_path=public as $$ select public.exam_role_of(uid) in ('super','admin'); $$;
create or replace function public.exam_is_viewer_all(uid uuid) returns boolean language sql stable security definer set search_path=public as $$ select public.exam_role_of(uid)='viewer'; $$;
create or replace function public.exam_can_access(uid uuid) returns boolean language sql stable security definer set search_path=public as $$ select public.exam_role_of(uid) is not null; $$;
create or replace function public.exam_scope_readable(uid uuid, p_process uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and (s.can_view or s.can_create or s.can_update or s.can_approve)); $function$;
create or replace function public.exam_scope_allows(uid uuid, p_process uuid, perm text)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and case perm when 'view' then s.can_view when 'create' then s.can_create
                    when 'update' then s.can_update when 'approve' then s.can_approve
                    when 'export' then s.can_export else false end); $function$;

-- ── 7) RLS: exam 기준정보/운영/스코프 (Production 규칙 최소 재현) ─────────────
alter table public.exam_groups     enable row level security;
alter table public.exam_categories enable row level security;
alter table public.exam_processes  enable row level security;
alter table public.exam_test_apps  enable row level security;
alter table public.exam_test_certs enable row level security;
alter table public.exam_user_process_scopes enable row level security;
alter table public.custom_roles enable row level security;
alter table public.user_custom_roles enable row level security;
alter table public.custom_role_permissions enable row level security;
alter table public.custom_role_scopes enable row level security;

-- 기준정보: 읽기=시험사용자, 쓰기=super
do $b$ declare t text; begin
  foreach t in array array['exam_groups','exam_categories','exam_processes'] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (public.exam_can_access(auth.uid()))', t, t);
    execute format('drop policy if exists %I_wr on public.%I', t, t);
    execute format('create policy %I_wr on public.%I for all to authenticated using (public.exam_is_super(auth.uid())) with check (public.exam_is_super(auth.uid()))', t, t);
  end loop;
end $b$;
-- 운영 테이블 2개: 읽기=admin|viewer|scope_readable · 쓰기=admin|scope_allows · 동일 패턴(coarse M 검증)
do $b$ declare t text; begin
  foreach t in array array['exam_test_apps','exam_test_certs'] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format($f$create policy %I_sel on public.%I for select to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_is_viewer_all(auth.uid()) or public.exam_scope_readable(auth.uid(), process_id))$f$, t, t);
    execute format('drop policy if exists %I_ins on public.%I', t, t);
    execute format($f$create policy %I_ins on public.%I for insert to authenticated
      with check (public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'create'))$f$, t, t);
    execute format('drop policy if exists %I_upd on public.%I', t, t);
    execute format($f$create policy %I_upd on public.%I for update to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'update'))
      with check (public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'update'))$f$, t, t);
  end loop;
end $b$;
-- exam_user_process_scopes: 관리=super, 본인 조회
drop policy if exists eups_select on public.exam_user_process_scopes;
create policy eups_select on public.exam_user_process_scopes for select to authenticated
  using (public.exam_is_super(auth.uid()) or user_id = auth.uid());
drop policy if exists eups_write on public.exam_user_process_scopes;
create policy eups_write on public.exam_user_process_scopes for all to authenticated
  using (public.exam_is_super(auth.uid())) with check (public.exam_is_super(auth.uid()));
-- custom_role_* : 관리=is_custom_role_admin, 본인 배정 조회
do $b$ declare t text; begin
  foreach t in array array['custom_roles','custom_role_permissions','custom_role_scopes'] loop
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format('create policy %I_all on public.%I for all to authenticated using (public.is_custom_role_admin()) with check (public.is_custom_role_admin())', t, t);
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (true)', t, t); -- staging 편의(브리지 helper 가 읽음)
  end loop;
end $b$;
drop policy if exists ucr_sel on public.user_custom_roles;
create policy ucr_sel on public.user_custom_roles for select to authenticated using (true);
drop policy if exists ucr_wr on public.user_custom_roles;
create policy ucr_wr on public.user_custom_roles for all to authenticated using (public.is_custom_role_admin()) with check (public.is_custom_role_admin());

-- ── 8) grant(anon 쓰기 없음) ────────────────────────────────────────────────
revoke all on all functions in schema public from anon;
-- (staging 편의: authenticated 실행/테이블 접근은 RLS 로 통제)
