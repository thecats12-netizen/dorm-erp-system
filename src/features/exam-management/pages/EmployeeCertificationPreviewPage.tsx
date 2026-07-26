// 직원별 인증 Preview(조회 전용) — calculateProcessStageEligibility 결과를 관리자에게 표시.
//  저장/승인/강등 없음. 배치 조회 + Map/Set + useMemo. DB 미적용 시 한글 안내(원문 비노출).
import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeSelector from "../components/EmployeeSelector";
import type { EmployeeLite } from "../types/employeeLookup";
import type { ExamRow } from "../services/examMasterService";
import type { EvaluationSubject, StageEligibility } from "../types/certificationCriteria";
import { calculateEquipmentSummary, calculateProcessStageEligibility, describeCriteria, isCriteriaEffective, normalizeCriteria } from "../engines/criteriaEvaluator";
import { loadPreviewMaster, loadPersonnelCertState, type PreviewMaster, type PersonnelCertState } from "../services/certificationPreviewService";

const LEVEL_CODES = new Set(["SINGLE", "M1", "M2", "M3", "M4"]);
type Props = { darkMode: boolean; tenantId: string; onToast?: (m: string) => void };

// hire_date → 근속 개월(정수). 미상이면 null.
function tenureMonths(hire?: string | null): number | null {
  const s = String(hire ?? "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s), now = new Date(); if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

type ProcEval = {
  processId: string; processName: string;
  targetCount: number; acquiredCount: number; coreCount: number; coreTarget: number; completionRate: number;
  stages: StageEligibility[]; highestPassedRank: number;
  confirmedLevel: { code: string; name: string } | null;
  engineLevel: { code: string; name: string } | null;
  nextLevel: { code: string; name: string; missing: string[] } | null;
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
  // 직원 변경/재계산 시 상태 재조회.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadState(employee); }, [employee, nonce, loadState]);

  const asMap = (arr: ExamRow[]) => new Map(arr.map((r) => [String(r.id), r]));
  const procById = useMemo(() => asMap(master?.processes ?? []), [master]);
  const levelById = useMemo(() => asMap(master?.levels ?? []), [master]);
  const nm = (m: Map<string, ExamRow>, id: unknown) => { const r = m.get(String(id ?? "")); return r ? (String(r.name ?? "").trim() || String(r.code ?? "").trim() || "-") : "-"; };

  // 엔진용 PM 단계(Single~M4) — rank 오름차순.
  const pmLevels = useMemo(() => (master?.levels ?? [])
    .filter((r) => r.is_active !== false && LEVEL_CODES.has(String(r.code ?? "").toUpperCase()))
    .map((r) => ({ id: String(r.id), code: String(r.code ?? "").toUpperCase(), rank_order: Number(r.rank_order ?? 0), requires_approval: r.requires_approval !== false, auto_promote: r.auto_promote === true }))
    .sort((a, b) => a.rank_order - b.rank_order), [master]);

  // 설비 → 공정 매핑(취득 설비로부터 평가 대상 공정 도출).
  const equipProcess = useMemo(() => new Map((master?.equipment ?? []).map((e) => [String(e.id), String(e.process_id ?? "")])), [master]);

  // 평가 결과(직원+마스터 → 공정별). 순수 계산(useMemo) · 저장 없음.
  const evals: ProcEval[] = useMemo(() => {
    if (!master || !state || !employee) return [];
    const acquired = new Set(state.approvedEquipmentIds);
    const achievedLevelIds = new Set(state.achievedLevelIds);
    const tenure = tenureMonths(employee.joinDate);
    // 평가 대상 공정 = 배정 공정 ∪ 취득 설비 소속 공정.
    const procIds = new Set<string>();
    if (employee.processId) procIds.add(String(employee.processId));
    for (const eqId of acquired) { const p = equipProcess.get(eqId); if (p) procIds.add(p); }
    const rankToLevel = (rank: number) => { const l = pmLevels.find((x) => x.rank_order === rank); return l ? { code: l.code, name: nm(levelById, l.id) } : null; };

    const out: ProcEval[] = [];
    for (const pid of procIds) {
      if (!pid) continue;
      const targetEquipmentIds = new Set((master.equipment).filter((e) => String(e.process_id ?? "") === pid && e.is_active !== false).map((e) => String(e.id)));
      const coreSet = new Set(master.stageRules.filter((r) => String(r.process_id ?? "") === pid && r.is_core_equipment === true && !r.deleted_at && r.is_active !== false).map((r) => String(r.equipment_id ?? "")));
      const coreEquipmentIds = new Set([...acquired].filter((id) => coreSet.has(id)));
      const subj: EvaluationSubject = {
        tenantId, personnelId: employee.id, processId: pid,
        acquiredEquipmentIds: acquired, coreEquipmentIds, targetEquipmentIds, achievedLevelIds,
        tenureMonths: tenure, elapsedMonths: null, cumulativeElapsedMonths: null,
      };
      const summary = calculateEquipmentSummary(subj);
      // 해당 공정·유효기간 내 달성기준 → level_id 매핑.
      const rulesByLevel = new Map<string, unknown>();
      for (const r of master.criteriaRules) {
        if (String(r.process_id ?? "") !== pid || r.deleted_at || r.is_active === false) continue;
        const c = normalizeCriteria(r.criteria); if (!isCriteriaEffective(c)) continue;
        const lid = String(r.level_id ?? ""); if (lid && !rulesByLevel.has(lid)) rulesByLevel.set(lid, r.criteria);
      }
      const { stages, highestPassedRank } = calculateProcessStageEligibility(subj, summary, pmLevels, rulesByLevel);
      // 현재 확정 단계 = 확정 레벨 중 최고 rank.
      let confirmedRank = 0; for (const l of pmLevels) if (achievedLevelIds.has(l.id) && l.rank_order > confirmedRank) confirmedRank = l.rank_order;
      const nextStage = stages.find((s) => !s.passed) ?? null;
      out.push({
        processId: pid, processName: nm(procById, pid),
        targetCount: summary.targetCount, acquiredCount: summary.acquiredCount, coreCount: summary.coreCount, coreTarget: coreSet.size, completionRate: summary.completionRate,
        stages, highestPassedRank,
        confirmedLevel: confirmedRank ? rankToLevel(confirmedRank) : null,
        engineLevel: highestPassedRank ? rankToLevel(highestPassedRank) : null,
        nextLevel: nextStage ? { code: nextStage.code, name: nm(levelById, nextStage.levelId), missing: nextStage.result.missing } : null,
      });
    }
    return out.sort((a, b) => a.processName.localeCompare(b.processName, "ko"));
  }, [master, state, employee, pmLevels, equipProcess, procById, levelById, tenantId]);

  const procFilterOpts = useMemo(() => evals.map((e) => ({ id: e.processId, name: e.processName })), [evals]);
  const shown = useMemo(() => (fProcess ? evals.filter((e) => e.processId === fProcess) : evals), [evals, fProcess]);
  const needsReeval = state?.needsReeval === true;

  const card = darkMode ? "rounded-2xl border border-slate-700 bg-slate-800/40 p-4" : "rounded-2xl border border-slate-200 bg-white p-4";
  const chip = darkMode ? "rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300" : "rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600";
  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const stageBadge = (passed: boolean) => passed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-500">직원을 선택하면 현재 취득 설비 기준으로 Single~M4 단계 충족 여부를 계산해 보여줍니다(조회 전용, 저장/강등 없음).</p>
        <button className={`${chip} hover:opacity-80`} onClick={() => { setNonce((n) => n + 1); onToast?.("최신 데이터로 다시 계산했습니다."); }}>↻ 재계산</button>
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
                <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>전체 대상 설비 <b className="text-slate-700 dark:text-slate-200">{ev.targetCount}</b></span>
                  <span>승인 설비 <b className="text-slate-700 dark:text-slate-200">{ev.acquiredCount}</b></span>
                  <span>주력설비 <b className="text-slate-700 dark:text-slate-200">{ev.coreCount} / {ev.coreTarget}</b></span>
                  <span>취득률 <b className="text-slate-700 dark:text-slate-200">{ev.completionRate}%</b></span>
                  <span>현재 확정 <b className="text-slate-700 dark:text-slate-200">{ev.confirmedLevel?.code ?? "없음"}</b></span>
                  <span>다음 단계 <b className="text-slate-700 dark:text-slate-200">{ev.nextLevel?.code ?? "—"}</b></span>
                </div>

                {/* 단계별(Single~M4) */}
                <div className="space-y-1.5">
                  {ev.stages.map((s) => {
                    const crit = master?.criteriaRules.find((r) => String(r.process_id ?? "") === ev.processId && String(r.level_id ?? "") === s.levelId && !r.deleted_at && r.is_active !== false);
                    const label = crit ? describeCriteria(crit.criteria) : "기준 규칙 미정의";
                    return (
                      <div key={s.levelId} className={`rounded-xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{nm(levelById, s.levelId)} <span className="text-xs text-slate-400">{s.code}</span></span>
                          <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${stageBadge(s.passed)}`}>{s.passed ? "충족" : "미충족"}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{label}</div>
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
