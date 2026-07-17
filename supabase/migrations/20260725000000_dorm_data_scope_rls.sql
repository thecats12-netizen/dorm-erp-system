-- ============================================================================
-- [초안 · 검토 필요 · 자동 실행 금지] 기숙사 업무 테이블 데이터 범위 RLS 보강
--
-- [목적]
--   occupants / dorms 에 "사용자 정의 데이터 범위(custom_role_scopes)"를 서버에서도 강제한다.
--   현재는 클라이언트+함수 계층만 적용되어 있어 REST 직접 호출 우회가 가능하다.
--
-- [설계 — 기존 정책 보존]
--   기존 permissive 정책을 삭제/교체하지 않는다. 대신 AS RESTRICTIVE 정책을 "추가"한다.
--   RESTRICTIVE 정책은 기존 permissive 정책과 AND 로 결합되므로, 접근을 "넓히지 않고 좁히기만" 한다.
--   판정: (admin) OR (사용자가 dorm 범위 제한 대상이 아님) OR (해당 행이 허용 범위 내).
--     → 데이터 범위 없는 계정(admin/viewer/dorm_manager 등)은 영향 없음(무회귀).
--     → restrictive 범위가 있는 계정만 그 범위로 제한.
--
-- [실제 컬럼(분석 결과)]  occupants: site, gender, dorm_id, created_by, tenant_id, is_deleted
--                        dorms:     site, gender, id(=dorm), created_by, tenant_id, is_deleted
--
-- [주의]  이 파일은 Production RLS 를 변경한다. 반드시 스테이징에서 검증 후 적용하라.
--         잘못 적용 시 기숙사 조회가 과도하게 제한될 수 있으므로, verify 섹션을 먼저 확인할 것.
--
-- ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 실행. 롤백/검증 파일 참조.
--    선행: 20260721(custom_role_scopes), 20260723(custom_roles/user_custom_roles/is_custom_role_admin).
-- ============================================================================

begin;

-- 1) 현재 사용자의 활성·유효 restrictive dorm-모듈 범위값 (scope_type, scope_value)
create or replace function public.crs_active_dorm_scopes()
returns table(scope_type text, scope_value text)
language sql stable security definer set search_path = public as $$
  select s.scope_type, s.scope_value
    from public.custom_role_scopes s
    join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id and ucr.is_active
    join public.custom_roles r        on r.id = s.custom_role_id and r.is_active and r.is_deleted = false and r.deleted_at is null
   where ucr.user_id = auth.uid()
     and r.permission_mode = 'restrictive'        -- restrictive 역할의 범위만(기존 정책과 동일)
     and s.scope_type in ('organization','region','gender','dorm','owner')
     and s.is_active and s.deleted_at is null
     and (s.valid_from  is null or s.valid_from  <= now())
     and (s.valid_until is null or s.valid_until >= now());
$$;

-- 2) 이 사용자가 dorm 데이터 범위 제한 대상인지(범위가 하나라도 있으면 true)
create or replace function public.crs_user_restricts_dorm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crs_active_dorm_scopes());
$$;

-- 3) 특정 행이 현재 사용자 범위 내인지 (같은 type UNION / 다른 type INTERSECTION / all=전체 / 미지정 type=통과)
create or replace function public.crs_dorm_row_allowed(p_site text, p_gender text, p_dorm_id text, p_created_by uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  has_org_all boolean;
  has_region boolean; region_ok boolean;
  has_gender boolean; gender_ok boolean;
  has_dorm   boolean; dorm_ok   boolean;
  has_owner  boolean; owner_ok  boolean;
begin
  -- admin 우회(기존 관리자 판별 재사용)
  if public.is_custom_role_admin() then return true; end if;
  -- 범위 제한 대상 아니면 통과(무회귀)
  if not public.crs_user_restricts_dorm() then return true; end if;

  select exists(select 1 from public.crs_active_dorm_scopes() where scope_type='organization' and scope_value='all') into has_org_all;
  if has_org_all then return true; end if;   -- 전체 데이터

  select exists(select 1 from public.crs_active_dorm_scopes() where scope_type='region') into has_region;
  region_ok := (not has_region) or exists(select 1 from public.crs_active_dorm_scopes() where scope_type='region' and (scope_value = p_site or scope_value='all'));

  select exists(select 1 from public.crs_active_dorm_scopes() where scope_type='gender') into has_gender;
  gender_ok := (not has_gender) or exists(select 1 from public.crs_active_dorm_scopes() where scope_type='gender' and (scope_value = p_gender or scope_value='all'));

  select exists(select 1 from public.crs_active_dorm_scopes() where scope_type='dorm') into has_dorm;
  dorm_ok := (not has_dorm) or exists(select 1 from public.crs_active_dorm_scopes() where scope_type='dorm' and (scope_value = p_dorm_id or scope_value='all'));

  select exists(select 1 from public.crs_active_dorm_scopes() where scope_type='owner') into has_owner;
  owner_ok := (not has_owner) or (p_created_by = auth.uid());  -- 본인 등록 데이터만

  return region_ok and gender_ok and dorm_ok and owner_ok;  -- 서로 다른 type 은 교집합
end;
$$;

revoke all on function public.crs_active_dorm_scopes()                     from public;
revoke all on function public.crs_user_restricts_dorm()                    from public;
revoke all on function public.crs_dorm_row_allowed(text,text,text,uuid)    from public;
grant execute on function public.crs_active_dorm_scopes()                  to authenticated;
grant execute on function public.crs_user_restricts_dorm()                 to authenticated;
grant execute on function public.crs_dorm_row_allowed(text,text,text,uuid) to authenticated;

-- 4) RESTRICTIVE 정책(기존 permissive 정책과 AND 결합 → 좁히기만). SELECT/UPDATE/DELETE 에 적용.
--    occupants
drop policy if exists occupants_scope_restrict on public.occupants;
create policy occupants_scope_restrict on public.occupants as restrictive
  for all to authenticated
  using (public.crs_dorm_row_allowed(site, gender, dorm_id::text, created_by));
--    dorms (dorm 범위는 dorm.id 로 판정)
drop policy if exists dorms_scope_restrict on public.dorms;
create policy dorms_scope_restrict on public.dorms as restrictive
  for all to authenticated
  using (public.crs_dorm_row_allowed(site, gender, id::text, created_by));

-- 5) 성능: 범위 필터가 site/gender/dorm_id 를 참조하므로 해당 컬럼 인덱스 검토(이미 있으면 무시).
create index if not exists occupants_site_gender_dorm_idx on public.occupants (tenant_id, site, gender, dorm_id) where is_deleted = false;

notify pgrst, 'reload schema';

commit;

-- 완료. 재실행 안전. ※ 반드시 스테이징 검증 후 Production 적용.
