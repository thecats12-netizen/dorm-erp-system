-- ============================================================================
-- 군대 custom-role 부서 범위 서버 강제 — APPLY 초안 (⚠ 실행 금지 · 승인 후에만)
--
-- [목표] viewer 에게 활성 custom military_department scope 가 있으면, sanitized RPC 결과 자체를
--        허용 부서 personnel + 그 personnel 참조 레코드로 서버에서 제한(프론트 필터 아님).
--
-- [우선순위]
--   A. admin(raw) → 기존 raw 전체(부서 필터 미적용).
--   B. viewer + military_department scope 없음(military_allowed_units()=NULL) → 기존 sanitized 전체(회귀 0).
--   C. viewer + scope 있음 → 기존 PII 마스킹 유지 + 허용 부서 personnel + 참조 레코드만.
--
-- [canonical 부서 매칭]  actual unit → btrim → 맨앞 'D-'/'F-' prefix만 제거 → scope_value 와 case-insensitive exact.
--   예: D-CMP/F-CMP→CMP · D-CVD/F-CVD→CVD · D-Metal→Metal · D-P&C/Clean→P&C/Clean. (내부 포함검색/LIKE 금지)
--   빈/NULL unit 은 어떤 scope 에도 미포함.
--
-- [참조 key — Production RPC 원문 + TypeScript(domain.ts) 확인, 추측 없음]
--   MilitaryPersonnel.id / .unit · TrainingRecord.personnelId(단일) · MilitaryNotice.personnelIds(배열; 빈=전사공지)
--   MilitaryReport: personnel 참조 필드 없음 → 필터 불가 → 기존 sanitized 유지(부서로 제거 안 함).
--   militaryActionItems / militaryCalendar: 현재 RPC projection 미포함(데이터 NULL) → 이번에 추가하지 않음(기존 semantics).
--     ※ 향후 personnel 참조형으로 도입되면 동일하게 v_pids 필터 추가(아래 주석 위치).
--
-- 안전: 신규 helper 2 + RPC 1개만 CREATE OR REPLACE. military_module_data RLS/GRANT/정책/데이터/구조 무변경.
--       raw 접근 확대 없음 · dynamic SQL 없음 · DML 없음 · anon EXECUTE 없음 · SECURITY DEFINER/search_path=public.
-- ⚠ 적용 전: precheck [M1] 로 캡처한 Production RPC 원문이 아래 base(=phaseB v2)와 동일한지 대조. 다르면 M1 원문에 이 diff 를 이식.
-- ============================================================================
begin;

-- ── 1) 부서 매칭 helper(순수 · 테이블 미접근 → IMMUTABLE, SECURITY DEFINER 불필요) ──────────
create or replace function public.military_unit_in_scope(p_unit text, p_allowed text[])
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_unit is null or btrim(p_unit) = '' then false          -- 빈/NULL unit → 미포함
    when p_allowed is null then false
    else lower(
           case when left(btrim(p_unit), 2) in ('D-','F-') then substr(btrim(p_unit), 3) else btrim(p_unit) end
         ) = any (select lower(btrim(x)) from unnest(p_allowed) x)
  end;
$$;

-- ── 2) 허용 부서 helper(auth.uid 기준 · 없으면 NULL · 빈배열 반환 안 함) ───────────────────────
create or replace function public.military_allowed_units()
returns text[] language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 then null
              else array_agg(distinct btrim(s.scope_value)) end
    from public.custom_role_scopes s
    join public.user_custom_roles ucr on ucr.custom_role_id = s.custom_role_id
    join public.custom_roles r        on r.id = s.custom_role_id
   where s.scope_type = 'military_department'
     and s.is_active and s.deleted_at is null
     and (s.valid_from  is null or s.valid_from  <= now())
     and (s.valid_until is null or s.valid_until >= now())
     and ucr.user_id = auth.uid() and ucr.is_active and ucr.deleted_at is null
     and (ucr.valid_from  is null or ucr.valid_from  <= now())
     and (ucr.valid_until is null or ucr.valid_until >= now())
     and r.is_active and r.is_deleted = false and r.deleted_at is null
     and s.tenant_id = ucr.tenant_id and r.tenant_id = ucr.tenant_id
     and ucr.tenant_id = public.current_user_tenant_id()
     and coalesce(btrim(s.scope_value), '') <> '';
$$;

-- ── 3) sanitized RPC 최소 확장(viewer 분기에 부서 필터 추가. admin/raw·마스킹·타 role 거부 그대로) ──
create or replace function public.get_military_module_for_current_user()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_active boolean; v_data jsonb; v_units text[]; v_pids text[];
begin
  select p.role, coalesce(p.is_active, false) into v_role, v_active
    from public.profiles p where p.id = auth.uid();
  if v_role is null or not v_active then return null; end if;

  select d.data into v_data from public.military_module_data d
   where d.tenant_id = 'default' order by d.updated_at desc limit 1;
  if v_data is null then return jsonb_build_object('_empty', true); end if;

  if v_role = 'admin' then
    return v_data;                                     -- active admin: 원본(부서 필터 미적용)
  elsif v_role = 'viewer' then
    v_units := public.military_allowed_units();         -- NULL = 부서 scope 없음 → 기존 sanitized 전체(회귀 0)
    if v_units is not null then                          -- 허용 personnel id 집합(부서 필터 대상)
      select coalesce(array_agg(p->>'id'), '{}')
        into v_pids
        from jsonb_array_elements(public.mil_safe_array(v_data->'militaryPersonnel')) p
       where public.military_unit_in_scope(p->>'unit', v_units);
    end if;

    return jsonb_build_object(
      'militaryPersonnel', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p->>'id', 'name', p->>'name', 'unit', p->>'unit', 'rank', p->>'rank', 'status', p->>'status',
          'enlistmentDate', p->>'enlistmentDate', 'dischargeDate', p->>'dischargeDate',
          'calculationMode', p->>'calculationMode', 'manualCategory', p->>'manualCategory',
          'manualYear', p->>'manualYear', 'manualBaseYear', p->>'manualBaseYear', 'mobilization', p->'mobilization',
          'phone', public.mask_military_phone(p->>'phone'), 'birthDate', public.mask_military_birth_date(p->>'birthDate'),
          'isDeleted', p->'isDeleted', 'isPermanentDeleted', p->'isPermanentDeleted'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryPersonnel')) p
        where v_units is null or public.military_unit_in_scope(p->>'unit', v_units)   -- [부서필터]
      ), '[]'::jsonb),
      'militaryTrainingRecords', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t->>'id', 'personnelId', t->>'personnelId', 'subject', t->>'subject', 'trainingType', t->>'trainingType',
          'trainingRound', t->>'trainingRound', 'trainingYear', t->>'trainingYear', 'trainingDate', t->>'trainingDate',
          'completionDate', t->>'completionDate', 'trainingHours', t->'trainingHours', 'location', t->>'location',
          'attendees', t->'attendees', 'status', t->>'status',
          'isDeleted', t->'isDeleted', 'isPermanentDeleted', t->'isPermanentDeleted'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryTrainingRecords')) t
        where v_units is null or (t->>'personnelId') = any(v_pids)                    -- [부서필터: 허용 personnel]
      ), '[]'::jsonb),
      'militaryNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n->>'id', 'personnelIds', n->'personnelIds', 'title', n->>'title', 'category', n->>'category',
          'publishedDate', n->>'publishedDate', 'expiresDate', n->>'expiresDate', 'sentStatus', n->>'sentStatus'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryNotices')) n
        where v_units is null
           or coalesce(jsonb_array_length(case when jsonb_typeof(n->'personnelIds')='array' then n->'personnelIds' else '[]'::jsonb end), 0) = 0  -- 전사공지 유지
           or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(n->'personnelIds')='array' then n->'personnelIds' else '[]'::jsonb end) x
                       where x = any(v_pids))                                          -- [부서필터: 허용 대상 교집합]
      ), '[]'::jsonb),
      -- militaryReports: personnel 참조 필드 없음 → 부서로 필터 불가 → 기존 sanitized 유지.
      'militaryReports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r->>'id', 'title', r->>'title', 'reportDate', r->>'reportDate', 'type', r->>'type',
          'author', r->>'author', 'status', r->>'status'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryReports')) r
      ), '[]'::jsonb),
      -- [향후] militaryActionItems / militaryCalendar 가 personnel 참조형 array 로 도입되면
      --   여기(위 패턴)에서 v_units is null or <personnel참조key> = any(v_pids) 로 동일 필터 추가.
      'militarySettings', case when jsonb_typeof(v_data->'militarySettings')='object' then v_data->'militarySettings' else '{}'::jsonb end,
      'militaryTrainingRules', public.mil_safe_array(v_data->'militaryTrainingRules'),
      'militaryCodeValues', case when jsonb_typeof(v_data->'militaryCodeValues')='object' then v_data->'militaryCodeValues' else '{}'::jsonb end,
      'militaryTrainingAutoConfig', case when jsonb_typeof(v_data->'militaryTrainingAutoConfig')='object'
        then v_data->'militaryTrainingAutoConfig'
        else jsonb_build_object('enabled', true, 'targetStatuses', jsonb_build_array('재직')) end
    );
  end if;
  return null;                                         -- dorm_manager/maintenance_reporter/기타 role 거부
end $$;

-- ── 4) 신규 helper ACL(anon 실행 불가 · authenticated 최소). RPC ACL 은 기존 유지(재부여만) ──────
revoke all on function public.military_unit_in_scope(text,text[]),
                     public.military_allowed_units()
  from public, anon;
grant execute on function public.military_unit_in_scope(text,text[]),
                          public.military_allowed_units()
  to authenticated;
revoke all on function public.get_military_module_for_current_user() from public, anon;
grant execute on function public.get_military_module_for_current_user() to authenticated;

commit;

-- ⚠ 적용 후 postcheck 실행. 문제 시 rollback(RPC 를 M1 원문으로 복원 + 신규 helper DROP).
