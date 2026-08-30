// 군대관리 v2 1A — 조치대상(읽기 전용). 기존 데이터 파생만 · 쓰기/상태변경/담당자지정 없음.
import { useMemo, useState } from "react";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice } from "../../types/domain";
import { buildMilitaryActionItems, ACTION_TYPE_LABEL, type MilitaryActionType, type MilitaryActionItem } from "./militaryDerive";
import { exportMilitaryXlsx, militaryTodayStamp } from "./militaryExport";

type Props = {
  darkMode: boolean;
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
  deptOf: (p: MilitaryPersonnel) => string;
  formatDate?: (v: string) => string;
  onOpenPerson?: (personId: string) => void;
  onNavigateType?: (type: MilitaryActionType) => void; // 유형별 보조 이동(미이수/임박→훈련, 미발송→공지)
  onExport?: (info: { rowCount: number; filterSummary: string }) => void;
};

const NAV_LABEL: Partial<Record<MilitaryActionType, string>> = { "미이수": "훈련기록", "임박7": "훈련기록", "임박30": "훈련기록", "미발송": "공지사항" };

const TYPE_ORDER: Array<MilitaryActionType | "전체"> = ["전체", "미이수", "미발송", "임박7", "임박30", "정보누락"];
const TYPE_CHIP: Record<MilitaryActionType, string> = {
  "미이수": "text-rose-700 bg-rose-50 dark:bg-rose-950/40",
  "미발송": "text-purple-700 bg-purple-50 dark:bg-purple-950/40",
  "임박7": "text-amber-700 bg-amber-50 dark:bg-amber-950/40",
  "임박30": "text-cyan-700 bg-cyan-50 dark:bg-cyan-950/40",
  "정보누락": "text-slate-700 bg-slate-100 dark:bg-slate-800",
};

export default function MilitaryActionItemsPanel({ darkMode, personnel, training, notices, deptOf, formatDate, onOpenPerson, onNavigateType, onExport }: Props) {
  const [typeF, setTypeF] = useState<MilitaryActionType | "전체">("전체");
  const [deptF, setDeptF] = useState("전체");
  const [search, setSearch] = useState("");

  const fmt = (v: string) => (formatDate ? formatDate(v) : (v || "-")) || "-";
  const all = useMemo(() => buildMilitaryActionItems({ personnel, training, notices, deptOf }), [personnel, training, notices, deptOf]);
  const depts = useMemo(() => Array.from(new Set(all.map((i) => i.dept).filter((d) => d && d !== "-"))).sort(), [all]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { 전체: all.length };
    all.forEach((i) => { c[i.type] = (c[i.type] ?? 0) + 1; });
    return c;
  }, [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((i) => (typeF === "전체" || i.type === typeF) && (deptF === "전체" || i.dept === deptF) && (!q || `${i.personName} ${i.relInfo}`.toLowerCase().includes(q)))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [all, typeF, deptF, search]);
  const distinctPersons = useMemo(() => new Set(rows.map((r) => r.personId).filter(Boolean)).size, [rows]);

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  const doExport = () => {
    const data = rows.map((r: MilitaryActionItem) => ({
      "유형": ACTION_TYPE_LABEL[r.type], "대상자": r.personName, "부서": r.dept, "발생일": fmt(r.baseDate), "기한": r.dueDate ? fmt(r.dueDate) : "-", "상태": r.status, "관련내용": r.relInfo,
    }));
    const fSummary = `유형:${typeF} · 부서:${deptF}${search.trim() ? ` · 검색:${search.trim()}` : ""}`;
    exportMilitaryXlsx(data, "조치대상", `군대관리_조치대상_${militaryTodayStamp()}.xlsx`);
    onExport?.({ rowCount: rows.length, filterSummary: fSummary });
  };

  const chip = (k: MilitaryActionType | "전체", label: string) => (
    <button key={k} onClick={() => setTypeF(k)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${typeF === k ? "bg-blue-600 text-white" : btn}`}>
      {label} <span className="ml-1 opacity-70">{counts[k] ?? 0}</span>
    </button>
  );

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">조치대상 <span className="text-xs font-normal text-slate-400">(읽기 전용 · 현재 데이터 파생)</span></h3>
          <p className="text-sm text-slate-500">조치 {rows.length}건 / 대상자 {distinctPersons}명</p>
        </div>
        <button className={btn} onClick={doExport}>Excel 내보내기</button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {TYPE_ORDER.map((k) => chip(k, k === "전체" ? "전체" : ACTION_TYPE_LABEL[k]))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <select value={deptF} onChange={(e) => setDeptF(e.target.value)} className={inputCls}><option value="전체">부서: 전체</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(대상자/내용)" className={`${inputCls} min-w-[180px]`} />
      </div>

      {/* PC 테이블 */}
      <div className="hidden overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 sm:block">
        <table className="w-full text-left text-xs">
          <thead className={darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}>
            <tr>{["유형", "대상자", "부서", "발생일", "기한", "상태", "관련내용", "작업"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                <td className="whitespace-nowrap px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${TYPE_CHIP[r.type]}`}>{ACTION_TYPE_LABEL[r.type]}</span></td>
                <td className="whitespace-nowrap px-3 py-2">{r.personName}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.dept}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmt(r.baseDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.dueDate ? fmt(r.dueDate) : "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.relInfo}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.personId && <button className="text-blue-600 hover:underline" onClick={() => onOpenPerson?.(r.personId)}>상세보기</button>}
                  {onNavigateType && NAV_LABEL[r.type] && <>{r.personId && <span className="mx-1 text-slate-300">·</span>}<button className="text-slate-500 hover:underline" onClick={() => onNavigateType(r.type)}>{NAV_LABEL[r.type]}</button></>}
                  {!r.personId && !NAV_LABEL[r.type] && <span className="text-slate-400">-</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">현재 처리할 조치사항이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 모바일 카드 */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${TYPE_CHIP[r.type]}`}>{ACTION_TYPE_LABEL[r.type]}</span>
              {r.personId && <button className="text-xs text-blue-600 hover:underline" onClick={() => onOpenPerson?.(r.personId)}>상세보기</button>}
            </div>
            <div className="mt-1 text-sm font-semibold">{r.personName} <span className="text-xs font-normal text-slate-500">{r.dept}</span></div>
            <div className="mt-0.5 text-xs text-slate-500">{r.relInfo}</div>
            <div className="mt-1 text-[0.7rem] text-slate-400">발생 {fmt(r.baseDate)}{r.dueDate ? ` · 기한 ${fmt(r.dueDate)}` : ""} · {r.status}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="px-3 py-8 text-center text-xs text-slate-500">현재 처리할 조치사항이 없습니다.</div>}
      </div>
    </section>
  );
}
