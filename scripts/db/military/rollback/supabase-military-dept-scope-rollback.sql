-- ============================================================================
-- 군대 부서 범위 강제 — ROLLBACK 초안 (⚠ 실행 금지 · 승인 후에만)
--
-- [완전성]  apply 는 (a) 신규 helper 2개 생성 (b) 기존 RPC CREATE OR REPLACE.
--   군대 테이블 RLS/GRANT/정책/데이터/구조는 건드리지 않았으므로 롤백 = RPC 를 원문으로 복원 + 신규 helper DROP.
--   ⚠ 순서: RPC 를 먼저 원문으로 복원(helper 의존 제거) → 그다음 신규 helper DROP.
--
-- ⚠⚠ 아래 §1 의 RPC 본문은 "적용 직전 precheck [M1] 로 캡처한 실제 Production 원문"으로 교체할 것.
--     여기에는 base(=phaseB v2, 배포 기준) 원문을 넣어두었으나, M1 캡처와 1자라도 다르면 M1 캡처가 최종 기준이다.
--     (repo 추정을 원본으로 간주하지 말 것.)
-- ============================================================================
begin;

-- ── 1) RPC 원문 복원 (M1 캡처 원문으로 교체 · 아래는 phaseB v2 base) ────────────────────────────
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
          'phone', public.mask_military_phone(p->>'phone'), 'birthDate', public.mask_military_birth_date(p->>'birthDate'),
          'isDeleted', p->'isDeleted', 'isPermanentDeleted', p->'isPermanentDeleted'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryPersonnel')) p
      ), '[]'::jsonb),
      'militaryTrainingRecords', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t->>'id', 'personnelId', t->>'personnelId', 'subject', t->>'subject', 'trainingType', t->>'trainingType',
          'trainingRound', t->>'trainingRound', 'trainingYear', t->>'trainingYear', 'trainingDate', t->>'trainingDate',
          'completionDate', t->>'completionDate', 'trainingHours', t->'trainingHours', 'location', t->>'location',
          'attendees', t->'attendees', 'status', t->>'status',
          'isDeleted', t->'isDeleted', 'isPermanentDeleted', t->'isPermanentDeleted'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryTrainingRecords')) t
      ), '[]'::jsonb),
      'militaryNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n->>'id', 'personnelIds', n->'personnelIds', 'title', n->>'title', 'category', n->>'category',
          'publishedDate', n->>'publishedDate', 'expiresDate', n->>'expiresDate', 'sentStatus', n->>'sentStatus'
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryNotices')) n
      ), '[]'::jsonb),
      'militaryReports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r->>'id', 'title', r->>'title', 'reportDate', r->>'reportDate', 'type', r->>'type',
          'author', r->>'author', 'status', r->>'status'
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
  return null;
end $$;

revoke all on function public.get_military_module_for_current_user() from public, anon;
grant execute on function public.get_military_module_for_current_user() to authenticated;

-- ── 2) 신규 helper 제거(RPC 복원 후) ────────────────────────────────────────────────────
drop function if exists public.military_allowed_units();
drop function if exists public.military_unit_in_scope(text,text[]);

commit;

-- ⚠ 롤백 후 postcheck 재사용: 신규 helper 소멸 · RPC 원문 복귀 · military_module_data RLS/GRANT/데이터 불변.
