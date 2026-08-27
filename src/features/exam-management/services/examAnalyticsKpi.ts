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
const isFailApp = (a: ExamRow) => /불합격/.test(S(a.status));
// 합격(대시보드/보고서 isPass 동일): 불합격 아님 && (취득 || "합격" 라벨).
const isPassApp = (a: ExamRow) => !isFailApp(a) && (isApplicationAcquired(a) || /합격/.test(S(a.status)));
const monthOf = (v: unknown): number => { const m = S(v).match(/^(\d{4})-(\d{2})/); return m ? Number(m[2]) : 0; };
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

export type LevelBucket = { key: string; label: string; count: number };
export type GroupRate = { key: string; label: string; acquired: number; headcount: number; rate: number };
export type MonthlyPoint = { month: number; label: string; applied: number; passed: number; acquired: number };
export type ExamKpiSummary = {
  headcount: number;
  appliedCount: number; appliedRate: number;
  acquiredCount: number; acquiredRate: number;
  levelDistribution: LevelBucket[]; // 미취득 + Single~M4(배타 · 합계 = headcount)
  dmCount: number; dualCount: number; // 보조(PM 단계와 별개 tier · 중첩 가능)
  groupRates: GroupRate[];
  retestCount: number;
  // [KPI 2차-A]
  writtenTakenCount: number; writtenPassCount: number; writtenPassRate: number;
  practicalTakenCount: number; practicalPassCount: number; practicalPassRate: number;
  processRates: GroupRate[];   // key=process_id(canonical), label=공정명. 분모/분자=사번 distinct(apps 기준)
  categoryRates: GroupRate[];  // key=category_id(canonical), label=제품군명(동명 다그룹 시 그룹명 보조)
  monthlyTrend: MonthlyPoint[]; // 12개월 · 건수(응시/합격/취득 이벤트 count)
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
  monthlyApplications?: ExamRow[]; // 월별 추세용(기간+scope 필터 적용된 apps). 미지정 시 applications 사용.
}): ExamKpiSummary {
  const { personnel, applications, levels, pmCertifications, dmCertifications, retestCandidates } = input;
  const monthlyApps = input.monthlyApplications ?? applications;
  const empScope = new Set(personnel.map((p) => S(p.employee_no)).filter(Boolean));
  const inScope = (a: ExamRow) => empScope.has(S(a.employee_no));

  // 응시/취득 인원(사번 distinct · scope 한정) + 필기/실기 + 공정별(process_id) 집계 — apps 1회 순회.
  const appliedEmp = new Set<string>();
  const acquiredEmp = new Set<string>();
  const wTaken = new Set<string>(), wPass = new Set<string>(), pTaken = new Set<string>(), pPass = new Set<string>();
  const byProc = new Map<string, { label: string; head: Set<string>; acq: Set<string> }>();
  for (const a of applications) {
    if (a.deleted_at || !inScope(a)) continue;
    const e = S(a.employee_no); if (!e) continue;
    if (isTakenApp(a)) appliedEmp.add(e);
    const acq = isApplicationAcquired(a); if (acq) acquiredEmp.add(e);
    // 필기: 응시=필기시험일/필기합격일 존재, 합격=필기합격일 존재.
    if (S(a.written_exam_date) || S(a.written_pass_date)) wTaken.add(e);
    if (S(a.written_pass_date)) wPass.add(e);
    // 실기: 응시=실기합격일 존재 또는 status 가 실기 계열, 합격=실기합격일 존재.
    if (S(a.practical_pass_date) || /실기/.test(S(a.status))) pTaken.add(e);
    if (S(a.practical_pass_date)) pPass.add(e);
    // 공정별(process_id canonical · 라벨=공정명 텍스트). 분모=응시(scope) 사번, 분자=취득 사번.
    const pid = S(a.process_id); if (pid) {
      const g = byProc.get(pid) ?? { label: S(a.process) || pid, head: new Set<string>(), acq: new Set<string>() };
      if (!g.label || g.label === pid) g.label = S(a.process) || g.label;
      g.head.add(e); if (acq) g.acq.add(e); byProc.set(pid, g);
    }
  }
  const processRates: GroupRate[] = Array.from(byProc.entries())
    .map(([key, g]) => ({ key, label: g.label, acquired: g.acq.size, headcount: g.head.size, rate: rate(g.acq.size, g.head.size) }))
    .sort((a, b) => b.rate - a.rate || b.headcount - a.headcount);

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

  // 그룹별·제품군별 인증률(personnel FK 기준). 분모=인원(사번 distinct), 분자=취득 인원. personnel 1회 순회.
  const byGroup = new Map<string, { label: string; head: Set<string>; acq: Set<string> }>();
  const byCat = new Map<string, { label: string; group: string; head: Set<string>; acq: Set<string> }>();
  for (const p of personnel) {
    const e = S(p.employee_no); const acq = !!e && acquiredEmp.has(e);
    const gid = S(p.group_id) || `name:${S(p.group_name)}`;
    const g = byGroup.get(gid) ?? { label: S(p.group_name) || "(미지정)", head: new Set<string>(), acq: new Set<string>() };
    if (e) { g.head.add(e); if (acq) g.acq.add(e); } byGroup.set(gid, g);
    // 제품군: category_id canonical(동명 제품군이 다른 그룹이면 category_id 로 분리). 라벨=제품군명.
    const cidRaw = S(p.category_id); const cid = cidRaw || `name:${S(p.group_name)}:${S(p.product_group)}`;
    if (S(p.product_group)) {
      const c = byCat.get(cid) ?? { label: S(p.product_group), group: S(p.group_name), head: new Set<string>(), acq: new Set<string>() };
      if (e) { c.head.add(e); if (acq) c.acq.add(e); } byCat.set(cid, c);
    }
  }
  const groupRates: GroupRate[] = Array.from(byGroup.entries())
    .map(([key, g]) => ({ key, label: g.label, acquired: g.acq.size, headcount: g.head.size, rate: rate(g.acq.size, g.head.size) }))
    .sort((a, b) => b.rate - a.rate || b.headcount - a.headcount);
  // 동명 제품군이 여러 그룹에 존재하면 라벨에 그룹명 보조(사용자 구분용).
  const catNameCount = new Map<string, number>();
  for (const c of byCat.values()) catNameCount.set(c.label, (catNameCount.get(c.label) ?? 0) + 1);
  const categoryRates: GroupRate[] = Array.from(byCat.entries())
    .map(([key, c]) => ({ key, label: (catNameCount.get(c.label) ?? 0) > 1 && c.group ? `${c.label} · ${c.group}` : c.label, acquired: c.acq.size, headcount: c.head.size, rate: rate(c.acq.size, c.head.size) }))
    .sort((a, b) => b.rate - a.rate || b.headcount - a.headcount);

  // 월별 추세(12개월 · 건수). 응시=필기시험일, 합격=실기||필기 합격일(isPass), 취득=취득일||실기합격일(isApplicationAcquired). created_at 미사용.
  const trend: MonthlyPoint[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: `${i + 1}월`, applied: 0, passed: 0, acquired: 0 }));
  for (const a of monthlyApps) {
    if (a.deleted_at) continue;
    const am = monthOf(a.written_exam_date); if (am) trend[am - 1].applied += 1;
    if (isPassApp(a)) { const pm = monthOf(a.practical_pass_date) || monthOf(a.written_pass_date); if (pm) trend[pm - 1].passed += 1; }
    if (isApplicationAcquired(a)) { const cm = monthOf(a.cert_acquired_date) || monthOf(a.practical_pass_date); if (cm) trend[cm - 1].acquired += 1; }
  }

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
    writtenTakenCount: wTaken.size, writtenPassCount: wPass.size, writtenPassRate: rate(wPass.size, wTaken.size),
    practicalTakenCount: pTaken.size, practicalPassCount: pPass.size, practicalPassRate: rate(pPass.size, pTaken.size),
    processRates, categoryRates, monthlyTrend: trend,
  };
}
