// 직원별 인증 Preview(조회 전용) — calculateProcessStageEligibility 결과를 관리자에게 표시.
//  저장/승인/강등 없음. 배치 조회 + Map/Set + useMemo. DB 미적용 시 한글 안내(원문 비노출).
import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeSelector from "../components/EmployeeSelector";
import type { EmployeeLite } from "../types/employeeLookup";
import type { ExamRow } from "../services/examMasterService";
import type { EvaluationSubject, StageEligibility } from "../types/certificationCriteria";
import { calculateEquipmentSummary, calculateProcessStageEligibility, describeCriteria, isCriteriaEffective, normalizeCriteria } from "../engines/criteriaEvaluator";
import { selectPmStageLevels } from "../utils/certificationLevel";
import { loadPreviewMaster, loadPersonnelCertState, type PreviewMaster, type PersonnelCertState } from "../services/certificationPreviewService";

type Props = { darkMode: boolean; tenantId: string; onToast?: (m: string) => void };

// 로컬 timezone 변환 없이 Y-M-D 문자열 → [y,m,d]. 형식 불일치면 null.
function parseYmd(v?: string | null): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "")); if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
// 특정 날짜부터 오늘까지 "완전(완료) 개월 수". 미래 날짜/무효면 null. (Date 객체 tz 변환 없이 Y/M/D 정수 비교)
function fullMonthsSince(ymd?: string | null): number | null {
  const a = parseYmd(ymd); if (!a) return null;
  const now = new Date(); const b: [number, number, number] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) return null; // 미래 방어
  let months = (b[0] - a[0]) * 12 + (b[1] - a[1]);
  if (b[2] < a[2]) months -= 1;  // 아직 그 달의 일(day)에 도달 못함 → 미완료 1개월 차감
  return Math.max(0, months);
}

type ProcEval = {
  processId: string; processName: string;
  targetCount: number; acquiredCount: number; coreCount: number; coreTarget: number; completionRate: number; noTarget: boolean;
  stages: StageEligibility[]; highestPassedRank: number; dupLevelIds: Set<string>;
  confirmedLevel: { code: string; name: string } | null;
  engineLevel: { code: string; name: string } | null;
  nextLevel: { code: string; name: string; missing: string[] } | null;
  tenureMonths: number | null; elapsedMonths: number | null; cumulativeMonths: number | null; hasStageDate: boolean;
};

export default function EmployeeCertificationPreviewPage({ darkMode, tenantId, onToast }: Props) {
  const [employee, setEmployee] = useState<EmployeeLite | null>(null);
  const [master, setMaster] = useState<PreviewMaster | null>(null);
  const [state, setState] = useState<PersonnelCertState | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [loadingState, setLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fProcess, setFProcess] = useState("");
  const [nonce, setNonce] = useState(0);   // 재계산 트리거

  const reloadMaster = useCallback(async () => {
    setLoadingMaster(true); setError(null);
    try { const m = await loadPreviewMaster(tenantId); setMaster(m); if (!m.ok) setError("인증 기준 데이터를 불러오려면 시험관리 DB 설정이 필요합니다."); }
    catch { setError("인증 기준 데이터를 불러오지 못했습니다."); }
    finally { setLoadingMaster(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reloadMaster(); }, [reloadMaster]);

  const loadState = useCallback(async (emp: EmployeeLite | null) => {
    if (!emp) { setState(null); return; }
    setLoadingState(true);
    try { const s = await loadPersonnelCertState(tenantId, emp.id); setState(s); if (!s.ok) setError("설비 취득 데이터를 불러오려면 시험관리 DB 설정이 필요합니다."); else setError(null); }
    catch { setError("직원 취득 데이터를 불러오지 못했습니다."); }
    finally { setLoadingState(false); }
  }, [tenantId]);
  // 직원 변경/재계산 시 이전 결과 초기화 후 재조회.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setState(null); void loadState(employee); }, [employee, nonce, loadState]);

  const asMap = (arr: ExamRow[]) => new Map(arr.map((r) => [String(r.id), r]));
  const procById = useMemo(() => asMap(master?.processes ?? []), [master]);
  const levelById = useMemo(() => asMap(master?.levels ?? []), [master]);
  // pm_level 텍스트 → 레벨(코드 우선, 없으면 이름). fallback 해석용.
  const levelByCode = useMemo(() => {
    const mp = new Map<string, ExamRow>();
    for (const r of master?.levels ?? []) { const c = String(r.code ?? "").trim().toUpperCase(); const n = String(r.name ?? "").trim().toUpperCase(); if (c) mp.set(c, r); if (n) mp.set(n, r); }
    return mp;
  }, [master]);
  const nm = (m: Map<string, ExamRow>, id: unknown) => { const r = m.get(String(id ?? "")); return r ? (String(r.name ?? "").trim() || String(r.code ?? "").trim() || "-") : "-"; };

  // 엔진용 PM 단계(Single~Multi 4) — 코드 하드코딩 없이 name/rank_order 로 선택(pmCandidate 와 공용 helper). rank 오름차순.
  const pmLevels = useMemo(() => selectPmStageLevels(master?.levels ?? [])
    .map((r) => ({ id: String(r.id), code: String(r.code ?? "").toUpperCase(), rank_order: Number(r.rank_order ?? 0), requires_approval: r.requires_approval !== false, auto_promote: r.auto_promote === true })), [master]);

  const equipProcess = useMemo(() => new Map((master?.equipment ?? []).map((e) => [String(e.id), String(e.process_id ?? "")])), [master]);

  // 평가 결과(직원+마스터 → 공정별) + 계산 시각. 순수 계산(useMemo) · 저장 없음.
  const { list: evals, computedAt } = useMemo((): { list: ProcEval[]; computedAt: string } => {
    if (!master || !state || !employee) return { list: [], computedAt: "" };
    const today = new Date();
    const acquired = new Set(state.approvedEquipmentIds);            // 동일 설비 중복 승인 → 1건(Set)
    const tenure = fullMonthsSince(employee.joinDate);
    // pm 확정: level_id 우선 · pm_level 텍스트 fallback · 만료(expiry) 제외 · deleted/is_active 는 쿼리에서 필터됨.
    const resolvePm = (p: { levelId: string | null; pmLevel: string | null }) => (p.levelId && levelById.has(p.levelId)) ? p.levelId : (p.pmLevel ? String(levelByCode.get(p.pmLevel.trim().toUpperCase())?.id ?? "") : "");
    const rankOf = (lid: string) => Number(levelById.get(lid)?.rank_order ?? 0);

    const procIds = new Set<string>();
    if (employee.processId) procIds.add(String(employee.processId));
    for (const eqId of acquired) { const p = equipProcess.get(eqId); if (p) procIds.add(p); }
    const rankToLevel = (rank: number) => { const l = pmLevels.find((x) => x.rank_order === rank); return l ? { code: l.code, name: nm(levelById, l.id) } : null; };

    const out: ProcEval[] = [];
    for (const pid of procIds) {
      if (!pid) continue;
      // 이 공정의 유효 확정 단계(만료 제외).
      const confirmed = state.pmCerts.filter((p) => p.processId === pid)
        .map((p) => ({ levelId: resolvePm(p), acquiredDate: p.acquiredDate, expiryDate: p.expiryDate }))
        .filter((p) => p.levelId && levelById.has(p.levelId) && !(p.expiryDate && parseYmd(p.expiryDate) && p.expiryDate < today.toISOString().slice(0, 10)));
      const achievedLevelIds = new Set(confirmed.map((p) => p.levelId));
      // 확정 단계 취득일(신뢰 가능한 단계 확정일) — 최고/최저 rank 기준.
      const confSorted = [...confirmed].filter((p) => p.acquiredDate).sort((a, b) => rankOf(a.levelId) - rankOf(b.levelId));
      const lowestDate = confSorted[0]?.acquiredDate ?? null;
      const highestDate = confSorted[confSorted.length - 1]?.acquiredDate ?? null;
      const cumulativeMonths = fullMonthsSince(lowestDate);
      const elapsedMonths = fullMonthsSince(highestDate);
      const hasStageDate = !!(lowestDate || highestDate);

      const targetEquipmentIds = new Set(master.equipment.filter((e) => String(e.process_id ?? "") === pid && e.is_active !== false).map((e) => String(e.id)));
      const coreSet = new Set(master.stageRules.filter((r) => String(r.process_id ?? "") === pid && r.is_core_equipment === true && !r.deleted_at && r.is_active !== false && isCriteriaEffective(normalizeCriteria({ effective_from: r.effective_from, effective_to: r.effective_to }))).map((r) => String(r.equipment_id ?? "")));
      const coreEquipmentIds = new Set([...acquired].filter((id) => coreSet.has(id)));
      const subj: EvaluationSubject = {
        tenantId, personnelId: employee.id, processId: pid,
        acquiredEquipmentIds: acquired, coreEquipmentIds, targetEquipmentIds, achievedLevelIds,
        tenureMonths: tenure, elapsedMonths, cumulativeElapsedMonths: cumulativeMonths,
      };
      const summary = calculateEquipmentSummary(subj);

      // 해당 공정·유효기간 내 달성기준 → level 별 후보 수집(중복 감지 + 우선순위 선택).
      const byLevel = new Map<string, ExamRow[]>();
      for (const r of master.criteriaRules) {
        if (String(r.process_id ?? "") !== pid || r.deleted_at || r.is_active === false) continue;
        if (!isCriteriaEffective(normalizeCriteria(r.criteria))) continue;
        const lid = String(r.level_id ?? ""); if (!lid) continue;
        const list = byLevel.get(lid) ?? []; list.push(r); byLevel.set(lid, list);
      }
      const rulesByLevel = new Map<string, unknown>();
      const dupLevelIds = new Set<string>();
      for (const [lid, list] of byLevel) {
        if (list.length > 1) dupLevelIds.add(lid);
        list.sort((a, b) => (normalizeCriteria(b.criteria).priority ?? 0) - (normalizeCriteria(a.criteria).priority ?? 0) || String(normalizeCriteria(b.criteria).effective_from ?? "").localeCompare(String(normalizeCriteria(a.criteria).effective_from ?? "")));
        rulesByLevel.set(lid, list[0].criteria);   // 우선순위(priority↓, 최근 시작↓) 최상위 1건 적용
      }

      const { stages, highestPassedRank } = calculateProcessStageEligibility(subj, summary, pmLevels, rulesByLevel);
      let confirmedRank = 0; for (const l of pmLevels) if (achievedLevelIds.has(l.id) && l.rank_order > confirmedRank) confirmedRank = l.rank_order;
      const nextStage = stages.find((s) => !s.passed) ?? null;
      out.push({
        processId: pid, processName: nm(procById, pid),
        targetCount: summary.targetCount, acquiredCount: summary.acquiredCount, coreCount: summary.coreCount, coreTarget: coreSet.size, completionRate: summary.completionRate, noTarget: summary.targetCount === 0,
        stages, highestPassedRank, dupLevelIds,
        confirmedLevel: confirmedRank ? rankToLevel(confirmedRank) : null,
        engineLevel: highestPassedRank ? rankToLevel(highestPassedRank) : null,
        nextLevel: nextStage ? { code: nextStage.code, name: nm(levelById, nextStage.levelId), missing: nextStage.result.missing } : null,
        tenureMonths: tenure, elapsedMonths, cumulativeMonths, hasStageDate,
      });
    }
    out.sort((a, b) => a.processName.localeCompare(b.processName, "ko"));
    return { list: out, computedAt: new Date().toLocaleString("ko-KR") };
  }, [master, state, employee, pmLevels, equipProcess, procById, levelById, levelByCode, tenantId]);

  const procFilterOpts = useMemo(() => evals.map((e) => ({ id: e.processId, name: e.processName })), [evals]);
  const shown = useMemo(() => (fProcess ? evals.filter((e) => e.processId === fProcess) : evals), [evals, fProcess]);
  const needsReeval = state?.needsReeval === true;

  const card = darkMode ? "rounded-2xl border border-slate-700 bg-slate-800/40 p-4" : "rounded-2xl border border-slate-200 bg-white p-4";
  const chip = darkMode ? "rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300" : "rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600";
  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const stageBadge = (passed: boolean) => passed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300";
  const moTxt = (v: number | null, has: boolean) => v == null ? (has ? "정보 없음" : "단계 취득일 정보 없음") : `${v}개월`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-500">직원을 선택하면 현재 취득 설비 기준으로 Single~M4 단계 충족 여부를 계산해 보여줍니다(조회 전용, 저장/강등 없음).</p>
        <div className="flex items-center gap-2">
          {employee && <span className="text-[0.7rem] text-slate-400">계산 시각 {computedAt}</span>}
          <button className={`${chip} hover:opacity-80`} onClick={() => { setNonce((n) => n + 1); onToast?.("최신 데이터로 다시 계산했습니다."); }}>↻ 재계산</button>
        </div>
      </div>

      {/* 필터: 직원 + 공정 */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[280px] flex-1"><label className="mb-1 block text-xs font-medium text-slate-500">직원</label>
          <EmployeeSelector value={employee} onChange={setEmployee} tenantId={tenantId} darkMode={darkMode} placeholder="사번/이름 검색" /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-500">공정</label>
          <select value={fProcess} onChange={(e) => setFProcess(e.target.value)} disabled={!procFilterOpts.length} className={inp}><option value="">전체</option>{procFilterOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      </div>

      {error && <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{error}</div>}
      {(loadingMaster || loadingState) && <div className="mb-3 text-xs text-slate-500">불러오는 중…</div>}

      {!employee && <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">직원을 선택하면 인증 계산 결과가 표시됩니다.</div>}

      {employee && (
        <>
          {/* 기본 정보 */}
          <div className={`${card} mb-4`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base font-semibold">{employee.name}</span>
              <span className="text-sm text-slate-400">({employee.employeeNo})</span>
              {needsReeval && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">재평가 필요</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className={chip}>부서 {employee.part || "-"}</span>
              <span className={chip}>그룹 {employee.group || "-"}</span>
              <span className={chip}>제품군 {employee.productFamily || "-"}</span>
              <span className={chip}>배정 공정 {nm(procById, employee.processId)}</span>
              <span className={chip}>근속 {employee.joinDate ? (fullMonthsSince(employee.joinDate) == null ? "입사일 정보 없음" : `${fullMonthsSince(employee.joinDate)}개월`) : "입사일 정보 없음"}</span>
            </div>
          </div>

          {shown.length === 0 && !loadingState && (
            <div className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">평가할 공정/취득 설비가 없습니다.</div>
          )}

          {/* 공정별 카드 */}
          <div className="grid gap-3 md:grid-cols-2">
            {shown.map((ev) => (
              <div key={ev.processId} className={card}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold">{ev.processName}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stageBadge(!!ev.engineLevel)}`}>{ev.engineLevel ? `엔진 계산 ${ev.engineLevel.code}` : "충족 단계 없음"}</span>
                </div>
                {ev.dupLevelIds.size > 0 && <div className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[0.7rem] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">⚠ 동일 공정·단계에 유효한 달성기준이 여러 건 있습니다. 우선순위 상위 1건만 적용했습니다(기준 정리 필요).</div>}
                <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>전체 대상 설비 <b className="text-slate-700 dark:text-slate-200">{ev.targetCount}</b></span>
                  <span>승인 설비 <b className="text-slate-700 dark:text-slate-200">{ev.acquiredCount}</b></span>
                  <span>주력설비 <b className="text-slate-700 dark:text-slate-200">{ev.coreCount} / {ev.coreTarget}</b></span>
                  <span>취득률 <b className="text-slate-700 dark:text-slate-200">{ev.noTarget ? "대상 설비 기준 없음" : `${ev.completionRate}%`}</b></span>
                  <span>현재 확정 <b className="text-slate-700 dark:text-slate-200">{ev.confirmedLevel?.code ?? "없음"}</b></span>
                  <span>다음 단계 <b className="text-slate-700 dark:text-slate-200">{ev.nextLevel?.code ?? "—"}</b></span>
                  <span>단계간 경과 <b className="text-slate-700 dark:text-slate-200">{moTxt(ev.elapsedMonths, ev.hasStageDate)}</b></span>
                  <span>누적 경과 <b className="text-slate-700 dark:text-slate-200">{moTxt(ev.cumulativeMonths, ev.hasStageDate)}</b></span>
                </div>

                {/* 단계별(Single~M4) */}
                <div className="space-y-1.5">
                  {ev.stages.map((s) => {
                    const crit = master?.criteriaRules.find((r) => String(r.process_id ?? "") === ev.processId && String(r.level_id ?? "") === s.levelId && !r.deleted_at && r.is_active !== false);
                    const label = crit ? describeCriteria(crit.criteria) : "기준 규칙 미정의";
                    return (
                      <div key={s.levelId} className={`rounded-xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{nm(levelById, s.levelId)} <span className="text-xs text-slate-400">{s.code}</span>{ev.dupLevelIds.has(s.levelId) && <span className="ml-1 text-[0.65rem] text-amber-600">중복 기준</span>}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${stageBadge(s.passed)}`}>{s.passed ? "충족" : "미충족"}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{label}</div>
                        {s.result.met.length > 0 && <div className="mt-0.5 text-[0.7rem] text-emerald-600">충족: {s.result.met.join(" · ")}</div>}
                        {s.result.missing.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">{s.result.missing.map((mi, i) => <li key={i}>{mi}</li>)}</ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
