// 단계 기준 정합성 검사 서비스 — 설비별 인증단계(exam_equipment_stage_rules)로부터 각 공정×단계의
//  "예상 required_equipment_ids/선행단계"를 계산하고 현재 공정별 달성기준(exam_rules criteria)과 비교(조회 전용).
//  ⚠ DB 저장/수정/삭제 없음. 배치 로드 1회 후 Map/Set 비교(행별 DB 호출 없음). equipment_id/level_id FK 기준.
import { listExamRows, examSupabaseReady, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules } from "./processCriteriaRuleService";
import { normalizeCriteria } from "../engines/criteriaEvaluator";
import { selectPmStageLevels, canonicalPmStageName } from "../utils/certificationLevel";
import type { AuditEquip, AuditStatus, CriteriaAuditRow, CriteriaAuditResult } from "../types/criteriaAudit";
import type { Criteria, CriteriaGroup } from "../types/certificationCriteria";

const S = (v: unknown) => String(v ?? "");
const active = (r: ExamRow) => r.is_active !== false && !r.deleted_at;
const nmeOf = (r?: ExamRow) => r ? (S(r.name).trim() || S(r.code).trim() || "-") : "-";
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

// 자동 적용 대상 상태(그 외 상태는 적용 대상 아님).
const APPLY_STATUSES = new Set<AuditStatus>(["필수설비 누락", "불필요 설비 포함", "선행단계 오류", "미등록", "min_equipment_count 사용 위험", "criteria 중복"]);
const MEANINGFUL_LEAF_KEYS = ["min_equipment_count", "min_core_equipment_count", "min_completion_rate", "prerequisite_level_ids", "min_tenure_months", "min_elapsed_months", "cumulative_elapsed_months", "required_process_ids", "required_category_ids"];
// groups 가 "설비별 단일 required leaf(Single OR)" 단순 구조인지 — 아니면 복잡 legacy 로 보고 자동 적용 차단.
function isSimpleSingleOrGroups(c: Criteria): boolean {
  const g = c.groups ?? []; if (!g.length) return false;
  return g.every((grp) => (grp.groups?.length ?? 0) === 0 && (grp.conditions ?? []).length > 0
    && (grp.conditions ?? []).every((cond) => Array.isArray(cond.required_equipment_ids) && !MEANINGFUL_LEAF_KEYS.some((k) => (cond as Record<string, unknown>)[k] != null)));
}

// 대표 상태(가장 심각한 것 1개) 선정 순서.
const STATUS_ORDER: AuditStatus[] = [
  "단계 설비 미등록", "미등록", "criteria 중복", "필수설비 누락",
  "선행단계 오류", "min_equipment_count 사용 위험", "불필요 설비 포함", "정책확인필요",
];
const pickStatus = (flags: AuditStatus[]): AuditStatus => STATUS_ORDER.find((s) => flags.includes(s)) ?? "정상";

// 현재 criteria 다중행 → 엔진과 동일 선택(priority DESC, effective_from DESC)으로 대표 1행.
function chooseCurrent(rows: ExamRow[]): ExamRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const ca = normalizeCriteria(a.criteria), cb = normalizeCriteria(b.criteria);
    return (cb.priority ?? 0) - (ca.priority ?? 0) || S(cb.effective_from).localeCompare(S(ca.effective_from));
  })[0];
}

export async function runCriteriaAudit(tenantId: string): Promise<CriteriaAuditResult> {
  if (!examSupabaseReady()) return { rows: [], ok: false, message: "Supabase 연결이 필요합니다." };
  const [levels, groups, categories, processes, equipment, stageRules, criteriaRules] = await Promise.all([
    listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
    listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),
    listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[]),
  ]);

  const groupById = new Map(groups.map((r) => [S(r.id), r]));
  const catById = new Map(categories.map((r) => [S(r.id), r]));
  const levelById = new Map(levels.map((r) => [S(r.id), r]));
  const equipById = new Map(equipment.map((r) => [S(r.id), r]));
  const eq = (id: string): AuditEquip => ({ id, name: nmeOf(equipById.get(id)) });

  const pmLevels = selectPmStageLevels(levels); // Single~Multi 4, rank_order 오름차순
  if (pmLevels.length === 0) return { rows: [], ok: false, message: "PM 단계(Single~Multi 4) 인증 레벨이 없습니다." };
  const pmLevelIdSet = new Set(pmLevels.map((l) => S(l.id))); // Single 예상설비(공정 전체 PM 단계) 산정용

  // 현재 criteria: (process|level) → 유효(미삭제) 행들.
  const critByKey = new Map<string, ExamRow[]>();
  for (const r of criteriaRules) {
    if (r.deleted_at) continue;
    const k = `${S(r.process_id)}|${S(r.level_id)}`;
    (critByKey.get(k) ?? critByKey.set(k, []).get(k)!).push(r);
  }

  const rows: CriteriaAuditRow[] = [];
  for (const p of processes.filter(active)) {
    const pid = S(p.id);
    for (let i = 0; i < pmLevels.length; i++) {
      const lv = pmLevels[i];
      const lid = S(lv.id);
      const stageName = canonicalPmStageName(lv.name) ?? canonicalPmStageName(lv.code) ?? nmeOf(lv);
      const isSingle = i === 0; // rank 최저 = Single

      // 예상 설비: Single = 동일 공정의 Single~Multi 4 stage rule 설비 전체(확정 정책), Multi = 현재 레벨 설비. 공정 scope·활성 equipment·distinct.
      const scopeLevels = isSingle ? pmLevelIdSet : new Set([lid]);
      const seen = new Set<string>(); const expectedEquip: AuditEquip[] = []; let invalidStageCount = 0;
      for (const r of stageRules) {
        if (!active(r) || S(r.process_id) !== pid || !scopeLevels.has(S(r.level_id))) continue;
        const eid = S(r.equipment_id); if (!eid || seen.has(eid)) continue;
        const e = equipById.get(eid);
        if (!e || !active(e) || S(e.process_id) !== pid) { invalidStageCount++; continue; } // 부재/비활성/공정 불일치 제외
        seen.add(eid); expectedEquip.push({ id: eid, name: nmeOf(e) });
      }
      const stageEquip = expectedEquip;                      // 표시상 "단계설비" = 인정 대상 설비(Single=공정 전체 PM, Multi=현재 레벨)
      const expectedPrereqLevelIds = i === 0 ? [] : [S(pmLevels[i - 1].id)];
      const expectedPrereqNames = expectedPrereqLevelIds.map((id) => nmeOf(levelById.get(id)));

      // 현재 criteria. Single 은 OR groups 도 인정 → 현재 설비 = top required ∪ groups leaf required(중복 제거).
      const curRows = critByKey.get(`${pid}|${lid}`) ?? [];
      const chosen = chooseCurrent(curRows);
      const c = chosen ? normalizeCriteria(chosen.criteria) : null;
      const groupEquipIds: string[] = [];
      const collectGroup = (g: CriteriaGroup) => { for (const cond of g.conditions ?? []) for (const id of cond.required_equipment_ids ?? []) groupEquipIds.push(S(id)); for (const sub of g.groups ?? []) collectGroup(sub); };
      for (const g of c?.groups ?? []) collectGroup(g);
      const currentReqIds = [...new Set([...(c?.required_equipment_ids ?? []).map(S), ...groupEquipIds])];
      const currentRequired = currentReqIds.map(eq);
      const currentPrereqLevelIds = (c?.prerequisite_level_ids ?? []).map(S);
      const currentPrereqNames = currentPrereqLevelIds.map((id) => nmeOf(levelById.get(id)));
      const currentMinEquipmentCount = typeof c?.min_equipment_count === "number" ? c!.min_equipment_count! : null;
      // Single "전부(AND)" 명시 저장(groups 없이 required ≥2) — any-1 자동변환 금지 대상.
      const singleIsAndMulti = isSingle && !(c?.groups?.length) && (c?.required_equipment_ids?.length ?? 0) >= 2;

      // 비교: 인정 대상 설비 집합 대비 현재 설비 집합(Single=OR/AND 무관 설비셋 기준, Multi=기존과 동일).
      const curSet = new Set(currentReqIds); const expSet = new Set(expectedEquip.map((e) => e.id));
      const missing = expectedEquip.filter((e) => !curSet.has(e.id));
      const extra = currentReqIds.filter((id) => !expSet.has(id)).map(eq);
      const prereqMatch = sameSet(expectedPrereqLevelIds, currentPrereqLevelIds);
      const singleNeedsGroups = isSingle && expectedEquip.length >= 2;

      const flags: AuditStatus[] = []; const notes: string[] = [];
      if (stageEquip.length === 0) flags.push("단계 설비 미등록");
      if (!chosen) flags.push("미등록");
      if (curRows.length > 1) { flags.push("criteria 중복"); notes.push(`동일 공정·단계 criteria ${curRows.length}행(대표 1행만 판정에 사용).`); }
      if (chosen && missing.length) flags.push("필수설비 누락");
      if (chosen && extra.length) flags.push("불필요 설비 포함");
      if (chosen && !prereqMatch) flags.push("선행단계 오류");
      if (currentMinEquipmentCount != null) {
        flags.push("min_equipment_count 사용 위험");
        notes.push(`min_equipment_count=${currentMinEquipmentCount} 사용 중 · 인정 대상 설비수 ${stageEquip.length} — required_equipment_ids/OR groups 방식으로 대체 권장.`);
      }
      if (isSingle && singleNeedsGroups) notes.push("Single 다중설비: 아무 1개(OR groups) 인정. 폼/선택 적용에서 OR groups 로 관리.");
      if (invalidStageCount) notes.push(`장비 master 부재/비활성/공정 불일치로 제외된 단계 설비 ${invalidStageCount}건.`);

      const status = pickStatus(flags);
      // ── 선택 적용용 권장 criteria + 자동적용 가능 여부(차단 조건 우선) ──
      let recommendedCriteria: Criteria | null = null; let applicable = false; let blockReason: string | null = null;
      const changes: string[] = []; const targetRuleId = chosen ? String(chosen.id) : null;
      const complexGroups = !!c && (c.groups?.length ?? 0) > 0 && !isSimpleSingleOrGroups(c);
      if (stageEquip.length === 0) blockReason = "단계 설비 미등록 — 설비별 인증단계 먼저 등록";
      else if (invalidStageCount > 0) blockReason = "stage rule↔장비 공정 불일치/비활성 참조 — 수동 확인";
      else if (curRows.length > 1) blockReason = "criteria 중복 — 유지할 행 확정 필요(자동 삭제 금지)";
      else if (singleIsAndMulti) blockReason = "Single '전부(AND)' 명시 저장 — any-1 자동변환 금지(수동 확인)";
      else if (complexGroups) blockReason = "복잡한 legacy groups — 수동 확인";
      if (!blockReason && APPLY_STATUSES.has(status)) {
        // 기존 필드(label_ko/effective/priority/version/memo 등) 보존 · 관리 4필드만 재구성.
        const base: Criteria = c ? { ...c } : {};
        delete base.min_equipment_count; delete base.groups; delete base.required_equipment_ids; delete base.prerequisite_level_ids;
        const ids = expectedEquip.map((e) => e.id);
        if (isSingle) {
          // 확정 정책: 아무거나 1개. 1개면 단순 required(AND), 2개 이상이면 OR groups(설비별 단일 leaf). min_equipment_count=1 대체 금지.
          if (ids.length <= 1) { base.operator = "AND"; if (ids.length) base.required_equipment_ids = ids; }
          else { base.operator = "OR"; base.groups = ids.map((id) => ({ operator: "AND", conditions: [{ required_equipment_ids: [id] }] })); }
        } else {
          base.operator = "AND";
          if (ids.length) base.required_equipment_ids = ids;
          if (expectedPrereqLevelIds.length) base.prerequisite_level_ids = expectedPrereqLevelIds;
        }
        recommendedCriteria = base; applicable = true;
        if (missing.length) changes.push(`설비 추가: ${missing.map((m) => m.name).join(", ")}`);
        if (extra.length) changes.push(`설비 제거: ${extra.map((x) => x.name).join(", ")}`);
        if (!prereqMatch) changes.push(`선행단계: ${currentPrereqNames.join(", ") || "-"} → ${expectedPrereqNames.join(", ") || "-"}`);
        if (currentMinEquipmentCount != null) changes.push(`min_equipment_count 제거(${currentMinEquipmentCount})`);
        if (!chosen) changes.push("criteria 신규 등록");
        if (isSingle && ids.length >= 2) changes.push("Single 아무거나 1개(OR groups)로 구성");
        if (!changes.length) changes.push("구조 정규화");
      }

      rows.push({
        key: `${pid}|${lid}`,
        groupName: nmeOf(groupById.get(S(p.group_id))), categoryName: nmeOf(catById.get(S(p.category_id))),
        processId: pid, processName: nmeOf(p),
        levelId: lid, levelCode: S(lv.code), levelName: nmeOf(lv), rankOrder: Number(lv.rank_order ?? 0), stageName, isSingle,
        stageEquip, invalidStageCount, expectedEquip, expectedPrereqLevelIds, expectedPrereqNames,
        currentExists: !!chosen, currentRowCount: curRows.length, currentRequired,
        currentPrereqLevelIds, currentPrereqNames, currentMinEquipmentCount,
        missing, extra, singleNeedsGroups,
        status, flags, notes,
        applicable, blockReason, recommendedCriteria, targetRuleId, changes,
      });
    }
  }
  return { rows, ok: true };
}
