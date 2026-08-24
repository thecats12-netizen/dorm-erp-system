// 공용 현재 인증 Level 계산 서비스 — 순수 함수(DB 호출 0). 응시관리 B 정책과 동일:
//   currentLevelIdx = max( 확정 exam_applications 취득, 유효 pm_certifications 승인, personnel legacy flag )
//  · 단계 순서/rank 는 selectPmStageLevels(levels)(rank_order canonical) · 코드/이름 하드코딩 없음.
//  · exam_applications 취득 판정은 canonical isAcquiredApplication 재사용(불합격/취소/미취득/진행중/삭제 제외).
//  · 공정 scope: application/pm 모두 process_id === personnel.process_id 일치만(타 공정 혼입 금지).
import type { ExamRow } from "./examMasterService";
import { selectPmStageLevels } from "../utils/certificationLevel";
import { isAcquiredApplication } from "./employeeAutofillService";

const S = (v: unknown): string => String(v ?? "").trim();
// personnel legacy flag(examAutomationService.stageAcquired 와 동일한 truthy 규칙).
const flagOn = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = S(v).toLowerCase();
  return !!s && !["0", "false", "n", "no", "x", "-", "없음", "미이수", "불필요"].includes(s);
};
// PM 단계 위치별 personnel flag 컬럼(Single=single_job, M1~M4=m1~m4). selectPmStageLevels 순서와 1:1 positional.
const FLAG_FIELDS = ["single_job", "m1", "m2", "m3", "m4"] as const;

export type CurrentLevelSource = "application" | "pm_certification" | "personnel_flag";
export type CurrentLevelResult = {
  currentLevelId: string | null;
  currentLevelIndex: number;   // -1 = 없음
  currentLevelName: string;    // "-" = 없음
  sources: CurrentLevelSource[]; // 최고 rank 에 도달한 source(동일 rank 복수 가능)
};

const NONE: CurrentLevelResult = { currentLevelId: null, currentLevelIndex: -1, currentLevelName: "-", sources: [] };

export function computeCurrentLevelByPersonnel(input: {
  personnel: ExamRow[];
  levels: ExamRow[];
  applications: ExamRow[];       // exam_applications
  pmCertifications: ExamRow[];   // pm_certifications
}): Map<string, CurrentLevelResult> {
  const { personnel, levels, applications, pmCertifications } = input;
  const out = new Map<string, CurrentLevelResult>();

  const pmStages = selectPmStageLevels(levels);              // Single..M4 (rank_order)
  const stageIds = pmStages.map((r) => S(r.id));
  const stageNames = pmStages.map((r) => S(r.name) || S(r.code));
  const idxByLevelId = new Map<string, number>(stageIds.map((id, i) => [id, i]));
  const today = new Date().toISOString().slice(0, 10);

  const personById = new Map(personnel.map((p) => [S(p.id), p]));
  const personByEmpNo = new Map(personnel.map((p) => [S(p.employee_no), p]));

  // ── pm_certifications: 승인·활성·미삭제·미만료 · 공정 일치 → `${pid}|${proc}` 최고 idx ──
  const pmIdxByPerson = new Map<string, number>();
  for (const c of pmCertifications) {
    if (S(c.approval_status) !== "승인" || (c as { is_active?: unknown }).is_active === false || c.deleted_at) continue;
    const exp = c.expiry_date ? S(c.expiry_date).slice(0, 10) : "";
    if (exp && exp < today) continue;
    const pid = S(c.personnel_id); const person = personById.get(pid); if (!person) continue;
    if (S(c.process_id) !== S(person.process_id)) continue;   // 공정 FK 일치(타 공정 제외)
    const idx = idxByLevelId.get(S(c.level_id)); if (idx === undefined) continue;
    if (idx > (pmIdxByPerson.get(pid) ?? -1)) pmIdxByPerson.set(pid, idx);
  }

  // ── exam_applications: 확정 취득(canonical) · 공정 일치 → personnel id 최고 idx ──
  const appIdxByPerson = new Map<string, number>();
  for (const a of applications) {
    if (a.deleted_at) continue;
    if (!isAcquiredApplication(a as Record<string, unknown>)) continue;
    const idx = idxByLevelId.get(S(a.level_id)); if (idx === undefined) continue;
    const person = (S(a.personnel_id) && personById.get(S(a.personnel_id))) || personByEmpNo.get(S(a.employee_no));
    const pid = person ? S(person.id) : ""; if (!pid) continue;
    if (!S(a.process_id) || S(a.process_id) !== S(person!.process_id)) continue; // 공정 FK 일치(타 공정 제외)
    if (idx > (appIdxByPerson.get(pid) ?? -1)) appIdxByPerson.set(pid, idx);
  }

  // ── 직원별 max(app, pm, flag) ──
  const flagLimit = Math.min(FLAG_FIELDS.length, stageIds.length);
  for (const p of personnel) {
    const pid = S(p.id); if (!pid) continue;
    let flagIdx = -1;
    for (let i = 0; i < flagLimit; i++) { if (flagOn(p[FLAG_FIELDS[i]])) flagIdx = i; else break; } // Single 부터 연속
    const appIdx = appIdxByPerson.get(pid) ?? -1;
    const pmIdx = pmIdxByPerson.get(pid) ?? -1;
    const idx = Math.max(appIdx, pmIdx, flagIdx);
    if (idx < 0) { out.set(pid, NONE); continue; }
    const sources: CurrentLevelSource[] = [];
    if (appIdx === idx) sources.push("application");
    if (pmIdx === idx) sources.push("pm_certification");
    if (flagIdx === idx) sources.push("personnel_flag");
    out.set(pid, { currentLevelId: stageIds[idx] ?? null, currentLevelIndex: idx, currentLevelName: stageNames[idx] ?? "-", sources });
  }
  return out;
}
