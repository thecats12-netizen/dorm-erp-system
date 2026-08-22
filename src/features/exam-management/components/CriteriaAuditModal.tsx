// 단계 기준 정합성 검사 — 감사 + "선택 적용"(사용자가 체크한 행만 · 미리보기 후 적용).
//  설비별 인증단계 기준 "예상 required_equipment_ids/선행단계"를 현재 공정별 달성기준과 비교하고, 적용 가능한 행만 권장값으로 저장.
//  ⚠ UUID 비노출(장비명/코드). 적용은 기존 upsertProcessCriteriaRule(감사로그·updated_by/at·tenant·RLS 준수). 자동 일괄수정/삭제 없음.
import { useCallback, useEffect, useMemo, useState } from "react";
import { runCriteriaAudit } from "../services/certificationCriteriaAuditService";
import { upsertProcessCriteriaRule } from "../services/processCriteriaRuleService";
import type { ExamRow } from "../services/examMasterService";
import type { AuditStatus, CriteriaAuditRow } from "../types/criteriaAudit";

type Props = { darkMode: boolean; tenantId: string; userId: string; canEdit: boolean; onClose: () => void; onApplied?: () => void };
type ApplyResult = { ok: boolean; error?: string };

const STATUS_TONE: Record<AuditStatus, string> = {
  "정상": "bg-emerald-100 text-emerald-700",
  "미등록": "bg-slate-200 text-slate-600",
  "필수설비 누락": "bg-rose-100 text-rose-700",
  "불필요 설비 포함": "bg-amber-100 text-amber-700",
  "선행단계 오류": "bg-rose-100 text-rose-700",
  "min_equipment_count 사용 위험": "bg-orange-100 text-orange-700",
  "criteria 중복": "bg-purple-100 text-purple-700",
  "단계 설비 미등록": "bg-slate-300 text-slate-700",
  "정책확인필요": "bg-yellow-100 text-yellow-700",
};

export default function CriteriaAuditModal({ darkMode, tenantId, userId, canEdit, onClose, onApplied }: Props) {
  const [rows, setRows] = useState<CriteriaAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fGroup, setFGroup] = useState(""); const [fCat, setFCat] = useState(""); const [fProc, setFProc] = useState("");
  const [fStage, setFStage] = useState(""); const [fStatus, setFStatus] = useState("");
  const [sel, setSel] = useState<CriteriaAuditRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());   // 체크한 행 key
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Map<string, ApplyResult>>(new Map());  // key → 적용 결과(행별)

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await runCriteriaAudit(tenantId); if (!r.ok) setError(r.message ?? "불러오지 못했습니다."); setRows(r.rows); }
    catch (e) { setError((e as { message?: string })?.message || "오류가 발생했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const opts = (key: keyof CriteriaAuditRow) => Array.from(new Set(rows.map((r) => String(r[key])))).filter(Boolean).sort();
  const filtered = useMemo(() => rows.filter((r) =>
    (!fGroup || r.groupName === fGroup) && (!fCat || r.categoryName === fCat) && (!fProc || r.processName === fProc) &&
    (!fStage || r.stageName === fStage) && (!fStatus || r.status === fStatus)
  ), [rows, fGroup, fCat, fProc, fStage, fStatus]);

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const selectedRows = useMemo(() => [...selected].map((k) => byKey.get(k)).filter((r): r is CriteriaAuditRow => !!r && r.applicable), [selected, byKey]);
  const toggleSel = (key: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const selectAllApplicable = () => setSelected(new Set(filtered.filter((r) => r.applicable).map((r) => r.key)));

  // 선택 행만 순차 적용(행별 성공/실패 분리). 기존 upsert(감사·tenant·RLS) 재사용. 자동 삭제/일괄 없음.
  const doApply = async () => {
    if (!canEdit || applying || !selectedRows.length) return;
    setApplying(true);
    const res = new Map(results);
    for (const r of selectedRows) {
      if (!r.applicable || !r.recommendedCriteria) { res.set(r.key, { ok: false, error: r.blockReason ?? "적용 불가" }); continue; }
      try {
        const payload = { ...(r.targetRuleId ? { id: r.targetRuleId } : {}), process_id: r.processId, level_id: r.levelId, criteria: r.recommendedCriteria as unknown as ExamRow[keyof ExamRow] } as ExamRow;
        await upsertProcessCriteriaRule(payload, tenantId, userId, { reason: `정합성 검사 선택 적용(${r.status})` });
        res.set(r.key, { ok: true });
      } catch (e) { res.set(r.key, { ok: false, error: (e as { message?: string })?.message || "적용 실패" }); }
    }
    setResults(res); setApplying(false); setPreviewOpen(false);
    setSelected((prev) => { const n = new Set(prev); for (const [k, v] of res) if (v.ok) n.delete(k); return n; }); // 성공 행은 선택 해제
    await load();          // 적용 후 감사 재실행 → 상태 갱신 확인
    onApplied?.();         // 상위 목록 갱신
  };
  const applied = [...results.values()].filter((v) => v.ok).length;
  const failed = [...results.values()].filter((v) => !v.ok).length;

  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-xs outline-none" : "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none";
  const th = "whitespace-nowrap px-2.5 py-2 text-left font-medium";
  const td = "whitespace-nowrap px-2.5 py-2";
  const names = (arr: { name: string }[]) => arr.length ? arr.map((x) => x.name).join(", ") : "-";
  const badge = (s: AuditStatus) => <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${STATUS_TONE[s]}`}>{s}</span>;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-6 w-full max-w-6xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">단계 기준 정합성 검사</h3>
            <p className="text-xs text-slate-500">설비별 인증단계 → 예상 필수설비/선행단계를 현재 공정별 달성기준과 비교합니다. {canEdit ? "체크한 행만 미리보기 후 선택 적용(자동 일괄수정·삭제 없음)." : "조회 전용."} 장비명 표시.</p>
          </div>
          <button className={inp} onClick={onClose}>닫기</button>
        </div>

        {/* 요약 */}
        {!loading && !error && (
          <div className="mb-3 flex flex-wrap gap-1.5">{summary.map(([s, n]) => <span key={s} className="flex items-center gap-1">{badge(s as AuditStatus)}<span className="text-xs text-slate-500">{n}</span></span>)}</div>
        )}

        {/* 필터 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} className={inp}><option value="">그룹: 전체</option>{opts("groupName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fCat} onChange={(e) => setFCat(e.target.value)} className={inp}><option value="">제품군: 전체</option>{opts("categoryName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fProc} onChange={(e) => setFProc(e.target.value)} className={inp}><option value="">공정: 전체</option>{opts("processName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fStage} onChange={(e) => setFStage(e.target.value)} className={inp}><option value="">단계: 전체</option>{opts("stageName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inp}><option value="">상태: 전체</option>{opts("status").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <span className="text-xs text-slate-400">총 {filtered.length}건</span>
        </div>

        {/* 선택 적용 툴바 */}
        {canEdit && !loading && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5 dark:border-slate-700">
            <button className={inp} onClick={selectAllApplicable}>적용 가능 전체 선택</button>
            <button className={inp} onClick={() => setSelected(new Set())} disabled={!selected.size}>선택 해제</button>
            <button className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:bg-slate-400" disabled={!selectedRows.length || applying} onClick={() => setPreviewOpen(true)}>선택 항목 수정 미리보기 ({selectedRows.length})</button>
            {(applied > 0 || failed > 0) && <span className="text-xs">적용 성공 <b className="text-emerald-600">{applied}</b> · 실패 <b className="text-rose-600">{failed}</b></span>}
            <span className="text-[0.65rem] text-slate-400">※ 적용 불가 행은 체크 불가(사유 표시). 중복/Single 미확정/불일치는 수동 확인.</span>
          </div>
        )}

        {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
        {loading ? <div className="py-10 text-center text-sm text-slate-500">검사 중…</div> : (
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{[...(canEdit ? ["✔"] : []), "그룹", "제품군", "공정", "단계", "단계설비", "현재", "예상", "현재선행", "예상선행", "상태", ...(canEdit ? ["적용"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((r) => { const res = results.get(r.key); return (
                    <tr key={r.key} className={`cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${sel?.key === r.key ? (darkMode ? "bg-slate-800" : "bg-blue-50") : ""}`} onClick={() => setSel(r)}>
                      {canEdit && <td className={`${td} text-center`} onClick={(e) => e.stopPropagation()}>
                        {r.applicable
                          ? <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggleSel(r.key)} />
                          : <span title={r.blockReason ?? "적용 대상 아님"} className="text-slate-400">–</span>}
                      </td>}
                      <td className={td}>{r.groupName}</td><td className={td}>{r.categoryName}</td><td className={td}>{r.processName}</td>
                      <td className={td}>{r.stageName}</td>
                      <td className={`${td} text-center`}>{r.stageEquip.length}{r.isSingle && r.stageEquip.length >= 2 ? " (OR)" : ""}</td>
                      <td className={`${td} text-center`}>{r.currentExists ? r.currentRequired.length : "-"}</td>
                      <td className={`${td} text-center`}>{r.expectedEquip.length}</td>
                      <td className={td}>{names(r.currentPrereqNames.map((n) => ({ name: n })))}</td>
                      <td className={td}>{names(r.expectedPrereqNames.map((n) => ({ name: n })))}</td>
                      <td className={td}>{badge(r.status)}</td>
                      {canEdit && <td className={`${td} text-center`}>{res ? (res.ok ? <span className="text-emerald-600" title="적용됨">✓</span> : <span className="text-rose-600" title={res.error}>✗</span>) : (r.applicable ? "" : <span className="text-slate-400" title={r.blockReason ?? ""}>불가</span>)}</td>}
                    </tr>
                  ); })}
                  {!filtered.length && <tr><td colSpan={canEdit ? 12 : 10} className="px-3 py-10 text-center text-slate-500">해당 조건의 항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* 상세 */}
            <div className={`max-h-[56vh] overflow-auto rounded-xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
              {!sel ? <p className="text-slate-500">행을 선택하면 현재/예상 기준과 차이를 표시합니다.</p> : (
                <div className="space-y-2">
                  <div className="font-semibold">{sel.processName} · {sel.stageName} {badge(sel.status)}</div>
                  <div><div className="text-slate-500">단계 설비(설비별 인증단계)</div><div>{names(sel.stageEquip)}</div></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="text-slate-500">현재 필수설비</div><div>{sel.currentExists ? names(sel.currentRequired) : "미등록"}</div></div>
                    <div><div className="text-slate-500">예상 필수설비</div><div>{sel.isSingle && sel.singleNeedsGroups ? `아무 1개(OR): ${names(sel.expectedEquip)}` : names(sel.expectedEquip)}</div></div>
                    <div><div className="text-slate-500">현재 선행단계</div><div>{names(sel.currentPrereqNames.map((n) => ({ name: n })))}</div></div>
                    <div><div className="text-slate-500">예상 선행단계</div><div>{names(sel.expectedPrereqNames.map((n) => ({ name: n })))}</div></div>
                    <div><div className="text-slate-500">min_equipment_count</div><div>{sel.currentMinEquipmentCount ?? "-"}</div></div>
                    <div><div className="text-slate-500">criteria 행 수</div><div>{sel.currentRowCount}</div></div>
                  </div>
                  {sel.missing.length > 0 && <div className="text-rose-600">+ 추가 필요: {names(sel.missing)}</div>}
                  {sel.extra.length > 0 && <div className="text-amber-600">− 제거 검토: {names(sel.extra)}</div>}
                  {sel.flags.length > 0 && <div><div className="text-slate-500">감지</div><div className="flex flex-wrap gap-1">{sel.flags.map((f) => badge(f))}</div></div>}
                  {sel.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-slate-500">{sel.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                  {sel.applicable
                    ? <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700 dark:bg-emerald-950/30"><div className="font-medium">적용 가능</div><ul className="list-disc pl-4">{sel.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
                    : sel.blockReason && <div className="rounded-lg bg-yellow-50 px-2 py-1.5 text-yellow-700 dark:bg-yellow-950/30">적용 불가: {sel.blockReason}</div>}
                  {results.get(sel.key) && <div className={results.get(sel.key)!.ok ? "text-emerald-600" : "text-rose-600"}>{results.get(sel.key)!.ok ? "✓ 적용됨" : `✗ 실패: ${results.get(sel.key)!.error}`}</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 선택 적용 미리보기(재확인) */}
      {previewOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setPreviewOpen(false)}>
          <div className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-semibold">선택 항목 수정 미리보기 · {selectedRows.length}건</h3>
            <p className="mb-3 text-xs text-slate-500">아래 변경을 적용합니다. 현재 criteria는 권장값으로 저장/신규 등록되며, 기존 행 삭제·비활성화는 하지 않습니다. 영향: 직원별 인증 Preview·PM 후보 판정(해당 공정·단계). 적용 후 자동 재검사합니다.</p>
            <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}><tr>{["공정", "단계", "현재 필수설비", "권장 필수설비", "현재선행", "권장선행", "변경/경고"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {selectedRows.map((r) => (
                    <tr key={r.key} className={`border-t align-top ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      <td className={td}>{r.processName}</td><td className={td}>{r.stageName}</td>
                      <td className="px-2.5 py-2">{r.currentExists ? names(r.currentRequired) : "미등록"}</td>
                      <td className="px-2.5 py-2 text-emerald-700 dark:text-emerald-400">{names(r.expectedEquip)}</td>
                      <td className={td}>{names(r.currentPrereqNames.map((n) => ({ name: n }))) }</td>
                      <td className={`${td} text-emerald-700 dark:text-emerald-400`}>{names(r.expectedPrereqNames.map((n) => ({ name: n })))}</td>
                      <td className="px-2.5 py-2"><ul className="list-disc pl-4">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>{r.currentMinEquipmentCount != null && <div className="text-orange-600">min_equipment_count 제거</div>}</td>
                    </tr>
                  ))}
                  {!selectedRows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">적용 가능한 선택 항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className={inp} onClick={() => setPreviewOpen(false)} disabled={applying}>취소</button>
              <button className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:bg-slate-400" disabled={applying || !selectedRows.length} onClick={() => void doApply()}>{applying ? "적용 중…" : `적용 (${selectedRows.length})`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
