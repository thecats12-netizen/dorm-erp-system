import { useCallback, useEffect, useState } from "react";
import { EXAM_ENTITY_CONFIGS } from "../examMasterConfigs";
import ExamMasterGrid from "./ExamMasterGrid";
import { downloadExamMasterTemplate, downloadExamMasterCurrent, loadExamMasterCounts } from "../services/examMasterBundleService";

// 시험관리 > 인증 기준관리 — 기준정보(제품군/그룹/제품파트/공정/장비/레벨) + 인증 규칙(exam_rules) CRUD.
//  · 상단: 등록 순서 안내 + 항목별 요약 카운트 + 통합 Excel(양식/현재데이터) 다운로드.
//  · 하위 탭 + 단일 등록/수정(ExamMasterGrid)은 기존 그대로 유지.
export default function ExamRulesPage({
  darkMode, canEdit, tenantId, userId, onToast,
}: {
  darkMode: boolean;
  canEdit: boolean;
  tenantId: string;
  userId: string;
  onToast?: (msg: string) => void;
}) {
  const [sub, setSub] = useState<string>(EXAM_ENTITY_CONFIGS[0].key);
  const active = EXAM_ENTITY_CONFIGS.find((c) => c.key === sub) || EXAM_ENTITY_CONFIGS[0];
  // 하위 빠른 추가: 상위 탭에서 "○○ 추가" 클릭 → 자식 탭으로 전환하고 상위 FK 를 채운 등록 모달을 연다.
  const [pendingChild, setPendingChild] = useState<{ key: string; scope: Record<string, unknown> } | null>(null);
  const handleQuickAdd = useCallback((childKey: string, scope: Record<string, unknown>) => {
    setSub(childKey);
    setPendingChild({ key: childKey, scope });
  }, []);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  const refreshCounts = useCallback(() => {
    loadExamMasterCounts(tenantId).then(setCounts).catch(() => setCounts({}));
  }, [tenantId]);
  useEffect(() => { refreshCounts(); }, [refreshCounts, sub]); // 탭 이동(=저장 후 복귀) 시 갱신

  const exportCurrent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { counts: c } = await downloadExamMasterCurrent(tenantId, includeInactive);
      setCounts(c);
      onToast?.("현재 인증 기준정보를 통합 Excel로 내려받았습니다.");
    } catch (e) {
      onToast?.(`통합 다운로드에 실패했습니다: ${(e as { message?: string })?.message || "오류"}`);
    } finally { setBusy(false); }
  };

  const subCls = (on: boolean) => `rounded-lg px-3 py-1.5 text-xs font-medium ${on ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}`;
  const btnCls = `rounded-xl border px-3 py-1.5 text-xs font-medium ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`;

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">인증 기준관리</h2>
          <p className="text-sm text-slate-500">시험관리 · 기준정보 및 취득/달성/유효기간/목표 기준을 관리합니다.</p>
        </div>
        {/* 통합 Excel: 양식/현재데이터 다운로드. 통합 업로드(트랜잭션 저장)는 다음 단계에서 제공. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />미사용 포함
          </label>
          <button type="button" className={btnCls} onClick={downloadExamMasterTemplate}>통합 양식 다운로드</button>
          <button type="button" className={btnCls} disabled={busy} onClick={() => void exportCurrent()}>{busy ? "내보내는 중…" : "현재 데이터 통합 다운로드"}</button>
        </div>
      </div>

      {/* 등록 순서 + 항목별 요약 카운트 */}
      <div className={`mb-4 rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}>
        <div className="mb-2 text-xs font-medium text-slate-500">등록 순서</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {EXAM_ENTITY_CONFIGS.map((c, i) => (
            <div key={c.key} className="flex items-center gap-1.5">
              <button type="button" onClick={() => setSub(c.key)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${sub === c.key ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100")}`}>
                <span className="font-medium">{i + 1}. {c.title}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold ${counts[c.key] ? (sub === c.key ? "bg-white/20" : "bg-emerald-100 text-emerald-700") : "bg-slate-200 text-slate-500"}`}>{counts[c.key] ?? "–"}</span>
              </button>
              {i < EXAM_ENTITY_CONFIGS.length - 1 && <span className="text-slate-400">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 하위 탭 */}
      <div className="mb-4 flex flex-wrap gap-1">
        {EXAM_ENTITY_CONFIGS.map((c) => (
          <button key={c.key} type="button" onClick={() => setSub(c.key)} className={subCls(sub === c.key)}>{c.title}</button>
        ))}
      </div>

      <ExamMasterGrid key={active.key} config={active} darkMode={darkMode} canEdit={canEdit} tenantId={tenantId} userId={userId} onToast={onToast}
        onQuickAdd={handleQuickAdd}
        initialEdit={pendingChild && pendingChild.key === active.key ? (pendingChild.scope as Record<string, unknown>) : null}
        onInitialEditConsumed={() => setPendingChild(null)} />
    </section>
  );
}
