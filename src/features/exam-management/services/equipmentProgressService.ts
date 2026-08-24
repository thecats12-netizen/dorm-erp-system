// 설비 단계별 진행률 공용 계산 서비스 — 순수 함수(DB 호출 0). 설비 인증현황·인력현황·응시 후보에서 재사용.
//  · 목적: "설비 보유 현황"(취득/대상 · n/m)만 계산. 단계 PASS/FAIL(any-1 등 eligibility) 은 여기서 판정하지 않는다(개념 분리).
//  · 대상 설비(분모): exam_equipment_stage_rules(process_id 일치 · active · distinct equipment_id).
//    Single = 동일 공정 Single~Multi4 전체 stage rule 합집합(any-1 인정범위) · Multi_k = 해당 level_id stage rule 만.
//  · 취득 설비(분자): 호출부가 넘긴 approvedEquipmentIds(Set) 와의 교집합. 내부에서 Supabase 조회 없음.
//  · 단계 순서: selectPmStageLevels(levels) — rank_order canonical(코드/이름 하드코딩 없음).
import type { ExamRow } from "./examMasterService";
import { selectPmStageLevels } from "../utils/certificationLevel";

const S = (v: unknown): string => String(v ?? "").trim();

export type StageEquipmentProgress = {
  levelId: string;
  stageIndex: number;                 // selectPmStageLevels 순서(0=Single … 4=Multi4)
  targetEquipmentIds: string[];       // 대상 설비(분모) — distinct
  acquiredEquipmentIds: string[];     // 대상 ∩ approved(분자)
  missingEquipmentIds: string[];      // 대상 − approved
  targetCount: number;
  acquiredCount: number;
  missingCount: number;
  progressPercent: number | null;     // 대상 0 → null(0/0 을 100% 로 만들지 않음)
};

export type PersonnelEquipmentProgress = {
  personnelId: string;
  processId: string;
  stages: StageEquipmentProgress[];
};

// 공정별 단계 대상설비 Set(approved 무관 · 재사용 캐시용). Single=Single~M4 합집합, Multi=해당 레벨.
export function buildStageTargetSets(
  processId: string,
  levels: ExamRow[],
  stageRules: ExamRow[],
): { stageLevelIds: string[]; targetByStageIndex: Set<string>[] } {
  const pid = S(processId);
  const stageLevelIds = selectPmStageLevels(levels).map((r) => S(r.id));
  // process+level → distinct equipment_id (active stage rule 만)
  const byLevel = new Map<string, Set<string>>();
  for (const s of stageRules) {
    if (s.deleted_at || (s as { is_active?: unknown }).is_active === false) continue; // 비활성/삭제 제외
    if (S(s.process_id) !== pid) continue;                                            // 공정 FK 정확 일치(다른 공정 제외)
    const lvl = S(s.level_id), eq = S(s.equipment_id);
    if (!lvl || !eq) continue;
    (byLevel.get(lvl) ?? byLevel.set(lvl, new Set<string>()).get(lvl)!).add(eq);
  }
  const targetByStageIndex = stageLevelIds.map((_, i) => {
    const scope = i === 0 ? stageLevelIds : [stageLevelIds[i]]; // Single(0)=전체 범위, Multi=해당 레벨만
    const set = new Set<string>();
    for (const lid of scope) for (const eq of byLevel.get(lid) ?? []) set.add(eq); // distinct 합집합
    return set;
  });
  return { stageLevelIds, targetByStageIndex };
}

function stageProgress(levelId: string, stageIndex: number, target: Set<string>, approved: Set<string>): StageEquipmentProgress {
  const targetEquipmentIds = [...target];
  const acquiredEquipmentIds = targetEquipmentIds.filter((id) => approved.has(id));   // 대상 ∩ approved
  const missingEquipmentIds = targetEquipmentIds.filter((id) => !approved.has(id));
  const targetCount = targetEquipmentIds.length;
  const acquiredCount = acquiredEquipmentIds.length;
  return {
    levelId, stageIndex, targetEquipmentIds, acquiredEquipmentIds, missingEquipmentIds,
    targetCount, acquiredCount, missingCount: missingEquipmentIds.length,
    progressPercent: targetCount > 0 ? (acquiredCount / targetCount) * 100 : null,     // 0/0 → null
  };
}

// 직원 1명의 공정 단계별 설비 진행률(순수 · DB 호출 0).
export function computePersonnelEquipmentProgress(input: {
  personnelId: string;
  processId: string;
  levels: ExamRow[];
  stageRules: ExamRow[];
  approvedEquipmentIds: Set<string> | null | undefined;   // loadApprovedEquipmentByPerson().get(personnelId)
}): PersonnelEquipmentProgress {
  const approved = input.approvedEquipmentIds ?? new Set<string>();
  const { stageLevelIds, targetByStageIndex } = buildStageTargetSets(input.processId, input.levels, input.stageRules);
  const stages = stageLevelIds.map((levelId, i) => stageProgress(levelId, i, targetByStageIndex[i], approved));
  return { personnelId: S(input.personnelId), processId: S(input.processId), stages };
}

// 여러 직원 배치(공정별 target set 캐시 재사용 → N 반복에도 재필터 최소 · DB 호출 0).
export function computeEquipmentProgressByPersonnel(input: {
  personnel: ReadonlyArray<{ id?: unknown; process_id?: unknown }>;
  levels: ExamRow[];
  stageRules: ExamRow[];
  approvedByPerson: Map<string, Set<string>>;              // loadApprovedEquipmentByPerson() 결과
}): Map<string, PersonnelEquipmentProgress> {
  const { personnel, levels, stageRules, approvedByPerson } = input;
  const cache = new Map<string, { stageLevelIds: string[]; targetByStageIndex: Set<string>[] }>();
  const out = new Map<string, PersonnelEquipmentProgress>();
  for (const p of personnel) {
    const personnelId = S(p.id), processId = S(p.process_id);
    if (!personnelId) continue;
    let t = cache.get(processId);
    if (!t) { t = buildStageTargetSets(processId, levels, stageRules); cache.set(processId, t); }
    const approved = approvedByPerson.get(personnelId) ?? new Set<string>();
    const stages = t.stageLevelIds.map((levelId, i) => stageProgress(levelId, i, t!.targetByStageIndex[i], approved));
    out.set(personnelId, { personnelId, processId, stages });
  }
  return out;
}
