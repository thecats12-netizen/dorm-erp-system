-- ============================================================================
-- 직원 라이선스 데이터 연결 진단 (읽기 전용)
--   한 직원(사번)에 대해 personnel / license_plan / applications / levels / rules 를 한 번에 확인.
--   ⚠ 아래 :emp_no 와 :tenant 를 대상 값으로 교체(예: 'S2411002', 'default').
-- ============================================================================

-- [A] 인력(exam_personnel) — 매칭 키
select 'A.personnel' as t, id, tenant_id, employee_no, name, process_id, part_id, product_group, group_name, part_name, employment_status
from public.exam_personnel
where tenant_id = 'default' and btrim(employee_no) = 'S2411002' and deleted_at is null;

-- [B] 라이선스 계획(employee_license_plan) — employee_id = personnel.id 여야 함
select 'B.plan' as t, p.id, p.employee_id, p.license_level, p.rule_id, p.status, p.target_date, p.completed_date, p.created_at
from public.employee_license_plan p
join public.exam_personnel e on e.id = p.employee_id
where p.tenant_id = 'default' and btrim(e.employee_no) = 'S2411002' and p.deleted_at is null
order by p.created_at;
--  → 0행이면 원인 A(계획 없음). 20260726 미적용/공정 스코프 규칙 없음/공정 미연결 중 하나.

-- [C] 응시 이력(exam_applications) — personnel_id 가 null 이고 employee_no 만 있을 수 있음(원인 D)
select 'C.application' as t, id, personnel_id, employee_no, category_code, category, level_id, status,
       written_pass_date, practical_pass_date, cert_acquired_date, cert_status, pm_level
from public.exam_applications
where tenant_id = 'default' and btrim(employee_no) = 'S2411002' and deleted_at is null
order by created_at;
--  → personnel_id 가 전부 null 이면: personnel_id 기준 조회가 실패(원인 D). employee_no 매칭 필요.
--  → cert_acquired_date/cert_status='취득'/status='인증 취득' 이면 취득 이력 존재(계획 없어도 현재단계 fallback 대상).

-- [D] 레벨 마스터(exam_levels) — category_code ↔ code 매칭 확인(원인 G)
select 'D.level' as t, id, code, name, rank_order, is_active
from public.exam_levels
where tenant_id = 'default' and deleted_at is null order by rank_order;

-- [E] 규칙(exam_rules) — 공정 스코프 존재 확인(원인 K: 다음 단계 계산 가능 여부)
select 'E.rule' as t, id, level_id, process_id, group_id, category_id, required_months, prerequisite_level_id, is_active
from public.exam_rules
where tenant_id = 'default' and deleted_at is null order by level_id;

-- [해석] C에 취득 이력이 있는데 B가 0행이면 → 화면이 '-' 로만 표시되는 근본 원인:
--   (1) 요약이 exam_applications 를 personnel_id 로만 조회(원인 D) + (2) 계획 없을 때 응시 fallback 미적용(원인 A/H).
