-- ============================================================================
-- 보안 강화 — 서버측 권한 함수 + 권한상승 차단 + 마지막 관리자 보호 + 보안 감사로그 + 인덱스
--
-- [이 프로젝트의 사실]
--   - 실제 최상위 System Role 은 super_admin 이 아니라 'admin' 이다(profiles.role).
--     따라서 "마지막 super_admin 보호" = "마지막 활성 admin 보호" 로 구현한다.
--   - 관리자 판정은 is_custom_role_admin()(profiles.role='admin' + is_active) 재사용.
--
-- [보호 원칙 — 매우 중요]
--   - 기존 업무 테이블의 기존 RLS 를 삭제/일괄 대체하지 않는다.
--   - 아래 함수는 "추가 허용(add-only) 보조 함수"로, 향후 업무 테이블 정책에서
--     `기존조건 OR helper(...)` 형태로 확장할 때 재사용한다(이번 단계는 정의만).
--   - profiles/기존 role/기존 데이터 구조 무변경. 트리거는 파괴적 변경이 아닌 가드.
--   - anon 쓰기 없음, RLS 비활성화 없음, USING(true)/WITH CHECK(true) 없음.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260718 / 20260719 / 20260720 / 20260721.
--    롤백: 20260722000000_security_hardening_rollback.sql
-- ============================================================================

-- ── 1) 유효기간·활성 판정을 포함한 권한 조회 함수(프론트 모델과 동일 기준) ──────
-- 현재 사용자가 특정 permission_key 를 사용자 정의 권한으로 보유하는지.
create or replace function public.crp_user_has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_permissions crp
      join public.user_custom_roles ucr on ucr.custom_role_id = crp.custom_role_id
     where crp.permission_key = p_key
       and crp.is_active
       and crp.effect = 'allow'
       and ucr.user_id = auth.uid()
       and ucr.is_active
  );
$$;

-- 현재 사용자의 사용자 정의 데이터 범위가 특정 (type,value) 를 허용하는지(유효기간·soft delete 반영).
create or replace function public.crs_user_scope_allows(p_type text, p_value text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_role_scopes s
      join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id
     where s.scope_type = p_type
       and (s.scope_value = p_value or s.scope_value = 'all')
       and s.is_active
       and coalesce(s.deleted_at is null, true)
       and (s.valid_from is null or s.valid_from <= now())
       and (s.valid_until is null or s.valid_until >= now())
       and ucr.user_id = auth.uid()
       and ucr.is_active
  );
$$;

-- 편의 래퍼(admin 은 항상 true = 기존 전권 유지, 그 외는 사용자 정의 범위로 추가 허용).
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
create or replace function public.can_user_access_process(p_process text)
returns boolean language sql stable security definer set search_path = public as $$
  -- 공정은 exam_user_process_scopes(기존)가 1차 원본. custom_role_scopes 는 보조.
  select public.is_custom_role_admin()
      or public.crs_user_scope_allows('process', p_process)
      or exists (
        select 1 from public.exam_user_process_scopes s
         where s.user_id = auth.uid() and s.process_id::text = p_process and s.is_active and s.can_view
      );
$$;
create or replace function public.can_user_manage_roles()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_custom_role_admin();   -- 권한관리는 admin 만(사용자 정의 권한으로 획득 불가)
$$;

-- ── 2) 권한 상승 차단: 사용자 정의 권한이 관리자 전용 기능을 부여하지 못하게 ────
-- users/permissions/settings/recycleBin/militarySettings 탭 기능은 custom role 로 부여 금지.
create or replace function public.crp_is_grantable_key(p_key text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when split_part(p_key, '.', 1) in ('users','permissions','settings','recycleBin','militarySettings') then false
    else true
  end;
$$;

-- custom_role_permissions 의 INSERT/UPDATE 정책을 강화(기존 정책 대체 — 우리 테이블).
drop policy if exists custom_role_permissions_insert on public.custom_role_permissions;
create policy custom_role_permissions_insert on public.custom_role_permissions
  for insert to authenticated
  with check (public.is_custom_role_admin() and effect = 'allow' and public.crp_is_grantable_key(permission_key));

drop policy if exists custom_role_permissions_update on public.custom_role_permissions;
create policy custom_role_permissions_update on public.custom_role_permissions
  for update to authenticated
  using (public.is_custom_role_admin())
  with check (public.is_custom_role_admin() and effect = 'allow' and public.crp_is_grantable_key(permission_key));

-- ── 3) 마지막 활성 admin 보호(강등/비활성화/삭제 차단) — profiles BEFORE UPDATE 트리거 ──
create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 대상이 "활성 admin" 이었고, 이번 변경으로 admin 이 아니거나 비활성으로 바뀌는 경우.
  if OLD.role = 'admin' and coalesce(OLD.is_active, true) then
    if (NEW.role is distinct from 'admin') or (coalesce(NEW.is_active, true) = false) then
      if (select count(*) from public.profiles
            where role = 'admin' and coalesce(is_active, true) and id <> OLD.id) = 0 then
        raise exception '마지막 관리자 계정은 비활성화하거나 권한을 변경할 수 없습니다.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_last_admin on public.profiles;
create trigger trg_protect_last_admin
  before update on public.profiles
  for each row execute function public.protect_last_admin();

-- ── 4) 보안 감사로그(권한상승/접근차단/파일차단 등) ──────────────────────────────
create table if not exists public.security_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null default 'default',
  actor_user_id  uuid,
  target_user_id uuid,
  action         text not null,        -- role_assign | escalation_blocked | access_denied | download_blocked | last_admin_blocked ...
  resource_type  text,
  resource_id    text,
  permission_key text,
  result         text,                 -- allowed | blocked
  reason         text,
  user_agent     text,                 -- IP 는 클라이언트에서 신뢰 불가 → 저장하지 않음. access token 절대 저장 금지.
  created_at     timestamptz not null default now()
);
create index if not exists security_audit_tenant_idx on public.security_audit_logs (tenant_id, created_at desc);
create index if not exists security_audit_actor_idx on public.security_audit_logs (actor_user_id);

alter table public.security_audit_logs enable row level security;
drop policy if exists security_audit_select on public.security_audit_logs;
create policy security_audit_select on public.security_audit_logs
  for select to authenticated using (public.is_custom_role_admin());
drop policy if exists security_audit_insert on public.security_audit_logs;
create policy security_audit_insert on public.security_audit_logs
  for insert to authenticated with check (actor_user_id = auth.uid() or public.is_custom_role_admin());
grant select, insert on public.security_audit_logs to authenticated;

-- ── 5) 성능 인덱스(RLS/권한 함수 조회 가속). 이미 있으면 무시. ──────────────────
create index if not exists ucr_user_active_idx on public.user_custom_roles (user_id, tenant_id, is_active);
create index if not exists crp_role_active_idx on public.custom_role_permissions (custom_role_id, is_active);
create index if not exists crs_role_type_idx on public.custom_role_scopes (custom_role_id, scope_type, scope_value);
create index if not exists eups_user_proc_active_idx on public.exam_user_process_scopes (user_id, process_id, is_active);

-- 재실행 안전(idempotent).
