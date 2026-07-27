// PM 자동 "후보" 생성(승인 아님). 클라이언트는 Single~M4 엔진으로 후보 스냅샷만 계산하고,
//  실제 권한검증·게이트 재검증·INSERT·감사·중복 방지는 서버 RPC(exam_generate_pm_candidates)가 수행한다.
//  → 프론트 직접 pm_certifications INSERT 없음. DB partial unique 로 동시성 최종 방어(23505→"이미 존재").
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { listExamRows, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules } from "./processCriteriaRuleService";
import { calculateEquipmentSummary, calculateProcessStageEligibility, isCriteriaEffective, normalizeCriteria } from "../engines/criteriaEvaluator";
import type { EvaluationSubject } from "../types/certificationCriteria";

const ENGINE_VERSION = "pm-stage-eligibility/v1";
const LEVEL_CODES = new Set(["SINGLE", "M1", "M2", "M3", "M4"]);
const todayYmd = () => new Date().toISOString().slice(0, 10);

export type PmCandidateResult = { created: number; existing: number; ineligible: number; reevalExcluded: number; confirmedHeld: number; errors: number; message: string };
type Snapshot = { personnel_id: string; process_id: string; level_id: string; engine_version: string; criteria_version: number | null };

// 확정 단계 취득일(YYYY-MM-DD) → 오늘까지 완전 개월(tz 변환 없이 Y/M/D 정수). 미래/무효면 null.
function fullMonthsSince(ymd?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? "")); if (!m) return null;
  const a = [Number(m[1]), Number(m[2]), Number(m[3])] as const; const n = new Date();
  const b = [n.getFullYear(), n.getMonth() + 1, n.getDate()] as const;
  if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) return null;
  let months = (b[0] - a[0]) * 12 + (b[1] - a[1]); if (b[2] < a[2]) months -= 1;
  return Math.max(0, months);
}

// PM 후보 배치 생성. userId 는 호출 호환용(서버는 auth.uid() 로 actor 결정). 결과 카운트 반환.
export async function generatePmCandidates(tenantId: string, userId: string): Promise<PmCandidateResult> {
  void userId; // 서버 RPC 가 auth.uid() 로 actor·권한을 결정(클라이언트 값 신뢰 안 함).
  const empty: PmCandidateResult = { created: 0, existing: 0, ineligible: 0, reevalExcluded: 0, confirmedHeld: 0, errors: 0, message: "" };
  if (!isSupabaseAvailable() || !supabase) return { ...empty, message: "Supabase 미설정 — DB 설정이 필요합니다." };

  // ── 배치 로드(테넌트 단위 · 행별 호출 없음) ──────────────────────────────
  const [personnel, levels, equipment, stageRules, criteriaRules] = await Promise.all([
    listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
    listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),
    listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[]),
  ]);
  const [certRes, pmRes] = await Promise.all([
    supabase.from("exam_equipment_certifications").select("personnel_id,equipment_id,status,metadata").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("pm_certifications").select("personnel_id,process_id,level_id,pm_level,acquired_date,expiry_date,approval_status,is_active").eq("tenant_id", tenantId).is("deleted_at", null),
  ]);
  if (certRes.error) return { ...empty, message: "설비 취득 데이터를 불러오려면 시험관리 DB 설정이 필요합니다." };

  const pmLevels = levels
    .filter((r) => r.is_active !== false && LEVEL_CODES.has(String(r.code ?? "").toUpperCase()))
    .map((r) => ({ id: String(r.id), code: String(r.code ?? "").toUpperCase(), rank_order: Number(r.rank_order ?? 0), requires_approval: r.requires_approval !== false, auto_promote: r.auto_promote === true }))
    .sort((a, b) => a.rank_order - b.rank_order);
  if (pmLevels.length === 0) return { ...empty, message: "PM 단계(Single~M4) 기준정보가 없습니다. 인증 레벨 seed 적용이 필요합니다." };
  const topLevel = pmLevels[pmLevels.length - 1];
  const maxPmRank = topLevel.rank_order;

  const levelById = new Map(levels.map((r) => [String(r.id), r]));
  const levelByCode = new Map<string, ExamRow>();
  for (const r of levels) { const c = String(r.code ?? "").trim().toUpperCase(); if (c) levelByCode.set(c, r); const n = String(r.name ?? "").trim().toUpperCase(); if (n) levelByCode.set(n, r); }

  const approvedByPerson = new Map<string, Set<string>>();
  const reevalPersons = new Set<string>();
  for (const c of (certRes.data as ExamRow[]) || []) {
    const pid = String(c.personnel_id ?? ""); if (!pid) continue;
    if ((c.metadata as { needs_reeval?: unknown } | null)?.needs_reeval === true) reevalPersons.add(pid);
    if (c.status !== "approved") continue;
    const eq = String(c.equipment_id ?? ""); if (!eq) continue;
    (approvedByPerson.get(pid) ?? approvedByPerson.set(pid, new Set()).get(pid)!).add(eq);
  }

  const today = todayYmd();
  const resolvePmLevelId = (r: ExamRow) => (r.level_id && levelById.has(String(r.level_id))) ? String(r.level_id) : (r.pm_level ? String(levelByCode.get(String(r.pm_level).trim().toUpperCase())?.id ?? "") : "");
  const confirmedByKey = new Map<string, number>();
  const pendingKeys = new Set<string>();
  const confirmedLevelIdsByPerson = new Map<string, Set<string>>();
  for (const r of (pmRes.data as ExamRow[]) || []) {
    const person = String(r.personnel_id ?? ""); const proc = String(r.process_id ?? "");
    const lid = resolvePmLevelId(r); if (!person) continue;
    const status = String(r.approval_status ?? "");
    if (status === "대기" && r.is_active !== false && lid) { pendingKeys.add(`${person}|${proc}|${lid}`); continue; }
    if (status !== "승인" || r.is_active === false) continue;
    const exp = r.expiry_date ? String(r.expiry_date).slice(0, 10) : "";
    if (exp && exp < today) continue;
    if (!lid) continue;
    const rank = Number(levelById.get(lid)?.rank_order ?? 0);
    const key = `${person}|${proc}`;
    if (rank > (confirmedByKey.get(key) ?? 0)) confirmedByKey.set(key, rank);
    (confirmedLevelIdsByPerson.get(key) ?? confirmedLevelIdsByPerson.set(key, new Set()).get(key)!).add(lid);
  }

  // ── 후보 스냅샷 계산(클라이언트) + 클라이언트측 분류 카운트 ────────────────
  let cReeval = 0, cHeld = 0, cExisting = 0, cIneligible = 0;
  const snapshot: Snapshot[] = [];
  for (const p of personnel) {
    if (p.is_active === false || p.deleted_at) continue;
    const personId = String(p.id ?? ""); const pid = String(p.process_id ?? "");
    if (!personId || !pid) { cIneligible++; continue; }
    if (reevalPersons.has(personId)) { cReeval++; continue; }

    const acquired = approvedByPerson.get(personId) ?? new Set<string>();
    const targetEquipmentIds = new Set(equipment.filter((e) => String(e.process_id ?? "") === pid && e.is_active !== false).map((e) => String(e.id)));
    const coreSet = new Set(stageRules.filter((r) => String(r.process_id ?? "") === pid && r.is_core_equipment === true && !r.deleted_at && r.is_active !== false && isCriteriaEffective(normalizeCriteria({ effective_from: r.effective_from, effective_to: r.effective_to }))).map((r) => String(r.equipment_id ?? "")));
    const coreEquipmentIds = new Set([...acquired].filter((id) => coreSet.has(id)));
    const achievedLevelIds = confirmedLevelIdsByPerson.get(`${personId}|${pid}`) ?? new Set<string>();

    const confRows = ((pmRes.data as ExamRow[]) || []).filter((r) => String(r.personnel_id ?? "") === personId && String(r.process_id ?? "") === pid && String(r.approval_status ?? "") === "승인" && r.is_active !== false && r.acquired_date);
    const confSorted = confRows.map((r) => ({ rank: Number(levelById.get(resolvePmLevelId(r))?.rank_order ?? 0), d: String(r.acquired_date).slice(0, 10) })).sort((a, b) => a.rank - b.rank);
    const subj: EvaluationSubject = {
      tenantId, personnelId: personId, processId: pid,
      acquiredEquipmentIds: acquired, coreEquipmentIds, targetEquipmentIds, achievedLevelIds,
      tenureMonths: fullMonthsSince(p.hire_date as string),
      elapsedMonths: fullMonthsSince(confSorted[confSorted.length - 1]?.d ?? null),
      cumulativeElapsedMonths: fullMonthsSince(confSorted[0]?.d ?? null),
    };
    const summary = calculateEquipmentSummary(subj);

    const byLevel = new Map<string, ExamRow[]>();
    for (const r of criteriaRules) {
      if (String(r.process_id ?? "") !== pid || r.deleted_at || r.is_active === false) continue;
      if (!isCriteriaEffective(normalizeCriteria(r.criteria))) continue;
      const lid = String(r.level_id ?? ""); if (!lid) continue;
      (byLevel.get(lid) ?? byLevel.set(lid, []).get(lid)!).push(r);
    }
    const rulesByLevel = new Map<string, unknown>();
    for (const [lid, list] of byLevel) {
      list.sort((a, b) => (normalizeCriteria(b.criteria).priority ?? 0) - (normalizeCriteria(a.criteria).priority ?? 0) || String(normalizeCriteria(b.criteria).effective_from ?? "").localeCompare(String(normalizeCriteria(a.criteria).effective_from ?? "")));
      rulesByLevel.set(lid, list[0].criteria);
    }

    const { highestPassedRank } = calculateProcessStageEligibility(subj, summary, pmLevels, rulesByLevel);
    if (highestPassedRank !== maxPmRank) { cIneligible++; continue; }                 // 최고 단계 미충족
    if ((confirmedByKey.get(`${personId}|${pid}`) ?? 0) >= maxPmRank) { cHeld++; continue; } // 확정 보유
    if (pendingKeys.has(`${personId}|${pid}|${topLevel.id}`)) { cExisting++; continue; }      // 기존 대기

    snapshot.push({ personnel_id: personId, process_id: pid, level_id: topLevel.id, engine_version: ENGINE_VERSION, criteria_version: normalizeCriteria(rulesByLevel.get(topLevel.id)).version ?? null });
  }

  // ── 서버 RPC 호출(권한검증·게이트 재검증·원자적 INSERT·감사) ───────────────
  const base: PmCandidateResult = { created: 0, existing: cExisting, ineligible: cIneligible, reevalExcluded: cReeval, confirmedHeld: cHeld, errors: 0, message: "" };
  if (snapshot.length === 0) return { ...base, message: buildMsg(base) };

  const { data, error } = await supabase.rpc("exam_generate_pm_candidates", { p_tenant_id: tenantId, p_candidates: snapshot });
  if (error) {
    const m = String((error as { message?: string }).message || "");
    if (/AUTH_REQUIRED/i.test(m)) return { ...base, message: "로그인이 필요합니다. 다시 로그인 후 시도해 주세요." };
    if (/FORBIDDEN/i.test(m)) return { ...base, message: "PM 후보를 생성할 권한이 없습니다(관리자 전용)." };
    return { ...base, errors: snapshot.length, message: "후보 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const rpc = (data ?? {}) as { created?: number; existing?: number; ineligible?: number; reeval_excluded?: number; confirmed_held?: number; errors?: number };
  const merged: PmCandidateResult = {
    created: rpc.created ?? 0,
    existing: cExisting + (rpc.existing ?? 0),
    ineligible: cIneligible + (rpc.ineligible ?? 0),
    reevalExcluded: cReeval + (rpc.reeval_excluded ?? 0),
    confirmedHeld: cHeld + (rpc.confirmed_held ?? 0),
    errors: rpc.errors ?? 0,
    message: "",
  };
  return { ...merged, message: buildMsg(merged) };
}

function buildMsg(r: PmCandidateResult): string {
  return `생성 ${r.created} · 이미 존재 ${r.existing} · 조건 미충족 ${r.ineligible} · 재평가 제외 ${r.reevalExcluded} · 확정 보유 ${r.confirmedHeld} · 오류 ${r.errors}`;
}
