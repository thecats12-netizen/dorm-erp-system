import { useState } from "react";
import { EXAM_ENTITY_CONFIGS } from "../examMasterConfigs";
import ExamMasterGrid from "./ExamMasterGrid";

// 시험관리 > 인증 기준관리 — 기준정보(제품군/그룹/파트/공정/레벨/장비) + 인증 기준(exam_rules) CRUD.
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

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">인증 기준관리</h2>
        <p className="text-sm text-slate-500">시험관리 · 기준정보 및 취득/달성/유효기간/목표 기준을 관리합니다.</p>
      </div>

      {/* 하위 탭 */}
      <div className="mb-4 flex flex-wrap gap-1">
        {EXAM_ENTITY_CONFIGS.map((c) => (
          <button key={c.key} type="button" onClick={() => setSub(c.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${sub === c.key ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}`}>
            {c.title}
          </button>
        ))}
      </div>

      <ExamMasterGrid key={active.key} config={active} darkMode={darkMode} canEdit={canEdit} tenantId={tenantId} userId={userId} onToast={onToast} />
    </section>
  );
}
