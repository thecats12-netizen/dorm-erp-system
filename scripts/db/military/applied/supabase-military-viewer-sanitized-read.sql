-- ============================================================================
-- 군대관리 v2 2E — viewer 원본 PII 서버 차단: sanitized read RPC + 마스킹 helper
-- ⚠ PRODUCTION 실행 금지 — LOCAL/STAGING 검증 후 승인받아 적용(rollout: RPC 먼저, 그 다음 프론트, 마지막에 RLS v3).
-- 원칙: 클라이언트 role/tenant/uid 인자 없음 · auth.uid() + profiles 기준 · SECURITY DEFINER · allowlist(fail-closed).
-- ============================================================================

-- ── 마스킹 helper(순수 · fail-closed: 형식 불명이면 전체 마스킹, 원문 노출 금지) ──
create or replace function public.mask_military_phone(p text)
returns text language sql immutable as $$
  select case
    when p is null or length(btrim(p)) = 0 then ''
    when p ~ '^\d{2,3}-\d{3,4}-\d{4}$' then regexp_replace(p, '-\d{3,4}-', '-****-')
    else '***-****-****'
  end;
$$;
create or replace function public.mask_military_birth_date(p text)
returns text language sql immutable as $$
  select case
    when p is null or length(btrim(p)) = 0 then ''
    when p ~ '^\d{4}-\d{2}-\d{2}' then substring(p from 1 for 4) || '-**-**'
    else '****-**-**'
  end;
$$;
revoke all on function public.mask_military_phone(text)     from public, anon;
revoke all on function public.mask_military_birth_date(text) from public, anon;
grant execute on function public.mask_military_phone(text)     to authenticated;
grant execute on function public.mask_military_birth_date(text) to authenticated;

-- ── sanitized read RPC ──
--  admin  : 원본 data 반환(원본 접근 권한 있음).
--  viewer : 전체 payload 를 allowlist 로 재구성(personnel PII 제거/마스킹 · training.notes/notice.content/report.notes 자유텍스트 제거). 신규 필드 자동 미노출(fail-closed).
--  기타/비활성/미인증 : null(tenant 존재/데이터 미노출). anon 은 EXECUTE 자체 없음.
create or replace function public.get_military_module_for_current_user()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_active boolean; v_data jsonb;
begin
  select p.role, coalesce(p.is_active, false) into v_role, v_active from public.profiles p where p.id = auth.uid();
  if v_role is null or not v_active then return null; end if;

  select d.data into v_data from public.military_module_data d
   where d.tenant_id = 'default' order by d.updated_at desc limit 1;
  if v_data is null then return jsonb_build_object('_empty', true); end if;

  if v_role = 'admin' then
    return v_data;                                   -- 원본
  elsif v_role = 'viewer' then
    return jsonb_build_object(
      'militaryPersonnel', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p->>'id', 'name', p->>'name', 'unit', p->>'unit', 'rank', p->>'rank', 'status', p->>'status',
          'enlistmentDate', p->>'enlistmentDate', 'dischargeDate', p->>'dischargeDate',
          'calculationMode', p->>'calculationMode', 'manualCategory', p->>'manualCategory',
          'manualYear', p->>'manualYear', 'manualBaseYear', p->>'manualBaseYear', 'mobilization', p->'mobilization',
          'phone', public.mask_military_phone(p->>'phone'), 'birthDate', public.mask_military_birth_date(p->>'birthDate')
          -- REMOVE: serviceNumber/emergencyContact/emergencyRelation/workPhone/email/bankName/accountNumber/notes (allowlist 미포함)
        )) from jsonb_array_elements(coalesce(v_data->'militaryPersonnel', '[]'::jsonb)) p
      ), '[]'::jsonb),
      'militaryTrainingRecords', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t->>'id', 'personnelId', t->>'personnelId', 'subject', t->>'subject', 'trainingType', t->>'trainingType',
          'trainingRound', t->>'trainingRound', 'trainingYear', t->>'trainingYear', 'trainingDate', t->>'trainingDate',
          'completionDate', t->>'completionDate', 'trainingHours', t->'trainingHours', 'location', t->>'location',
          'attendees', t->'attendees', 'status', t->>'status'
          -- REMOVE: notes(자유텍스트)
        )) from jsonb_array_elements(coalesce(v_data->'militaryTrainingRecords', '[]'::jsonb)) t
      ), '[]'::jsonb),
      'militaryNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n->>'id', 'personnelIds', n->'personnelIds', 'title', n->>'title', 'category', n->>'category',
          'publishedDate', n->>'publishedDate', 'expiresDate', n->>'expiresDate', 'sentStatus', n->>'sentStatus'
          -- REMOVE: content(자유텍스트)
        )) from jsonb_array_elements(coalesce(v_data->'militaryNotices', '[]'::jsonb)) n
      ), '[]'::jsonb),
      'militaryReports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r->>'id', 'title', r->>'title', 'reportDate', r->>'reportDate', 'type', r->>'type',
          'author', r->>'author', 'status', r->>'status'
          -- REMOVE: notes(자유텍스트)
        )) from jsonb_array_elements(coalesce(v_data->'militaryReports', '[]'::jsonb)) r
      ), '[]'::jsonb),
      'militarySettings', coalesce(v_data->'militarySettings', '{}'::jsonb),
      'militaryTrainingRules', coalesce(v_data->'militaryTrainingRules', '[]'::jsonb),
      'militaryCodeValues', coalesce(v_data->'militaryCodeValues', '{}'::jsonb),
      'militaryTrainingAutoConfig', coalesce(v_data->'militaryTrainingAutoConfig', jsonb_build_object('enabled', true, 'targetStatuses', jsonb_build_array('재직')))
    );
  end if;
  return null;                                       -- 기타 role 거부
end $$;

revoke all on function public.get_military_module_for_current_user() from public, anon;
grant execute on function public.get_military_module_for_current_user() to authenticated;
-- 소유자(owner)는 신뢰 role(postgres) 이어야 함 — postcheck 로 확인.
