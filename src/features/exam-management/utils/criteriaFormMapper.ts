// 공정별 달성기준 폼 ↔ criteria(jsonb) 변환. 미입력(빈칸)과 0 을 구분하고, 폼이 다루지 않는
//  기존 확장 필드(groups/version/priority/description/source_*·target_* 등)를 손실 없이 보존한다.
import { normalizeCriteria } from "../engines/criteriaEvaluator";
import type { Criteria, CriteriaOperator } from "../types/certificationCriteria";

// 폼이 직접 편집하는 상태(any 금지). 숫자는 number | "" 로 미입력("")과 0 을 구분.
export interface ProcessCriteriaFormState {
  operator: CriteriaOperator;
  minEquipmentCount: number | "";
  minCoreEquipmentCount: number | "";
  minCompletionRate: number | "";
  requiredEquipmentIds: string[];
  prerequisiteLevelIds: string[];
  minTenureMonths: number | "";
  minElapsedMonths: number | "";
  cumulativeElapsedMonths: number | "";
  allowException: boolean;
  effectiveFrom: string;   // "" = 미지정
  effectiveTo: string;     // "" = 미지정
  labelKo: string;         // 사용자 표시 문구
}

// 폼이 관리하는 criteria 키(병합 시 이 슬롯만 폼 값으로 대체 · 나머지는 원본 보존).
const MANAGED_KEYS: (keyof Criteria)[] = [
  "operator", "min_equipment_count", "min_core_equipment_count", "min_completion_rate",
  "required_equipment_ids", "prerequisite_level_ids", "min_tenure_months", "min_elapsed_months",
  "cumulative_elapsed_months", "allow_exception", "effective_from", "effective_to", "label_ko",
];

const numOrBlank = (v: unknown): number | "" => (typeof v === "number" && Number.isFinite(v) ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function criteriaToFormState(raw: unknown): ProcessCriteriaFormState {
  const c = normalizeCriteria(raw);
  return {
    operator: c.operator === "OR" ? "OR" : "AND",
    minEquipmentCount: numOrBlank(c.min_equipment_count),
    minCoreEquipmentCount: numOrBlank(c.min_core_equipment_count),
    minCompletionRate: numOrBlank(c.min_completion_rate),
    requiredEquipmentIds: arr(c.required_equipment_ids),
    prerequisiteLevelIds: arr(c.prerequisite_level_ids),
    minTenureMonths: numOrBlank(c.min_tenure_months),
    minElapsedMonths: numOrBlank(c.min_elapsed_months),
    cumulativeElapsedMonths: numOrBlank(c.cumulative_elapsed_months),
    allowException: c.allow_exception === true,
    effectiveFrom: str(c.effective_from).slice(0, 10),
    effectiveTo: str(c.effective_to).slice(0, 10),
    labelKo: str(c.label_ko),
  };
}

// 원본 criteria 위에 폼 관리 슬롯만 교체 병합. 원본의 미관리 필드(groups/version/priority/
//  description/source_*·target_* 및 알 수 없는 확장 필드)는 그대로 유지한다.
export function mergeCriteriaPreservingUnknownFields(original: unknown, managed: Partial<Criteria>): Criteria {
  const base = normalizeCriteria(original);          // 원본 정규화(unknown 필드 포함 보존)
  const out: Criteria = { ...base };
  for (const k of MANAGED_KEYS) delete out[k];       // 폼 관리 슬롯 비우기
  return { ...out, ...managed };                     // 값이 있는 관리 필드만 재적용
}

// 폼 상태 → criteria. 미입력("")은 필드 자체를 제거(0 은 보존), 빈 배열은 제거.
export function formStateToCriteria(form: ProcessCriteriaFormState, original: unknown): Criteria {
  const managed: Partial<Criteria> = { operator: form.operator, allow_exception: form.allowException };
  const putNum = (k: keyof Criteria, v: number | "") => { if (v !== "") (managed as Record<string, unknown>)[k] = v; };
  putNum("min_equipment_count", form.minEquipmentCount);
  putNum("min_core_equipment_count", form.minCoreEquipmentCount);
  putNum("min_completion_rate", form.minCompletionRate);
  putNum("min_tenure_months", form.minTenureMonths);
  putNum("min_elapsed_months", form.minElapsedMonths);
  putNum("cumulative_elapsed_months", form.cumulativeElapsedMonths);
  if (form.requiredEquipmentIds.length) managed.required_equipment_ids = [...new Set(form.requiredEquipmentIds)];
  if (form.prerequisiteLevelIds.length) managed.prerequisite_level_ids = [...new Set(form.prerequisiteLevelIds)];
  if (form.effectiveFrom) managed.effective_from = form.effectiveFrom;
  if (form.effectiveTo) managed.effective_to = form.effectiveTo;
  if (form.labelKo.trim()) managed.label_ko = form.labelKo.trim();
  return mergeCriteriaPreservingUnknownFields(original, managed);
}

// 폼 상태에 실질 조건이 하나라도 있는지(저장 전 "조건 없음" 확인용).
export function hasAnyCondition(form: ProcessCriteriaFormState, originalHasGroups: boolean): boolean {
  return originalHasGroups
    || form.minEquipmentCount !== "" || form.minCoreEquipmentCount !== "" || form.minCompletionRate !== ""
    || form.minTenureMonths !== "" || form.minElapsedMonths !== "" || form.cumulativeElapsedMonths !== ""
    || form.requiredEquipmentIds.length > 0 || form.prerequisiteLevelIds.length > 0;
}
