// 단계 기준 정합성 검사 서비스 — 설비별 인증단계(exam_equipment_stage_rules)로부터 각 공정×단계의
//  "예상 required_equipment_ids/선행단계"를 계산하고 현재 공정별 달성기준(exam_rules criteria)과 비교(조회 전용).
//  ⚠ DB 저장/수정/삭제 없음. 배치 로드 1회 후 Map/Set 비교(행별 DB 호출 없음). equipment_id/level_id FK 기준.
import { listExamRows, examSupabaseReady, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules } from "./processCriteriaRuleService";
import { normalizeCriteria } from "../engines/criteriaEvaluator";
import { selectPmStageLevels, canonicalPmStageName } from "../utils/certificationLevel";
import type { AuditEquip, AuditStatus, CriteriaAuditRow, CriteriaAuditResult } from "../types/criteriaAudit";

const S = (v: unknown) => String(v ?? "");
const active = (r: ExamRow) => r.is_active !== false && !r.deleted_at;
const nmeOf = (r?: ExamRow) => r ? (S(r.name).trim() || S(r.code).trim() || "-") : "-";
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

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

      // 단계 설비 집계(설비별 인증단계) — 공정 scope 검증(equipment.process_id === stage.process_id === p).
      const stageForKey = stageRules.filter((r) => active(r) && S(r.process_id) === pid && S(r.level_id) === lid);
      const seen = new Set<string>(); const stageEquip: AuditEquip[] = []; let invalidStageCount = 0;
      for (const r of stageForKey) {
        const eid = S(r.equipment_id); if (!eid || seen.has(eid)) continue;
        const e = equipById.get(eid);
        if (!e || !active(e) || S(e.process_id) !== pid) { invalidStageCount++; continue; } // 부재/비활성/공정 불일치 제외
        seen.add(eid); stageEquip.push({ id: eid, name: nmeOf(e) });
      }
      const expectedEquip = stageEquip;                      // Multi=전체 취득, Single=후보(any 1)
      const expectedPrereqLevelIds = i === 0 ? [] : [S(pmLevels[i - 1].id)];
      const expectedPrereqNames = expectedPrereqLevelIds.map((id) => nmeOf(levelById.get(id)));

      // 현재 criteria.
      const curRows = critByKey.get(`${pid}|${lid}`) ?? [];
      const chosen = chooseCurrent(curRows);
      const c = chosen ? normalizeCriteria(chosen.criteria) : null;
      const currentReqIds = (c?.required_equipment_ids ?? []).map(S);
      const currentRequired = currentReqIds.map(eq);
      const currentPrereqLevelIds = (c?.prerequisite_level_ids ?? []).map(S);
      const currentPrereqNames = currentPrereqLevelIds.map((id) => nmeOf(levelById.get(id)));
      const currentMinEquipmentCount = typeof c?.min_equipment_count === "number" ? c!.min_equipment_count! : null;

      // 비교(Single 설비 ≥2 는 OR 정책이라 누락/초과 판정 제외 · 그 외 전부취득 기준).
      const treatAsAll = !isSingle || stageEquip.length <= 1;
      const curSet = new Set(currentReqIds); const expSet = new Set(stageEquip.map((e) => e.id));
      const missing = treatAsAll ? stageEquip.filter((e) => !curSet.has(e.id)) : [];
      const extra = treatAsAll ? currentReqIds.filter((id) => !expSet.has(id)).map(eq) : [];
      const prereqMatch = sameSet(expectedPrereqLevelIds, currentPrereqLevelIds);
      const singleNeedsGroups = isSingle && stageEquip.length >= 2;

      const flags: AuditStatus[] = []; const notes: string[] = [];
      if (stageEquip.length === 0) flags.push("단계 설비 미등록");
      if (!chosen) flags.push("미등록");
      if (curRows.length > 1) { flags.push("criteria 중복"); notes.push(`동일 공정·단계 criteria ${curRows.length}행(대표 1행만 판정에 사용).`); }
      if (chosen && treatAsAll && missing.length) flags.push("필수설비 누락");
      if (chosen && treatAsAll && extra.length) flags.push("불필요 설비 포함");
      if (chosen && !prereqMatch) flags.push("선행단계 오류");
      if (currentMinEquipmentCount != null) {
        flags.push("min_equipment_count 사용 위험");
        notes.push(`min_equipment_count=${currentMinEquipmentCount} 사용 중 · 단계 설비수 ${stageEquip.length} — "전부 취득" 정책과 충돌 가능(정책확인필요).`);
      }
      if (singleNeedsGroups) {
        flags.push("정책확인필요");
        notes.push(`Single 설비 ${stageEquip.length}개 → "아무 1개(OR)"는 groups 구조 필요. 현재 폼은 OR groups 미지원 → 코드/폼 보완 필요(min_equipment_count 대체 금지).`);
      }
      if (invalidStageCount) notes.push(`장비 master 부재/비활성/공정 불일치로 제외된 단계 설비 ${invalidStageCount}건.`);

      rows.push({
        key: `${pid}|${lid}`,
        groupName: nmeOf(groupById.get(S(p.group_id))), categoryName: nmeOf(catById.get(S(p.category_id))),
        processId: pid, processName: nmeOf(p),
        levelId: lid, levelCode: S(lv.code), levelName: nmeOf(lv), rankOrder: Number(lv.rank_order ?? 0), stageName, isSingle,
        stageEquip, invalidStageCount, expectedEquip, expectedPrereqLevelIds, expectedPrereqNames,
        currentExists: !!chosen, currentRowCount: curRows.length, currentRequired,
        currentPrereqLevelIds, currentPrereqNames, currentMinEquipmentCount,
        missing, extra, singleNeedsGroups,
        status: pickStatus(flags), flags, notes,
      });
    }
  }
  return { rows, ok: true };
}
