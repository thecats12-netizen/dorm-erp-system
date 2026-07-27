-- ============================================================================
-- 테스트 데이터 seed — 직원 A~E + 시나리오 (테스트 tenant 전용 · idempotent)
--   ⚠ 운영 tenant 에서 실행 금지. 아래 guard 가 'default'/'prod' 등이면 실행 중단.
--   ⚠ 실제 테이블 컬럼만 사용. 정리는 cleanup-test-data.sql 참조.
--   psql:  \set test_tenant 'test'   후 실행
--   Dashboard SQL Editor: :test_tenant 를 'test' 로 모두 치환.
--   고정 UUID(a5100000-...-000000000NN)로 반복 실행 가능(ON CONFLICT (id) DO UPDATE).
--   레벨은 (tenant, code)로 참조 — 20260747000001 seed 와 코드 중복 생성 방지.
-- ============================================================================
\set test_tenant 'test'

-- ── SAFETY GUARD: 운영/기본 tenant 면 즉시 중단(0으로 나눠 강제 에러) ──────────
select case when :'test_tenant' in ('default','prod','production','운영','main')
            then 1/0 else 0 end as must_be_test_tenant_guard;

-- ── 0) 인증 단계(SINGLE~M4) 보장: 없을 때만 삽입(코드 기준) ───────────────────
insert into public.exam_levels (id, tenant_id, code, name, rank_order, is_active, tier, requires_approval, auto_promote)
select gen_random_uuid(), :'test_tenant', v.code, v.name, v.rank, true, 'PM', true, false
from (values ('SINGLE','Single',10),('M1','M1',20),('M2','M2',30),('M3','M3',40),('M4','M4',50)) as v(code,name,rank)
where not exists (select 1 from public.exam_levels l where l.tenant_id=:'test_tenant' and upper(l.code)=v.code);

-- 편의: 레벨 id 조회 서브쿼리 매크로 대용(각 INSERT 에서 서브쿼리로 사용)
--   (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)='M1' order by rank_order limit 1)

-- ── 1) 기준정보(카테고리/그룹/공정/설비) ───────────────────────────────────
insert into public.exam_categories (id, tenant_id, code, name, is_active) values
 ('a5100000-0000-4000-8000-000000000001', :'test_tenant', 'TCAT', '테스트 제품군', true)
on conflict (id) do update set name=excluded.name, is_active=true, deleted_at=null;

insert into public.exam_groups (id, tenant_id, category_id, code, name, is_active) values
 ('a5100000-0000-4000-8000-000000000002', :'test_tenant', 'a5100000-0000-4000-8000-000000000001', 'TGRP', '테스트 그룹', true)
on conflict (id) do update set name=excluded.name, is_active=true, deleted_at=null;

insert into public.exam_processes (id, tenant_id, group_id, category_id, code, name, is_active) values
 ('a5100000-0000-4000-8000-000000000003', :'test_tenant', 'a5100000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000001', 'TPRC', '테스트 공정(조립)', true)
on conflict (id) do update set name=excluded.name, is_active=true, deleted_at=null;

insert into public.exam_equipment (id, tenant_id, process_id, code, name, is_active) values
 ('a5100000-0000-4000-8000-000000000011', :'test_tenant', 'a5100000-0000-4000-8000-000000000003', 'EQC1', '주력설비1', true),
 ('a5100000-0000-4000-8000-000000000012', :'test_tenant', 'a5100000-0000-4000-8000-000000000003', 'EQC2', '주력설비2', true),
 ('a5100000-0000-4000-8000-000000000013', :'test_tenant', 'a5100000-0000-4000-8000-000000000003', 'EQN1', '일반설비1', true),
 ('a5100000-0000-4000-8000-000000000014', :'test_tenant', 'a5100000-0000-4000-8000-000000000003', 'EQN2', '일반설비2', true)
on conflict (id) do update set name=excluded.name, process_id=excluded.process_id, is_active=true, deleted_at=null;

-- ── 2) 설비별 인증단계(주력 여부 + 유효기간). 비활성/만료 시나리오 포함 ──────────
-- 주력: EQC1(SINGLE), EQC2(M1) / 일반: EQN1(SINGLE), EQN2(M2)
insert into public.exam_equipment_stage_rules
 (id, tenant_id, category_id, group_id, process_id, equipment_id, level_id, is_core_equipment, is_active, effective_from, effective_to)
select v.id, :'test_tenant', 'a5100000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000002',
       'a5100000-0000-4000-8000-000000000003', v.equip,
       (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)=v.lvl order by rank_order limit 1),
       v.core, v.active, v.eff_from, v.eff_to
from (values
  ('a5100000-0000-4000-8000-000000000041','a5100000-0000-4000-8000-000000000011','SINGLE',true , true , null, null),
  ('a5100000-0000-4000-8000-000000000042','a5100000-0000-4000-8000-000000000012','M1'    ,true , true , null, null),
  ('a5100000-0000-4000-8000-000000000043','a5100000-0000-4000-8000-000000000013','SINGLE',false, true , null, null),
  ('a5100000-0000-4000-8000-000000000044','a5100000-0000-4000-8000-000000000014','M2'    ,false, true , null, null),
  -- 비활성 규칙(계산 제외 확인)
  ('a5100000-0000-4000-8000-000000000045','a5100000-0000-4000-8000-000000000014','M1'    ,true , false, null, null),
  -- 만료 규칙(effective_to 과거 → 제외 확인)
  ('a5100000-0000-4000-8000-000000000046','a5100000-0000-4000-8000-000000000013','M1'    ,true , true , date '2000-01-01', date '2000-12-31')
) as v(id, equip, lvl, core, active, eff_from, eff_to)
on conflict (id) do update set is_core_equipment=excluded.is_core_equipment, is_active=excluded.is_active,
  effective_from=excluded.effective_from, effective_to=excluded.effective_to, level_id=excluded.level_id, deleted_at=null;

-- ── 3) 공정별 달성기준(exam_rules, rule_type='달성 기준'). criteria(jsonb) ────────
-- SINGLE: 취득률20% / M1: AND(설비2+주력1) / M2: AND(취득률50%+선행M1) / M3: OR(설비4 또는 취득률90%) / M4: 주력2+필수(EQC1,EQC2)
insert into public.exam_rules (id, tenant_id, rule_type, process_id, level_id, criteria, effective_date, is_active)
select v.id, :'test_tenant', '달성 기준', 'a5100000-0000-4000-8000-000000000003',
       (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)=v.lvl order by rank_order limit 1),
       v.crit::jsonb, null, true
from (values
  ('a5100000-0000-4000-8000-000000000051','SINGLE','{"operator":"AND","min_completion_rate":20,"label_ko":"취득률 20% 이상"}'),
  ('a5100000-0000-4000-8000-000000000052','M1','{"operator":"AND","min_equipment_count":2,"min_core_equipment_count":1}'),
  ('a5100000-0000-4000-8000-000000000053','M2',
     '{"operator":"AND","min_completion_rate":50,"prerequisite_level_ids":["__M1__"]}'),
  ('a5100000-0000-4000-8000-000000000054','M3','{"operator":"OR","min_equipment_count":4,"min_completion_rate":90}'),
  ('a5100000-0000-4000-8000-000000000055','M4',
     '{"operator":"AND","min_core_equipment_count":2,"required_equipment_ids":["a5100000-0000-4000-8000-000000000011","a5100000-0000-4000-8000-000000000012"]}')
) as v(id, lvl, crit)
on conflict (id) do update set criteria=excluded.criteria, is_active=true, deleted_at=null;
-- M2 선행 M1 id 치환(위 __M1__ 자리표시자 → 실제 level id). 반복 실행 안전.
update public.exam_rules
   set criteria = jsonb_set(criteria, '{prerequisite_level_ids}',
        to_jsonb(array[(select id::text from public.exam_levels where tenant_id=:'test_tenant' and upper(code)='M1' order by rank_order limit 1)]))
 where id='a5100000-0000-4000-8000-000000000053';

-- 추가 criteria 시나리오: 만료 / 미래 / 중복 활성 --------------------------------
insert into public.exam_rules (id, tenant_id, rule_type, process_id, level_id, criteria, is_active)
select v.id, :'test_tenant', '달성 기준', 'a5100000-0000-4000-8000-000000000003',
       (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)=v.lvl order by rank_order limit 1),
       v.crit::jsonb, true
from (values
  -- 만료 criteria(effective_to 과거 → 제외)
  ('a5100000-0000-4000-8000-000000000056','SINGLE','{"operator":"AND","min_completion_rate":10,"effective_from":"2000-01-01","effective_to":"2000-12-31"}'),
  -- 미래 criteria(effective_from 미래 → 제외)
  ('a5100000-0000-4000-8000-000000000057','SINGLE','{"operator":"AND","min_completion_rate":30,"effective_from":"2999-01-01"}'),
  -- 중복 활성 criteria(M1 두 번째 → Preview "중복 기준" 경고)
  ('a5100000-0000-4000-8000-000000000058','M1','{"operator":"AND","min_equipment_count":1,"priority":1}')
) as v(id, lvl, crit)
on conflict (id) do update set criteria=excluded.criteria, is_active=true, deleted_at=null;

-- ── 4) 직원 A~E (exam_personnel) ────────────────────────────────────────────
insert into public.exam_personnel (id, tenant_id, employee_no, name, group_name, product_group, part_name, process_id, hire_date, employment_status)
select v.id, :'test_tenant', v.no, v.nm, '테스트 그룹', '테스트 제품군', '테스트 부서',
       'a5100000-0000-4000-8000-000000000003', v.hire::date, '재직'
from (values
  ('a5100000-0000-4000-8000-000000000031','T-A','테스트직원A','2020-01-15'),
  ('a5100000-0000-4000-8000-000000000032','T-B','테스트직원B','2021-03-10'),
  ('a5100000-0000-4000-8000-000000000033','T-C','테스트직원C','2019-06-01'),
  ('a5100000-0000-4000-8000-000000000034','T-D','테스트직원D','2018-02-20'),
  ('a5100000-0000-4000-8000-000000000035','T-E','테스트직원E','2022-09-05')
) as v(id, no, nm, hire)
on conflict (id) do update set name=excluded.name, process_id=excluded.process_id, hire_date=excluded.hire_date,
  employment_status='재직', deleted_at=null;

-- ── 5) 설비 취득(exam_equipment_certifications) ─────────────────────────────
-- A: 승인 0 (행 없음)
-- B: EQC1 승인 → 취득률 25%(SINGLE 충족) · 설비1개(M1 미충족)
-- C: EQC1+EQN1 승인 → 설비2개+주력1(M1 충족) · M2 는 선행 M1 pm확정 없어 미충족
-- D: EQC1+EQC2+EQN1 승인 → 주력2+취득률75%(M4 필수설비 충족) · 선행/상위 조건은 pm이력으로 제어
-- E: EQC1 승인 + metadata.needs_reeval=true
insert into public.exam_equipment_certifications
 (id, tenant_id, personnel_id, process_id, equipment_id, level_id, acquired_date, status, source, metadata, approved_at, approved_by)
select v.id, :'test_tenant', v.person, 'a5100000-0000-4000-8000-000000000003', v.equip,
       (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)='SINGLE' order by rank_order limit 1),
       v.acq::date, v.status, 'manual', v.meta::jsonb, now(), null
from (values
  -- B
  ('a5100000-0000-4000-8000-000000000061','a5100000-0000-4000-8000-000000000032','a5100000-0000-4000-8000-000000000011','2023-01-10','approved','{}'),
  -- C
  ('a5100000-0000-4000-8000-000000000062','a5100000-0000-4000-8000-000000000033','a5100000-0000-4000-8000-000000000011','2022-05-01','approved','{}'),
  ('a5100000-0000-4000-8000-000000000063','a5100000-0000-4000-8000-000000000033','a5100000-0000-4000-8000-000000000013','2022-06-01','approved','{}'),
  -- D
  ('a5100000-0000-4000-8000-000000000064','a5100000-0000-4000-8000-000000000034','a5100000-0000-4000-8000-000000000011','2020-01-01','approved','{}'),
  ('a5100000-0000-4000-8000-000000000065','a5100000-0000-4000-8000-000000000034','a5100000-0000-4000-8000-000000000012','2020-07-01','approved','{}'),
  ('a5100000-0000-4000-8000-000000000066','a5100000-0000-4000-8000-000000000034','a5100000-0000-4000-8000-000000000013','2021-01-01','approved','{}'),
  -- E: needs_reeval
  ('a5100000-0000-4000-8000-000000000067','a5100000-0000-4000-8000-000000000035','a5100000-0000-4000-8000-000000000011','2023-02-01','approved','{"needs_reeval":true}'),
  -- 제외 시나리오(A 대상): pending / revoked / expired
  ('a5100000-0000-4000-8000-000000000068','a5100000-0000-4000-8000-000000000031','a5100000-0000-4000-8000-000000000012','2024-01-01','pending','{}'),
  ('a5100000-0000-4000-8000-000000000069','a5100000-0000-4000-8000-000000000031','a5100000-0000-4000-8000-000000000013','2024-01-01','revoked','{}'),
  ('a5100000-0000-4000-8000-00000000006a','a5100000-0000-4000-8000-000000000031','a5100000-0000-4000-8000-000000000014','2024-01-01','expired','{}')
) as v(id, person, equip, acq, status, meta)
on conflict (id) do update set status=excluded.status, metadata=excluded.metadata, acquired_date=excluded.acquired_date, deleted_at=null;
-- deleted_at 시나리오: 위 pending 행을 soft delete 로도 표시(제외 확인)
update public.exam_equipment_certifications set deleted_at = now()
 where id='a5100000-0000-4000-8000-000000000068';   -- (원하면 주석 처리하여 pending 상태 유지 확인)
-- ⚠ approved 중복(동일 personnel+equipment)은 부분 unique(ux_eqcert_approved_one)로 DB가 차단.
--   Preview 의 Set 중복 제거는 방어적 이중 안전장치이며, 여기서는 중복 approved 를 삽입하지 않는다.

-- ── 6) pm_certifications(현재 확정 단계) 시나리오 ──────────────────────────────
-- D: SINGLE(승인,-x개월)+M1(승인) → 선행 충족 + 경과개월 근거. level_id null+pm_level fallback 1건.
-- 대기/승인취소(대기) row 는 확정으로 인정되면 안 됨(Preview 확인).
insert into public.pm_certifications
 (id, tenant_id, personnel_id, employee_no, process_id, level_id, pm_level, approval_status, is_active, acquired_date, approved_by, approved_at)
select v.id, :'test_tenant', v.person, v.no, 'a5100000-0000-4000-8000-000000000003',
       case when v.use_fallback then null
            else (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)=v.lvl order by rank_order limit 1) end,
       v.lvl, v.appr, true, v.acq::date, null, now()
from (values
  -- D 확정: SINGLE(level_id), M1(level_id) — 경과개월/선행 근거
  ('a5100000-0000-4000-8000-000000000071','a5100000-0000-4000-8000-000000000034','T-D','SINGLE','승인','2020-02-01', false),
  ('a5100000-0000-4000-8000-000000000072','a5100000-0000-4000-8000-000000000034','T-D','M1'    ,'승인','2021-08-01', false),
  -- B 확정: level_id NULL + pm_level='SINGLE' (fallback 해석 확인)
  ('a5100000-0000-4000-8000-000000000073','a5100000-0000-4000-8000-000000000032','T-B','SINGLE','승인','2023-02-01', true ),
  -- C 대기(확정 아님): Preview 현재확정에 미표시 확인
  ('a5100000-0000-4000-8000-000000000074','a5100000-0000-4000-8000-000000000033','T-C','M1'    ,'대기','2024-01-01', false),
  -- D 승인취소(대기)로 남은 row: is_active=true 이나 확정 아님 → 미표시 확인
  ('a5100000-0000-4000-8000-000000000075','a5100000-0000-4000-8000-000000000034','T-D','M2'    ,'대기','2024-01-01', false)
) as v(id, person, no, lvl, appr, acq, use_fallback)
on conflict (id) do update set approval_status=excluded.approval_status, is_active=true,
  acquired_date=excluded.acquired_date, level_id=excluded.level_id, pm_level=excluded.pm_level, deleted_at=null;

-- ── 7) 인증 이력(예시 1건 · 서비스 append 와 별개로 조회/불변성 확인용) ──────────
insert into public.exam_certification_history
 (id, tenant_id, personnel_id, process_id, certification_type, level_id, approved_at, approved_by, source_type, source_id, reason, status, metadata, created_by)
select 'a5100000-0000-4000-8000-000000000081', :'test_tenant', 'a5100000-0000-4000-8000-000000000034',
       'a5100000-0000-4000-8000-000000000003', 'M1',
       (select id from public.exam_levels where tenant_id=:'test_tenant' and upper(code)='M1' order by rank_order limit 1),
       now(), null, 'pm_certification', 'a5100000-0000-4000-8000-000000000072', '테스트 이력', 'approved',
       '{"__test__":true,"pm_level":"M1"}'::jsonb, null
on conflict (id) do update set status=excluded.status, metadata=excluded.metadata;

-- 완료. 검증: verify-schema.sql → preview-validation.sql → 브라우저 Preview.
