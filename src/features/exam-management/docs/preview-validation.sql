-- ============================================================================
-- 시험관리 · 직원별 인증 Preview / 엔진 실동작 검증용 대조 SQL (조회 전용)
-- ----------------------------------------------------------------------------
-- ⚠ 운영 데이터 수정 금지. 아래 SELECT 만 사용(UPDATE/DELETE/INSERT 없음).
-- 파라미터 치환 위치:
--   :tenant_id     → 테스트 tenant (text, 예: 'test')
--   :personnel_id  → 대상 직원 exam_personnel.id (uuid)
--   :process_id    → 대상 공정 exam_processes.id (uuid)
--   :achieve_type  → 달성기준 rule_type 표준값 (예: '달성 기준')  ※ 호환: replace(rule_type,' ','')='달성기준'
--   :today         → 기준일 (date, 보통 current_date)
-- Supabase SQL Editor 에서는 :param 대신 실제 값으로 바꿔 실행하세요.
-- ============================================================================

-- [2] migration 적용 상태 확인 -----------------------------------------------
-- exam_levels 확장 컬럼(tier/parent_level_id/requires_approval/auto_promote)
select column_name from information_schema.columns
 where table_schema='public' and table_name='exam_levels'
   and column_name in ('tier','parent_level_id','requires_approval','auto_promote','rank_order');

-- SINGLE/M1~M4 seed 존재 여부(테넌트별)
select tenant_id, upper(code) as code, name, rank_order, tier, requires_approval, auto_promote
  from public.exam_levels
 where tenant_id = :tenant_id and upper(code) in ('SINGLE','M1','M2','M3','M4')
 order by rank_order;

-- 신규 테이블 존재 여부
select table_name from information_schema.tables
 where table_schema='public'
   and table_name in ('exam_equipment_stage_rules','exam_equipment_certifications');

-- index / unique / exclusion / btree_gist 확인
select indexname, indexdef from pg_indexes
 where schemaname='public' and tablename in ('exam_equipment_stage_rules','exam_equipment_certifications')
 order by tablename, indexname;
select conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid in ('public.exam_equipment_stage_rules'::regclass, 'public.exam_equipment_certifications'::regclass)
 order by contype;   -- contype: 'x'=exclusion, 'u'=unique, 'c'=check
select extname from pg_extension where extname='btree_gist';

-- RLS 정책
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname='public' and tablename in ('exam_equipment_stage_rules','exam_equipment_certifications');

-- [4][6] 승인 설비 집계(중복 승인은 1건) -------------------------------------
-- Preview '승인 설비'와 대조. status='approved' & deleted_at is null 만.
select count(distinct equipment_id) as approved_distinct_equipment
  from public.exam_equipment_certifications
 where tenant_id = :tenant_id and personnel_id = :personnel_id
   and status = 'approved' and deleted_at is null;

-- 상태별 분포(제외 대상 확인: eligible/pending/rejected/suspended/revoked/expired 는 취득 아님)
select status, count(*) as cnt, count(distinct equipment_id) as distinct_eq
  from public.exam_equipment_certifications
 where tenant_id = :tenant_id and personnel_id = :personnel_id and deleted_at is null
 group by status order by status;

-- [26] 동일 직원·동일 설비 중복 승인 데이터 탐지
select equipment_id, count(*) as approved_rows
  from public.exam_equipment_certifications
 where tenant_id = :tenant_id and personnel_id = :personnel_id
   and status='approved' and deleted_at is null
 group by equipment_id having count(*) > 1;

-- [7] 공정별 대상 설비(분모) — 활성 설비 -------------------------------------
select count(*) as target_equipment_count
  from public.exam_equipment
 where tenant_id = :tenant_id and process_id = :process_id
   and is_active = true and deleted_at is null;

-- [5][8] 공정별 주력설비 대상(현재 유효한 stage rule 의 is_core_equipment) ----
select count(distinct r.equipment_id) as core_target_count
  from public.exam_equipment_stage_rules r
 where r.tenant_id = :tenant_id and r.process_id = :process_id
   and r.is_core_equipment = true and r.is_active = true and r.deleted_at is null
   and (r.effective_from is null or r.effective_from <= :today)
   and (r.effective_to   is null or r.effective_to   >= :today);

-- 설비별 기준단계(level) 매핑 + 만료/미래/삭제/비활성 규칙 제외 검증
select e.code as equip_code, e.name as equip_name, l.code as level_code,
       r.is_core_equipment, r.effective_from, r.effective_to, r.is_active, r.deleted_at
  from public.exam_equipment_stage_rules r
  join public.exam_equipment e on e.id = r.equipment_id
  left join public.exam_levels l on l.id = r.level_id
 where r.tenant_id = :tenant_id and r.process_id = :process_id
 order by e.code;

-- 승인 주력설비 수(승인 ∩ 유효 core) — Preview '주력설비 취득분'과 대조
select count(distinct c.equipment_id) as approved_core_count
  from public.exam_equipment_certifications c
 where c.tenant_id = :tenant_id and c.personnel_id = :personnel_id
   and c.status='approved' and c.deleted_at is null
   and c.equipment_id in (
     select r.equipment_id from public.exam_equipment_stage_rules r
      where r.tenant_id = :tenant_id and r.process_id = :process_id
        and r.is_core_equipment = true and r.is_active = true and r.deleted_at is null
        and (r.effective_from is null or r.effective_from <= :today)
        and (r.effective_to   is null or r.effective_to   >= :today));

-- [6][27] 공정별 활성 criteria(달성기준) — 유효기간은 criteria(jsonb) 내부 ------
select id, level_id, is_active, deleted_at,
       criteria->>'effective_from' as eff_from, criteria->>'effective_to' as eff_to,
       criteria->>'priority' as priority, criteria->>'operator' as operator, criteria
  from public.exam_rules
 where tenant_id = :tenant_id and process_id = :process_id
   and replace(coalesce(rule_type,''),' ','') = '달성기준'
   and is_active = true and deleted_at is null
 order by level_id, (criteria->>'priority')::numeric desc nulls last;

-- [6] 동일 공정·레벨 복수 유효 규칙(중복 기준) 탐지 → Preview 경고와 대조
select level_id, count(*) as active_rules
  from public.exam_rules
 where tenant_id = :tenant_id and process_id = :process_id
   and replace(coalesce(rule_type,''),' ','') = '달성기준'
   and is_active = true and deleted_at is null
   and (coalesce(criteria->>'effective_from','') = '' or (criteria->>'effective_from') <= :today::text)
   and (coalesce(criteria->>'effective_to','')   = '' or (criteria->>'effective_to')   >= :today::text)
 group by level_id having count(*) > 1;

-- [27] 유효기간 밖(만료/미래) 규칙 — 계산에서 제외되어야 함
select id, level_id, criteria->>'effective_from' as eff_from, criteria->>'effective_to' as eff_to
  from public.exam_rules
 where tenant_id = :tenant_id and process_id = :process_id
   and replace(coalesce(rule_type,''),' ','') = '달성기준' and is_active=true and deleted_at is null
   and ( (criteria->>'effective_from') > :today::text or (criteria->>'effective_to') < :today::text );

-- [11][23][24] 현재 확정 단계(pm_certifications) — level_id 우선, pm_level fallback -
-- 만료(expiry_date < today) 제외, is_active/deleted_at 필터, 공정 스코프.
select pc.process_id, pc.level_id, l.code as level_code, l.rank_order,
       pc.pm_level, pc.acquired_date, pc.expiry_date, pc.is_active, pc.deleted_at
  from public.pm_certifications pc
  left join public.exam_levels l on l.id = pc.level_id
 where pc.tenant_id = :tenant_id and pc.personnel_id = :personnel_id
   and pc.process_id = :process_id and pc.is_active = true and pc.deleted_at is null
   and pc.approval_status = '승인'   -- 프로젝트 표준 확정 상태(대기/반려/승인취소 제외)
   and (pc.expiry_date is null or pc.expiry_date >= :today)
 order by l.rank_order desc nulls last, pc.acquired_date desc;

-- [21][22] 경과개월 계산 근거 — 확정 단계 취득일(최저/최고 rank) ----------------
-- 단계간 경과 = 최고 rank 확정일→오늘, 누적 경과 = 최저 rank 확정일→오늘 (완전 개월)
select min(pc.acquired_date) filter (where pc.acquired_date is not null) as earliest_stage_date,
       max(pc.acquired_date) filter (where pc.acquired_date is not null) as latest_stage_date
  from public.pm_certifications pc
 where pc.tenant_id = :tenant_id and pc.personnel_id = :personnel_id
   and pc.process_id = :process_id and pc.is_active = true and pc.deleted_at is null
   and pc.approval_status = '승인'   -- 프로젝트 표준 확정 상태(대기/반려/승인취소 제외)
   and (pc.expiry_date is null or pc.expiry_date >= :today);

-- [14][25] needs_reeval 설비 -------------------------------------------------
select id, equipment_id, status, (metadata->>'needs_reeval') as needs_reeval
  from public.exam_equipment_certifications
 where tenant_id = :tenant_id and personnel_id = :personnel_id and deleted_at is null
   and (metadata->>'needs_reeval') = 'true';

-- [13] 근속 기준(hire_date) — 미래/누락 방어 대상 확인 --------------------------
select employee_no, name, hire_date, process_id, group_name, product_group, part_name, employment_status
  from public.exam_personnel
 where tenant_id = :tenant_id and id = :personnel_id;

-- [히스토리] 인증 이력(exam_certification_history) — append 검증 & 조회 -----------
-- 승인 1회당 1건 append 확인. UPDATE/DELETE 정책이 없어 불변(수정 시도는 RLS 거부).
select id, certification_type, level_id, previous_level_id, approved_at, approved_by,
       source_type, source_id, reason, status, metadata, created_by, created_at
  from public.exam_certification_history
 where tenant_id = :tenant_id and personnel_id = :personnel_id
 order by approved_at desc nulls last, created_at desc;
-- 같은 source(pm_certifications.id)로 이력이 2건 이상이면(중복 append) 점검
select source_id, count(*) as history_rows
  from public.exam_certification_history
 where tenant_id = :tenant_id and personnel_id = :personnel_id and source_type = 'pm_certification'
 group by source_id having count(*) > 1;
