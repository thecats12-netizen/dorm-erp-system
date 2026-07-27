-- ============================================================================
-- PM 후보 생성 무결성·서버 검증 보강 (신규 · additive)
--   1) pm_certifications.metadata(jsonb) 컬럼 추가(후보 provenance 저장용)
--   2) 대기 후보 중복 방지 partial unique index (level_id 존재 데이터에만)
--   3) SECURITY DEFINER RPC exam_generate_pm_candidates — 서버 권한검증 + 원자적 생성
--   4) exam_certification_history INSERT 정책 강화(viewer append 차단)
--   · 기존 테이블/컬럼/데이터/승인 로직 변경 없음. 기존 migration 미수정.
--   · 기존 중복 데이터를 자동 삭제/병합하지 않음(발견 시 migration 중단 + 운영자 정리 안내).
--   ⚠ 운영 DB 자동 적용 금지.
-- ============================================================================
begin;

-- ── 1) pm_certifications.metadata (additive) ────────────────────────────────
alter table public.pm_certifications add column if not exists metadata jsonb not null default '{}'::jsonb;

-- ── 2) 대기 후보 중복 방지 ─────────────────────────────────────────────────
-- [사전 중복 탐지] 아래를 먼저 확인(참고용 · 이 블록은 자동 삭제하지 않음):
--   select tenant_id, personnel_id, process_id, level_id, count(*)
--     from public.pm_certifications
--    where approval_status='대기' and is_active=true and deleted_at is null and level_id is not null
--    group by 1,2,3,4 having count(*) > 1;
-- 중복이 있으면 아래 DO 블록이 예외를 던져 migration 을 중단합니다(데이터 보존).
--   운영자가 중복 후보를 수동 정리(예: 오래된 대기 행을 is_active=false 또는 deleted_at 처리) 후 재실행하세요.
do $$
declare v_dups int;
begin
  select count(*) into v_dups from (
    select 1 from public.pm_certifications
     where approval_status = '대기' and is_active = true and deleted_at is null and level_id is not null
     group by tenant_id, personnel_id, process_id, level_id
     having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception '중복 대기 후보 그룹 %건이 존재하여 유니크 인덱스를 만들 수 없습니다. 자동 삭제하지 않습니다. 운영자가 중복을 정리(대기 1건만 유지)한 뒤 이 migration 을 재실행하세요.', v_dups;
  end if;
end $$;

-- 동일 tenant·직원·공정·단계에 활성 승인대기 후보 최대 1건(level_id 존재 데이터에만 적용 → 기존 null 호환).
create unique index if not exists ux_pmcert_pending_candidate
  on public.pm_certifications (tenant_id, personnel_id, process_id, level_id)
  where approval_status = '대기' and is_active = true and deleted_at is null and level_id is not null;

-- ── 3) 서버 RPC: 권한검증 + 게이트 재검증 + 원자적 생성(대기) ──────────────────
-- 반환: jsonb {created, existing, ineligible, reeval_excluded, confirmed_held, errors}
-- p_candidates: [{personnel_id, process_id, level_id, engine_version, criteria_version}]  (클라이언트 스냅샷)
--   ※ 최종 자격의 보안·정체성 게이트는 서버가 재검증. (중첩 criteria 충족 여부는 클라이언트 엔진 계산 —
--      본 RPC 는 그 결과를 그대로 신뢰하지 않고 tenant/직원/공정/단계/재평가/확정보유/중복을 재확인)
create or replace function public.exam_generate_pm_candidates(p_tenant_id text, p_candidates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant text := coalesce(nullif(p_tenant_id, ''), 'default');
  v_created int := 0; v_existing int := 0; v_ineligible int := 0;
  v_reeval int := 0; v_held int := 0; v_errors int := 0;
  v_top_rank int; v_level_rank int; v_code text;
  r jsonb; v_person uuid; v_proc uuid; v_level uuid;
begin
  -- 인증/권한(클라이언트 신뢰 금지): 로그인 + 관리자 또는 PM 생성 권한.
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.is_exam_admin() or public.crp_user_has_permission('examPmCertifications.create')) then
    raise exception 'FORBIDDEN';
  end if;

  -- 최고 PM 단계(M4) rank.
  select max(rank_order) into v_top_rank from public.exam_levels
   where tenant_id = v_tenant and coalesce(is_active, true) and deleted_at is null
     and upper(code) in ('SINGLE','M1','M2','M3','M4');
  if v_top_rank is null then
    return jsonb_build_object('created',0,'existing',0,'ineligible',0,'reeval_excluded',0,'confirmed_held',0,'errors',0);
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) as t(value)
  loop
    begin
      v_person := (r->>'personnel_id')::uuid;
      v_proc   := (r->>'process_id')::uuid;
      v_level  := (r->>'level_id')::uuid;

      -- (a) 직원 활성 + 동일 tenant + 공정 일치
      if not exists (select 1 from public.exam_personnel p
                      where p.id = v_person and p.tenant_id = v_tenant
                        and coalesce(p.is_active, true) and p.deleted_at is null
                        and p.process_id = v_proc) then
        v_ineligible := v_ineligible + 1; continue;
      end if;
      -- (b) 공정 유효
      if not exists (select 1 from public.exam_processes pr
                      where pr.id = v_proc and pr.tenant_id = v_tenant
                        and coalesce(pr.is_active, true) and pr.deleted_at is null) then
        v_ineligible := v_ineligible + 1; continue;
      end if;
      -- (c) level 이 최고 PM 단계(M4)인지
      select rank_order, upper(code) into v_level_rank, v_code from public.exam_levels
       where id = v_level and tenant_id = v_tenant and deleted_at is null;
      if v_level_rank is null or v_level_rank <> v_top_rank then
        v_ineligible := v_ineligible + 1; continue;
      end if;
      -- (d) 재평가 제외(승인 설비 중 needs_reeval)
      if exists (select 1 from public.exam_equipment_certifications c
                  where c.tenant_id = v_tenant and c.personnel_id = v_person and c.deleted_at is null
                    and (c.metadata->>'needs_reeval') = 'true') then
        v_reeval := v_reeval + 1; continue;
      end if;
      -- (e) 최고 단계 확정 보유 제외(승인·활성·미만료; level_id 또는 pm_level fallback)
      if exists (select 1 from public.pm_certifications pm
                  where pm.tenant_id = v_tenant and pm.personnel_id = v_person and pm.process_id = v_proc
                    and pm.approval_status = '승인' and coalesce(pm.is_active, true) and pm.deleted_at is null
                    and (pm.expiry_date is null or pm.expiry_date >= current_date)
                    and (pm.level_id = v_level or (pm.level_id is null and upper(coalesce(pm.pm_level,'')) = v_code))) then
        v_held := v_held + 1; continue;
      end if;
      -- (f) 기존 대기 후보 제외(unique 와 이중 방어)
      if exists (select 1 from public.pm_certifications pm
                  where pm.tenant_id = v_tenant and pm.personnel_id = v_person and pm.process_id = v_proc
                    and pm.level_id = v_level and pm.approval_status = '대기'
                    and coalesce(pm.is_active, true) and pm.deleted_at is null) then
        v_existing := v_existing + 1; continue;
      end if;

      -- INSERT (대기). 승인/취득/강등 없음. metadata 에 provenance.
      insert into public.pm_certifications
        (tenant_id, personnel_id, employee_no, process_id, level_id, pm_level,
         approval_status, is_active, acquired_date, created_by, updated_by, metadata)
      select v_tenant, v_person, p.employee_no, v_proc, v_level, v_code,
             '대기', true, current_date, v_uid, v_uid,
             jsonb_build_object('auto_candidate', true, 'candidate_generated_at', now(),
                                'engine_version', r->>'engine_version', 'criteria_version', r->'criteria_version',
                                'server_validated', true)
        from public.exam_personnel p where p.id = v_person;
      v_created := v_created + 1;

    exception
      when unique_violation then v_existing := v_existing + 1;   -- 동시성 최종 방어(partial unique)
      when others then v_errors := v_errors + 1;                 -- 개별 후보 오류는 건너뜀(원문 비노출)
    end;
  end loop;

  -- 감사로그(서버측 · 배치 1건). certification history 에는 기록하지 않음(승인 시에만).
  insert into public.exam_audit_logs (tenant_id, target_type, target_id, action_type, changed_by, after_value, memo, created_by)
  values (v_tenant, 'pm_certifications', 'batch-' || extract(epoch from now())::bigint, 'create', v_uid,
          jsonb_build_object('created',v_created,'existing',v_existing,'ineligible',v_ineligible,
                             'reeval_excluded',v_reeval,'confirmed_held',v_held,'errors',v_errors),
          'PM 후보 자동 생성(서버 RPC · 대기)', v_uid);

  return jsonb_build_object('created',v_created,'existing',v_existing,'ineligible',v_ineligible,
                            'reeval_excluded',v_reeval,'confirmed_held',v_held,'errors',v_errors);
end $$;

revoke all on function public.exam_generate_pm_candidates(text, jsonb) from public;
grant execute on function public.exam_generate_pm_candidates(text, jsonb) to authenticated;

-- ── 4) 인증 이력 INSERT 정책 강화(viewer append 차단) ──────────────────────────
-- 기존(20260750): is_exam_admin() OR can_read_exam_master() → viewer append 가능(권한 과다).
-- 변경: 관리자 또는 PM 생성 권한자만 append. 조회(SELECT)는 기존 viewer 이상 유지.
drop policy if exists "certhist_insert" on public.exam_certification_history;
create policy "certhist_insert" on public.exam_certification_history
  for insert to authenticated
  with check ((public.is_exam_admin() or public.crp_user_has_permission('examPmCertifications.create')) and tenant_id is not null);

commit;

-- notify pgrst, 'reload schema';  -- 선택(RPC 노출 반영)
