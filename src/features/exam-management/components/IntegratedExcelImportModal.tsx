// 통합 Excel 등록 모달 — 한 파일의 여러 시트를 FK 순서로 분석(미리보기) 후 저장. 조회 전용 분석 → 사용자 확인 후 커밋.
import { useState } from "react";
import * as XLSX from "xlsx";
import { analyzeIntegratedWorkbook, commitIntegratedWorkbook, type IntegratedAnalysis, type CommitSummary } from "../services/examMasterIntegratedImport";

type Props = { darkMode: boolean; tenantId: string; userId: string; onClose: () => void; onDone?: () => void };

export default function IntegratedExcelImportModal({ darkMode, tenantId, userId, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<IntegratedAnalysis | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setError(null); setSummary(null); setAnalysis(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setAnalysis(await analyzeIntegratedWorkbook(wb, tenantId));
    } catch { setError("파일을 분석하지 못했습니다. Excel 형식과 시트를 확인해 주세요."); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!analysis || busy) return;
    setBusy(true); setError(null);
    try { const s = await commitIntegratedWorkbook(analysis, tenantId, userId); setSummary(s); onDone?.(); }
    catch { setError("등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-2 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100";
  const totalNewUpd = analysis ? analysis.sheets.reduce((n, s) => n + s.counts.new + s.counts.update, 0) : 0;
  const totalErr = analysis ? analysis.sheets.reduce((n, s) => n + s.counts.error, 0) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-8 w-full max-w-2xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold">통합 Excel 등록</h3>
        <p className="mb-4 text-sm text-slate-500">한 파일의 시트를 그룹 → 제품군 → 공정 → 장비 → 인증레벨 → 인증규칙 순서로 처리합니다. 같은 부모 스코프의 코드는 수정, 없으면 신규로 등록됩니다.</p>

        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold text-white ${busy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>
          {busy ? "처리 중…" : "Excel 파일 선택"}
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { void onPick(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        </label>

        {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}

        {analysis && !summary && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">미리보기</div>
            <div className="max-h-[40vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                  <tr>{["시트", "총", "신규", "수정", "중복", "오류"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {analysis.sheets.map((s) => (
                    <tr key={s.key} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      <td className="px-2.5 py-1.5">{s.title}{!s.sheetName && <span className="ml-1 text-slate-400">(시트 없음)</span>}</td>
                      <td className="px-2.5 py-1.5">{s.total}</td>
                      <td className="px-2.5 py-1.5 text-emerald-600">{s.counts.new}</td>
                      <td className="px-2.5 py-1.5 text-blue-600">{s.counts.update}</td>
                      <td className="px-2.5 py-1.5 text-slate-500">{s.counts.dup}</td>
                      <td className={`px-2.5 py-1.5 ${s.counts.error ? "text-rose-600" : "text-slate-400"}`}>{s.counts.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(analysis.holdSheets.length > 0 || analysis.unknownSheets.length > 0) && (
              <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {analysis.holdSheets.length > 0 && <div>처리보류: {analysis.holdSheets.join(", ")} (상위 기준정보 오류 또는 개별 화면 전용)</div>}
                {analysis.unknownSheets.length > 0 && <div>인식 불가 시트(건너뜀): {analysis.unknownSheets.join(", ")}</div>}
              </div>
            )}
            {/* 오류 상세(최대 5) */}
            {totalErr > 0 && (
              <ul className="mt-2 max-h-24 list-disc space-y-0.5 overflow-auto rounded-xl bg-rose-50 px-5 py-2 text-xs text-rose-600 dark:bg-rose-950/30">
                {analysis.sheets.flatMap((s) => s.rows.filter((r) => r.action === "error").slice(0, 3).map((r) => `${s.title} ${r.rowNo}행: ${r.reason}`)).slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-slate-500">저장 대상 {totalNewUpd}건{totalErr ? ` · 오류 ${totalErr}건 제외` : ""}</span>
              <button className={btn} onClick={onClose}>취소</button>
              <button disabled={busy || totalNewUpd === 0} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${busy || totalNewUpd === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`} onClick={() => void commit()}>등록 실행</button>
            </div>
          </div>
        )}

        {summary && (
          <div className="mt-4">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{summary.message}</div>
            <div className="mt-4 flex justify-end"><button className={btn} onClick={onClose}>닫기</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
