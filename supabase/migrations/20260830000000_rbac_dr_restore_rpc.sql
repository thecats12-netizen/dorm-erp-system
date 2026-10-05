-- ============================================================================
-- RBAC(사용자·권한) DR 복원 전용 서버측 보안 경계 (SECURITY DEFINER RPC)
--  · 대상: profiles / custom_roles / custom_role_permissions / custom_role_scopes / user_custom_roles
--  · 핵심 안전장치(프론트 아닌 DB 에서 강제):
--     - is_admin() 서버 검증(=profiles.role='admin', auth.uid()) · tenant 서버결정(payload 불신뢰)
--     - 단일 트랜잭션(실패 시 전체 자동 롤백) · table allowlist · advisory lock · idempotency · audit
--     - profiles = INSERT-MISSING-ONLY(기존 프로필 UPDATE/DELETE/권한 덮어쓰기 금지)
--     - auth.users 존재 guard(없는 사용자에게 profile/role 배정 금지)
--     - 실행자 admin 불변 + tenant 활성 admin ≥1 불변(위반 시 롤백)
--     - system custom_role(role_type<>'custom') 변조 금지(skip)
--  · exam_user_process_scopes 는 exam 도메인 소관 → 본 RBAC DR 제외(중복 금지).
--  ※ LOCAL 검증용으로 작성. Production 적용은 별도 승인 절차.
-- ============================================================================

create table if not exists public.rbac_dr_restore_log (
  request_id     uuid primary key,
  actor_user_id  uuid not null,
  tenant_id      text not null,
  datasets       text[] not null,
  row_counts     jsonb,
  skipped_counts jsonb,
  status         text not null,
  created_at     timestamptz not null default now()
);
alter table public.rbac_dr_restore_log enable row level security;
revoke all on public.rbac_dr_restore_log from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on public.rbac_dr_restore_log from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on public.rbac_dr_restore_log from authenticated'; end if;
end $$;

create or replace function public.rbac_dr_restore(p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_tenant text;
  v_order  text[] := array['profiles','custom_roles','custom_role_permissions','custom_role_scopes','user_custom_roles'];
  k text; t text; v_rows jsonb; v_keys text[]; v_collist text; v_sellist text; v_updlist text;
  v_counts jsonb := '{}'::jsonb; v_skip jsonb := '{}'::jsonb; v_existing jsonb; v_in int; v_tot int;
begin
  if v_actor is null then raise exception 'RBAC_DR_AUTH_REQUIRED'; end if;
  if not public.is_admin() then raise exception 'RBAC_DR_NOT_ADMIN'; end if;
  v_tenant := public.current_profile_tenant();
  if v_tenant is null then raise exception 'RBAC_DR_TENANT_UNRESOLVED'; end if;
  if p_request_id is null then raise exception 'RBAC_DR_REQUEST_ID_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_payload->'tables','{}'::jsonb)) <> 'object' then raise exception 'RBAC_DR_BAD_PAYLOAD'; end if;

  -- idempotency
  select jsonb_build_object('idempotent',true,'status',status,'row_counts',row_counts,'skipped_counts',skipped_counts)
    into v_existing from public.rbac_dr_restore_log where request_id = p_request_id;
  if v_existing is not null then return v_existing; end if;

  -- tenant advisory lock
  if not pg_try_advisory_xact_lock(hashtextextended('rbac_dr:'||v_tenant, 0)) then
    raise exception 'RBAC_DR_RESTORE_BUSY';
  end if;

  -- allowlist
  for k in select jsonb_object_keys(coalesce(p_payload->'tables','{}'::jsonb)) loop
    if not (k = any(v_order)) then raise exception 'RBAC_DR_TABLE_NOT_ALLOWED: %', k; end if;
  end loop;

  foreach t in array v_order loop
    if (p_payload->'tables') ? t then
      if jsonb_typeof(p_payload->'tables'->t) <> 'array' then raise exception 'RBAC_DR_INVALID_TABLE_PAYLOAD: %', t; end if;
      v_tot := jsonb_array_length(p_payload->'tables'->t);

      if t = 'profiles' then
        -- INSERT-MISSING-ONLY + auth.users 존재 + 아직 없는 id 만. 기존 프로필 절대 미변경.
        select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
        from (select (elem || jsonb_build_object('tenant_id', v_tenant)) e
              from jsonb_array_elements(p_payload->'tables'->t) elem
              where (elem->>'id') is not null
                and exists (select 1 from auth.users u where u.id = (elem->>'id')::uuid)
                and not exists (select 1 from public.profiles p where p.id = (elem->>'id')::uuid)) q;
      elsif t = 'custom_roles' then
        -- custom(role_type='custom')만. 기존이 system 이면 skip(변조 금지). tenant override.
        select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
        from (select (elem || jsonb_build_object('tenant_id', v_tenant)) e
              from jsonb_array_elements(p_payload->'tables'->t) elem
              where coalesce(elem->>'role_type','custom') = 'custom'
                and coalesce((select role_type from public.custom_roles c where c.id=(elem->>'id')::uuid),'custom') = 'custom') q;
      elsif t = 'user_custom_roles' then
        -- user_id 가 실제 auth.users 에 있는 배정만(orphan 금지). tenant override.
        select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
        from (select (elem || jsonb_build_object('tenant_id', v_tenant)) e
              from jsonb_array_elements(p_payload->'tables'->t) elem
              where (elem->>'user_id') is not null
                and exists (select 1 from auth.users u where u.id = (elem->>'user_id')::uuid)) q;
      else
        -- custom_role_permissions / custom_role_scopes: tenant override 만(부모 FK RESTRICT 가 orphan 차단)
        select coalesce(jsonb_agg(elem || jsonb_build_object('tenant_id', v_tenant)), '[]'::jsonb) into v_rows
        from jsonb_array_elements(p_payload->'tables'->t) elem;
      end if;

      v_in := jsonb_array_length(v_rows);
      v_skip := v_skip || jsonb_build_object(t, v_tot - v_in);
      if v_in = 0 then v_counts := v_counts || jsonb_build_object(t, 0); continue; end if;

      select array_agg(distinct key) into v_keys from (select jsonb_object_keys(e) key from jsonb_array_elements(v_rows) e) s;
      if v_keys is null or not ('id' = any(v_keys)) then raise exception 'RBAC_DR_MISSING_ID: %', t; end if;
      select string_agg(format('%I', column_name), ',' order by ordinal_position),
             string_agg(format('r.%I', column_name), ',' order by ordinal_position),
             string_agg(case when column_name<>'id' then format('%I=excluded.%I', column_name, column_name) end, ',' order by ordinal_position)
        into v_collist, v_sellist, v_updlist
        from information_schema.columns where table_schema='public' and table_name=t and column_name = any(v_keys);

      if t = 'profiles' then
        -- 기존 미변경 보장: 충돌(id 존재) 시 do nothing(위 필터로 이미 신규만이지만 2중 안전)
        execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r on conflict (id) do nothing', t, v_collist, v_sellist, t) using v_rows;
      else
        execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r on conflict (id) do update set %s', t, v_collist, v_sellist, t, v_updlist) using v_rows;
      end if;
      v_counts := v_counts || jsonb_build_object(t, v_in);
    end if;
  end loop;

  -- 불변식(실패 시 전체 롤백)
  if not exists (select 1 from public.profiles where id=v_actor and role='admin' and coalesce(is_active,true) and tenant_id=v_tenant) then
    raise exception 'RBAC_DR_EXECUTOR_ADMIN_LOST';
  end if;
  if (select count(*) from public.profiles where tenant_id=v_tenant and role='admin' and coalesce(is_active,true)) < 1 then
    raise exception 'RBAC_DR_NO_ACTIVE_ADMIN';
  end if;
  -- orphan user-role = 0 (auth.users 기준)
  if exists (select 1 from public.user_custom_roles ucr where ucr.tenant_id=v_tenant and not exists (select 1 from auth.users u where u.id=ucr.user_id)) then
    raise exception 'RBAC_DR_ORPHAN_USER_ROLE';
  end if;

  insert into public.rbac_dr_restore_log(request_id, actor_user_id, tenant_id, datasets, row_counts, skipped_counts, status)
  values (p_request_id, v_actor, v_tenant,
          (select array_agg(key) from jsonb_object_keys(coalesce(p_payload->'tables','{}'::jsonb)) key),
          v_counts, v_skip, 'ok');

  return jsonb_build_object('idempotent', false, 'status', 'ok', 'tenant', v_tenant, 'row_counts', v_counts, 'skipped_counts', v_skip);
end;
$fn$;

create or replace function public.rbac_dr_available()
returns boolean language sql stable security definer set search_path to 'public'
as $probe$ select public.is_admin() $probe$;

revoke all on function public.rbac_dr_restore(uuid, jsonb) from public;
revoke all on function public.rbac_dr_available() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then
    execute 'revoke all on function public.rbac_dr_restore(uuid, jsonb) from anon';
    execute 'revoke all on function public.rbac_dr_available() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    execute 'grant execute on function public.rbac_dr_restore(uuid, jsonb) to authenticated';
    execute 'grant execute on function public.rbac_dr_available() to authenticated';
  end if;
end $$;
