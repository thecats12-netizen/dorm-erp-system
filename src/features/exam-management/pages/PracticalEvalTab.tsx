import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadPracticalTargets, savePracticalResult, finalizePracticalEvaluation, computeEquipmentResult, computePracticalResult, PRACTICAL_FALLBACK,
  type PracticalBoard,
} from "../services/practicalEvalService";
import { EVAL_STATUS_LABEL, type OverallStatus, type EvalStatus, type ChecklistItem, type PracticalEvaluatorResult, type PracticalTarget } from "../types/practicalEval";

// 시험 응시관리 > "실기 평가" 하위 탭(2차 · 입력/저장). 확정/practical_pass_date/PM·DM 연동은 미구현.
//  · 판정은 practicalEvalService 순수 함수(computeEquipmentResult/computePracticalResult)로만 계산(UI 계산 금지).
const STATUS_TONE: Record<OverallStatus, string> = {
  pending: "bg-slate-200 text-slate-600", in_progress: "bg-blue-100 text-blue-700", awaiting_decision: "bg-amber-100 text-amber-700",
  passed: "bg-emerald-100 text-emerald-700", failed: "bg-rose-100 text-rose-700", review_required: "bg-amber-100 text-amber-700", partial_complete: "bg-indigo-100 text-indigo-700",
};
type DraftRow = { evaluator: string; resultDate: string; score: string; notes: string; checklist: ChecklistItem[] };
const dkey = (eqId: string, no: number) => `${eqId}|${no}`;

export default function PracticalEvalTab({ darkMode, canEdit, tenantId, userId }: { darkMode: boolean; canEdit?: boolean; tenantId: string; userId?: string }) {
  const [board, setBoard] = useState<PracticalBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selId, setSelId] = useState("");
  const [search, setSearch] = useState("");
  const [processF, setProcessF] = useState("");
  const [statusF, setStatusF] = useState<"" | OverallStatus>("");
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const load = useCallback(async (keepSel = true) => {
    setLoading(true); setError(null);
    try { const b = await loadPracticalTargets(tenantId); setBoard(b); if (!keepSel) setSelId(""); return b; }
    catch (e) { setError((e as { message?: string })?.message || "실기 평가 대상을 불러오지 못했습니다."); return null; }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { let alive = true; (async () => { const b = await load(); if (!alive) void b; })(); return () => { alive = false; }; }, [load]);

  const targets = board?.targets || [];
  const sel = targets.find((t) => t.applicationId === selId) || null;
  const evaluatorCount = Math.max(1, sel?.rule.evaluatorCount ?? PRACTICAL_FALLBACK.evaluatorCount);
  const passScore = sel?.rule.practicalPassScore ?? PRACTICAL_FALLBACK.passScore;

  // 선택 대상 변경 시 draft 초기화(기존 저장값 prefill · 이전 대상 잔존 방지).
  useEffect(() => {
    if (!sel) { setDraft({}); return; }
    const d: Record<string, DraftRow> = {};
    for (const eq of sel.equipment) {
      for (let no = 1; no <= Math.max(1, sel.rule.evaluatorCount ?? 1); no++) {
        const ex = sel.results.find((r) => r.equipmentId === eq.id && r.evaluatorNo === no);
        d[dkey(eq.id, no)] = {
          evaluator: ex?.evaluator ?? "", resultDate: ex?.resultDate ?? "", score: ex?.score != null ? String(ex.score) : "",
          notes: ex?.notes ?? "", checklist: ex?.checklist ? ex.checklist.map((c) => ({ ...c })) : [],
        };
      }
    }
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const setRow = (eqId: string, no: number, patch: Partial<DraftRow>) => setDraft((p) => ({ ...p, [dkey(eqId, no)]: { ...(p[dkey(eqId, no)] || { evaluator: "", resultDate: "", score: "", notes: "", checklist: [] }), ...patch } }));

  const buildResults = useCallback((eqId: string): PracticalEvaluatorResult[] => {
    if (!sel) return [];
    const rows: PracticalEvaluatorResult[] = [];
    for (let no = 1; no <= evaluatorCount; no++) {
      const r = draft[dkey(eqId, no)]; if (!r) continue;
      const hasInput = r.evaluator.trim() || r.score.trim() || r.checklist.length;
      if (!hasInput) continue;
      rows.push({ resultId: null, applicationId: sel.applicationId, personnelId: sel.personnelId, equipmentId: eqId, evaluator: r.evaluator.trim() || null, evaluatorNo: no, score: r.score.trim() === "" ? null : Number(r.score), maxScore: 100, checklist: r.checklist, notes: r.notes.trim() || null, resultDate: r.resultDate || null, evalStatus: null });
    }
    return rows;
  }, [sel, draft, evaluatorCount]);

  // 실시간 판정(순수 함수).
  const liveEquip = useMemo(() => {
    if (!sel) return new Map<string, ReturnType<typeof computeEquipmentResult>>();
    return new Map(sel.equipment.map((eq) => [eq.id, computeEquipmentResult(buildResults(eq.id), sel.rule, eq.name)]));
  }, [sel, buildResults]);
  const liveOverall = useMemo(() => {
    if (!sel) return null;
    return computePracticalResult(Array.from(liveEquip.values()), sel.rule, sel.equipment.map((e) => ({ id: e.id, isRepresentative: e.isRepresentative, group: e.group })));
  }, [sel, liveEquip]);

  const saveRow = async (eqId: string, no: number) => {
    if (!sel || busy) return;
    const r = draft[dkey(eqId, no)]; if (!r) return;
    if (!sel.canSave) { setError("인력정보 연결이 필요합니다(personnel_id 미확정)."); return; }
    setBusy(true); setError(null);
    try {
      const eqRes = liveEquip.get(eqId);
      const scoreNum = r.score.trim() === "" ? null : Number(r.score);
      const rowPassed = scoreNum != null && scoreNum >= passScore && r.checklist.every((c) => !c.required || c.passed === true);
      const res = await savePracticalResult(tenantId, userId || "", {
        applicationId: sel.applicationId, personnelId: sel.personnelId, equipmentId: eqId, evaluator: r.evaluator.trim() || null, evaluatorNo: no,
        score: scoreNum, maxScore: 100, passed: rowPassed, checklist: r.checklist, notes: r.notes.trim() || null,
        evalStatus: (eqRes?.status ?? null) as EvalStatus | null, resultDate: r.resultDate || null,
      });
      if (!res.ok) { setError(res.error || "저장하지 못했습니다."); return; }
      setToast("실기 평가가 저장되었습니다."); window.setTimeout(() => setToast(null), 2500);
      await load(); // 재조회 → 판정 재계산
    } finally { setBusy(false); }
  };

  const doFinalize = async () => {
    if (!sel || finalizing) return;
    setFinalizing(true); setError(null);
    try {
      const r = await finalizePracticalEvaluation(tenantId, sel.applicationId, userId || "");
      setConfirmOpen(false);
      if (!r.ok) { setError(r.error || "확정에 실패했습니다."); return; }
      setToast(r.already ? "이미 최종 확정된 평가입니다." : r.overallPass ? "실기 평가가 최종 확정되었습니다(합격 · 응시/라이선스 반영)." : "실기 평가 결과가 확정되었습니다.");
      window.setTimeout(() => setToast(null), 3000);
      await load(); // 확정 후 재조회(전체 페이지 새로고침 아님)
    } finally { setFinalizing(false); }
  };

  const processOpts = useMemo(() => Array.from(new Set(targets.map((t) => t.process).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")), [targets]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return targets.filter((t) => (!q || `${t.employeeNo} ${t.name} ${t.process} ${t.levelCode}`.toLowerCase().includes(q)) && (!processF || t.process === processF) && (!statusF || t.summary.overallStatus === statusF));
  }, [targets, search, processF, statusF]);

  const card = darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white";
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-sm" : "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm";
  const badge = (s: OverallStatus) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s]}`}>{EVAL_STATUS_LABEL[s]}</span>;

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">실기 평가 대상을 불러오는 중…</div>;
  if (error && !board) return <div className="rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-600">{error}</div>;
  if (board && !board.schemaReady) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">실기 평가 데이터 구조가 아직 준비되지 않았습니다. 관리자에게 문의하세요.</div>;

  return (
    <div>
      {toast && <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{toast}</div>}
      {error && <div className="mb-3 whitespace-pre-line rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {board && board.warnings.length > 0 && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{board.warnings.join(" · ")}</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* 좌: 실기 대상 */}
        <div className={`rounded-2xl border p-3 ${card}`}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사번/이름/공정 검색" className={`${inputCls} min-w-[120px] flex-1`} />
            <button type="button" onClick={() => void load()} className={`rounded-xl border px-2.5 py-1 text-xs ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>새로고침</button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <select value={processF} onChange={(e) => setProcessF(e.target.value)} className={`${inputCls} flex-1`}><option value="">공정: 전체</option>{processOpts.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} className={inputCls}><option value="">상태: 전체</option>{(["pending", "in_progress", "awaiting_decision", "review_required", "partial_complete", "passed", "failed"] as OverallStatus[]).map((s) => <option key={s} value={s}>{EVAL_STATUS_LABEL[s]}</option>)}</select>
          </div>
          <div className="mb-2 text-xs text-slate-500">실기 대상 {filtered.length}건</div>
          <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            {filtered.length === 0 && <div className="px-3 py-8 text-center text-xs text-slate-400">실기 평가 대상이 없습니다. {(search || processF || statusF) && <button type="button" className="ml-1 underline" onClick={() => { setSearch(""); setProcessF(""); setStatusF(""); }}>필터 초기화</button>}</div>}
            {filtered.map((t: PracticalTarget) => (
              <button key={t.applicationId} type="button" onClick={() => setSelId(t.applicationId)}
                className={`flex w-full items-center justify-between gap-2 border-t px-3 py-2 text-left text-sm first:border-t-0 ${t.applicationId === selId ? (darkMode ? "bg-blue-950/50" : "bg-blue-50") : (darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50")} ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                <span className="min-w-0"><span className="font-medium">{t.name || "-"}</span><span className="ml-1 text-xs text-slate-400">{t.employeeNo}</span><span className="block truncate text-[0.7rem] text-slate-400">{t.process || "-"} · {t.levelCode || "-"}</span></span>
                <span className="flex shrink-0 items-center gap-1">{!t.canSave && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-rose-700" title="인력정보 연결 필요">연결</span>}{badge(t.summary.overallStatus)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 우: 설비별 평가 입력 */}
        <div className={`rounded-2xl border p-3 ${card}`}>
          {!sel ? <div className="px-3 py-12 text-center text-sm text-slate-400">좌측에서 실기 대상을 선택하세요.</div> : (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div><div className="text-base font-semibold">{sel.name} <span className="text-xs font-normal text-slate-400">{sel.employeeNo}</span></div><div className="text-xs text-slate-500">{[sel.process, sel.levelCode].filter(Boolean).join(" · ") || "-"} · 방식 {sel.rule.equipmentCertMethod ?? PRACTICAL_FALLBACK.method} · 합격 {passScore}점 · 위원 {evaluatorCount}명</div></div>
                {liveOverall && (
                  <div className="flex items-center gap-2">
                    {badge(liveOverall.overallStatus)}<span className="text-xs text-slate-500">합격 {liveOverall.passedCount}/{liveOverall.targetCount}</span>
                    {canEdit && (() => {
                      const canFin = !!sel.canSave && sel.equipment.length > 0 && !["pending", "in_progress", "awaiting_decision", "review_required"].includes(liveOverall.overallStatus) && !liveOverall.warnings.some((w) => /자동 확정할 수 없습니다/.test(w));
                      return <button type="button" disabled={!canFin || finalizing} onClick={() => setConfirmOpen(true)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${canFin && !finalizing ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-slate-300 text-slate-500"}`}>실기 평가 최종 확정</button>;
                    })()}
                  </div>
                )}
              </div>
              {!sel.canSave && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">인력정보 연결이 필요합니다 — 저장할 수 없습니다.</div>}
              {liveOverall && liveOverall.warnings.length > 0 && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{liveOverall.warnings.join(" · ")}</div>}
              {sel.equipment.length === 0 && <div className="rounded-lg bg-amber-50 px-3 py-6 text-center text-xs text-amber-700">대상 설비 기준정보가 없습니다.</div>}

              <div className="space-y-3">
                {sel.equipment.map((eq) => {
                  const er = liveEquip.get(eq.id);
                  return (
                    <div key={eq.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">{eq.name || "설비"} {eq.isRepresentative && <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[0.6rem] text-slate-600 dark:bg-slate-700 dark:text-slate-300">대표</span>}</div>
                        {er && <div className="flex items-center gap-2 text-xs">{badge(er.status)}<span className="text-slate-500">평균 {er.averageScore ?? "-"} · 위원 {er.evaluatorCompleted}/{er.evaluatorRequired} · 편차 {er.variance}</span></div>}
                      </div>
                      {er && (er.reasons.length > 0 || er.warnings.length > 0) && <div className="mb-2 text-[0.7rem] text-slate-500">{[...er.reasons, ...er.warnings].join(" · ")}</div>}
                      <div className="space-y-2">
                        {Array.from({ length: evaluatorCount }, (_, i) => i + 1).map((no) => {
                          const r = draft[dkey(eq.id, no)] || { evaluator: "", resultDate: "", score: "", notes: "", checklist: [] };
                          return (
                            <div key={no} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-100 bg-slate-50"}`}>
                              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="w-12 shrink-0 text-slate-400">위원 {no}</span>
                                <input placeholder="평가위원" value={r.evaluator} onChange={(e) => setRow(eq.id, no, { evaluator: e.target.value })} className={`${inputCls} min-w-[90px] flex-1`} disabled={!canEdit || !sel.canSave} />
                                <input type="date" value={r.resultDate} onChange={(e) => setRow(eq.id, no, { resultDate: e.target.value })} className={inputCls} disabled={!canEdit || !sel.canSave} />
                                <input type="number" min={0} max={100} placeholder="점수" value={r.score} onChange={(e) => setRow(eq.id, no, { score: e.target.value })} className={`${inputCls} w-20`} disabled={!canEdit || !sel.canSave} />
                              </div>
                              {/* 체크리스트 미니 편집 */}
                              <div className="mb-1.5 space-y-1">
                                {r.checklist.map((c, ci) => (
                                  <div key={c.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <input placeholder="점검 항목" value={c.label} onChange={(e) => setRow(eq.id, no, { checklist: r.checklist.map((x, k) => k === ci ? { ...x, label: e.target.value } : x) })} className={`${inputCls} min-w-[120px] flex-1`} disabled={!canEdit || !sel.canSave} />
                                    <label className="flex items-center gap-1 text-slate-500"><input type="checkbox" checked={c.required} onChange={(e) => setRow(eq.id, no, { checklist: r.checklist.map((x, k) => k === ci ? { ...x, required: e.target.checked } : x) })} disabled={!canEdit || !sel.canSave} />필수</label>
                                    <label className="flex items-center gap-1 text-slate-500"><input type="checkbox" checked={c.passed === true} onChange={(e) => setRow(eq.id, no, { checklist: r.checklist.map((x, k) => k === ci ? { ...x, passed: e.target.checked } : x) })} disabled={!canEdit || !sel.canSave} />합격</label>
                                    <button type="button" className="text-rose-500 hover:underline" onClick={() => setRow(eq.id, no, { checklist: r.checklist.filter((_, k) => k !== ci) })} disabled={!canEdit || !sel.canSave}>삭제</button>
                                  </div>
                                ))}
                                {canEdit && sel.canSave && <button type="button" className="text-[0.7rem] text-blue-600 hover:underline" onClick={() => setRow(eq.id, no, { checklist: [...r.checklist, { id: `c-${Date.now()}`, label: "", required: false, passed: null, score: null, maxScore: null }] })}>+ 체크 항목 추가</button>}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input placeholder="메모" value={r.notes} onChange={(e) => setRow(eq.id, no, { notes: e.target.value })} className={`${inputCls} flex-1`} disabled={!canEdit || !sel.canSave} />
                                {canEdit && <button type="button" disabled={busy || !sel.canSave} onClick={() => void saveRow(eq.id, no)} className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${busy || !sel.canSave ? "bg-slate-300 text-slate-500" : "bg-blue-600 text-white hover:bg-blue-500"}`}>저장</button>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-400">저장은 설비×위원별 결과만 반영합니다. 최종 확정·practical_pass_date 갱신·라이선스/PM·DM 연동은 다음 단계입니다.</p>
            </>
          )}
        </div>
      </div>

      {/* 최종 확정 확인 모달 */}
      {confirmOpen && sel && liveOverall && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !finalizing && setConfirmOpen(false)}>
          <div className={`w-full max-w-md rounded-2xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold">실기 평가 최종 확정</h3>
            <p className="mb-3 text-sm text-slate-500">실기 평가를 최종 확정하면 응시 상태와 라이선스 단계에 반영됩니다. 계속하시겠습니까?</p>
            <div className={`mb-3 rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              전체 판정: <b>{EVAL_STATUS_LABEL[liveOverall.overallStatus]}</b> · 합격 설비 {liveOverall.passedCount}/{liveOverall.targetCount}
              <div className="mt-0.5 text-slate-500">{liveOverall.overallPassed ? "합격 → 실기 합격일(practical_pass_date) 및 취득/라이선스 파이프라인 반영" : "합격 아님 → 실기 합격일 미반영(설비별 결과만 확정)"}</div>
            </div>
            <p className="mb-3 text-[0.7rem] text-slate-400">저장된 결과 기준으로 서버에서 재검증·확정합니다. 승인 권한·중복 확정은 서버(RPC)에서 최종 방어합니다.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={finalizing} className={`rounded-xl border px-4 py-2 text-sm font-medium ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" onClick={() => void doFinalize()} disabled={finalizing} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${finalizing ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-500"}`}>{finalizing ? "확정 중…" : "최종 확정"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
