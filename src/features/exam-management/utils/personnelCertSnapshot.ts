// 인증 스냅샷 공용 SoT — 시험 보고서·대시보드가 "같은 입력이면 같은 인증 결과"를 반환하도록 단일 계산.
//  · Single~M4 / 인증Level(cert_level): 실제 취득(exam_applications) 기준. process_id 있는 인력만 동일 공정 취득으로 재계산,
//    legacy(process 미연결) 인력은 기존 personnel flag 보존(무회귀).
//  · D.M / Dual: 승인·활성·미삭제 dm_certifications(canonical). personnel.dm/dual_multi flag 는 우선 source 로 쓰지 않는다.
//  ⚠ 새 판정식 만들지 않음 — 기존 공용 resolver(acquiredLevelIds · normalizeCertificationLevel) 재사용.
import type { ExamRow } from "../services/examMasterService";
import { acquiredLevelIds, normalizeCertificationLevel } from "./certificationLevel";

const S = (v: unknown) => (v == null ? "" : String(v));
const isTruthy = (v: unknown) => { if (typeof v === "boolean") return v; const s = S(v).trim().toLowerCase(); return !!s && !["0", "false", "n", "no", "x", "-", "없음"].includes(s); };

export function computeCertifiedFlagsByPerson(input: {
  personnel: ExamRow[];
  applications: ExamRow[];
  levels: ExamRow[];            // 원본 exam_levels(code/name/rank_order 포함)
  dmCertifications: ExamRow[];  // dm_certifications
}): ExamRow[] {
  const { personnel, applications, levels, dmCertifications } = input;
  const sid = {
    single_job: normalizeCertificationLevel("Single", levels),
    m1: normalizeCertificationLevel("M1", levels), m2: normalizeCertificationLevel("M2", levels),
    m3: normalizeCertificationLevel("M3", levels), m4: normalizeCertificationLevel("M4", levels),
  };
  const rankById = new Map(levels.map((l) => [String(l.id), Number(l.rank_order ?? 0)]));
  const nameById = new Map(levels.map((l) => [String(l.id), String(l.name ?? l.code ?? "")]));
  // [D.M/Dual canonical] 유효 승인 D.M 을 employee_no 기준 집계(다른 직원 혼입 방지). dm=1건 이상 승인, dual=승인 중 dual_multi.
  const dmByEmp = new Map<string, { dm: boolean; dual: boolean }>();
  for (const c of dmCertifications) {
    if (c.deleted_at || String(c.approval_status ?? "") !== "승인" || c.is_active === false) continue;
    const e = S(c.employee_no); if (!e) continue;
    const prev = dmByEmp.get(e) ?? { dm: false, dual: false };
    dmByEmp.set(e, { dm: true, dual: prev.dual || isTruthy(c.dual_multi) });
  }
  return personnel.map((r): ExamRow => {
    const emp = S(r.employee_no), pid = S(r.process_id);
    const dmInfo = emp ? dmByEmp.get(emp) : undefined;
    const dmOverlay = { dm: dmInfo?.dm ? "○" : "", dual_multi: !!dmInfo?.dual }; // canonical 우선(legacy flag 미혼합)
    if (!emp || !pid) return { ...r, ...dmOverlay }; // legacy(공정 미연결) → single~m4 flag 보존, dm/dual 만 실데이터 정합
    const acq = acquiredLevelIds(applications, emp, levels, { processId: pid });
    let bestId = "", bestRank = -Infinity;
    for (const id of acq) { const rk = rankById.get(id) ?? 0; if (rk > bestRank) { bestRank = rk; bestId = id; } }
    return {
      ...r,
      single_job: sid.single_job && acq.has(sid.single_job) ? "○" : "",
      m1: sid.m1 && acq.has(sid.m1) ? "○" : "", m2: sid.m2 && acq.has(sid.m2) ? "○" : "",
      m3: sid.m3 && acq.has(sid.m3) ? "○" : "", m4: sid.m4 && acq.has(sid.m4) ? "○" : "",
      cert_level: bestId ? (nameById.get(bestId) || "") : "",
      ...dmOverlay,
    };
  });
}
