import { ClipboardList } from "lucide-react";
import { EXAM_TAB_TITLES, type ExamTabKey } from "../examTabs";

// 시험관리(대메뉴) 1단계 — 하위 메뉴별 임시 빈 화면(placeholder).
// 실제 CRUD/Excel/통계/보고서/Supabase 연동은 이후 단계에서 구현한다.
export default function ExamManagementPage({ tab, darkMode }: { tab: ExamTabKey; darkMode: boolean }) {
  const title = EXAM_TAB_TITLES[tab] || "시험관리";
  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">시험관리</p>
      </div>
      <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-300 text-slate-400"}`}>
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${darkMode ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-400"}`}>
          <ClipboardList className="h-6 w-6" />
        </span>
        <div className="text-sm font-medium">시험관리 기능을 준비 중입니다.</div>
      </div>
    </section>
  );
}
