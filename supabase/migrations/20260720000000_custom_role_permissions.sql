-- ============================================================================
-- 사용자 정의 권한의 메뉴별·기능별 권한 — custom_role_permissions 테이블 + RLS
--
-- [목적]
--   custom_roles(사용자 정의 권한)에 "메뉴×기능" 허용 권한(permission_key)을 저장한다.
--   예: examApplications.approve, cleaningReports.excel_download ...
--
-- [설계 결정]
--   - permission_key 는 코드 카탈로그(src/features/role-management/permissionCatalog.ts)가
--     단일 원본. 별도 permissions 카탈로그 테이블을 만들지 않는다(메뉴 정의가 이미 코드에
--     존재하므로 DB 이중화 시 drift 위험). 여기서는 role↔permission_key "부여"만 저장한다.
--   - effect='allow' 만 사용(이번 단계는 deny 미구현 — 명세대로 add-only).
--
-- [보호 원칙]
--   - 기존 profiles.role / 기존 RLS / 기존 업무 테이블 무변경.
--   - add-only 오버레이. System Role 권한을 축소/제거하지 않는다.
--   - 물리 DELETE 정책 없음 → is_active=false + deleted_at 으로 Soft Delete.
--   - custom_roles(20260718000000) 선행 필요.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260718000000_custom_roles.sql
--    롤백: 20260720000000_custom_role_permissions_rollback.sql
-- ============================================================================

create table if not exists public.custom_role_permissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  custom_role_id uuid not null references public.custom_roles(id) on delete cascade,
  permission_key text not null,              -- 예: 'examApplications.approve' (코드 카탈로그 기준)
  effect         text not null default 'allow',
  is_active      boolean not null default true,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- 동일 역할에 같은 권한 중복 금지(활성/비활성 한 행 유지 → upsert 로 재활성).
create unique index if not exists custom_role_permissions_uniq
  on public.custom_role_permissions (tenant_id, custom_role_id, permission_key);

create index if not exists custom_role_permissions_role_idx
  on public.custom_role_permissions (tenant_id, custom_role_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.custom_role_permissions enable row level security;

-- admin(is_custom_role_admin) + 동일 tenant. 본인 배정 역할의 권한은 SELECT 로 읽어 병합에 사용.
drop policy if exists custom_role_permissions_select on public.custom_role_permissions;
create policy custom_role_permissions_select on public.custom_role_permissions
  for select to authenticated
  using (
    public.is_custom_role_admin()
    or exists (
      select 1 from public.user_custom_roles ucr
       where ucr.custom_role_id = custom_role_permissions.custom_role_id
         and ucr.user_id = auth.uid()
         and ucr.is_active
    )
  );

drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
create policy custom_role_permissions_insert on public.custom_role_permissions
  for insert to authenticated
  with check (public.is_custom_role_admin() and effect = 'allow');

drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
create policy custom_role_permissions_update on public.custom_role_permissions
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin() and effect = 'allow');

grant select, insert, update on public.custom_role_permissions to authenticated;
-- anon 쓰기 없음.

-- 재실행 안전(idempotent).
