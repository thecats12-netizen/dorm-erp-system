// PM 자동 "후보" 생성(승인 아님) — Single~M4 엔진 결과로 PM 조건 충족 직원을 pm_certifications
//  approval_status='대기'(후보)로 생성. 승인/취득/강등 없음. 배치 조회 + 단일 batch insert(N+1 없음).
//  후보 = 최고 PM 단계(M4) 충족 + criteria 전부 충족 + 재평가 아님 + 승인 설비만 인정 + PM 미보유 + 기존 대기 없음.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { listExamRows, writeExamAudit, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules } from "./processCriteriaRuleService";
import { calculateEquipmentSummary, calculateProcessStageEligibility, isCriteriaEffective, normalizeCriteria } from "../engines/criteriaEvaluator";
import type { EvaluationSubject } from "../types/certificationCriteria";

const ENGINE_VERSION = "pm-stage-eligibility/v1";
const LEVEL_CODES = new Set(["SINGLE", "M1", "M2", "M3", "M4"]);
const nowIso = () => new Date().toISOString();
const todayYmd = () => new Date().toISOString().slice(0, 10);

export type PmCandidateResult = { created: number; existing: number; ineligible: number; errors: number; message: string };

// 확정 단계 취득일(YYYY-MM-DD) → 오늘까지 완전 개월(로컬 tz 변환 없이 Y/M/D 정수). 미래/무효면 null.
function fullMonthsSince(ymd?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? "")); if (!m) return null;
  const a = [Number(m[1]), Number(m[2]), Number(m[3])] as const; const n = new Date();
  const b = [n.getFullYear(), n.getMonth() + 1, n.getDate()] as const;
  if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) return null;
  let months = (b[0] - a[0]) * 12 + (b[1] - a[1]); if (b[2] < a[2]) months -= 1;
  return Math.max(0, months);
}

// PM 후보 배치 생성. 관리자 실행(권한은 UI+RLS 로도 강제). 결과 카운트 반환.
export async function generatePmCandidates(tenantId: string, userId: string): Promise<PmCandidateResult> {
  if (!isSupabaseAvailable() || !supabase) return { created: 0, existing: 0, ineligible: 0, errors: 0, message: "Supabase 미설정 — DB 설정이 필요합니다." };

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
  if (certRes.error) return { created: 0, existing: 0, ineligible: 0, errors: 0, message: "설비 취득 데이터를 불러오려면 시험관리 DB 설정이 필요합니다." };

  // ── PM 단계(Single~M4) + 최고 단계(M4) ───────────────────────────────────
  const pmLevels = levels
    .filter((r) => r.is_active !== false && LEVEL_CODES.has(String(r.code ?? "").toUpperCase()))
    .map((r) => ({ id: String(r.id), code: String(r.code ?? "").toUpperCase(), rank_order: Number(r.rank_order ?? 0), requires_approval: r.requires_approval !== false, auto_promote: r.auto_promote === true }))
    .sort((a, b) => a.rank_order - b.rank_order);
  if (pmLevels.length === 0) return { created: 0, existing: 0, ineligible: 0, errors: 0, message: "PM 단계(Single~M4) 기준정보가 없습니다. 인증 레벨 seed 적용이 필요합니다." };
  const topLevel = pmLevels[pmLevels.length - 1];   // 최고 PM 단계 = M4
  const maxPmRank = topLevel.rank_order;

  // ── Map/Set 인덱스 ──────────────────────────────────────────────────────
  const levelById = new Map(levels.map((r) => [String(r.id), r]));
  const levelByCode = new Map<string, ExamRow>();
  for (const r of levels) { const c = String(r.code ?? "").trim().toUpperCase(); if (c) levelByCode.set(c, r); const n = String(r.name ?? "").trim().toUpperCase(); if (n) levelByCode.set(n, r); }

  const approvedByPerson = new Map<string, Set<string>>();      // personnel → 승인 설비 id Set
  const reevalPersons = new Set<string>();                      // needs_reeval 보유 personnel
  for (const c of (certRes.data as ExamRow[]) || []) {
    const pid = String(c.personnel_id ?? ""); if (!pid) continue;
    if ((c.metadata as { needs_reeval?: unknown } | null)?.needs_reeval === true) reevalPersons.add(pid);
    if (c.status !== "approved") continue;
    const eq = String(c.equipment_id ?? ""); if (!eq) continue;
    (approvedByPerson.get(pid) ?? approvedByPerson.set(pid, new Set()).get(pid)!).add(eq);
  }

  // pm_certs 그룹핑: 확정(승인·활성·미만료) 레벨 rank + 대기(후보) 존재 여부(personnel|process|level 키).
  const today = todayYmd();
  const resolvePmLevelId = (r: ExamRow) => (r.level_id && levelById.has(String(r.level_id))) ? String(r.level_id) : (r.pm_level ? String(levelByCode.get(String(r.pm_level).trim().toUpperCase())?.id ?? "") : "");
  const confirmedByKey = new Map<string, number>();            // `${person}|${process}` → 최고 확정 rank
  const pendingKeys = new Set<string>();                       // `${person}|${process}|${levelId}` 대기 존재
  const confirmedLevelIdsByPerson = new Map<string, Set<string>>(); // 선행단계 평가용(공정 스코프)
  for (const r of (pmRes.data as ExamRow[]) || []) {
    const person = String(r.personnel_id ?? ""); const proc = String(r.process_id ?? "");
    const lid = resolvePmLevelId(r); if (!person) continue;
    const status = String(r.approval_status ?? "");
    if (status === "대기" && r.is_active !== false && lid) { pendingKeys.add(`${person}|${proc}|${lid}`); continue; }
    // 확정(승인) — 만료 제외
    if (status !== "승인" || r.is_active === false) continue;
    const exp = r.expiry_date ? String(r.expiry_date).slice(0, 10) : "";
    if (exp && exp < today) continue;
    if (!lid) continue;
    const rank = Number(levelById.get(lid)?.rank_order ?? 0);
    const key = `${person}|${proc}`;
    if (rank > (confirmedByKey.get(key) ?? 0)) confirmedByKey.set(key, rank);
    (confirmedLevelIdsByPerson.get(`${person}|${proc}`) ?? confirmedLevelIdsByPerson.set(`${person}|${proc}`, new Set()).get(`${person}|${proc}`)!).add(lid);
  }

  // ── 후보 평가 ──────────────────────────────────────────────────────────
  let created = 0, existing = 0, ineligible = 0, errors = 0;
  const toInsert: ExamRow[] = [];

  for (const p of personnel) {
    if (p.is_active === false || p.deleted_at) { continue; }
    const personId = String(p.id ?? ""); const pid = String(p.process_id ?? "");
    if (!personId || !pid) { ineligible++; continue; }
    if (reevalPersons.has(personId)) { ineligible++; continue; }  // 재평가 필요는 후보 제외

    const acquired = approvedByPerson.get(personId) ?? new Set<string>();
    const targetEquipmentIds = new Set(equipment.filter((e) => String(e.process_id ?? "") === pid && e.is_active !== false).map((e) => String(e.id)));
    const coreSet = new Set(stageRules.filter((r) => String(r.process_id ?? "") === pid && r.is_core_equipment === true && !r.deleted_at && r.is_active !== false && isCriteriaEffective(normalizeCriteria({ effective_from: r.effective_from, effective_to: r.effective_to }))).map((r) => String(r.equipment_id ?? "")));
    const coreEquipmentIds = new Set([...acquired].filter((id) => coreSet.has(id)));
    const achievedLevelIds = confirmedLevelIdsByPerson.get(`${personId}|${pid}`) ?? new Set<string>();

    // 확정 단계 취득일 기반 경과개월(승인 pm_certs) — Preview 와 동일 정의.
    const confRows = ((pmRes.data as ExamRow[]) || []).filter((r) => String(r.personnel_id ?? "") === personId && String(r.process_id ?? "") === pid && String(r.approval_status ?? "") === "승인" && r.is_active !== false && r.acquired_date);
    const confSorted = confRows.map((r) => ({ rank: Number(levelById.get(resolvePmLevelId(r))?.rank_order ?? 0), d: String(r.acquired_date).slice(0, 10) })).sort((a, b) => a.rank - b.rank);
    const elapsedMonths = fullMonthsSince(confSorted[confSorted.length - 1]?.d ?? null);
    const cumulativeMonths = fullMonthsSince(confSorted[0]?.d ?? null);

    const subj: EvaluationSubject = {
      tenantId, personnelId: personId, processId: pid,
      acquiredEquipmentIds: acquired, coreEquipmentIds, targetEquipmentIds, achievedLevelIds,
      tenureMonths: fullMonthsSince(p.hire_date as string), elapsedMonths, cumulativeElapsedMonths: cumulativeMonths,
    };
    const summary = calculateEquipmentSummary(subj);

    // 공정·유효기간 내 달성기준 → level 별 1건(priority↓, 최근 시작↓).
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
    // PM 조건: 최고 단계(M4)까지 연속 충족.
    if (highestPassedRank !== maxPmRank) { ineligible++; continue; }
    // PM 미보유: 최고 단계 확정(승인) 없어야 함.
    if ((confirmedByKey.get(`${personId}|${pid}`) ?? 0) >= maxPmRank) { existing++; continue; }
    // 기존 대기(후보) 없어야 함.
    if (pendingKeys.has(`${personId}|${pid}|${topLevel.id}`)) { existing++; continue; }

    const critVer = normalizeCriteria(rulesByLevel.get(topLevel.id)).version ?? null;
    toInsert.push({
      tenant_id: tenantId, personnel_id: personId, employee_no: p.employee_no ?? null,
      process_id: pid, level_id: topLevel.id, pm_level: topLevel.code,
      approval_status: "대기", is_active: true, acquired_date: today,
      created_by: userId, updated_by: userId, created_at: nowIso(), updated_at: nowIso(),
      metadata: { auto_candidate: true, candidate_generated_at: nowIso(), engine_version: ENGINE_VERSION, criteria_version: critVer } as ExamRow[keyof ExamRow],
    });
    // 동일 배치 내 중복 방지.
    pendingKeys.add(`${personId}|${pid}|${topLevel.id}`);
  }

  // ── 단일 batch insert(승인 로직·History 미관여 · 대기 행만 생성) ──────────────
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from("pm_certifications").insert(toInsert).select("id");
    if (error) { errors = toInsert.length; return { created: 0, existing, ineligible, errors, message: `후보 생성 실패: ${translateSupabaseError(error.message || String(error))}` }; }
    created = (data as ExamRow[])?.length ?? toInsert.length;
  }

  // ── 감사로그: 배치 1건만 기록(후보 개별/History 기록 안 함) ───────────────────
  try {
    await writeExamAudit(tenantId, userId, "pm_certifications", `batch-${Date.now()}`, "create", null,
      { created, existing, ineligible, errors, engine_version: ENGINE_VERSION }, "PM 후보 자동 생성(배치 · 대기 상태)");
  } catch { /* 감사 실패는 결과에 영향 없음 */ }

  return { created, existing, ineligible, errors, message: `생성 ${created} · 이미 존재 ${existing} · 조건 미충족 ${ineligible} · 오류 ${errors}` };
}
