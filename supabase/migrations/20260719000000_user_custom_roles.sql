-- ============================================================================
-- 계정 ↔ 사용자 정의 권한 연결 — user_custom_roles 테이블 + RLS
--
-- [목적]
--   시스템 > 사용자관리 계정 등록/수정 화면에서 관리자가 특정 계정에 "추가 권한
--   (Custom Role)" 을 배정/해제할 수 있게 하는 연결 저장소.
--
-- [보호 원칙 — 매우 중요]
--   - 기존 profiles.role(System Role) 컬럼/값/RLS 는 일절 건드리지 않는다.
--   - 이 배정은 add-only 오버레이다. System Role 을 강등/제거/변환하지 않는다.
--   - 기존 계정에 자동 배정하지 않는다(관리자가 직접 저장할 때만 행 생성).
--   - 물리 DELETE 정책 없음 → is_active=false + deleted_at 으로 Soft Delete 만.
--   - custom_roles(20260718000000) 가 먼저 적용되어 있어야 한다(FK/헬퍼 재사용).
--
-- [권한 모델]
--   - 관리자 판정은 기존과 동일 is_custom_role_admin()(profiles.role='admin').
--   - tenant_id 격리, anon 쓰기 없음, USING(true)/WITH CHECK(true) 없음.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260718000000_custom_roles.sql
--    롤백: 20260719000000_user_custom_roles_rollback.sql
-- ============================================================================

-- ── 1) user_custom_roles 테이블 ──────────────────────────────────────────────
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
  deleted_at     timestamptz
);

-- 동일 사용자에게 같은 사용자 정의 권한 중복 배정 금지(활성/비활성 무관 한 행 유지 → upsert 로 재활성).
create unique index if not exists user_custom_roles_uniq
  on public.user_custom_roles (tenant_id, user_id, custom_role_id);

create index if not exists user_custom_roles_user_idx on public.user_custom_roles (tenant_id, user_id);
create index if not exists user_custom_roles_role_idx on public.user_custom_roles (custom_role_id);

-- ── 2) RLS ───────────────────────────────────────────────────────────────────
alter table public.user_custom_roles enable row level security;

-- admin + 동일 tenant 만. SELECT/INSERT/UPDATE 분리. DELETE 정책 없음(물리삭제 차단).
drop policy if exists user_custom_roles_select on public.user_custom_roles;
create policy user_custom_roles_select on public.user_custom_roles
  for select to authenticated
  using (public.is_custom_role_admin() or user_id = auth.uid());  -- 본인은 자신 배정 조회 가능

drop policy if exists user_custom_roles_insert on public.user_custom_roles;
create policy user_custom_roles_insert on public.user_custom_roles
  for insert to authenticated
  with check (public.is_custom_role_admin());

drop policy if exists user_custom_roles_update on public.user_custom_roles;
create policy user_custom_roles_update on public.user_custom_roles
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin());
  -- tenant_id/user_id 변경은 앱에서 보내지 않으며, upsert 충돌키(tenant_id,user_id,custom_role_id)로 사실상 고정.

-- ── 3) 권한 부여 ─────────────────────────────────────────────────────────────
grant select, insert, update on public.user_custom_roles to authenticated;
-- anon 쓰기 권한 부여 없음.

-- 재실행 안전(idempotent).
