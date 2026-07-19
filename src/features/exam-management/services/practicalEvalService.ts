// 실기 평가관리 서비스(1차 · 조회/판정). 저장/확정/practical_pass_date 갱신/PM·DM 연동은 2차.
//  · 판정은 전부 "순수 함수"(Supabase 호출 없음) → 화면/저장/보고서가 동일 결과.
//  · exam_results(설비별) + exam_rules(요건) 사용. 신규 컬럼 미적용(migration 전) 방어.
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { completeStageByCode } from "./licensePlanService";
import { writeExamAudit } from "./examMasterService";
import type {
  ChecklistItem, PracticalEvaluatorResult, EquipmentEvaluationSummary, PracticalEvalSummary,
  PracticalRule, PracticalTarget, EquipmentCertMethod, EvalStatus,
} from "../types/practicalEval";

type Row = Record<string, unknown>;
const asText = (v: unknown): string => (v == null ? "" : String(v).trim());
const asNum = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const ymd = (v: unknown): string | null => { const s = asText(v); return s ? s.slice(0, 10) : null; };

// ── fallback 기본값(요구사항 6) ──────────────────────────────────────
export const PRACTICAL_FALLBACK = { passScore: 80, evaluatorCount: 1, method: "all" as EquipmentCertMethod, varianceThreshold: 20 };

// exam_rules 행 → PracticalRule 안전 추출(nullable/미적용 컬럼 대비).
export function extractPracticalRule(ruleRow: Row | null | undefined): PracticalRule {
  const r = ruleRow || {};
  const method = asText(r.equipment_cert_method) as EquipmentCertMethod;
  return {
    requirePractical: r.require_practical === true,
    practicalPassScore: asNum(r.practical_pass_score),
    evaluatorCount: asNum(r.evaluator_count),
    equipmentCertMethod: ["one", "all", "representative", "equipment_group", "individual"].includes(method) ? method : null,
    requiredEquipmentCount: asNum(r.required_equipment_count),
  };
}

// ── 순수 함수 1: 체크리스트 검증 ─────────────────────────────────────
export function validateChecklist(input: unknown): { valid: boolean; errors: string[]; normalizedItems: ChecklistItem[] } {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { valid: false, errors: ["체크리스트 형식이 올바르지 않습니다(배열이 아님)."], normalizedItems: [] };
  const items: ChecklistItem[] = [];
  input.forEach((raw, i) => {
    const o = (raw ?? {}) as Row;
    const label = asText(o.label);
    if (!label) { errors.push(`${i + 1}번 항목: 항목명(label)이 필요합니다.`); return; }
    const required = o.required === true;
    const passed = o.passed === true ? true : o.passed === false ? false : null;
    const score = o.score == null ? null : asNum(o.score);
    const maxScore = o.maxScore == null ? null : asNum(o.maxScore);
    if (score != null && score < 0) errors.push(`${label}: 점수는 음수일 수 없습니다.`);
    if (maxScore != null && maxScore < 0) errors.push(`${label}: 만점은 음수일 수 없습니다.`);
    if (score != null && maxScore != null && score > maxScore) errors.push(`${label}: 점수가 만점을 초과했습니다.`);
    items.push({ id: asText(o.id) || `item-${i + 1}`, label, required, passed, score, maxScore, note: asText(o.note) || undefined });
  });
  return { valid: errors.length === 0, errors, normalizedItems: items };
}

// ── 순수 함수 2: 점수 편차(최고-최저) ────────────────────────────────
export function calculateScoreVariance(scores: Array<number | null | undefined>): number {
  const nums = scores.map((s) => (s == null ? null : Number(s))).filter((n): n is number => n != null && Number.isFinite(n));
  if (nums.length <= 1) return 0;
  return Math.max(...nums) - Math.min(...nums);
}

// ── 순수 함수 3: 설비별 판정 ─────────────────────────────────────────
export function computeEquipmentResult(rowsForEquipment: PracticalEvaluatorResult[], rule: PracticalRule, equipmentName = ""): EquipmentEvaluationSummary {
  const passScore = rule.practicalPassScore ?? PRACTICAL_FALLBACK.passScore;
  const evaluatorRequired = Math.max(1, rule.evaluatorCount ?? PRACTICAL_FALLBACK.evaluatorCount);
  const reasons: string[] = []; const warnings: string[] = [];
  const rows = rowsForEquipment.filter((r) => r.evaluatorNo != null || r.score != null || (r.checklist?.length ?? 0) > 0);
  const evaluatorCompleted = new Set(rows.map((r) => r.evaluatorNo ?? -1)).size;

  const base = { equipmentId: rowsForEquipment[0]?.equipmentId ?? "", equipmentName, averageScore: null as number | null, variance: 0, evaluatorRequired, evaluatorCompleted, checklistPassed: true, passed: false };
  if (rows.length === 0) return { ...base, status: "pending", reasons: ["평가 입력이 없습니다."], warnings };

  const scores = rows.map((r) => r.score).filter((s): s is number => s != null);
  const averageScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const variance = calculateScoreVariance(scores);
  // 필수 체크리스트: 하나라도 required && passed !== true → 불통과
  const checklistPassed = rows.every((r) => (r.checklist || []).every((c) => !c.required || c.passed === true));

  if (evaluatorCompleted < evaluatorRequired) reasons.push(`평가위원 입력 미완료(${evaluatorCompleted}/${evaluatorRequired}).`);
  if (!checklistPassed) reasons.push("필수 체크리스트 미충족.");
  if (variance >= PRACTICAL_FALLBACK.varianceThreshold) warnings.push(`위원 점수 편차 ${variance}점(≥${PRACTICAL_FALLBACK.varianceThreshold}) — 재검토 필요.`);

  let status: EvalStatus;
  if (evaluatorCompleted < evaluatorRequired) status = evaluatorCompleted === 0 ? "in_progress" : "awaiting_decision";
  else if (!checklistPassed) status = "failed";
  else if (variance >= PRACTICAL_FALLBACK.varianceThreshold) status = "review_required";
  else if (averageScore != null && averageScore >= passScore) { status = "passed"; reasons.push(`평균 ${averageScore} ≥ 합격 ${passScore}.`); }
  else { status = "failed"; reasons.push(`평균 ${averageScore ?? "-"} < 합격 ${passScore}.`); }

  return { ...base, status, averageScore, variance, checklistPassed, passed: status === "passed", reasons, warnings };
}

// ── 순수 함수 4: 전체 판정 ───────────────────────────────────────────
export function computePracticalResult(
  equipmentSummaries: EquipmentEvaluationSummary[], rule: PracticalRule, equipmentList: Array<{ id: string; isRepresentative?: boolean; group?: string | null }>
): PracticalEvalSummary {
  const method = rule.equipmentCertMethod ?? PRACTICAL_FALLBACK.method;
  const requiredCount = rule.requiredEquipmentCount;
  const reasons: string[] = []; const warnings: string[] = [];
  const applicationId = "";
  const targetCount = equipmentList.length;
  const byId = new Map(equipmentSummaries.map((e) => [e.equipmentId, e]));
  const isPass = (id: string) => byId.get(id)?.passed === true;
  const passedCount = equipmentList.filter((e) => isPass(e.id)).length;
  const failedCount = equipmentSummaries.filter((e) => e.status === "failed").length;
  const reviewRequiredCount = equipmentSummaries.filter((e) => e.status === "review_required").length;
  const completedCount = equipmentSummaries.filter((e) => e.status === "passed" || e.status === "failed").length;

  const empty = { applicationId, method, requiredCount, targetCount, completedCount, passedCount, failedCount, reviewRequiredCount, equipmentSummaries, reasons, warnings };
  if (targetCount === 0) { warnings.push("대상 설비가 없습니다 — 자동 합격하지 않습니다."); return { ...empty, overallStatus: "pending", overallPassed: false, partialComplete: false }; }
  if (reviewRequiredCount > 0) warnings.push(`재검토 필요 설비 ${reviewRequiredCount}건.`);

  const countOk = requiredCount == null || passedCount >= requiredCount;
  if (requiredCount != null && !countOk) reasons.push(`합격 설비 ${passedCount} < 필요 ${requiredCount}.`);

  let overallPassed = false; let partialComplete = false;
  switch (method) {
    case "one": overallPassed = passedCount >= 1 && countOk; break;
    case "all": overallPassed = passedCount === targetCount && countOk; break;
    case "representative": {
      const reps = equipmentList.filter((e) => e.isRepresentative);
      if (reps.length === 0) { warnings.push("대표 설비 기준정보가 없습니다 — 자동 확정할 수 없습니다."); overallPassed = false; }
      else overallPassed = reps.every((e) => isPass(e.id)) && countOk;
      break;
    }
    case "equipment_group": {
      const groups = new Map<string, string[]>();
      equipmentList.forEach((e) => { const g = e.group || "__none__"; (groups.get(g) || groups.set(g, []).get(g)!).push(e.id); });
      if (groups.size === 1 && groups.has("__none__")) { warnings.push("설비 그룹 기준정보가 없습니다 — 자동 확정할 수 없습니다."); overallPassed = false; }
      else overallPassed = Array.from(groups.values()).every((ids) => ids.some((id) => isPass(id))) && countOk;
      break;
    }
    case "individual": {
      // 전체 단일 합격으로 처리하지 않음. 필수 설비 전부 충족 시에만 완료, 일부면 부분 완료.
      overallPassed = passedCount === targetCount && countOk;
      partialComplete = passedCount > 0 && passedCount < targetCount;
      break;
    }
  }

  let overallStatus: PracticalEvalSummary["overallStatus"];
  if (reviewRequiredCount > 0) overallStatus = "review_required";
  else if (overallPassed) overallStatus = "passed";
  else if (partialComplete) overallStatus = "partial_complete";
  else if (completedCount === 0) overallStatus = passedCount === 0 && failedCount === 0 ? (equipmentSummaries.some((e) => e.status === "in_progress" || e.status === "awaiting_decision") ? "in_progress" : "pending") : "in_progress";
  else if (completedCount < targetCount) overallStatus = "in_progress";
  else overallStatus = "failed";

  return { ...empty, overallStatus, overallPassed, partialComplete };
}

// ── 조회(비순수): 실기 평가 대상 + 판정 미리보기. N+1 없이 일괄 조회 후 메모리 조합. ──
export type PracticalBoard = { schemaReady: boolean; rulesReady: boolean; targets: PracticalTarget[]; warnings: string[] };

export async function loadPracticalTargets(tenantId: string): Promise<PracticalBoard> {
  const out: PracticalBoard = { schemaReady: true, rulesReady: true, targets: [], warnings: [] };
  if (!isSupabaseAvailable() || !supabase || !tenantId) { out.schemaReady = false; out.warnings.push("데이터 연결이 필요합니다."); return out; }

  // 신규 컬럼 방어: exam_results.result_type 조회 시도 → 실패면 스키마 미준비.
  let results: Row[] = [];
  try {
    const rr = await supabase.from("exam_results")
      .select("id, tenant_id, application_id, personnel_id, equipment_id, evaluator, evaluator_no, score, max_score, checklist, notes, result_date, eval_status, result_type")
      .eq("tenant_id", tenantId).eq("result_type", "practical").is("deleted_at", null);
    if (rr.error) throw rr.error;
    results = (rr.data as Row[]) || [];
  } catch { out.schemaReady = false; out.warnings.push("실기 평가 데이터 구조가 아직 준비되지 않았습니다(관리자 문의)."); }

  const [appsR, pplR, rulesR, equipR] = await Promise.all([
    supabase.from("exam_applications").select("id, personnel_id, employee_no, name, process, category_code, level_id, status, written_pass_date, practical_pass_date, deleted_at")
      .eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_personnel").select("id, employee_no, employment_status, process_id").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_rules").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_equipment").select("id, name, process_id, is_representative, equipment_group, is_active").eq("tenant_id", tenantId).is("deleted_at", null),
  ]);
  const apps = (appsR.data as Row[]) || [];
  const personnel = (pplR.data as Row[]) || [];
  const rules = (rulesR.data as Row[]) || [];
  const equipment = (equipR.data as Row[]) || [];
  out.rulesReady = rules.some((r) => Object.prototype.hasOwnProperty.call(r, "require_practical"));
  if (!out.rulesReady) out.warnings.push("인증 규칙의 실기 요건(require_practical 등)이 아직 준비되지 않았습니다.");

  const pplById = new Map(personnel.map((p) => [asText(p.id), p]));
  const pplByNo = new Map(personnel.map((p) => [asText(p.employee_no), p]));
  const resultsByApp = new Map<string, Row[]>();
  results.forEach((r) => { const k = asText(r.application_id); (resultsByApp.get(k) || resultsByApp.set(k, []).get(k)!).push(r); });

  // 규칙 매칭: level_id 우선, 없으면 category_code=level.code (level 마스터 없이 process_id 규칙으로 근사).
  const rulesByLevel = new Map<string, Row>();
  rules.forEach((r) => { const lid = asText(r.level_id); if (lid && !rulesByLevel.has(lid)) rulesByLevel.set(lid, r); });

  const isWrittenPass = (a: Row) => !!ymd(a.written_pass_date) || /필기\s*합격|실기|인증\s*취득/.test(asText(a.status));
  const isEmployed = (p: Row | undefined) => { const s = asText(p?.employment_status); return s === "" || !/퇴사|퇴직|비활성|중지|해지/.test(s); };

  for (const a of apps) {
    if (/취소/.test(asText(a.status))) continue;
    if (ymd(a.practical_pass_date)) continue;         // 이미 실기 합격
    if (!isWrittenPass(a)) continue;                  // 필기 합격만
    const ruleRow = rulesByLevel.get(asText(a.level_id)) || null;
    const rule = extractPracticalRule(ruleRow);
    if (out.rulesReady && !rule.requirePractical) continue; // 실기 필요 규칙만(스키마 준비 시)

    const empNo = asText(a.employee_no);
    const person = (asText(a.personnel_id) && pplById.get(asText(a.personnel_id))) || (empNo && pplByNo.get(empNo)) || undefined;
    if (!isEmployed(person)) continue;                // 재직만
    const personnelId = person ? asText(person.id) : (asText(a.personnel_id) || null);
    const canSave = !!personnelId;
    const targetWarn: string[] = [];
    if (!canSave) targetWarn.push("인력정보 연결이 필요합니다.");

    // 대상 설비: 규칙 process_id(없으면 인력 process_id)에 연결된 활성 설비.
    const scopeProcess = asText(ruleRow?.process_id) || asText(person?.process_id);
    const targetEquip = equipment.filter((e) => e.is_active !== false && (!scopeProcess || asText(e.process_id) === scopeProcess));
    if (targetEquip.length === 0) targetWarn.push("대상 설비 기준정보가 없습니다.");

    // 설비별 결과 → 위원 결과 → 판정
    const appResults = resultsByApp.get(asText(a.id)) || [];
    const targetResults: PracticalEvaluatorResult[] = [];
    const equipSummaries: EquipmentEvaluationSummary[] = targetEquip.map((eq) => {
      const rows: PracticalEvaluatorResult[] = appResults.filter((r) => asText(r.equipment_id) === asText(eq.id)).map((r) => ({
        resultId: asText(r.id) || null, applicationId: asText(a.id), personnelId, equipmentId: asText(eq.id),
        evaluator: asText(r.evaluator) || null, evaluatorNo: asNum(r.evaluator_no), score: asNum(r.score), maxScore: asNum(r.max_score),
        checklist: validateChecklist(r.checklist).normalizedItems, notes: asText(r.notes) || null, resultDate: ymd(r.result_date), evalStatus: (asText(r.eval_status) || null) as EvalStatus | null,
      }));
      targetResults.push(...rows);
      return computeEquipmentResult(rows, rule, asText(eq.name));
    });
    const equipMeta = targetEquip.map((e) => ({ id: asText(e.id), name: asText(e.name), isRepresentative: e.is_representative === true, group: asText(e.equipment_group) || null }));
    const summary = computePracticalResult(equipSummaries, rule, equipMeta.map((e) => ({ id: e.id, isRepresentative: e.isRepresentative, group: e.group })));
    summary.applicationId = asText(a.id);

    out.targets.push({
      applicationId: asText(a.id), employeeNo: empNo, name: asText(a.name), process: asText(a.process),
      levelCode: asText(a.category_code) || asText(a.level_id), writtenPassDate: ymd(a.written_pass_date),
      personnelId, canSave, summary, warnings: targetWarn, rule, equipment: equipMeta, results: targetResults,
    });
  }
  out.targets.sort((x, y) => x.employeeNo.localeCompare(y.employeeNo));
  return out;
}

// ── 저장(2차): 설비×위원 실기 결과 1건 upsert. practical_pass_date/status/연동은 여기서 하지 않는다. ──
//  · personnel_id NOT NULL 대비: 미확정이면 저장 차단. 필수 체크리스트 미충족/점수 범위 위반도 차단.
//  · 부분 유니크(application_id, equipment_id, evaluator_no) → 기존행 확인 후 update, 없으면 insert(42P10 회피).
export async function savePracticalResult(tenantId: string, userId: string, input: {
  applicationId: string; personnelId: string | null; equipmentId: string; evaluator: string | null; evaluatorNo: number;
  score: number | null; maxScore: number | null; passed: boolean | null; checklist: ChecklistItem[]; notes: string | null;
  evalStatus: EvalStatus | null; resultDate: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!isSupabaseAvailable() || !supabase) return { ok: false, error: "데이터 연결이 필요합니다." };
  if (!input.applicationId || !input.equipmentId) return { ok: false, error: "응시/설비 정보가 필요합니다." };
  if (!input.personnelId) return { ok: false, error: "인력정보 연결이 필요합니다(personnel_id 미확정)." };
  if (input.score != null) {
    if (input.score < 0) return { ok: false, error: "점수는 음수일 수 없습니다." };
    const cap = input.maxScore ?? 100;
    if (input.score > cap) return { ok: false, error: `점수가 만점(${cap})을 초과했습니다.` };
  }
  const cv = validateChecklist(input.checklist);
  if (!cv.valid) return { ok: false, error: cv.errors[0] || "체크리스트 형식이 올바르지 않습니다." };
  if (cv.normalizedItems.some((c) => c.required && c.passed !== true)) return { ok: false, error: "필수 체크리스트 항목을 모두 충족해야 저장할 수 있습니다." };

  const payload: Row = {
    tenant_id: tenantId, application_id: input.applicationId, personnel_id: input.personnelId, equipment_id: input.equipmentId,
    evaluator: input.evaluator, evaluator_no: input.evaluatorNo, score: input.score, max_score: input.maxScore, passed: input.passed,
    checklist: cv.normalizedItems as unknown, notes: input.notes, result_type: "practical", eval_status: input.evalStatus, result_date: input.resultDate,
    updated_by: userId || null, updated_at: new Date().toISOString(),
  };
  const { data: exist } = await supabase.from("exam_results").select("id")
    .eq("tenant_id", tenantId).eq("application_id", input.applicationId).eq("equipment_id", input.equipmentId)
    .eq("evaluator_no", input.evaluatorNo).eq("result_type", "practical").is("deleted_at", null).limit(1);
  const id = (exist as Array<{ id?: string }> | null)?.[0]?.id;
  if (id) {
    const { error } = await supabase.from("exam_results").update(payload).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true, id };
  }
  const { data, error } = await supabase.from("exam_results").insert({ ...payload, created_by: userId || null }).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, id: (data as { id?: string })?.id };
}

// ── 최종 확정(3차): 재조회·재계산(엔진) → 원자적 RPC → 취득/라이선스 파이프라인(비원자·기존 재사용) → 감사로그. ──
//  · 화면 미리보기를 신뢰하지 않고 loadPracticalTargets 로 재조회·재계산한 verdict 로만 확정한다.
//  · practical_pass_date 는 전체 합격일 때만(RPC 내부). practical_acquire_date(실기 취득일)는 의미 모호로 미변경.
export async function finalizePracticalEvaluation(
  tenantId: string, applicationId: string, userId: string
): Promise<{ ok: boolean; overallPass?: boolean; already?: boolean; error?: string }> {
  if (!isSupabaseAvailable() || !supabase) return { ok: false, error: "데이터 연결이 필요합니다." };
  // 1) 최신 재조회 + 순수 엔진 재계산
  const board = await loadPracticalTargets(tenantId);
  if (!board.schemaReady) return { ok: false, error: "실기 평가 데이터 구조가 아직 준비되지 않았습니다(관리자 문의)." };
  const t = board.targets.find((x) => x.applicationId === applicationId);
  if (!t) return { ok: false, error: "대상 응시를 찾을 수 없습니다(목록을 새로고침한 뒤 다시 시도해 주세요)." };
  if (!t.personnelId) return { ok: false, error: "인력정보 연결이 필요합니다." };
  if (t.equipment.length === 0) return { ok: false, error: "대상 설비 기준정보가 없습니다." };
  const s = t.summary;
  if (s.warnings.some((w) => /자동 확정할 수 없습니다/.test(w))) return { ok: false, error: s.warnings.join(" · ") };
  if (s.overallStatus === "review_required") return { ok: false, error: "재검토가 필요한 평가가 있습니다." };
  if (["pending", "in_progress", "awaiting_decision"].includes(s.overallStatus)) return { ok: false, error: "평가위원 입력/필수 체크리스트가 완료되지 않았습니다." };

  const overallPass = s.overallPassed;
  const evalStatus = s.overallStatus;
  const completedDate = new Date().toISOString().slice(0, 10);

  // 2) 원자적 확정(RPC = 트랜잭션). 여러 update 부분 성공 방지.
  const { data, error } = await supabase.rpc("finalize_practical_evaluation", {
    p_tenant: tenantId, p_application_id: applicationId, p_overall_pass: overallPass, p_completed_date: completedDate, p_eval_status: evalStatus,
  });
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if ((error as { code?: string }).code === "PGRST202" || /does not exist|could not find|schema cache|42883/.test(msg))
      return { ok: false, error: "최종 확정 기능이 아직 준비되지 않았습니다(RPC 미적용). 관리자에게 문의하세요." };
    return { ok: false, error: error.message };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; already?: boolean };
  if (!r.ok) return { ok: false, error: r.error === "permission" ? "최종 확정 권한이 없습니다." : r.error === "not_found" ? "대상 응시를 찾을 수 없습니다." : "확정에 실패했습니다." };

  // 3) 전체 합격 최초 확정 시 기존 취득/라이선스 파이프라인 재사용(비원자·비차단 — 실패해도 확정은 유지).
  if (overallPass && !r.already) {
    try { await completeStageByCode({ personnelId: t.personnelId, employeeNo: t.employeeNo }, tenantId, t.levelCode, completedDate, userId); } catch { /* 경고만 */ }
  }
  // 4) 감사로그(기존 서비스 재사용 · best-effort).
  try {
    await writeExamAudit(tenantId, userId, "exam_applications", applicationId,
      overallPass ? "approve" : "reject", { status: "실기 평가 확정 전" },
      { practical_status: evalStatus, overall_pass: overallPass, passed: `${s.passedCount}/${s.targetCount}` },
      `실기 평가 최종 확정: ${evalStatus} · 합격 설비 ${s.passedCount}/${s.targetCount}`);
  } catch { /* 무시 */ }
  return { ok: true, overallPass, already: !!r.already };
}
