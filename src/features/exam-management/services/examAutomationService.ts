// 시험관리 자동화 서비스(공통 진입점 — 실제 PM/D.M/실적 계산은 아직 구현하지 않음).
// 각 계산은 공통 CalculationResult 구조를 반환하며, 자동계산(auto)과 관리자 수동 확정(manual)을 구분한다.
// 실제 규칙은 향후 certificationRuleEngine 에 exam_rules 기준정보를 주입해 구현한다.
import {
  type CalculationResult,
  autoResult,
  emptyResult,
  manualResult,
  resolveCalculation,
} from "../utils/examCalculations";
import { createRuleEngine, type RuleContext, type RuleEngine } from "./certificationRuleEngine";

// 시험 응시 레코드(exam_applications 1행) — 계산에 필요한 필드만 느슨하게 참조.
export type ExamApplicationRecord = Record<string, unknown>;

// 자동계산 시험 상태 라벨(응시관리 자동계산 전용 — 저장 status 값과 별개의 표시용 계산 결과).
export type AutoExamStatus =
  | "미등록" | "응시예정" | "필기진행" | "필기합격" | "필기불합격"
  | "실기진행" | "실기합격" | "실기불합격" | "인증취득" | "취소" | "재응시";

const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const toYmd = (v: unknown): string => {
  const s = asText(v);
  if (!s) return "";
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10);
};

// 시험 상태 자동계산. 결과 값과 계산 근거(reasons)를 함께 반환한다(공통 CalculationResult 구조).
//  - 저장된 status 값을 덮어쓰지 않는다(표시용 계산 결과). 수동 확정값 유지는 resolveExamStatus 로 처리.
//  - 진행 단계가 높은 것이 우선(실기 > 필기 > 시험일). 취소/재응시/인증취득은 확정 우선.
export function calculateExamStatus(record: ExamApplicationRecord): CalculationResult<AutoExamStatus> {
  const status = asText(record.status);
  const writtenExam = toYmd(record.written_exam_date);
  const writtenPass = toYmd(record.written_pass_date);
  const practicalAcquire = toYmd(record.practical_acquire_date);
  const practicalPass = toYmd(record.practical_pass_date);
  const certAcquired = toYmd(record.cert_acquired_date);
  const certStatus = asText(record.cert_status);
  const today = new Date().toISOString().slice(0, 10);

  // 확정 상태(취소/재응시) 우선
  if (/취소/.test(status)) return autoResult<AutoExamStatus>("취소", ["취소값이 입력됨"]);
  if (/재응시|재시험/.test(status)) return autoResult<AutoExamStatus>("재응시", ["재시험(재응시) 확정"]);

  // 최종 인증 취득
  if (certAcquired) return autoResult<AutoExamStatus>("인증취득", ["인증 취득일이 입력됨"]);
  if (practicalPass && certStatus === "취득") return autoResult<AutoExamStatus>("인증취득", ["실기 합격 + 인증취득 확정"]);

  // 실기 단계
  if (/실기.*불합격/.test(status)) return autoResult<AutoExamStatus>("실기불합격", ["실기 불합격 상태"]);
  if (practicalPass) return autoResult<AutoExamStatus>("실기합격", ["실기 합격일이 입력됨"]);
  if (practicalAcquire) return autoResult<AutoExamStatus>("실기진행", ["실기 진행(취득)일이 입력됨"]);

  // 필기 단계
  if (/필기.*불합격/.test(status)) return autoResult<AutoExamStatus>("필기불합격", ["필기 불합격 상태"]);
  if (writtenPass) return autoResult<AutoExamStatus>("필기합격", ["필기 합격일이 입력됨"]);
  if (writtenExam) {
    if (writtenExam > today) return autoResult<AutoExamStatus>("응시예정", ["시험일이 미래임"]);
    return autoResult<AutoExamStatus>("필기진행", ["필기 진행일이 입력됨"]);
  }

  // 시험일 없음
  return autoResult<AutoExamStatus>("미등록", ["시험일이 없음"]);
}

// 수동 확정값 우선: 관리자가 확정한 status(manual)가 있으면 그 값을 유지하고, 없으면 자동계산 결과를 사용한다.
//  - 자동계산이 수동 확정값을 덮어쓰지 않도록 하는 공통 진입점(저장 status 는 변경하지 않음).
export function resolveExamStatus(
  record: ExamApplicationRecord,
  manual?: { value: string; reasons?: string[] } | null
): CalculationResult<string> {
  return resolveCalculation<string>(calculateExamStatus(record), manual);
}

// ─────────────────────────────────────────────────────────────
// 인증취득 여부 자동계산
// ─────────────────────────────────────────────────────────────

// 인증취득 자동판정 결과 라벨.
export type CertificationStatus = "인증취득 후보" | "인증취득 확정" | "미취득" | "확인 필요";

// 인증 취득 요건(exam_rules 기준정보에서 추출). 데이터 없으면 기본값 사용.
export type CertRequirements = {
  requireWritten: boolean;   // 필기 합격 필요(기본 true)
  requirePractical: boolean; // 실기 합격 필요(기본 true)
  requireEquipment: boolean; // 필수 설비 충족 필요
  requireEducation: boolean; // 필수 교육 충족 필요
  minTenureMonths: number;   // 최소 재직기간(개월)
  requireApproval: boolean;  // 관리자 승인 필요(기본 true)
};

const truthyFlag = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = asText(v).toLowerCase();
  return !!s && !["0", "false", "n", "no", "x", "-", "없음", "미이수", "불필요"].includes(s);
};

// 규칙 행 목록에서 요건 플래그를 병합(내부 공통 — 필터는 호출부에서 수행).
//  - 기존 exam_rules 구조가 자유형(jsonb)이라 한글/영문 별칭을 모두 탐색하고, 없으면 안전한 기본값을 쓴다.
function mergeRequirementFlags(rules: ExamApplicationRecord[]): CertRequirements {
  const req: CertRequirements = {
    requireWritten: true, requirePractical: true,
    requireEquipment: false, requireEducation: false,
    minTenureMonths: 0, requireApproval: true,
  };
  for (const rule of rules) {
    const bag: Record<string, unknown> = { ...(rule as Record<string, unknown>), ...((rule?.criteria as Record<string, unknown>) || {}) };
    const pick = (...keys: string[]) => { for (const k of keys) { if (bag[k] !== undefined && bag[k] !== null && bag[k] !== "") return bag[k]; } return undefined; };
    const eq = pick("require_equipment", "requireEquipment", "필수설비", "equipment_required", "min_equipment");
    if (eq !== undefined) req.requireEquipment = req.requireEquipment || truthyFlag(eq);
    const edu = pick("require_education", "requireEducation", "필수교육", "education_required");
    if (edu !== undefined) req.requireEducation = req.requireEducation || truthyFlag(edu);
    const appr = pick("require_approval", "requireApproval", "관리자승인", "approval_required");
    if (appr !== undefined) req.requireApproval = truthyFlag(appr);
    const tenure = Number(pick("min_tenure_months", "minTenureMonths", "최소재직개월", "min_tenure"));
    if (Number.isFinite(tenure) && tenure > req.minTenureMonths) req.minTenureMonths = tenure;
    const wr = pick("require_written", "requireWritten", "필기필수");
    if (wr !== undefined) req.requireWritten = truthyFlag(wr);
    const pr = pick("require_practical", "requirePractical", "실기필수");
    if (pr !== undefined) req.requirePractical = truthyFlag(pr);
  }
  return req;
}

// exam_rules 에서 인증 취득 요건 추출(취득/인증 관련 규칙만).
export function extractCertRequirements(rules?: ExamApplicationRecord[]): CertRequirements {
  if (!Array.isArray(rules)) return mergeRequirementFlags([]);
  return mergeRequirementFlags(rules.filter((r) => /취득|인증|cert/i.test(JSON.stringify(r ?? {}))));
}

// exam_rules 에서 PM 승급 요건 추출(PM/단계 관련 규칙만, 특정 단계로 좁힐 수 있음).
export function extractPmRequirements(rules?: ExamApplicationRecord[], stage?: string): CertRequirements {
  if (!Array.isArray(rules)) return mergeRequirementFlags([]);
  const stageRe = stage ? new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const relevant = rules.filter((r) => {
    const s = JSON.stringify(r ?? {});
    if (!/pm|single\s*job|master|m[1-4]|단계|level/i.test(s)) return false;
    return stageRe ? stageRe.test(s) : true;
  });
  // 해당 단계 전용 규칙이 없으면 PM 전반 규칙으로 폴백.
  const fallback = relevant.length ? relevant : rules.filter((r) => /pm|단계/i.test(JSON.stringify(r ?? {})));
  return mergeRequirementFlags(fallback);
}

// 관리자 승인(수동 확정 취득) 여부 판정.
export const isCertificationApproved = (record: ExamApplicationRecord): boolean =>
  record.cert_status_manual === true && asText(record.cert_status) === "취득";

// 인증취득 여부 자동계산. 실기 합격만으로 무조건 취득 처리하지 않고 exam_rules 요건을 검증한다.
//  - 결과에 충족 조건(reasons)과 미충족/확인필요 조건(warnings)을 함께 담는다.
//  - 모든 요건 충족 + 승인 전 → "인증취득 후보", 승인 완료 → "인증취득 확정".
//  - 확정적 미충족 → "미취득", 데이터 부족으로 검증 불가 → "확인 필요".
export function calculateCertificationStatus(
  record: ExamApplicationRecord,
  rules?: ExamApplicationRecord[]
): CalculationResult<CertificationStatus> {
  const req = extractCertRequirements(rules);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let hardFail = false;   // 확정적 미충족
  let needCheck = false;  // 데이터 부족으로 검증 불가
  const has = (k: string) => asText(record[k]) !== "";

  if (req.requireWritten) {
    if (has("written_pass_date")) reasons.push("필기 합격");
    else { warnings.push("필기 합격 이력이 없습니다"); hardFail = true; }
  }
  if (req.requirePractical) {
    if (has("practical_pass_date")) reasons.push("실기 합격");
    else { warnings.push("실기 합격 이력이 없습니다"); hardFail = true; }
  }
  if (req.requireEquipment) {
    if (has("equipment_id")) reasons.push("필수 설비 충족");
    else { warnings.push("필수 설비 인증이 부족합니다"); hardFail = true; }
  }
  if (req.requireEducation) {
    const v = record.education_completed ?? record.education_done ?? (record as Record<string, unknown>)["교육이수"];
    if (v === undefined || v === null || v === "") { warnings.push("필수 교육 이수 여부를 확인할 수 없습니다"); needCheck = true; }
    else if (truthyFlag(v)) reasons.push("필수 교육 충족");
    else { warnings.push("필수 교육이 미이수 상태입니다"); hardFail = true; }
  }
  if (req.minTenureMonths > 0) {
    const raw = record.tenure_months ?? (record as Record<string, unknown>)["재직개월"];
    const t = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(t)) {
      warnings.push(`최소 재직기간(${req.minTenureMonths}개월) 충족 여부를 확인할 수 없습니다`); needCheck = true;
    } else if (t >= req.minTenureMonths) reasons.push(`최소 재직기간 충족(${t}개월)`);
    else { warnings.push(`최소 재직기간 미충족(${t}/${req.minTenureMonths}개월)`); hardFail = true; }
  }

  if (hardFail) return autoResult<CertificationStatus>("미취득", reasons, warnings);
  if (needCheck) return autoResult<CertificationStatus>("확인 필요", reasons, warnings);

  const approved = isCertificationApproved(record);
  if (req.requireApproval && !approved) {
    return autoResult<CertificationStatus>("인증취득 후보", reasons, [...warnings, "관리자 승인 대기"]);
  }
  return autoResult<CertificationStatus>("인증취득 확정", [...reasons, approved ? "관리자 승인 완료" : "승인 불필요"], warnings);
}

// 수동 인증 확정값 우선: 관리자가 cert_status 를 수동 확정(cert_status_manual=true)했으면 그 값을 유지하고,
//  자동계산이 덮어쓰지 않는다. 수동 확정이 없을 때만 자동계산 결과를 사용한다.
export function resolveCertificationStatus(
  record: ExamApplicationRecord,
  rules?: ExamApplicationRecord[]
): CalculationResult<string> {
  if (record.cert_status_manual === true) {
    const cs = asText(record.cert_status);
    if (cs === "취득") return manualResult<string>("인증취득 확정", ["관리자 수동 확정(취득)"]);
    if (cs === "미취득") return manualResult<string>("미취득", ["관리자 수동 확정(미취득)"]);
  }
  return calculateCertificationStatus(record, rules) as CalculationResult<string>;
}

// ─────────────────────────────────────────────────────────────
// PM Level 자동계산
// ─────────────────────────────────────────────────────────────

// 직원 레코드(exam_personnel 1행) — PM 단계 플래그/재직/기준 필드를 느슨하게 참조.
export type ExamPersonnelRecord = Record<string, unknown>;

// PM 단계 순서(도메인 단계값 — 요건/계산 로직은 exam_rules 기준, 단계 라벨만 상수).
export const PM_STAGES = ["Single", "M1", "M2", "M3", "M4", "Master"] as const;
export type PmStage = typeof PM_STAGES[number];

// 재직기간(개월) 계산. 유효 입사일 없으면 null.
function tenureMonths(hireDate: unknown): number | null {
  const s = asText(hireDate);
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  const iso = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  return months < 0 ? null : months;
}

// 인증 이력(pm_certifications 등)에 해당 단계 취득 기록이 있는지(느슨한 텍스트 매칭).
function certHasStage(certifications: ExamPersonnelRecord[] | undefined, stage: PmStage): boolean {
  if (!Array.isArray(certifications)) return false;
  return certifications.some((c) => {
    const s = `${asText(c.pm_level)} ${asText(c.level)} ${asText(c.name)} ${asText(c.stage)} ${asText(c.cert_level)}`.toLowerCase();
    return s.includes(stage.toLowerCase());
  });
}

// 단계 취득 여부: 직원 플래그(single_job/m1~m4/cert_level) 또는 인증 이력.
function stageAcquired(person: ExamPersonnelRecord, certifications: ExamPersonnelRecord[] | undefined, stage: PmStage): boolean {
  if (stage === "Single") return truthyFlag(person.single_job) || certHasStage(certifications, "Single");
  if (stage === "Master") return /master/i.test(asText(person.cert_level)) || truthyFlag(person.master) || certHasStage(certifications, "Master");
  return truthyFlag(person[stage.toLowerCase()]) || certHasStage(certifications, stage);
}

// 인증 설비 보유 여부(직원/인증 이력의 설비 정보 — 느슨한 확인).
function hasEquipment(person: ExamPersonnelRecord, certifications: ExamPersonnelRecord[] | undefined): boolean {
  if (asText(person.equipment_id) || Number(person.equipment_count) > 0) return true;
  return Array.isArray(certifications) && certifications.some((c) => asText(c.equipment_id) !== "" || Number(c.equipment_count) > 0);
}

// PM Level 자동계산(하드코딩 금지 — 단계 순서만 상수, 승급 요건은 exam_rules 기준).
//  - 시험 결과/인증 취득이력/공정·파트/인증 설비/취득일/재직기간/이전 단계 취득 여부를 확인한다.
//  - 이전 단계 취득 여부: Single 부터 연속 취득한 최상위 단계를 현재 PM Level 로 본다(중간 누락 시 그 앞까지).
//  - 다음 단계 미충족 조건은 warnings 에 담는다. M4 후 Master 요건 충족 시 "Master 후보".
export function calculatePmLevel(
  person: ExamPersonnelRecord,
  certifications?: ExamPersonnelRecord[],
  rules?: ExamApplicationRecord[]
): CalculationResult<string> {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1) Single 부터 연속 취득한 최상위 단계 = 현재 PM Level
  let current: PmStage | "" = "";
  for (const stage of PM_STAGES) {
    if (stageAcquired(person, certifications, stage)) { reasons.push(`${stage} 인증 완료`); current = stage; }
    else break;
  }

  // 2) 다음 단계 요건 검증(exam_rules 기준). current="" 이면 다음 단계 = Single.
  const idx = current === "" ? -1 : PM_STAGES.indexOf(current);
  const next: PmStage | null = idx < PM_STAGES.length - 1 ? PM_STAGES[idx + 1] : null;
  let value: string = current || "미취득";

  if (next) {
    const req = extractPmRequirements(rules, next);
    const unmet: string[] = [];
    if (current) reasons.push(`이전 단계(${current}) 취득 확인`);
    if (req.requireEquipment && !hasEquipment(person, certifications)) unmet.push("필수 설비 조건");
    if (req.requireEducation && !truthyFlag(person.education_completed ?? (person as Record<string, unknown>)["교육이수"])) unmet.push("필수 교육");
    if (req.minTenureMonths > 0) {
      const t = tenureMonths(person.hire_date);
      if (t === null) unmet.push(`재직기간 확인 필요(${req.minTenureMonths}개월)`);
      else if (t < req.minTenureMonths) unmet.push(`재직기간 미충족(${t}/${req.minTenureMonths}개월)`);
    }
    if (unmet.length) {
      warnings.push(`${next} 승급 미충족: ${unmet.join(", ")}`);
    } else {
      reasons.push(`${next} 승급 요건 충족`);
      if (next === "Master") value = "Master 후보"; // M4 이후 Master 요건 충족 → 후보(승인 대기)
    }
  }

  return autoResult<string>(value, reasons, warnings);
}

// 수동 확정 PM Level 우선: 관리자가 확정한 값이 있으면 유지하고, 자동계산이 덮어쓰지 않는다.
//  - person.pm_level_manual === true 이면 person.current_pm_level 을 수동 확정값으로 사용.
//  - 그 외에는 manual 인자(있으면) → 자동계산 순으로 결정.
export function resolvePmLevel(
  person: ExamPersonnelRecord,
  certifications?: ExamPersonnelRecord[],
  rules?: ExamApplicationRecord[],
  manual?: { value: string; reasons?: string[] } | null
): CalculationResult<string> {
  if (person.pm_level_manual === true && asText(person.current_pm_level)) {
    return manualResult<string>(asText(person.current_pm_level), ["관리자 수동 확정 PM Level"]);
  }
  return resolveCalculation<string>(calculatePmLevel(person, certifications, rules), manual);
}

// ─────────────────────────────────────────────────────────────
// 조기 / 정상 / 지연 취득 자동판정
// ─────────────────────────────────────────────────────────────

export type AcquisitionTiming = "조기취득" | "정상취득" | "지연취득" | "지연 미취득" | "미취득(기간 내)" | "확인 필요";

// 두 날짜(YYYY-MM-DD) 사이 경과 개월(정수). 형식 오류 시 null.
function monthsBetween(from: string, to: string): number | null {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return m;
}

// 취득 시점 판정(공통). 기준 시작일(baseDate) + 기준 개월(targetMonths) 대비 취득일(acquisitionDate).
//  - 기준기간 이전(소요<기준) → 조기취득 / 기준기간 내(소요=기준) → 정상취득 / 기준기간 초과(소요>기준) → 지연취득
//  - 미취득 + 기준기간 초과 → 지연 미취득 / 미취득 + 기간 내 → 미취득(기간 내)
//  - 기준일/기준 개월 없음 → 확인 필요
export function calculateAcquisitionTiming(input: {
  baseDate?: unknown; acquisitionDate?: unknown; targetMonths?: unknown;
}): CalculationResult<AcquisitionTiming> {
  const base = toYmd(input.baseDate);
  const acq = toYmd(input.acquisitionDate);
  const target = Number(input.targetMonths);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!base) { warnings.push("기준 시작일이 없습니다"); return autoResult<AcquisitionTiming>("확인 필요", reasons, warnings); }
  if (!Number.isFinite(target) || target <= 0) { warnings.push("기준 개월 수(기준정보)가 없습니다"); return autoResult<AcquisitionTiming>("확인 필요", reasons, warnings); }

  if (acq) {
    const elapsed = monthsBetween(base, acq);
    if (elapsed === null) { warnings.push("날짜 형식 오류"); return autoResult<AcquisitionTiming>("확인 필요", reasons, warnings); }
    reasons.push(`기준 시작일 ${base} · 취득일 ${acq} · 소요 ${elapsed}개월 / 기준 ${target}개월`);
    if (elapsed < target) return autoResult<AcquisitionTiming>("조기취득", [...reasons, "기준기간 이전 취득"], warnings);
    if (elapsed === target) return autoResult<AcquisitionTiming>("정상취득", [...reasons, "기준기간 내 취득"], warnings);
    return autoResult<AcquisitionTiming>("지연취득", [...reasons, "기준기간 초과 취득"], warnings);
  }

  // 미취득
  const today = new Date().toISOString().slice(0, 10);
  const passed = monthsBetween(base, today);
  reasons.push(`기준 시작일 ${base} · 미취득 · 경과 ${passed ?? "?"}개월 / 기준 ${target}개월`);
  if (passed !== null && passed > target) return autoResult<AcquisitionTiming>("지연 미취득", [...reasons, "기준기간 초과 미취득"], warnings);
  return autoResult<AcquisitionTiming>("미취득(기간 내)", reasons, warnings);
}

// exam_rules 에서 취득 기준 개월 수를 읽는다(파트/공정/인증단계 매칭 우선, 없으면 일반 규칙). 없으면 null.
export function extractTimingMonths(
  rules?: ExamApplicationRecord[],
  keys?: { part?: string; process?: string; level?: string }
): number | null {
  if (!Array.isArray(rules)) return null;
  const timing = rules.filter((r) => /취득기준|기준개월|기준\s*기간|target_months|standard_months|month|개월/i.test(JSON.stringify(r ?? {})));
  const matchKey = (r: ExamApplicationRecord): number => {
    const s = JSON.stringify(r ?? {});
    let score = 0;
    for (const k of [keys?.part, keys?.process, keys?.level]) if (k && new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s)) score += 1;
    return score;
  };
  const ordered = [...timing].sort((a, b) => matchKey(b) - matchKey(a));
  for (const rule of ordered) {
    const bag: Record<string, unknown> = { ...(rule as Record<string, unknown>), ...((rule?.criteria as Record<string, unknown>) || {}) };
    const pick = (...ks: string[]) => { for (const k of ks) { if (bag[k] !== undefined && bag[k] !== null && bag[k] !== "") return bag[k]; } return undefined; };
    const m = Number(pick("target_months", "기준개월", "취득기준개월", "standard_months", "min_months", "months", "기준기간"));
    if (Number.isFinite(m) && m > 0) return m;
  }
  return null;
}

// 시험 응시 레코드 + exam_rules 로 취득 시점 판정. 기준 시작일은 우선순위대로 결정한다.
//  기준 시작일: ① 해당 단계 시작일 → ② 이전 단계 취득일 → ③ 입사일 → ④ 관리자 지정 기준일
//  취득일: 인증 취득일 → 실기 합격일
export function resolveAcquisitionTiming(
  record: ExamApplicationRecord,
  rules?: ExamApplicationRecord[],
  options?: { prevStageAcquiredDate?: unknown; hireDate?: unknown; adminBaseDate?: unknown; targetMonths?: number | null }
): CalculationResult<string> {
  const stageStart = record.stage_start_date ?? record.written_exam_date; // 해당 단계 시작일(필기 진행일 근사)
  const baseDate = [stageStart, options?.prevStageAcquiredDate, options?.hireDate ?? record.hire_date, options?.adminBaseDate ?? record.base_date]
    .map(toYmd).find((d) => d !== "") || "";
  const acquisitionDate = record.cert_acquired_date ?? record.practical_pass_date;
  const targetMonths = options?.targetMonths ?? extractTimingMonths(rules, {
    part: asText(record.process) || asText(record.part_name), process: asText(record.process), level: asText(record.level_id),
  });
  return calculateAcquisitionTiming({ baseDate, acquisitionDate, targetMonths }) as CalculationResult<string>;
}

// ─────────────────────────────────────────────────────────────
// D.M 자동계산 (공정 조합·필수 설비·필수 PM Level·유효/만료·제품군/파트 기준 반영)
// ─────────────────────────────────────────────────────────────

// D.M 단계 순서(도메인 단계값 — 요건/임계치는 exam_rules 기준).
export const DM_LEVELS = ["Single Job", "Multi Job 1", "Multi Job 2", "Multi Job 3", "Multi Job 4", "Dual Multi", "Master"] as const;
export type DmLevel = typeof DM_LEVELS[number];

const pickField = (bag: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (bag[k] !== undefined && bag[k] !== null && bag[k] !== "") return bag[k];
  return undefined;
};

// 단계별 D.M 요건(exam_rules 에서 추출).
type DmStageRule = { stage: DmLevel; minProcess: number; requiredPmLevel: string; requireEquipment: boolean; requireCombination: boolean; product: string; part: string };

// exam_rules 에서 D.M 단계별 기준을 추출(D.M/단계 관련 규칙만).
export function extractDmStageRules(rules?: ExamApplicationRecord[]): DmStageRule[] {
  if (!Array.isArray(rules)) return [];
  const out: DmStageRule[] = [];
  for (const r of rules) {
    const s = JSON.stringify(r ?? {});
    if (!/d\.?m|dual|multi|single\s*job|master/i.test(s)) continue;
    const stage = DM_LEVELS.find((st) => new RegExp(st.replace(/\s+/g, "\\s*"), "i").test(s));
    if (!stage) continue;
    const bag: Record<string, unknown> = { ...(r as Record<string, unknown>), ...((r?.criteria as Record<string, unknown>) || {}) };
    out.push({
      stage,
      minProcess: Number(pickField(bag, "min_process", "min_process_count", "process_count", "기준공정수", "공정수")) || 0,
      requiredPmLevel: asText(pickField(bag, "required_pm_level", "requiredPmLevel", "필수pm", "필수PM", "pm_level")),
      requireEquipment: truthyFlag(pickField(bag, "require_equipment", "필수설비", "equipment_required")),
      requireCombination: truthyFlag(pickField(bag, "require_combination", "공정조합", "combination_required")),
      product: asText(pickField(bag, "product_group", "제품군", "product")),
      part: asText(pickField(bag, "part_name", "파트", "part")),
    });
  }
  return out;
}

// 유효 공정 인증 수 계산(단순 개수 아님): 취득 완료 + (만료 확인 시)미만료인 서로 다른 공정만 집계.
function countValidProcessCerts(certifications?: ExamPersonnelRecord[]): { count: number; expiredExcluded: number } {
  if (!Array.isArray(certifications)) return { count: 0, expiredExcluded: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const set = new Set<string>();
  let expiredExcluded = 0;
  for (const c of certifications) {
    const acquired = asText(c.acquired_date) || asText(c.practical_pass_date) || asText(c.cert_acquired_date) || asText(c.cert_status) === "취득";
    if (!acquired) continue;
    const exp = toYmd(c.expiry_date);
    if (exp && exp < today) { expiredExcluded += 1; continue; } // 만료 인증 제외(유효 인증만)
    const proc = asText(c.process) || asText(c.dm_process) || asText(c.process_id) || asText(c.id);
    if (proc) set.add(proc);
  }
  return { count: set.size, expiredExcluded };
}

// PM Level 비교용 순서.
const PM_ORDER = ["single", "m1", "m2", "m3", "m4", "master"];
const pmRank = (v: string): number => { const s = v.toLowerCase().replace(/\s+/g, ""); return PM_ORDER.findIndex((k) => s.includes(k)); };

// D.M 자동계산(하드코딩 금지 — 단계 순서만 상수, 임계치/조건은 exam_rules 기준).
//  - 유효 공정 인증 수(만료 제외) + 단계별 요건(공정 수/조합/설비/PM Level/제품군·파트)을 검증.
//  - Single Job 부터 요건 충족한 최상위 단계를 D.M Level 로 본다. Dual Multi 충족·Master 후보 여부 포함.
//  - Master/Dual Multi 는 자동계산 후 관리자 승인 대기 구조(값은 후보로 표시).
export function calculateDmLevel(
  person: ExamPersonnelRecord,
  certifications?: ExamPersonnelRecord[],
  rules?: ExamApplicationRecord[]
): CalculationResult<string> {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const { count: validCount, expiredExcluded } = countValidProcessCerts(certifications);
  const declared = Number(person.process_count);
  const processCount = Math.max(validCount, Number.isFinite(declared) ? declared : 0);
  reasons.push(`유효 공정 인증 ${validCount}개`);
  if (Number.isFinite(declared) && declared > validCount) reasons.push(`신고 공정 수 ${declared}개`);
  if (expiredExcluded > 0) warnings.push(`만료 인증 ${expiredExcluded}개 제외`);

  const stageRules = extractDmStageRules(rules);
  if (stageRules.length === 0) {
    warnings.push("D.M 기준(exam_rules)이 등록되어 있지 않습니다");
    return autoResult<string>("확인 필요", reasons, warnings);
  }

  const curPm = asText(person.current_pm_level) || asText(person.pm_level);
  const pmOk = (required: string) => { if (!required) return true; return pmRank(curPm) >= pmRank(required) && pmRank(curPm) >= 0; };

  let current: DmLevel | "" = "";
  for (const stage of DM_LEVELS) {
    const rule = stageRules.find((r) => r.stage === stage);
    if (!rule) break; // 해당 단계 기준 미등록 → 더 진행 불가
    const unmet: string[] = [];
    if (rule.minProcess > 0 && processCount < rule.minProcess) unmet.push(`공정 수 ${processCount}/${rule.minProcess}`);
    if (rule.requireEquipment && !(Number(person.equipment_count) > 0)) unmet.push("필수 설비");
    if (rule.requireCombination && !asText(person.process_combination)) unmet.push("필수 공정 조합");
    if (rule.requiredPmLevel && !pmOk(rule.requiredPmLevel)) unmet.push(`필수 PM Level ${rule.requiredPmLevel}`);
    if (rule.product && asText(person.product_group) && rule.product !== asText(person.product_group)) unmet.push("제품군 조건");
    if (rule.part && asText(person.part_name) && rule.part !== asText(person.part_name)) unmet.push("파트 조건");
    if (unmet.length) { warnings.push(`${stage} 미충족: ${unmet.join(", ")}`); break; }
    reasons.push(`${stage} 기준 충족`);
    current = stage;
  }

  const dualMulti = current === "Dual Multi" || current === "Master" || person.dual_multi === true;
  if (dualMulti) reasons.push("Dual Multi 충족");

  let value: string = current || "확인 필요";
  // Master/Dual Multi 는 자동계산 후 관리자 승인 대기 → 후보로 표시(승인 시 확정은 resolveDmLevel 에서 유지).
  if (current === "Master") value = "Master 후보";
  if (!current) warnings.push("최소 단계(Single Job) 기준 미충족");

  return autoResult<string>(value, reasons, warnings);
}

// 수동/승인 확정값 우선: 관리자 승인(approval_status="승인") 또는 수동 확정(dm_level_manual)이 있으면 그 값을 유지하고,
//  자동계산이 덮어쓰지 않는다. (D.M / Dual Multi / Master 자동계산 후 관리자 승인 가능 구조 유지)
export function resolveDmLevel(
  person: ExamPersonnelRecord,
  certifications?: ExamPersonnelRecord[],
  rules?: ExamApplicationRecord[],
  manual?: { value: string; reasons?: string[] } | null
): CalculationResult<string> {
  if (asText(person.approval_status) === "승인") {
    const v = asText(person.dm_level) || asText(person.dm_stage);
    if (v) return manualResult<string>(v, ["관리자 승인 확정"]);
  }
  if (person.dm_level_manual === true && (asText(person.dm_level) || asText(person.dm_stage))) {
    return manualResult<string>(asText(person.dm_level) || asText(person.dm_stage), ["관리자 수동 확정"]);
  }
  return resolveCalculation<string>(calculateDmLevel(person, certifications, rules), manual);
}

// ─────────────────────────────────────────────────────────────
// 월간실적 자동집계 (해당 월 최종 인증 확정 건수)
// ─────────────────────────────────────────────────────────────

export type MonthlyPerfFilters = { group?: string; product?: string; part?: string; process?: string; level?: string };

// 삭제/취소/확정 판정.
const isDeletedRec = (r: ExamApplicationRecord): boolean => !!r.deleted_at || r.is_active === false || r.isDeleted === true;
const isCanceledRec = (r: ExamApplicationRecord): boolean => /취소/.test(asText(r.status));
// 최종 확정: 수동 확정 취득(exam_applications) 또는 승인 완료(dm_certifications). 자동계산 후보만 있는 건 제외.
const isConfirmedRec = (r: ExamApplicationRecord): boolean =>
  (r.cert_status_manual === true && asText(r.cert_status) === "취득") || asText(r.approval_status) === "승인";
// 인증 확정일(취득일).
const confirmDate = (r: ExamApplicationRecord): string => toYmd(r.cert_acquired_date ?? r.acquired_date ?? r.practical_pass_date);
// 중복 인증 식별 키(사원 + 단계/구분 + 확정일). 동일 인증은 1건으로.
const perfDedupKey = (r: ExamApplicationRecord): string =>
  [asText(r.employee_no), asText(r.level_id) || asText(r.dm_stage) || asText(r.category_code), confirmDate(r)].join("|");
const matchFilter = (val: unknown, f?: string): boolean => !f || f === "전체" || asText(val) === f;

// 특정 연/월의 최종 인증 확정 건수 자동집계(취소/삭제/미확정/중복 제외 + 필터).
export function calculateMonthlyPerformance(
  records: ExamApplicationRecord[],
  year: number | string,
  month: number | string,
  filters?: MonthlyPerfFilters
): CalculationResult<number> {
  const y = String(year);
  const mm = String(month).padStart(2, "0");
  const seen = new Set<string>();
  let count = 0;
  let excludedDup = 0;
  for (const r of Array.isArray(records) ? records : []) {
    if (isDeletedRec(r)) continue;      // 삭제 제외
    if (isCanceledRec(r)) continue;     // 취소 제외
    if (!isConfirmedRec(r)) continue;   // 수동 확정/승인만(자동 후보 제외)
    const d = confirmDate(r);
    if (!d || d.slice(0, 4) !== y || d.slice(5, 7) !== mm) continue; // 해당 월 확정만
    if (!matchFilter(r.group_name, filters?.group)) continue;
    if (!matchFilter(r.product ?? r.product_group, filters?.product)) continue;
    if (!matchFilter(r.part_name ?? r.part, filters?.part)) continue;
    if (!matchFilter(r.process ?? r.dm_process, filters?.process)) continue;
    if (!matchFilter(r.level_id ?? r.dm_stage, filters?.level)) continue;
    const k = perfDedupKey(r);
    if (seen.has(k)) { excludedDup += 1; continue; } // 중복 인증 제외
    seen.add(k);
    count += 1;
  }
  const reasons = [`${y}년 ${Number(mm)}월 최종 확정 인증 ${count}건`];
  const warnings = excludedDup > 0 ? [`중복 인증 ${excludedDup}건 제외`] : [];
  return autoResult<number>(count, reasons, warnings);
}

// 연도 전체(1~12월) 자동집계 + 누계.
export function calculateMonthlyPerformanceYear(
  records: ExamApplicationRecord[],
  year: number | string,
  filters?: MonthlyPerfFilters
): { months: number[]; total: number; results: CalculationResult<number>[] } {
  const results = Array.from({ length: 12 }, (_, i) => calculateMonthlyPerformance(records, year, i + 1, filters));
  const months = results.map((r) => r.value);
  return { months, total: months.reduce((a, b) => a + b, 0), results };
}

// 달성률(안전): 목표 0 이하 → 0%. NaN/Infinity 금지. 정수 반올림.
export function safePercent(actual: unknown, target: unknown): number {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const v = Math.round((Number(actual) / t) * 100);
  return Number.isFinite(v) ? v : 0;
}

// ─────────────────────────────────────────────────────────────
// 연간목표 실적/달성률 자동계산
// ─────────────────────────────────────────────────────────────

export type AnnualPerformance = { actual: number; target: number; rate: number; months: number[] };

// 연간 실적 = 선택 연도 1~12월 최종 인증 확정 건수 합계(월간집계와 동일 기준 → 합계 일치 보장).
//  달성률 = 실적/목표×100(목표 0 → 0%, NaN/Infinity 금지). target 은 연간목표(exam_annual_targets)의 합계를 전달.
export function calculateAnnualPerformance(
  records: ExamApplicationRecord[],
  year: number | string,
  opts?: { filters?: MonthlyPerfFilters; target?: number }
): CalculationResult<AnnualPerformance> {
  const { months, total } = calculateMonthlyPerformanceYear(records, year, opts?.filters);
  const target = Number(opts?.target) || 0;
  const rate = safePercent(total, target);
  const reasons = [`${year}년 실적 ${total}건 · 목표 ${target}건 · 달성률 ${rate}%`];
  const warnings = target <= 0 ? ["목표가 0이라 달성률은 0%로 처리"] : [];
  return autoResult<AnnualPerformance>({ actual: total, target, rate, months }, reasons, warnings);
}

// ─────────────────────────────────────────────────────────────
// 재시험 후보 자동생성(후보 도출 — 실제 시험회차 등록 아님)
// ─────────────────────────────────────────────────────────────

export type RetestReason = "필기 불합격" | "실기 불합격" | "시험 취소" | "기준기간 초과 미취득" | "인증 갱신 실패" | "인증 만료";

export type RetestCandidateSpec = {
  employee_no: string;
  name: string;
  level_id: string;      // 인증단계(exam_levels id 또는 D.M 단계 문자열)
  level_label: string;
  reason: RetestReason;
  occurred_date: string; // 발생일(YYYY-MM-DD)
  source_type: "exam_application" | "dm_certification";
  source_id: string;
};

// 동일 직원 + 동일 인증단계 + 동일 사유 → 1건(중복 후보 생성 방지 키).
export const retestDedupKey = (s: { employee_no: string; level_id: string; reason: string }): string =>
  `${s.employee_no}|${s.level_id}|${s.reason}`;

// 시험 응시/ D.M 인증 데이터에서 재시험 후보를 도출한다(순수 함수 — DB 기록/실제 신청 없음).
//  사유: 필기 불합격 / 실기 불합격 / 시험 취소 / 기준기간 초과 미취득 / 인증 갱신 실패 / 인증 만료
export function buildRetestCandidates(
  applications: ExamApplicationRecord[],
  dmCertifications: ExamApplicationRecord[],
  rules?: ExamApplicationRecord[],
  levelLabelOf?: (levelId: string) => string
): RetestCandidateSpec[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: RetestCandidateSpec[] = [];

  for (const a of Array.isArray(applications) ? applications : []) {
    if (isDeletedRec(a)) continue;
    const level_id = asText(a.level_id);
    const base = {
      employee_no: asText(a.employee_no), name: asText(a.name),
      level_id, level_label: levelLabelOf ? levelLabelOf(level_id) : level_id,
      source_type: "exam_application" as const, source_id: asText(a.id),
    };
    const st = asText(a.status);
    if (/필기.*불합격/.test(st)) out.push({ ...base, reason: "필기 불합격", occurred_date: toYmd(a.written_pass_date) || today });
    else if (/실기.*불합격/.test(st)) out.push({ ...base, reason: "실기 불합격", occurred_date: toYmd(a.practical_pass_date) || today });
    else if (/취소/.test(st)) out.push({ ...base, reason: "시험 취소", occurred_date: today });
    else if (resolveAcquisitionTiming(a, rules).value === "지연 미취득") out.push({ ...base, reason: "기준기간 초과 미취득", occurred_date: today });
  }

  for (const c of Array.isArray(dmCertifications) ? dmCertifications : []) {
    if (isDeletedRec(c)) continue;
    const exp = toYmd(c.expiry_date);
    if (!exp || exp >= today) continue; // 미만료 제외
    const level_id = asText(c.dm_stage);
    const base = {
      employee_no: asText(c.employee_no), name: asText(c.name),
      level_id, level_label: asText(c.dm_level) || level_id,
      source_type: "dm_certification" as const, source_id: asText(c.id),
    };
    if (toYmd(c.renewal_date)) out.push({ ...base, reason: "인증 갱신 실패", occurred_date: exp });
    else out.push({ ...base, reason: "인증 만료", occurred_date: exp });
  }

  // 중복 후보 제거(동일 직원+단계+사유는 1건).
  const seen = new Set<string>();
  return out.filter((s) => { const k = retestDedupKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ─────────────────────────────────────────────────────────────
// 응시 후보 자동계산(인력현황 + 인증 기준 → 후보 도출 · 순수 함수 · 실제 등록 아님)
// ─────────────────────────────────────────────────────────────

export type ExamCandidate = {
  employee_no: string; name: string; group_name: string; product: string; process: string;
  current_level: string; target_level: string;
  employed: boolean; belowTarget: boolean; prereqMet: boolean; notInProgress: boolean;
  retestOk: boolean; retestAvailableDate: string | null; needEquipment: boolean;
  eligible: boolean; blockedReasons: string[];
};

// 재직 판정(값 없으면 통과, 있으면 "재직" 포함만).
const candIsEmployed = (v: unknown): boolean => { const s = asText(v); return s === "" || /재직/.test(s); };
// 진행 중 상태(취소/불합격/인증취득은 진행중 아님).
const candInProgress = (status: string): boolean => /예정|진행|합격|승인|대기|후보|연기/.test(status) && !/불합격|취소|인증\s*취득/.test(status);
// 응시행이 목표 단계(Single/M1~/Master)에 해당하는지 — pm_level 텍스트/구분 기준(느슨).
const candMatchesLevel = (a: ExamApplicationRecord, level: string): boolean => {
  const bag = `${asText(a.pm_level)} ${asText(a.category)} ${asText(a.category_code)} ${asText(a.level_id)}`;
  return new RegExp(`(^|[^a-z0-9])${level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(bag);
};
// exam_rules 에서 재시험 제한기간(개월) 추출. 없으면 null.
function extractRetestGapMonths(rules?: ExamApplicationRecord[]): number | null {
  if (!Array.isArray(rules)) return null;
  for (const r of rules) {
    const bag = JSON.stringify({ ...(r as Record<string, unknown>), ...((r?.criteria as Record<string, unknown>) || {}) });
    if (!/재시험|retest/i.test(bag)) continue;
    const m = bag.match(/(\d+)\s*개월/); if (m) return Number(m[1]);
    const n = Number(pickField({ ...(r as Record<string, unknown>) }, "retest_gap_months", "retest_months", "재시험제한개월"));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// 인력현황(personnel) × 인증 기준(rules) × 기존 응시(applications) → 응시 후보.
//  조건: 재직 · 해당 공정 소속 · 목표 인증레벨 미달 · 선행 인증 충족 · 재시험 제한기간 경과 ·
//        동일 시험 진행중 아님 · (설비 필요 여부 표기) · (공정 권한은 호출부에서 필터)
export function buildExamCandidates(
  personnel: ExamPersonnelRecord[],
  applications: ExamApplicationRecord[],
  rules?: ExamApplicationRecord[],
  opts?: { retestGapMonths?: number }
): ExamCandidate[] {
  const today = new Date().toISOString().slice(0, 10);
  const gap = opts?.retestGapMonths ?? extractRetestGapMonths(rules) ?? 3;
  const apps = (Array.isArray(applications) ? applications : []).filter((a) => !isDeletedRec(a));
  const out: ExamCandidate[] = [];

  for (const p of Array.isArray(personnel) ? personnel : []) {
    if (isDeletedRec(p)) continue;
    const employed = candIsEmployed((p as Record<string, unknown>).employment_status ?? p.status);
    // 현재 단계 = Single 부터 연속 취득한 최상위, 목표 = 다음 단계.
    let curIdx = -1;
    for (let i = 0; i < 5; i++) { if (stageAcquired(p, undefined, PM_STAGES[i])) curIdx = i; else break; }
    const targetIdx = curIdx + 1;
    if (targetIdx >= PM_STAGES.length) continue;               // Master 이상 → 후보 아님(목표 미달 아님)
    const current_level = curIdx < 0 ? "미취득" : PM_STAGES[curIdx];
    const target_level = PM_STAGES[targetIdx];

    const empNo = asText(p.employee_no);
    const process = asText(p.part_name) || asText(p.process);
    const notInProgress = !apps.some((a) => asText(a.employee_no) === empNo && candMatchesLevel(a, target_level) && candInProgress(asText(a.status)));

    // 재시험: 동일 사번+목표단계 최근 불합격/취소 → 가능일 = 발생 + gap개월
    let retestAvailableDate: string | null = null; let retestOk = true;
    const fails = apps.filter((a) => asText(a.employee_no) === empNo && candMatchesLevel(a, target_level) && /불합격|취소/.test(asText(a.status)));
    if (fails.length) {
      const last = fails.map((a) => toYmd(a.practical_pass_date) || toYmd(a.written_pass_date) || toYmd(a.updated_at) || today).sort().pop() || today;
      retestAvailableDate = addMonthsYmd(last, gap);
      retestOk = today >= retestAvailableDate;
    }
    const prereqMet = curIdx === targetIdx - 1;                // 연속 취득 → 선행 충족
    const req = extractPmRequirements(rules, target_level);
    const needEquipment = !!req.requireEquipment;

    const blockedReasons: string[] = [];
    if (!employed) blockedReasons.push("재직자 아님");
    if (!process) blockedReasons.push("공정 정보 없음");
    if (!prereqMet) blockedReasons.push("선행 인증 미충족");
    if (!notInProgress) blockedReasons.push("동일 시험 진행 중");
    if (!retestOk) blockedReasons.push(`재시험 제한(${retestAvailableDate} 이후)`);

    const eligible = employed && !!process && prereqMet && notInProgress && retestOk;
    out.push({
      employee_no: empNo, name: asText(p.name), group_name: asText(p.group_name),
      product: asText(p.product_group) || asText(p.product), process,
      current_level, target_level, employed, belowTarget: true, prereqMet, notInProgress,
      retestOk, retestAvailableDate, needEquipment, eligible, blockedReasons,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// D.M 인증 후보 자동계산(승인된 PM 인증 → 공정 조합 집계 · PM 원본 미수정 · 순수 함수)
// ─────────────────────────────────────────────────────────────

export type DmCandidate = {
  employee_no: string; name: string; personnel_id: string | null;
  process_count: number; equipment_count: number; process_combination: string;
  single_job: boolean; dual_multi: boolean; master_candidate: boolean;
  dm_stage: string; dm_level: string; acquirable: boolean;
  currentStageIdx: number; targetStageIdx: number;
};

// 인증 공정 수 → D.M 단계 인덱스. 규칙(exam_rules)에 임계치가 있으면 우선, 없으면 기본 사다리.
//  기본: 1→Single Job, 2→Multi Job 1, 3→Multi Job 2, 4→Multi Job 3, 5→Multi Job 4, 6+→Dual Multi.
//  Master 는 자동 확정하지 않고 "후보"로만 표기(관리자 승인 필요).
function dmStageIdxForCount(count: number, rules?: ExamApplicationRecord[]): number {
  // 규칙 기반 임계치(있으면): {threshold/min_process, result_level/dm_level} 매칭.
  if (Array.isArray(rules)) {
    let best: { th: number; idx: number } | null = null;
    for (const r of rules) {
      const bag: Record<string, unknown> = { ...(r as Record<string, unknown>), ...((r?.criteria as Record<string, unknown>) || {}) };
      const th = Number(pickField(bag, "threshold", "min_process", "process_count", "min_value"));
      const label = asText(pickField(bag, "result_level", "dm_level", "level", "name", "code"));
      const idx = DM_LEVELS.findIndex((s) => label && s.toLowerCase() === label.toLowerCase());
      if (Number.isFinite(th) && th <= count && idx >= 0 && (!best || th > best.th)) best = { th, idx };
    }
    if (best) return best.idx;
  }
  if (count <= 0) return -1;
  return Math.min(count - 1, DM_LEVELS.indexOf("Dual Multi")); // 1→0(Single Job) … 6+→Dual Multi
}

// 승인된 PM 인증(pmCerts)을 사번별로 집계해 D.M 후보를 도출. existingDm 로 이미 보유한 단계는 초과분만 후보.
export function buildDmCandidates(
  pmCerts: ExamApplicationRecord[],
  personnel: ExamPersonnelRecord[],
  rules?: ExamApplicationRecord[],
  existingDm?: ExamApplicationRecord[],
  labelOf?: { process?: (r: ExamApplicationRecord) => string; equipment?: (r: ExamApplicationRecord) => string }
): DmCandidate[] {
  const dmRules = Array.isArray(rules) ? rules.filter((r) => /d\.?m|dual|multi|single\s*job|master/i.test(JSON.stringify(r ?? {}))) : [];
  const pById = new Map<string, ExamPersonnelRecord>();
  (Array.isArray(personnel) ? personnel : []).forEach((p) => pById.set(asText(p.employee_no), p));

  // 사번별 승인·활성 PM 인증 그룹.
  const byEmp = new Map<string, ExamApplicationRecord[]>();
  for (const c of Array.isArray(pmCerts) ? pmCerts : []) {
    if (isDeletedRec(c)) continue;
    if (asText(c.approval_status) !== "승인" || c.is_active === false) continue; // 승인 확정분만(미승인 집계 금지)
    const e = asText(c.employee_no); if (!e) continue;
    (byEmp.get(e) || byEmp.set(e, []).get(e)!).push(c);
  }

  // 사번별 기존 D.M 최고 단계 인덱스(반려/취소 제외).
  const curIdxByEmp = new Map<string, number>();
  for (const d of Array.isArray(existingDm) ? existingDm : []) {
    if (isDeletedRec(d) || d.is_active === false || asText(d.approval_status) === "반려") continue;
    const e = asText(d.employee_no); const idx = DM_LEVELS.indexOf(asText(d.dm_stage) as (typeof DM_LEVELS)[number]);
    if (e && idx >= 0) curIdxByEmp.set(e, Math.max(curIdxByEmp.get(e) ?? -1, idx));
  }

  const out: DmCandidate[] = [];
  for (const [emp, certs] of byEmp) {
    const procs = Array.from(new Set(certs.map((c) => (labelOf?.process ? labelOf.process(c) : asText(c.process) || asText(c.part_name))).filter(Boolean)));
    const equips = Array.from(new Set(certs.map((c) => (labelOf?.equipment ? labelOf.equipment(c) : asText(c.equipment_id) || asText(c.equipment_label))).filter(Boolean)));
    const process_count = procs.length;
    const equipment_count = equips.length;
    const targetStageIdx = dmStageIdxForCount(process_count, dmRules);
    if (targetStageIdx < 0) continue;
    const currentStageIdx = curIdxByEmp.get(emp) ?? -1;
    const person = pById.get(emp);
    const dualIdx = DM_LEVELS.indexOf("Dual Multi");
    const dm_stage = DM_LEVELS[targetStageIdx];
    out.push({
      employee_no: emp, name: asText(certs[0].name) || asText(person?.name), personnel_id: asText(person?.id) || null,
      process_count, equipment_count, process_combination: procs.join(" + "),
      single_job: process_count >= 1,
      dual_multi: targetStageIdx >= dualIdx,
      master_candidate: targetStageIdx >= dualIdx && process_count >= (DM_LEVELS.length), // Dual Multi 이상 + 충분한 공정 → Master 후보(승인 필요)
      dm_stage, dm_level: dm_stage, acquirable: process_count >= 1,
      currentStageIdx, targetStageIdx,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 인증 만료 및 갱신 자동계산
// ─────────────────────────────────────────────────────────────

// 상태값: 정상 / 만료 90일 전 / 만료 30일 전 / 만료예정 / 만료 / 갱신완료
export type CertExpiryStatus = "정상" | "만료 90일 전" | "만료 30일 전" | "만료예정" | "만료" | "갱신완료";
export type CertExpiryResult = {
  status: CertExpiryStatus;
  expiryDate: string;        // 만료일(YYYY-MM-DD)
  remainingDays: number | null; // 남은 일수(만료일 없으면 null)
  needRenewal: boolean;      // 갱신 필요 여부
  isExpiringSoon: boolean;   // 만료예정(기존 프로젝트 30일 기준 재사용)
};

// 만료예정 기준(기존 프로젝트 계약 만료예정과 동일한 30일 기준 재사용).
const EXPIRING_SOON_DAYS = 30;

// 날짜에 개월 더하기.
function addMonthsYmd(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// exam_rules 에서 인증 유효기간(개월)을 읽는다(인증/유효 관련 규칙, 파트/공정/레벨 매칭 우선). 없으면 null.
export function extractCertValidityMonths(
  rules?: ExamApplicationRecord[],
  keys?: { part?: string; process?: string; level?: string }
): number | null {
  if (!Array.isArray(rules)) return null;
  const relevant = rules.filter((r) => /유효기간|유효개월|valid|expiry|만료|month|개월/i.test(JSON.stringify(r ?? {})));
  const score = (r: ExamApplicationRecord): number => {
    const s = JSON.stringify(r ?? {}); let n = 0;
    for (const k of [keys?.part, keys?.process, keys?.level]) if (k && new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s)) n += 1;
    return n;
  };
  for (const rule of [...relevant].sort((a, b) => score(b) - score(a))) {
    const bag: Record<string, unknown> = { ...(rule as Record<string, unknown>), ...((rule?.criteria as Record<string, unknown>) || {}) };
    const m = Number(pickField(bag, "valid_months", "validity_months", "유효기간", "유효개월", "expiry_months", "cert_valid_months"));
    if (Number.isFinite(m) && m > 0) return m;
  }
  return null;
}

// 인증 만료/갱신 자동계산. 취득일 + 유효기간(exam_rules)으로 만료일 계산, 저장된 만료일이 있으면 우선.
//  상태: 만료(경과) / 갱신완료(갱신일 존재 + 유효) / 만료 30일 전(≤30) / 만료 90일 전(≤90) / 정상(>90).
//  isExpiringSoon = 만료예정(기존 프로젝트 30일 기준).
export function calculateCertExpiry(
  record: ExamApplicationRecord,
  rules?: ExamApplicationRecord[]
): CalculationResult<CertExpiryResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const acquired = toYmd(record.acquired_date ?? record.cert_acquired_date ?? record.practical_pass_date);

  let expiry = toYmd(record.expiry_date);
  if (!expiry && acquired) {
    const validMonths = extractCertValidityMonths(rules, {
      part: asText(record.part_name) || asText(record.process), process: asText(record.process) || asText(record.dm_process), level: asText(record.level_id) || asText(record.dm_stage),
    });
    if (validMonths) { expiry = addMonthsYmd(acquired, validMonths); reasons.push(`취득일 ${acquired} + 유효기간 ${validMonths}개월 → 만료일 ${expiry}`); }
  } else if (expiry) reasons.push(`만료일 ${expiry}`);

  if (!expiry) {
    warnings.push("만료일/유효기간(exam_rules) 정보가 없습니다");
    return autoResult<CertExpiryResult>({ status: "정상", expiryDate: "", remainingDays: null, needRenewal: false, isExpiringSoon: false }, reasons, warnings);
  }

  const remaining = Math.floor((new Date(expiry).getTime() - new Date(today).getTime()) / 86400000);
  const renewed = !!toYmd(record.renewal_date);
  const isExpiringSoon = remaining >= 0 && remaining <= EXPIRING_SOON_DAYS;

  let status: CertExpiryStatus;
  if (remaining < 0) status = "만료";
  else if (renewed) status = "갱신완료";
  else if (remaining <= 30) status = "만료 30일 전";
  else if (remaining <= 90) status = "만료 90일 전";
  else status = "정상";

  const needRenewal = status === "만료" || status === "만료 30일 전";
  reasons.push(`남은 ${remaining}일 · ${status}`);
  return autoResult<CertExpiryResult>({ status, expiryDate: expiry, remainingDays: remaining, needRenewal, isExpiringSoon }, reasons, warnings);
}

// 인증 목록의 만료 상태별 건수 요약(대시보드용).
export function summarizeCertExpiry(records: ExamApplicationRecord[], rules?: ExamApplicationRecord[]): Record<CertExpiryStatus, number> {
  const acc: Record<CertExpiryStatus, number> = { "정상": 0, "만료 90일 전": 0, "만료 30일 전": 0, "만료예정": 0, "만료": 0, "갱신완료": 0 };
  for (const r of Array.isArray(records) ? records : []) {
    if (isDeletedRec(r)) continue;
    const st = calculateCertExpiry(r, rules).value.status;
    acc[st] = (acc[st] || 0) + 1;
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────
// 시험관리 앱 내 알림(파생 · 중복 방지 · 클릭 시 상세 이동)
// ─────────────────────────────────────────────────────────────

export type ExamNotificationType =
  | "시험 30일 전" | "시험 7일 전" | "시험 전일" | "결과 미입력" | "불합격" | "재시험 필요"
  | "인증 승인 대기" | "인증 만료 90일 전" | "인증 만료 30일 전" | "목표 미달" | "Excel 오류" | "중복 데이터" | "기준정보 미매핑";

export type ExamNotificationSeverity = "info" | "warn" | "error";
export type ExamNotification = {
  key: string;                 // 중복 방지 키(동일 이벤트 1건)
  type: ExamNotificationType;
  severity: ExamNotificationSeverity;
  message: string;
  targetTab: string;           // 클릭 시 이동할 시험관리 탭
  occurredAt: string;          // 관련 일자(YYYY-MM-DD)
};

const NOTI_SEVERITY: Record<ExamNotificationType, ExamNotificationSeverity> = {
  "시험 30일 전": "info", "시험 7일 전": "warn", "시험 전일": "warn", "결과 미입력": "error",
  "불합격": "error", "재시험 필요": "warn", "인증 승인 대기": "warn", "인증 만료 90일 전": "warn",
  "인증 만료 30일 전": "error", "목표 미달": "warn", "Excel 오류": "error", "중복 데이터": "warn", "기준정보 미매핑": "warn",
};

// 시험관리 데이터에서 앱 내 알림을 생성한다(순수 함수). 동일 이벤트 중복 알림은 생성하지 않는다(key 기준).
export function buildExamNotifications(input: {
  applications?: ExamApplicationRecord[];
  dmCertifications?: ExamApplicationRecord[];
  annualTargets?: ExamApplicationRecord[];
  retestCandidates?: ExamApplicationRecord[];
  importErrors?: ExamApplicationRecord[];
  rules?: ExamApplicationRecord[];
}): ExamNotification[] {
  const out: ExamNotification[] = [];
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  const daysUntil = (d: string) => Math.floor((new Date(d).getTime() - new Date(today).getTime()) / 86400000);
  const push = (type: ExamNotificationType, key: string, message: string, targetTab: string, occurredAt: string) => {
    if (seen.has(key)) return; // 중복 방지
    seen.add(key);
    out.push({ key, type, severity: NOTI_SEVERITY[type], message, targetTab, occurredAt });
  };

  for (const a of input.applications || []) {
    if (isDeletedRec(a)) continue;
    const id = asText(a.id);
    const who = `${asText(a.name) || asText(a.employee_no)}`;
    const exam = toYmd(a.written_exam_date);
    if (exam) {
      const dd = daysUntil(exam);
      if (dd === 30) push("시험 30일 전", `exam30|${id}`, `${who} 시험 30일 전 (${exam})`, "examApplications", exam);
      else if (dd === 7) push("시험 7일 전", `exam7|${id}`, `${who} 시험 7일 전 (${exam})`, "examApplications", exam);
      else if (dd === 1) push("시험 전일", `exam1|${id}`, `${who} 시험 전일 (${exam})`, "examApplications", exam);
      if (dd < 0 && ["예정", "필기 진행", ""].includes(asText(a.status)) && !toYmd(a.written_pass_date) && !toYmd(a.practical_pass_date)) {
        push("결과 미입력", `noresult|${id}`, `${who} 시험 결과 미입력 (${exam})`, "examApplications", exam);
      }
    }
    if (/불합격/.test(asText(a.status))) push("불합격", `fail|${id}`, `${who} ${asText(a.status)}`, "examApplications", today);
    if (!asText(a.level_id)) push("기준정보 미매핑", `unmapped|${id}`, `${who} 인증단계(기준정보) 미지정`, "examApplications", today);
  }

  // 중복 데이터: 동일 사원번호 + 구분코드 2건 이상.
  const dup = new Map<string, number>();
  (input.applications || []).filter((a) => !isDeletedRec(a) && asText(a.category_code)).forEach((a) => {
    const k = `${asText(a.employee_no)}|${asText(a.category_code)}`; dup.set(k, (dup.get(k) || 0) + 1);
  });
  dup.forEach((cnt, k) => { if (cnt > 1) push("중복 데이터", `dup|${k}`, `중복 응시 데이터 ${cnt}건 (${k})`, "examApplications", today); });

  for (const c of input.dmCertifications || []) {
    if (isDeletedRec(c)) continue;
    const id = asText(c.id);
    const who = `${asText(c.name) || asText(c.employee_no)} ${asText(c.dm_stage)}`;
    if (["대기", ""].includes(asText(c.approval_status))) push("인증 승인 대기", `approve|${id}`, `${who} 인증 승인 대기`, "examDmCertifications", today);
    const ex = calculateCertExpiry(c, input.rules).value;
    if (ex.status === "만료 90일 전") push("인증 만료 90일 전", `exp90|${id}`, `${who} 만료 ${ex.remainingDays}일 전 (${ex.expiryDate})`, "examDmCertifications", ex.expiryDate);
    if (ex.status === "만료 30일 전") push("인증 만료 30일 전", `exp30|${id}`, `${who} 만료 ${ex.remainingDays}일 전 (${ex.expiryDate})`, "examDmCertifications", ex.expiryDate);
  }

  for (const r of input.retestCandidates || []) {
    if (asText(r.status) === "후보") push("재시험 필요", `retest|${asText(r.id)}`, `${asText(r.name)} 재시험 필요 (${asText(r.reason)})`, "examDashboard", asText(r.occurred_date) || today);
  }

  for (const t of input.annualTargets || []) {
    if (isDeletedRec(t)) continue;
    const cur = Number(t.current_count) || 0, tgt = Number(t.target_count) || 0;
    if (tgt > 0 && cur < tgt) push("목표 미달", `target|${asText(t.id)}`, `${asText(t.year)} ${asText(t.group_name)} ${asText(t.part_name)} 목표 미달 (${cur}/${tgt})`, "examAnnualTargets", today);
  }

  for (const e of input.importErrors || []) {
    push("Excel 오류", `xlerr|${asText(e.id)}`, `Excel 오류: ${asText(e.message)}${e.row_no ? ` (${asText(e.row_no)}행)` : ""}`, "examExcelImport", today);
  }

  // 최신(관련일 늦은) 순.
  return out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ─────────────────────────────────────────────────────────────
// 관리자 재계산 / 검증 (파생 계산 재실행 — 대상별 결과 요약)
// ─────────────────────────────────────────────────────────────

export type RecalcScope =
  | { kind: "employee"; employeeNo: string }
  | { kind: "part"; part: string }
  | { kind: "month"; year: string | number; month: string | number }
  | { kind: "all" }
  | { kind: "errorsOnly" };

export type RecalcItemStatus = "성공" | "실패" | "확인 필요";
export type RecalcResult = {
  scopeLabel: string;
  total: number; success: number; failed: number; needCheck: number;
  ranAt: string; ranBy: string;
  items: Array<{ ref: string; kind: "응시" | "D.M 인증"; status: RecalcItemStatus; detail: string }>;
};

type RecalcRecord = { rec: ExamApplicationRecord; kind: "application" | "cert" };

// 레코드 1건 재계산/검증. 계산 예외 → 실패, 값 "확인 필요"/데이터 부족 → 확인 필요, 그 외 성공.
function validateRecalcRecord(x: RecalcRecord, rules?: ExamApplicationRecord[]): { status: RecalcItemStatus; detail: string } {
  try {
    if (x.kind === "application") {
      const es = calculateExamStatus(x.rec);
      const cs = calculateCertificationStatus(x.rec, rules);
      const tm = resolveAcquisitionTiming(x.rec, rules);
      const need = cs.value === "확인 필요" || tm.value === "확인 필요";
      return { status: need ? "확인 필요" : "성공", detail: `상태 ${es.value} · 인증 ${cs.value} · 시점 ${tm.value}` };
    }
    const dm = calculateDmLevel(x.rec, [], rules);
    const ex = calculateCertExpiry(x.rec, rules);
    const need = dm.value === "확인 필요";
    return { status: need ? "확인 필요" : "성공", detail: `D.M ${dm.value} · 만료 ${ex.value.status}` };
  } catch (e) {
    return { status: "실패", detail: (e as { message?: string })?.message || "계산 오류" };
  }
}

const recalcRef = (r: ExamApplicationRecord, kind: "application" | "cert"): string => {
  const who = `${asText(r.name) || asText(r.employee_no)}`;
  const lv = kind === "cert" ? asText(r.dm_stage) : asText(r.category_code);
  return [who, lv].filter(Boolean).join(" · ") || asText(r.id);
};

// 대상별 재계산 실행(파생 계산 검증). DB를 재저장하지 않으며 결과 요약만 반환한다.
export function runRecalculation(
  data: { applications?: ExamApplicationRecord[]; dmCertifications?: ExamApplicationRecord[]; rules?: ExamApplicationRecord[] },
  scope: RecalcScope,
  opts: { ranBy: string }
): RecalcResult {
  const rules = data.rules;
  const apps: RecalcRecord[] = (data.applications || []).filter((r) => !isDeletedRec(r)).map((r) => ({ rec: r, kind: "application" }));
  const certs: RecalcRecord[] = (data.dmCertifications || []).filter((r) => !isDeletedRec(r)).map((r) => ({ rec: r, kind: "cert" }));
  let pool: RecalcRecord[] = [...apps, ...certs];
  let scopeLabel = "전체 검증";

  if (scope.kind === "employee") {
    pool = pool.filter((x) => asText(x.rec.employee_no) === scope.employeeNo);
    scopeLabel = `직원 재계산 (${scope.employeeNo})`;
  } else if (scope.kind === "part") {
    const p = scope.part;
    pool = pool.filter((x) => asText(x.rec.part_name) === p || asText(x.rec.process) === p || asText(x.rec.dm_process) === p);
    scopeLabel = `파트/공정 재계산 (${p})`;
  } else if (scope.kind === "month") {
    const y = String(scope.year), mm = String(scope.month).padStart(2, "0");
    pool = pool.filter((x) => { const d = confirmDate(x.rec); return d.slice(0, 4) === y && d.slice(5, 7) === mm; });
    scopeLabel = `${y}년 ${Number(mm)}월 실적 재계산`;
  } else if (scope.kind === "errorsOnly") {
    scopeLabel = "오류 항목 재처리";
  }

  let items = pool.map((x) => { const v = validateRecalcRecord(x, rules); return { ref: recalcRef(x.rec, x.kind), kind: (x.kind === "cert" ? "D.M 인증" : "응시") as "응시" | "D.M 인증", status: v.status, detail: v.detail }; });
  if (scope.kind === "errorsOnly") items = items.filter((i) => i.status !== "성공");

  return {
    scopeLabel,
    total: items.length,
    success: items.filter((i) => i.status === "성공").length,
    failed: items.filter((i) => i.status === "실패").length,
    needCheck: items.filter((i) => i.status === "확인 필요").length,
    ranAt: new Date().toISOString(),
    ranBy: opts.ranBy || "관리자",
    items,
  };
}

// 계산 입력 컨텍스트(직원/응시/기준정보 등). 실제 필드는 각 계산 구현 시 확정.
export type ExamAutomationContext = RuleContext;

// 관리자 수동 확정값(있으면 자동계산보다 우선). 없으면 undefined.
export type ManualOverride<T> = { value: T; reasons?: string[] } | null | undefined;

// 규칙 엔진 인스턴스(현재 규칙 미등록 골격). 향후 exam_rules 로딩 시 register 로 규칙 주입.
const pmLevelEngine: RuleEngine<string> = createRuleEngine<string>();
const dmLevelEngine: RuleEngine<string> = createRuleEngine<string>();
const achievementEngine: RuleEngine<number> = createRuleEngine<number>();

export const examAutomationService = {
  // PM Level 자동계산(미구현 — 빈 자동계산 결과). manual 확정값이 있으면 그 값 유지.
  calculatePmLevel(ctx: ExamAutomationContext, manual?: ManualOverride<string>): CalculationResult<string> {
    return resolveCalculation(pmLevelEngine.run(ctx, ""), manual);
  },

  // D.M Level 자동계산(미구현 — 빈 자동계산 결과). manual 확정값이 있으면 그 값 유지.
  calculateDmLevel(ctx: ExamAutomationContext, manual?: ManualOverride<string>): CalculationResult<string> {
    return resolveCalculation(dmLevelEngine.run(ctx, ""), manual);
  },

  // 목표 대비 달성률 자동계산(미구현 — 빈 자동계산 결과). manual 확정값이 있으면 그 값 유지.
  calculateAchievementRate(ctx: ExamAutomationContext, manual?: ManualOverride<number>): CalculationResult<number> {
    return resolveCalculation(achievementEngine.run(ctx, 0), manual);
  },

  // 인증 취득 여부 자동계산(미구현 — 빈 자동계산 결과).
  calculateCertificationAcquired(_ctx: ExamAutomationContext, manual?: ManualOverride<boolean>): CalculationResult<boolean> {
    void _ctx;
    return resolveCalculation(emptyResult<boolean>(false), manual);
  },
};

export type ExamAutomationService = typeof examAutomationService;
