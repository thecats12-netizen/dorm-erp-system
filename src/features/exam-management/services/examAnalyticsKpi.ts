// 시험 대시보드/보고서 공용 KPI 집계 — DB 조회 없는 순수 함수(입력은 이미 batch load 된 배열).
//  · 기존 SoT 재사용: computeCurrentLevelByPersonnel(현재 Level 배타 분포) · isApplicationAcquired(취득 판정).
//  · 새 인증 판정 엔진 만들지 않음. 페이지 컴포넌트에 KPI 계산식 중복 금지.
//  · 정책 데이터(required_months/valid_months) 의존 지표(목표취득/만료/갱신)는 여기서 계산하지 않는다.
import type { ExamRow } from "./examMasterService";
import { computeCurrentLevelByPersonnel, type CurrentLevelResult } from "./currentCertificationLevelService";
import { computeEquipmentProgressByPersonnel } from "./equipmentProgressService";
import { deriveAchievementTiming } from "./examAutomationService";
import { monthsBetween } from "./licensePlanService";
import { isAchieveType } from "./processCriteriaRuleService";
import { normalizeCriteria, isCriteriaEffective } from "../engines/criteriaEvaluator";
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
export type EquipmentSummary = { targetPersons: number; missingPersons: number; targetEquipmentCount: number; acquiredEquipmentCount: number; rate: number | null };
export type TimingDistribution = { early: number; onTime: number; late: number; undetermined: number };
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
  // [KPI 2차-B]
  equipmentSummary: EquipmentSummary; // 설비: 대상/미취득 인원 + distinct 설비 취득률(personId+equipId)
  timingDistribution: TimingDistribution; // 조기/정상/지연/판정불가(deriveAchievementTiming)
  avgAcquireMonths: number | null;     // 평균 취득기간(개월): Single=입사일→취득, M1~M4=직전취득→취득
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
  equipmentCertifications?: ExamRow[]; // 설비 인증(approved 판정용)
  equipmentStageRules?: ExamRow[];     // 설비별 인증단계 규칙(대상 설비)
  criteriaRules?: ExamRow[];           // 공정별 달성기준(조기/정상/지연 criteria)
  currentLevelByPerson?: Map<string, CurrentLevelResult>; // 페이지 precompute 재사용(중복 계산 방지)
}): ExamKpiSummary {
  const { personnel, applications, levels, pmCertifications, dmCertifications, retestCandidates } = input;
  const monthlyApps = input.monthlyApplications ?? applications;
  const equipmentCertifications = input.equipmentCertifications ?? [];
  const equipmentStageRules = input.equipmentStageRules ?? [];
  const criteriaRules = input.criteriaRules ?? [];
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
    // 실기: 응시=실기합격일/실기취득(진행)일 존재 또는 status 실기 계열, 합격=실기합격일 존재.
    //  practical_acquire_date 는 calculateExamStatus 에서 "실기진행"(실기 응시 발생) 신호로 쓰이므로 분모에 포함.
    if (S(a.practical_pass_date) || S(a.practical_acquire_date) || /실기/.test(S(a.status))) pTaken.add(e);
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
  // 중복 계산 방지: 페이지가 이미 계산한 결과를 넘기면 재사용(같은 입력이면 동일 결과).
  const levelByPerson = input.currentLevelByPerson ?? computeCurrentLevelByPersonnel({ personnel, levels, applications, pmCertifications });
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

  // ── [설비] 대상/미취득 인원 + distinct 설비 취득률 (computeEquipmentProgressByPersonnel 재사용) ──
  const approvedByPerson = new Map<string, Set<string>>();
  for (const c of equipmentCertifications) {
    if (c.deleted_at || S(c.status) !== "approved") continue;
    const pid = S(c.personnel_id), eid = S(c.equipment_id); if (!pid || !eid) continue;
    const set = approvedByPerson.get(pid) ?? new Set<string>(); set.add(eid); approvedByPerson.set(pid, set);
  }
  const progress = computeEquipmentProgressByPersonnel({ personnel, levels, stageRules: equipmentStageRules, approvedByPerson });
  let eqTargetPersons = 0, eqMissingPersons = 0, eqTargetCount = 0, eqAcquiredCount = 0;
  for (const pr of progress.values()) {
    const tset = new Set<string>(), aset = new Set<string>();
    for (const s of pr.stages) { s.targetEquipmentIds.forEach((id) => tset.add(id)); s.acquiredEquipmentIds.forEach((id) => aset.add(id)); }
    if (tset.size === 0) continue; // target=0 → 대상/미취득 모두 제외
    eqTargetPersons += 1; eqTargetCount += tset.size; eqAcquiredCount += aset.size; // person 단위 union → personId+equipId distinct
    if (aset.size < tset.size) eqMissingPersons += 1;
  }
  const equipmentSummary: EquipmentSummary = {
    targetPersons: eqTargetPersons, missingPersons: eqMissingPersons,
    targetEquipmentCount: eqTargetCount, acquiredEquipmentCount: eqAcquiredCount,
    rate: eqTargetCount > 0 ? rate(eqAcquiredCount, eqTargetCount) : null,
  };

  // ── [조기/정상/지연] + [평균 취득기간] (deriveAchievementTiming 재사용) ──
  // 취득(person+level) canonical 1건: 동일 사번+level 은 가장 이른 취득일 1건만.
  const hireByEmp = new Map<string, unknown>();
  for (const p of personnel) { const e = S(p.employee_no); if (e && !hireByEmp.has(e)) hireByEmp.set(e, p.hire_date); }
  const empScopeSet = new Set(personnel.map((p) => S(p.employee_no)).filter(Boolean));
  const acqByEmpLevel = new Map<string, Map<string, { date: string; processId: string }>>();
  for (const a of applications) {
    if (a.deleted_at || !isApplicationAcquired(a)) continue;
    const e = S(a.employee_no); if (!e || !empScopeSet.has(e)) continue;
    const lvl = S(a.level_id); if (!lvl) continue;
    const d = (S(a.cert_acquired_date) || S(a.practical_pass_date)).slice(0, 10); if (!d) continue;
    const m = acqByEmpLevel.get(e) ?? new Map(); const prev = m.get(lvl);
    if (!prev || d < prev.date) m.set(lvl, { date: d, processId: S(a.process_id) }); // 가장 이른 취득일
    acqByEmpLevel.set(e, m);
  }
  // 공정+단계별 유효 달성기준 criteria 선택(effective 우선 · 없으면 첫 행). normalizeCriteria 로 정규화.
  const achieveRules = criteriaRules.filter((r) => !r.deleted_at && isAchieveType(r.rule_type));
  const criteriaFor = (processId: string, levelId: string, at: string): Record<string, unknown> | null => {
    const cands = achieveRules.filter((r) => S(r.process_id) === processId && S(r.level_id) === levelId);
    if (cands.length === 0) return null;
    const atDate = at ? new Date(at) : new Date();
    const eff = cands.find((r) => isCriteriaEffective(normalizeCriteria(r.criteria), atDate)) ?? cands[0];
    return normalizeCriteria(eff.criteria) as unknown as Record<string, unknown>;
  };
  const timingDistribution: TimingDistribution = { early: 0, onTime: 0, late: 0, undetermined: 0 };
  let avgSum = 0, avgN = 0;
  for (const [emp, byLevel] of acqByEmpLevel) {
    for (const [lvl, ent] of byLevel) {
      const criteria = criteriaFor(ent.processId, lvl, ent.date);
      const prereqIds: string[] = criteria && Array.isArray(criteria.prerequisite_level_ids) ? (criteria.prerequisite_level_ids as unknown[]).map(String) : [];
      // 선행단계 취득일(최신). 없으면 undefined → Single 등은 입사일 기준.
      let prereqAcq = "";
      for (const pid of prereqIds) { const d = byLevel.get(pid)?.date; if (d && d > prereqAcq) prereqAcq = d; }
      const hireDate = hireByEmp.get(emp);
      const t = deriveAchievementTiming({ criteria, hireDate, prereqAcquiredDate: prereqAcq || undefined, certAcquiredDate: ent.date });
      if (!criteria || t.insufficient) timingDistribution.undetermined += 1;
      else if (t.value === "조기취득") timingDistribution.early += 1;
      else if (t.value === "지연취득") timingDistribution.late += 1;
      else if (t.value === "정상취득") timingDistribution.onTime += 1;
      else timingDistribution.undetermined += 1;
      // 평균 취득기간: base = 선행단계 취득일(있으면) 또는 입사일. 둘 다 없으면 제외.
      const base = prereqAcq || (hireDate ? String(hireDate).slice(0, 10) : "");
      if (base) { const mm = monthsBetween(base, ent.date); if (mm != null && mm >= 0) { avgSum += mm; avgN += 1; } }
    }
  }
  const avgAcquireMonths = avgN > 0 ? Math.round((avgSum / avgN) * 10) / 10 : null;

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
    equipmentSummary, timingDistribution, avgAcquireMonths,
  };
}
