-- ============================================================================
-- 군대관리 v2 2G — Phase A (ADDITIVE ONLY · Production 승인 후 적용 가능)
-- 목적: 기존 동작을 깨지 않고 "viewer sanitized read path"만 추가한다.
--   - 새 함수/RPC/mask helper 만 CREATE (additive)
--   - 기존 broad 정책 DROP 없음 · RLS 정책 변경 없음 · publication 변경 없음 · table GRANT 변경 없음
--   → 이 파일 적용 후에도 현재 raw 경로/기능은 그대로 동작(무회귀). RLS 차단은 Phase D 에서 별도.
-- 보안: 전역 is_admin() 미사용. 군대 전용 active-admin helper 로 is_active 강제.
--   PII/JSONB 원문을 로그/출력하지 않는다.
-- ⚠ Production 실행은 명시적 승인 후. 이 파일 자체는 실행/commit 하지 않음.
-- ============================================================================
begin;

-- ── 0) 안전 배열 helper (immutable · 비배열/누락 JSONB 를 []로 정규화 · malformed guard) ──
create or replace function public.mil_safe_array(v jsonb)
returns jsonb language sql immutable as $$
  select case when v is not null and jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
$$;
revoke all on function public.mil_safe_array(jsonb) from public, anon;
grant execute on function public.mil_safe_array(jsonb) to authenticated;

-- ── 1) 군대 전용 active-admin helper (raw 접근 판정 · role='admin' AND is_active) ──
--   전역 is_admin() 을 쓰지 않는 이유: is_active 를 검사하지 않아 비활성 admin 이 통과할 수 있음.
create or replace function public.can_read_military_raw()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active is true
  );
$$;
revoke all on function public.can_read_military_raw() from public, anon;
grant execute on function public.can_read_military_raw() to authenticated;

-- ── 2) 마스킹 helper (순수 · fail-closed: 형식 불명이면 전체 마스킹) ──
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

-- ── 3) sanitized read RPC ──
--   admin(active) : 원본 data 반환.
--   viewer(active): 전체 payload 를 allowlist 로 재구성(personnel PII 제거/마스킹 · training.notes/notice.content/report.notes 제거). 신규 필드 자동 미노출(fail-closed).
--   기타 role / 비활성 / 미인증 : null. anon 은 EXECUTE 자체 없음.
create or replace function public.get_military_module_for_current_user()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_active boolean; v_data jsonb;
begin
  select p.role, coalesce(p.is_active, false) into v_role, v_active
    from public.profiles p where p.id = auth.uid();
  if v_role is null or not v_active then return null; end if;

  select d.data into v_data from public.military_module_data d
   where d.tenant_id = 'default' order by d.updated_at desc limit 1;
  if v_data is null then return jsonb_build_object('_empty', true); end if;

  -- active admin: 원본. (can_read_military_raw 와 동일 판정 · 여기선 이미 role/active 확인됨)
  if v_role = 'admin' then
    return v_data;
  elsif v_role = 'viewer' then
    return jsonb_build_object(
      'militaryPersonnel', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p->>'id', 'name', p->>'name', 'unit', p->>'unit', 'rank', p->>'rank', 'status', p->>'status',
          'enlistmentDate', p->>'enlistmentDate', 'dischargeDate', p->>'dischargeDate',
          'calculationMode', p->>'calculationMode', 'manualCategory', p->>'manualCategory',
          'manualYear', p->>'manualYear', 'manualBaseYear', p->>'manualBaseYear', 'mobilization', p->'mobilization',
          'phone', public.mask_military_phone(p->>'phone'), 'birthDate', public.mask_military_birth_date(p->>'birthDate')
          -- REMOVE: serviceNumber/accountNumber/bankName/emergencyContact/emergencyRelation/workPhone/email/notes
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryPersonnel')) p
      ), '[]'::jsonb),
      'militaryTrainingRecords', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t->>'id', 'personnelId', t->>'personnelId', 'subject', t->>'subject', 'trainingType', t->>'trainingType',
          'trainingRound', t->>'trainingRound', 'trainingYear', t->>'trainingYear', 'trainingDate', t->>'trainingDate',
          'completionDate', t->>'completionDate', 'trainingHours', t->'trainingHours', 'location', t->>'location',
          'attendees', t->'attendees', 'status', t->>'status'
          -- REMOVE: notes(자유텍스트)
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryTrainingRecords')) t
      ), '[]'::jsonb),
      'militaryNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n->>'id', 'personnelIds', n->'personnelIds', 'title', n->>'title', 'category', n->>'category',
          'publishedDate', n->>'publishedDate', 'expiresDate', n->>'expiresDate', 'sentStatus', n->>'sentStatus'
          -- REMOVE: content(자유텍스트)
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryNotices')) n
      ), '[]'::jsonb),
      'militaryReports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r->>'id', 'title', r->>'title', 'reportDate', r->>'reportDate', 'type', r->>'type',
          'author', r->>'author', 'status', r->>'status'
          -- REMOVE: notes(자유텍스트)
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryReports')) r
      ), '[]'::jsonb),
      'militarySettings', case when jsonb_typeof(v_data->'militarySettings')='object' then v_data->'militarySettings' else '{}'::jsonb end,
      'militaryTrainingRules', public.mil_safe_array(v_data->'militaryTrainingRules'),
      'militaryCodeValues', case when jsonb_typeof(v_data->'militaryCodeValues')='object' then v_data->'militaryCodeValues' else '{}'::jsonb end,
      'militaryTrainingAutoConfig', case when jsonb_typeof(v_data->'militaryTrainingAutoConfig')='object'
        then v_data->'militaryTrainingAutoConfig'
        else jsonb_build_object('enabled', true, 'targetStatuses', jsonb_build_array('재직')) end
    );
  end if;
  return null;  -- dorm_manager/maintenance_reporter/기타 role 거부
end $$;

revoke all on function public.get_military_module_for_current_user() from public, anon;
grant execute on function public.get_military_module_for_current_user() to authenticated;
-- owner 는 신뢰 role(postgres) 이어야 함 — postcheck 로 확인.

commit;

-- 적용 후(선택) 확인 — PII/원문 출력 금지, 존재/속성만:
--   select proname, prosecdef, pg_get_userbyid(proowner) owner, proacl, proconfig
--     from pg_proc where proname in
--     ('can_read_military_raw','get_military_module_for_current_user','mask_military_phone','mask_military_birth_date','mil_safe_array');
