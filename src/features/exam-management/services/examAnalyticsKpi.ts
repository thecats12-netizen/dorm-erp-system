// 시험 대시보드/보고서 공용 KPI 집계 — DB 조회 없는 순수 함수(입력은 이미 batch load 된 배열).
//  · 기존 SoT 재사용: computeCurrentLevelByPersonnel(현재 Level 배타 분포) · isApplicationAcquired(취득 판정).
//  · 새 인증 판정 엔진 만들지 않음. 페이지 컴포넌트에 KPI 계산식 중복 금지.
//  · 정책 데이터(required_months/valid_months) 의존 지표(목표취득/만료/갱신)는 여기서 계산하지 않는다.
import type { ExamRow } from "./examMasterService";
import { computeCurrentLevelByPersonnel } from "./currentCertificationLevelService";
import { isApplicationAcquired, selectPmStageLevels } from "../utils/certificationLevel";

const S = (v: unknown) => (v == null ? "" : String(v));
// 응시 여부: 기존 대시보드/보고서 semantics 그대로("예정/취소/빈값" 제외).
const isTakenApp = (a: ExamRow) => !["예정", "취소", ""].includes(S(a.status));
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

export type LevelBucket = { key: string; label: string; count: number };
export type GroupRate = { key: string; label: string; acquired: number; headcount: number; rate: number };
export type ExamKpiSummary = {
  headcount: number;
  appliedCount: number; appliedRate: number;
  acquiredCount: number; acquiredRate: number;
  levelDistribution: LevelBucket[]; // 미취득 + Single~M4(배타 · 합계 = headcount)
  dmCount: number; dualCount: number; // 보조(PM 단계와 별개 tier · 중첩 가능)
  groupRates: GroupRate[];
  retestCount: number;
};

// personnel 은 "현재 필터가 적용된" 인력 배열을 넘긴다(headcount = personnel.length).
//  applications 는 전체(누적)로 넘겨도 되며, 내부에서 personnel 의 employee_no 로 scope 를 한정한다.
export function computeExamKpiSummary(input: {
  personnel: ExamRow[];
  applications: ExamRow[];
  levels: ExamRow[];
  pmCertifications: ExamRow[];
  dmCertifications: ExamRow[];
  retestCandidates: Array<{ employee_no?: unknown; status?: unknown }>;
}): ExamKpiSummary {
  const { personnel, applications, levels, pmCertifications, dmCertifications, retestCandidates } = input;
  const empScope = new Set(personnel.map((p) => S(p.employee_no)).filter(Boolean));
  const inScope = (a: ExamRow) => empScope.has(S(a.employee_no));

  // 응시/취득 인원(사번 distinct · scope 한정)
  const appliedEmp = new Set<string>();
  const acquiredEmp = new Set<string>();
  for (const a of applications) {
    if (a.deleted_at || !inScope(a)) continue;
    const e = S(a.employee_no); if (!e) continue;
    if (isTakenApp(a)) appliedEmp.add(e);
    if (isApplicationAcquired(a)) acquiredEmp.add(e);
  }

  // 현재 Level 배타 분포(canonical). index: -1=미취득, 0=Single … 4=M4.
  const stageNames = selectPmStageLevels(levels).map((l) => S(l.name) || S(l.code)); // ["Single","M1"…]
  const levelByPerson = computeCurrentLevelByPersonnel({ personnel, levels, applications, pmCertifications });
  const buckets: LevelBucket[] = [{ key: "none", label: "미취득", count: 0 }, ...stageNames.map((n, i) => ({ key: `stage${i}`, label: n, count: 0 }))];
  for (const p of personnel) {
    const r = levelByPerson.get(S(p.id));
    const idx = r ? r.currentLevelIndex : -1;
    const bi = idx < 0 ? 0 : Math.min(idx + 1, buckets.length - 1);
    buckets[bi].count += 1;
  }

  // D.M/Dual 보조(승인·활성·미삭제 · scope · 사번 distinct)
  const dmEmp = new Set<string>(); const dualEmp = new Set<string>();
  for (const c of dmCertifications) {
    if (c.deleted_at || S(c.approval_status) !== "승인" || c.is_active === false || !inScope(c)) continue;
    const e = S(c.employee_no); if (!e) continue;
    dmEmp.add(e);
    const dv = c.dual_multi; const dt = typeof dv === "boolean" ? dv : !["", "0", "false", "n", "no", "x", "-", "없음"].includes(S(dv).trim().toLowerCase());
    if (dt) dualEmp.add(e);
  }

  // 그룹별 인증률(FK group_id 기준 · 그룹명 라벨). 분모=그룹 인원, 분자=취득 인원.
  const byGroup = new Map<string, { label: string; head: Set<string>; acq: Set<string> }>();
  for (const p of personnel) {
    const gid = S(p.group_id) || `name:${S(p.group_name)}`; // group_id 없으면 이름 fallback 키
    const label = S(p.group_name) || "(미지정)";
    const g = byGroup.get(gid) ?? { label, head: new Set<string>(), acq: new Set<string>() };
    const e = S(p.employee_no); if (e) { g.head.add(e); if (acquiredEmp.has(e)) g.acq.add(e); }
    byGroup.set(gid, g);
  }
  const groupRates: GroupRate[] = Array.from(byGroup.entries())
    .map(([key, g]) => ({ key, label: g.label, acquired: g.acq.size, headcount: g.head.size, rate: rate(g.acq.size, g.head.size) }))
    .sort((a, b) => b.rate - a.rate || b.headcount - a.headcount);

  // 재시험 대상(활성 후보/승인 · 사번 distinct)
  const retestEmp = new Set<string>();
  for (const r of retestCandidates) { if (["후보", "승인"].includes(S(r.status))) { const e = S(r.employee_no); if (e) retestEmp.add(e); } }

  const headcount = personnel.length;
  return {
    headcount,
    appliedCount: appliedEmp.size, appliedRate: rate(appliedEmp.size, headcount),
    acquiredCount: acquiredEmp.size, acquiredRate: rate(acquiredEmp.size, headcount),
    levelDistribution: buckets, dmCount: dmEmp.size, dualCount: dualEmp.size,
    groupRates, retestCount: retestEmp.size,
  };
}
