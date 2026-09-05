-- ============================================================================
-- 군대관리 v2 2G — Phase B RPC v2 (get_military_module_for_current_user 만 최소 보정 · Production 승인 후 적용)
-- 변경점(Phase A 대비): viewer personnel/training projection 에 isDeleted / isPermanentDeleted (boolean) 추가.
--   근거: 프론트 alive()=!isDeleted&&!isPermanentDeleted · isInTrash() 의미론 보존(비민감 boolean · PII 아님).
-- ⚠ ADDITIVE/IDEMPOTENT — 정책/RLS/publication/table GRANT/데이터 변경 없음. CREATE OR REPLACE 1개 함수만.
--   원본 object spread 금지 · 추가 PII 필드 금지 · 기존 마스킹/제거 정책 유지.
-- Phase A 의 mil_safe_array/can_read_military_raw/mask_* 는 이미 배포됨 — 재생성하지 않는다(이 파일은 RPC 만).
-- ============================================================================
begin;

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
    return v_data;                                     -- active admin: 원본
  elsif v_role = 'viewer' then
    return jsonb_build_object(
      'militaryPersonnel', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p->>'id', 'name', p->>'name', 'unit', p->>'unit', 'rank', p->>'rank', 'status', p->>'status',
          'enlistmentDate', p->>'enlistmentDate', 'dischargeDate', p->>'dischargeDate',
          'calculationMode', p->>'calculationMode', 'manualCategory', p->>'manualCategory',
          'manualYear', p->>'manualYear', 'manualBaseYear', p->>'manualBaseYear', 'mobilization', p->'mobilization',
          'phone', public.mask_military_phone(p->>'phone'), 'birthDate', public.mask_military_birth_date(p->>'birthDate'),
          'isDeleted', p->'isDeleted', 'isPermanentDeleted', p->'isPermanentDeleted'  -- v2: 삭제 의미론 보존(boolean · 비민감)
          -- REMOVE: serviceNumber/accountNumber/bankName/emergencyContact/emergencyRelation/workPhone/email/notes/serviceBranch
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryPersonnel')) p
      ), '[]'::jsonb),
      'militaryTrainingRecords', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t->>'id', 'personnelId', t->>'personnelId', 'subject', t->>'subject', 'trainingType', t->>'trainingType',
          'trainingRound', t->>'trainingRound', 'trainingYear', t->>'trainingYear', 'trainingDate', t->>'trainingDate',
          'completionDate', t->>'completionDate', 'trainingHours', t->'trainingHours', 'location', t->>'location',
          'attendees', t->'attendees', 'status', t->>'status',
          'isDeleted', t->'isDeleted', 'isPermanentDeleted', t->'isPermanentDeleted'  -- v2: 삭제 의미론 보존
          -- REMOVE: notes(자유텍스트)
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryTrainingRecords')) t
      ), '[]'::jsonb),
      'militaryNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n->>'id', 'personnelIds', n->'personnelIds', 'title', n->>'title', 'category', n->>'category',
          'publishedDate', n->>'publishedDate', 'expiresDate', n->>'expiresDate', 'sentStatus', n->>'sentStatus'
          -- REMOVE: content(자유텍스트) · (MilitaryNotice 에 isDeleted 없음)
        )) from jsonb_array_elements(public.mil_safe_array(v_data->'militaryNotices')) n
      ), '[]'::jsonb),
      'militaryReports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r->>'id', 'title', r->>'title', 'reportDate', r->>'reportDate', 'type', r->>'type',
          'author', r->>'author', 'status', r->>'status'
          -- REMOVE: notes(자유텍스트) · (MilitaryReport 에 isDeleted 없음)
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
  return null;                                         -- dorm_manager/maintenance_reporter/기타 role 거부
end $$;

revoke all on function public.get_military_module_for_current_user() from public, anon;
grant execute on function public.get_military_module_for_current_user() to authenticated;

commit;
-- 적용 후 postcheck(phase-postcheck.sql) 로 owner=postgres · search_path=public · anon ACL 없음 재확인 권장.
