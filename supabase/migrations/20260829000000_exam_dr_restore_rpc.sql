-- ============================================================================
-- 시험관리 DR 복원/롤백 전용 서버측 보안 경계 (SECURITY DEFINER RPC)
--  · 목적: exam 25테이블은 RLS ON + DELETE 정책 0 → 클라이언트 경로로 안전한 복원/롤백 불가.
--          service_role 를 프론트에 노출하지 않고, DB 가 검증하는 관리자만 "허용된 범위"를
--          단일 트랜잭션으로 복원(실패 시 전체 자동 롤백)하게 하는 RPC 를 둔다.
--  · 안전: auth.uid() 필수 + is_exam_admin()(=profiles.role='admin' active) + tenant 서버결정 +
--          table allowlist + tenant_id 강제 override + 순환/자기참조 FK 2-pass + tenant advisory lock +
--          idempotency(request_id) + audit. 범용 SQL executor 아님(동적 SQL 식별자는 %I 로만).
--  ※ LOCAL 전용. Production 적용/commit 금지.
-- ============================================================================

-- 감사/idempotency 로그 (RPC 성공 시 1행). 일반 롤이 직접 접근 못 하게 차단.
create table if not exists public.exam_dr_restore_log (
  request_id    uuid primary key,
  actor         uuid not null,
  tenant_id     text not null,
  datasets      text[] not null,
  row_counts    jsonb,
  status        text not null,
  created_at    timestamptz not null default now()
);
alter table public.exam_dr_restore_log enable row level security;
revoke all on public.exam_dr_restore_log from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on public.exam_dr_restore_log from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on public.exam_dr_restore_log from authenticated'; end if;
end $$;

create or replace function public.exam_dr_restore(p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_tenant text;
  -- 복원 허용 테이블 = FK 부모→자식 순서(allowlist). 제외: audit_logs, import_jobs/errors,
  --   sequence_counters, user_process_scopes(→profiles/auth), retest_candidates.
  v_order text[] := array[
    'exam_lines','exam_categories','exam_groups','exam_levels','exam_parts','exam_personnel',
    'exam_processes','exam_sessions','exam_equipment','exam_rules','exam_annual_targets',
    'exam_monthly_results','exam_applications','exam_equipment_stage_rules','exam_results',
    'exam_equipment_certifications','exam_certification_history','dm_certifications',
    'pm_certifications','employee_license_plan'
  ];
  v_deferred_tables text[] := array['exam_categories','exam_groups','exam_levels'];
  k text; t text; v_defer text[]; v_rows jsonb; v_collist text; v_updlist text; v_sellist text; v_keys text[];
  v_counts jsonb := '{}'::jsonb; v_existing jsonb;
begin
  -- 1) DB 검증 관리자만(클라이언트 플래그 불신뢰)
  if v_actor is null then raise exception 'EXAM_DR_AUTH_REQUIRED'; end if;
  if not public.is_exam_admin() then raise exception 'EXAM_DR_NOT_ADMIN'; end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is null then raise exception 'EXAM_DR_TENANT_UNRESOLVED'; end if;
  if p_request_id is null then raise exception 'EXAM_DR_REQUEST_ID_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_payload->'tables','{}'::jsonb)) <> 'object' then raise exception 'EXAM_DR_BAD_PAYLOAD'; end if;

  -- 2) idempotency: 동일 request_id 성공 기록 있으면 재실행 없이 반환
  select jsonb_build_object('idempotent',true,'status',status,'row_counts',row_counts)
    into v_existing from public.exam_dr_restore_log where request_id = p_request_id;
  if v_existing is not null then return v_existing; end if;

  -- 3) tenant 단위 advisory lock(xact 종료 시 자동 해제) → 동시 복원 차단
  if not pg_try_advisory_xact_lock(hashtextextended('exam_dr:'||v_tenant, 0)) then
    raise exception 'EXAM_DR_RESTORE_BUSY';
  end if;

  -- 4) allowlist 외 table 주입 거부
  for k in select jsonb_object_keys(coalesce(p_payload->'tables','{}'::jsonb)) loop
    if not (k = any(v_order)) then raise exception 'EXAM_DR_TABLE_NOT_ALLOWED: %', k; end if;
  end loop;

  -- 5) PASS A: FK 순서대로 full-row upsert(merge by id). 순환/자기참조 FK 컬럼은 null 로 삽입.
  foreach t in array v_order loop
    if (p_payload->'tables') ? t then
      v_defer := case t
        when 'exam_categories' then array['group_id']
        when 'exam_groups' then array['category_id']
        when 'exam_levels' then array['parent_level_id']
        else array[]::text[] end;
      -- 구조 검증(fail-closed): 테이블 payload 는 JSON 배열이어야 한다(object/string/null 거부).
      if jsonb_typeof(p_payload->'tables'->t) <> 'array' then raise exception 'EXAM_DR_INVALID_TABLE_PAYLOAD: %', t; end if;
      -- tenant_id 강제 override + deferred FK 키 제거(1차)
      select coalesce(jsonb_agg((elem - v_defer) || jsonb_build_object('tenant_id', v_tenant)), '[]'::jsonb)
        into v_rows from jsonb_array_elements(p_payload->'tables'->t) elem;
      -- 정상 빈 dataset([]) → no-op(건너뜀). 빈 테이블을 'id 누락'으로 오판하지 않는다.
      if jsonb_array_length(v_rows) = 0 then continue; end if;
      -- payload 에 실제 존재하는 키만 대상(기본값 컬럼 보존 + merge). 행이 있는데 id 없으면 거부.
      select array_agg(distinct key) into v_keys from (select jsonb_object_keys(e) key from jsonb_array_elements(v_rows) e) s;
      if v_keys is null or not ('id' = any(v_keys)) then raise exception 'EXAM_DR_MISSING_ID: %', t; end if;
      select string_agg(format('%I', column_name), ',' order by ordinal_position),
             string_agg(format('r.%I', column_name), ',' order by ordinal_position),
             string_agg(case when column_name<>'id' then format('%I=excluded.%I', column_name, column_name) end, ',' order by ordinal_position)
        into v_collist, v_sellist, v_updlist
        from information_schema.columns where table_schema='public' and table_name=t and column_name = any(v_keys);
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r on conflict (id) do update set %s',
        t, v_collist, v_sellist, t, v_updlist
      ) using v_rows;
      v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(p_payload->'tables'->t));
    end if;
  end loop;

  -- 6) PASS B: 순환/자기참조 테이블만 full row(원래 FK 포함) 재-upsert → FK backfill(부모 이미 존재)
  foreach t in array v_deferred_tables loop
    if (p_payload->'tables') ? t then
      if jsonb_typeof(p_payload->'tables'->t) <> 'array' then raise exception 'EXAM_DR_INVALID_TABLE_PAYLOAD: %', t; end if;
      select coalesce(jsonb_agg(elem || jsonb_build_object('tenant_id', v_tenant)), '[]'::jsonb)
        into v_rows from jsonb_array_elements(p_payload->'tables'->t) elem;
      if jsonb_array_length(v_rows) = 0 then continue; end if; -- 정상 빈 dataset → no-op
      select array_agg(distinct key) into v_keys from (select jsonb_object_keys(e) key from jsonb_array_elements(v_rows) e) s;
      select string_agg(format('%I', column_name), ',' order by ordinal_position),
             string_agg(format('r.%I', column_name), ',' order by ordinal_position),
             string_agg(case when column_name<>'id' then format('%I=excluded.%I', column_name, column_name) end, ',' order by ordinal_position)
        into v_collist, v_sellist, v_updlist
        from information_schema.columns where table_schema='public' and table_name=t and column_name = any(v_keys);
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r on conflict (id) do update set %s',
        t, v_collist, v_sellist, t, v_updlist
      ) using v_rows;
    end if;
  end loop;

  -- 7) 성공 기록(실패 시 전체 트랜잭션과 함께 롤백 → 로그 미기록 = 재시도 가능)
  insert into public.exam_dr_restore_log(request_id, actor, tenant_id, datasets, row_counts, status)
  values (p_request_id, v_actor, v_tenant,
          (select array_agg(key) from jsonb_object_keys(coalesce(p_payload->'tables','{}'::jsonb)) key),
          v_counts, 'ok');

  return jsonb_build_object('idempotent', false, 'status', 'ok', 'tenant', v_tenant, 'row_counts', v_counts);
end;
$fn$;

-- 가용성 probe(부수효과 없음): frontend 가 RPC 존재/권한을 사전 확인하여 fail-closed 활성화 판단.
create or replace function public.exam_dr_available()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $probe$ select public.is_exam_admin() $probe$;
revoke all on function public.exam_dr_available() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on function public.exam_dr_available() from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'grant execute on function public.exam_dr_available() to authenticated'; end if;
end $$;

-- 실행 권한: authenticated 에게 EXECUTE(내부 is_exam_admin 게이트가 실제 제한). anon/public 금지.
revoke all on function public.exam_dr_restore(uuid, jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on function public.exam_dr_restore(uuid, jsonb) from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'grant execute on function public.exam_dr_restore(uuid, jsonb) to authenticated'; end if;
end $$;
