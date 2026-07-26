// criteria 표준 평가 엔진 — 순수 함수(행별 DB 호출 없음 · 배치 입력 Map/Set 기반).
//  UI 와 완전 분리. 모든 임계값은 데이터(criteria). 미지정 조건은 무시(0 과 미지정 구분).
import type {
  Criteria, CriteriaGroup, CriteriaLeaf, CriteriaResult,
  EvaluationSubject, EquipmentSummary, StageEligibility,
} from "../types/certificationCriteria";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const countIn = (set: Set<string>, ids: string[]) => ids.reduce((n, id) => n + (set.has(id) ? 1 : 0), 0);

// criteria 정규화 — 잘못된 타입/음수 방어, 안전 기본값. 원본은 변경하지 않음.
export function normalizeCriteria(raw: unknown): Criteria {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const numOrU = (v: unknown) => (isNum(v) && v >= 0 ? v : undefined);
  const arrOrU = (v: unknown) => (isArr(v) ? v.filter(Boolean) : undefined);
  const out: Criteria = {
    version: isNum(c.version) ? c.version : 1,
    priority: isNum(c.priority) ? c.priority : undefined,
    operator: c.operator === "OR" ? "OR" : c.operator === "AND" ? "AND" : undefined,
    min_equipment_count: numOrU(c.min_equipment_count),
    min_core_equipment_count: numOrU(c.min_core_equipment_count),
    min_completion_rate: numOrU(c.min_completion_rate),
    required_equipment_ids: arrOrU(c.required_equipment_ids),
    required_process_ids: arrOrU(c.required_process_ids),
    required_category_ids: arrOrU(c.required_category_ids),
    prerequisite_level_ids: arrOrU(c.prerequisite_level_ids),
    min_tenure_months: numOrU(c.min_tenure_months),
    min_elapsed_months: numOrU(c.min_elapsed_months),
    cumulative_elapsed_months: numOrU(c.cumulative_elapsed_months),
    source_process_id: typeof c.source_process_id === "string" ? c.source_process_id : undefined,
    source_required_level_id: typeof c.source_required_level_id === "string" ? c.source_required_level_id : undefined,
    target_process_ids: arrOrU(c.target_process_ids),
    target_required_equipment_count: numOrU(c.target_required_equipment_count),
    target_required_core_equipment_count: numOrU(c.target_required_core_equipment_count),
    allow_exception: c.allow_exception === true,
    effective_from: typeof c.effective_from === "string" ? c.effective_from : null,
    effective_to: typeof c.effective_to === "string" ? c.effective_to : null,
    valid_months: isNum(c.valid_months) ? c.valid_months : null,
    description: typeof c.description === "string" ? c.description : undefined,
    label_ko: typeof c.label_ko === "string" ? c.label_ko : undefined,
  };
  const groups = Array.isArray(c.groups) ? (c.groups as unknown[]).map(normalizeGroup).filter(Boolean) as CriteriaGroup[] : undefined;
  if (groups && groups.length) out.groups = groups;
  return out;
}

function normalizeGroup(raw: unknown): CriteriaGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const conditions = Array.isArray(g.conditions) ? (g.conditions as unknown[]).map((x) => normalizeCriteria(x) as CriteriaLeaf) : undefined;
  const groups = Array.isArray(g.groups) ? (g.groups as unknown[]).map(normalizeGroup).filter(Boolean) as CriteriaGroup[] : undefined;
  return { operator: g.operator === "OR" ? "OR" : "AND", conditions, groups };
}

// criteria 유효성 검사 — 저장 전 경고용(치명/경미). 계산을 막지는 않음.
export function validateCriteria(raw: unknown): { ok: boolean; errors: string[] } {
  const c = normalizeCriteria(raw);
  const errors: string[] = [];
  if (isNum(c.min_completion_rate) && (c.min_completion_rate! < 0 || c.min_completion_rate! > 100)) errors.push("취득률은 0~100 사이여야 합니다.");
  if (c.effective_from && c.effective_to && c.effective_from > c.effective_to) errors.push("적용 시작일이 종료일보다 늦습니다.");
  return { ok: errors.length === 0, errors };
}

// 유효기간 내 규칙인지(오늘 기준). 미지정이면 항상 유효.
export function isCriteriaEffective(c: Criteria, today = new Date()): boolean {
  const d = today.toISOString().slice(0, 10);
  if (c.effective_from && d < c.effective_from) return false;
  if (c.effective_to && d > c.effective_to) return false;
  return true;
}

// 개별(leaf) 조건 평가. 지정된 필드만 검사(미지정 무시). 충족/부족 한글 사유 반환.
export function evaluateLeaf(leaf: CriteriaLeaf, subj: EvaluationSubject, summary: EquipmentSummary): CriteriaResult {
  const met: string[] = []; const missing: string[] = [];
  const check = (cond: boolean, ok: string, no: string) => (cond ? met : missing).push(cond ? ok : no);

  if (isNum(leaf.min_equipment_count)) check(summary.acquiredCount >= leaf.min_equipment_count!, `설비 ${leaf.min_equipment_count}개 이상 취득`, `설비 ${leaf.min_equipment_count}개 이상 필요(현재 ${summary.acquiredCount}개)`);
  if (isNum(leaf.min_core_equipment_count)) check(summary.coreCount >= leaf.min_core_equipment_count!, `주력설비 ${leaf.min_core_equipment_count}개 이상`, `주력설비 ${leaf.min_core_equipment_count}개 이상 필요(현재 ${summary.coreCount}개)`);
  if (isNum(leaf.min_completion_rate)) check(summary.completionRate >= leaf.min_completion_rate!, `취득률 ${leaf.min_completion_rate}% 이상`, `취득률 ${leaf.min_completion_rate}% 이상 필요(현재 ${summary.completionRate}%)`);
  if (isArr(leaf.required_equipment_ids) && leaf.required_equipment_ids.length) {
    const have = countIn(subj.acquiredEquipmentIds, leaf.required_equipment_ids);
    check(have === leaf.required_equipment_ids.length, "필수 설비 전체 취득", `필수 설비 미취득(${leaf.required_equipment_ids.length - have}개 부족)`);
  }
  if (isArr(leaf.prerequisite_level_ids) && leaf.prerequisite_level_ids.length) {
    const have = leaf.prerequisite_level_ids.every((id) => subj.achievedLevelIds.has(id));
    check(have, "선행 단계 충족", "선행 단계 미충족");
  }
  if (isNum(leaf.min_tenure_months)) check((subj.tenureMonths ?? 0) >= leaf.min_tenure_months!, `근속 ${leaf.min_tenure_months}개월 이상`, `근속 ${leaf.min_tenure_months}개월 이상 필요`);
  if (isNum(leaf.min_elapsed_months)) check((subj.elapsedMonths ?? 0) >= leaf.min_elapsed_months!, `직전 단계 후 ${leaf.min_elapsed_months}개월 경과`, `직전 단계 후 ${leaf.min_elapsed_months}개월 경과 필요`);
  if (isNum(leaf.cumulative_elapsed_months)) check((subj.cumulativeElapsedMonths ?? 0) >= leaf.cumulative_elapsed_months!, `누적 ${leaf.cumulative_elapsed_months}개월 경과`, `누적 ${leaf.cumulative_elapsed_months}개월 경과 필요`);

  return { passed: missing.length === 0, met, missing };
}

// 그룹(AND/OR) 평가 — 중첩 지원.
export function evaluateCriteriaGroup(group: CriteriaGroup, subj: EvaluationSubject, summary: EquipmentSummary): CriteriaResult {
  const op: "AND" | "OR" = group.operator === "OR" ? "OR" : "AND";
  const results: CriteriaResult[] = [];
  for (const leaf of group.conditions ?? []) results.push(evaluateLeaf(leaf, subj, summary));
  for (const g of group.groups ?? []) results.push(evaluateCriteriaGroup(g, subj, summary));
  if (results.length === 0) return { passed: true, met: [], missing: [] };
  const met = results.flatMap((r) => r.met); const missing = results.flatMap((r) => r.missing);
  const passed = op === "AND" ? results.every((r) => r.passed) : results.some((r) => r.passed);
  return { passed, met, missing };
}

// 최상위 criteria 평가(유효기간 제외 시 통과 처리 없음 — 호출부에서 isCriteriaEffective 선검사 권장).
export function evaluateCriteria(raw: unknown, subj: EvaluationSubject, summary: EquipmentSummary): CriteriaResult {
  const c = normalizeCriteria(raw);
  const topLeaf = evaluateLeaf(c, subj, summary);
  const groupRes = (c.groups ?? []).map((g) => evaluateCriteriaGroup(g, subj, summary));
  const all = [topLeaf, ...groupRes];
  const op: "AND" | "OR" = c.operator === "OR" ? "OR" : "AND";
  const nonEmpty = all.filter((r) => r.met.length + r.missing.length > 0);
  const passed = nonEmpty.length === 0 ? true : (op === "AND" ? nonEmpty.every((r) => r.passed) : nonEmpty.some((r) => r.passed));
  return { passed, met: all.flatMap((r) => r.met), missing: all.flatMap((r) => r.missing) };
}

// 조건 → 사용자 표시 한글 문구. label_ko 우선, 없으면 조건 요약 생성(UUID/개발값 비노출).
export function describeCriteria(raw: unknown): string {
  const c = normalizeCriteria(raw);
  if (c.label_ko && c.label_ko.trim()) return c.label_ko.trim();
  const parts: string[] = [];
  if (isNum(c.min_core_equipment_count)) parts.push(`주력설비 ${c.min_core_equipment_count}개 이상`);
  if (isNum(c.min_equipment_count)) parts.push(`설비 ${c.min_equipment_count}개 이상`);
  if (isNum(c.min_completion_rate)) parts.push(`취득률 ${c.min_completion_rate}% 이상`);
  if (isArr(c.required_equipment_ids) && c.required_equipment_ids.length) parts.push(`필수 설비 ${c.required_equipment_ids.length}종`);
  if (isArr(c.prerequisite_level_ids) && c.prerequisite_level_ids.length) parts.push("선행 단계 충족");
  if (isNum(c.min_tenure_months)) parts.push(`근속 ${c.min_tenure_months}개월+`);
  if (isNum(c.min_elapsed_months)) parts.push(`경과 ${c.min_elapsed_months}개월+`);
  const groupText = (c.groups ?? []).map((g) => {
    const inner = (g.conditions ?? []).map((l) => describeCriteria(l)).filter(Boolean);
    return inner.length ? `(${inner.join(g.operator === "OR" ? " 또는 " : " 그리고 ")})` : "";
  }).filter(Boolean);
  const top = [...parts, ...groupText];
  if (!top.length) return "조건 없음";
  return top.join(c.operator === "OR" ? " 또는 " : " · ");
}

// 공정 대상 설비/취득/주력/취득률 요약.
export function calculateEquipmentSummary(subj: EvaluationSubject): EquipmentSummary {
  const targetCount = subj.targetEquipmentIds.size;
  const acquiredCount = countIn(subj.acquiredEquipmentIds, Array.from(subj.targetEquipmentIds));
  const coreCount = subj.coreEquipmentIds.size;
  const completionRate = targetCount > 0 ? Math.round((acquiredCount / targetCount) * 1000) / 10 : 0;
  return { targetCount, acquiredCount, coreCount, completionRate };
}

// 공정별 Single~M4 단계 적격 산출 — rank_order 순, 선행 단계 반영. 최고 충족 단계까지.
//  levels: 해당 tier(PM) 레벨 목록(각: id/code/rank_order/requires_approval/auto_promote).
//  rulesByLevel: level_id → criteria(해당 공정 스코프에서 매칭된 규칙, 유효기간 내).
export function calculateProcessStageEligibility(
  subj: EvaluationSubject,
  summary: EquipmentSummary,
  levels: Array<{ id: string; code: string; rank_order: number; requires_approval: boolean; auto_promote: boolean }>,
  rulesByLevel: Map<string, unknown>,   // level_id → criteria(jsonb)
): { stages: StageEligibility[]; highestPassedRank: number } {
  const ordered = [...levels].sort((a, b) => a.rank_order - b.rank_order);
  const stages: StageEligibility[] = [];
  let highestPassedRank = 0;
  let prevPassed = true; // 하위 단계부터 순차 — 선행 미충족이면 상위도 미충족 처리
  for (const lv of ordered) {
    const crit = rulesByLevel.get(lv.id);
    const result: CriteriaResult = crit === undefined ? { passed: false, met: [], missing: ["기준 규칙 미정의"] } : evaluateCriteria(crit, subj, summary);
    const passed: boolean = prevPassed && result.passed;
    if (passed) highestPassedRank = lv.rank_order;
    stages.push({ levelId: lv.id, code: lv.code, rankOrder: lv.rank_order, passed, requiresApproval: lv.requires_approval, autoPromote: lv.auto_promote, result });
    prevPassed = passed; // 상위 단계는 하위가 통과해야만 평가 통과
  }
  return { stages, highestPassedRank };
}
