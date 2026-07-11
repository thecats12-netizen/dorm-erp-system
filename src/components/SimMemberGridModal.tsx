import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { formatDong, formatRoomHo } from "../utils/formatUtils";
import { formatDateOnly } from "../utils/formatters";
import type { DormContract, NewHireEmployee, CleaningReport, DefectRequest, InventoryItem } from "../types/domain";

// 운영시뮬레이션 통계 팝업(현거주자/만료자/중도퇴거/천안이동/신규입주) 상세 명단 1행.
export type SimMemberRow = {
  id: string;
  name: string;
  department: string;
  site: string;
  gender: string;
  phone: string;
  building: string;
  dong: string;
  roomHo: string;
  dorm: string;
  residenceStatus: string;
  moveInType: string;
  moveIn: string;
  contractEnd: string;
  actualMoveOut: string;
  cheonanMove: string;
};

type ColKey =
  | "name" | "department" | "site" | "gender" | "dorm"
  | "residenceStatus" | "moveInType" | "moveIn" | "contractEnd" | "actualMoveOut" | "cheonanMove";

const COLUMNS: { key: ColKey; label: string }[] = [
  { key: "name", label: "이름" },
  { key: "department", label: "부서" },
  { key: "site", label: "근무지" },
  { key: "gender", label: "성별" },
  { key: "dorm", label: "기숙사" },
  { key: "residenceStatus", label: "거주상태" },
  { key: "moveInType", label: "입주유형" },
  { key: "moveIn", label: "입실일" },
  { key: "contractEnd", label: "계약종료일" },
  { key: "actualMoveOut", label: "실제퇴실일" },
  { key: "cheonanMove", label: "천안이동일" },
];

type Props = {
  title: string;
  rows: SimMemberRow[];
  darkMode: boolean;
  onClose: () => void;
  // 상세정보(직원) 조회용 원본 데이터
  dormContracts: DormContract[];
  newHires: NewHireEmployee[];
  cleaningReports: CleaningReport[];
  defects: DefectRequest[];
  inventory: InventoryItem[];
};

const digits = (s?: string) => String(s || "").replace(/\D/g, "");
// 건물+동+호 정규화 매칭 키(표기 차이 흡수).
const roomKey = (b?: string, d?: string, h?: string) =>
  [b, d, h].map((s) => String(s || "").replace(/\s/g, "").replace(/동$/, "").replace(/호$/, "").toLowerCase()).join("|");

const rowKeyOf = (r: SimMemberRow) => r.id || `${r.name}|${digits(r.phone)}|${r.moveIn}|${r.dorm}`;

const uniqueSorted = (arr: string[]) => Array.from(new Set(arr.filter((v) => v && v !== "-"))).sort();

const selCls = (darkMode: boolean) =>
  darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs outline-none"
    : "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none";

// 필터 셀렉트(모듈 레벨 — 렌더 중 컴포넌트 생성 방지).
function GridSelect({ value, onChange, options, label, darkMode }: { value: string; onChange: (v: string) => void; options: string[]; label: string; darkMode: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selCls(darkMode)} aria-label={label}>
      <option value="전체">{label}: 전체</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// 상세정보 이력 테이블(모듈 레벨).
function HistoryTable({ cols, rows, darkMode }: { cols: string[]; rows: (string | number)[][]; darkMode: boolean }) {
  const cell = darkMode ? "border-slate-700" : "border-slate-200";
  const head = darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600";
  return (
    <div className="overflow-auto rounded-lg border" style={{ maxHeight: "40vh" }}>
      <table className="w-full text-left text-xs">
        <thead className={`sticky top-0 ${head}`}><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r, i) => (
            <tr key={i} className={`border-t ${cell}`}>{r.map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{v === "" || v == null ? "-" : v}</td>)}</tr>
          )) : <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-500">이력이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function SimMemberGridModal({
  title, rows, darkMode, onClose, dormContracts, newHires, cleaningReports, defects, inventory,
}: Props) {
  const [search, setSearch] = useState("");
  const [fSite, setFSite] = useState("전체");
  const [fDept, setFDept] = useState("전체");
  const [fBuilding, setFBuilding] = useState("전체");
  const [fDong, setFDong] = useState("전체");
  const [fRoom, setFRoom] = useState("전체");
  const [fResidence, setFResidence] = useState("전체");
  const [fType, setFType] = useState("전체");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
  const [pinName, setPinName] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<SimMemberRow | null>(null);

  const siteOpts = useMemo(() => uniqueSorted(rows.map((r) => r.site)), [rows]);
  const deptOpts = useMemo(() => uniqueSorted(rows.map((r) => r.department)), [rows]);
  const buildingOpts = useMemo(() => uniqueSorted(rows.map((r) => r.building)), [rows]);
  const dongOpts = useMemo(() => uniqueSorted(rows.map((r) => r.dong)), [rows]);
  const roomOpts = useMemo(() => uniqueSorted(rows.map((r) => r.roomHo)), [rows]);
  const residenceOpts = useMemo(() => uniqueSorted(rows.map((r) => r.residenceStatus)), [rows]);
  const typeOpts = useMemo(() => uniqueSorted(rows.map((r) => r.moveInType)), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (fSite !== "전체" && r.site !== fSite) return false;
      if (fDept !== "전체" && r.department !== fDept) return false;
      if (fBuilding !== "전체" && r.building !== fBuilding) return false;
      if (fDong !== "전체" && r.dong !== fDong) return false;
      if (fRoom !== "전체" && r.roomHo !== fRoom) return false;
      if (fResidence !== "전체" && r.residenceStatus !== fResidence) return false;
      if (fType !== "전체" && r.moveInType !== fType) return false;
      // 기간: 입실일 기준
      const mi = (r.moveIn || "").slice(0, 10);
      if (fromDate && (!mi || mi < fromDate)) return false;
      if (toDate && (!mi || mi > toDate)) return false;
      if (q) {
        const text = `${r.name} ${r.department} ${r.site} ${r.dorm} ${r.phone} ${r.residenceStatus} ${r.moveInType}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), "ko") * dir);
    }
    return list;
  }, [rows, search, fSite, fDept, fBuilding, fDong, fRoom, fResidence, fType, fromDate, toDate, sortKey, sortDir]);

  const visibleCols = COLUMNS.filter((c) => !hidden.has(c.key));
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(rowKeyOf(r)));

  const toggleSort = (k: ColKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };
  const toggleHidden = (k: ColKey) => setHidden((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleSelect = (key: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setSelected((prev) => {
    if (filtered.every((r) => prev.has(rowKeyOf(r)))) { const n = new Set(prev); filtered.forEach((r) => n.delete(rowKeyOf(r))); return n; }
    const n = new Set(prev); filtered.forEach((r) => n.add(rowKeyOf(r))); return n;
  });

  const rowsForExport = () => {
    const sel = selected.size ? filtered.filter((r) => selected.has(rowKeyOf(r))) : filtered;
    return sel.length ? sel : filtered;
  };
  const asObj = (r: SimMemberRow) => visibleCols.reduce((o, c) => { o[c.label] = r[c.key] ?? ""; return o; }, {} as Record<string, string>);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rowsForExport().map(asObj));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "명단");
    XLSX.writeFile(wb, `${title.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`);
  };
  const exportCsv = () => {
    const header = visibleCols.map((c) => c.label);
    const lines = [header.join(",")].concat(
      rowsForExport().map((r) => visibleCols.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyRows = async () => {
    const header = visibleCols.map((c) => c.label).join("\t");
    const body = rowsForExport().map((r) => visibleCols.map((c) => String(r[c.key] ?? "")).join("\t")).join("\n");
    try { await navigator.clipboard.writeText(header + "\n" + body); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard 불가 무시 */ }
  };
  const printGrid = () => {
    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = rowsForExport().map((r) => `<tr>${visibleCols.map((c) => `<td>${String(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;padding:16px;color:#111}h2{font-size:16px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}</style>
      <h2>${title} (${rowsForExport().length}건)</h2><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  // ── 요약 통계(하단): 거주상태별 분포 ──
  const summary = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => { const k = r.residenceStatus || "미지정"; m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries());
  }, [filtered]);

  const pct = rows.length ? Math.round((filtered.length / rows.length) * 100) : 0;

  const selectCls = selCls(darkMode);
  const btnCls = darkMode
    ? "rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-800"
    : "rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-6 w-full max-w-5xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-slate-500">전체 {rows.length}명 · 표시 {filtered.length}명 ({pct}%){selected.size ? ` · 선택 ${selected.size}` : ""}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>

        {/* 필터 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(이름/부서/기숙사/연락처)" className={`${selectCls} min-w-[180px]`} />
          <GridSelect value={fSite} onChange={setFSite} options={siteOpts} label="근무지" darkMode={darkMode} />
          <GridSelect value={fDept} onChange={setFDept} options={deptOpts} label="부서" darkMode={darkMode} />
          <GridSelect value={fBuilding} onChange={setFBuilding} options={buildingOpts} label="기숙사" darkMode={darkMode} />
          <GridSelect value={fDong} onChange={setFDong} options={dongOpts} label="동" darkMode={darkMode} />
          <GridSelect value={fRoom} onChange={setFRoom} options={roomOpts} label="호실" darkMode={darkMode} />
          <GridSelect value={fResidence} onChange={setFResidence} options={residenceOpts} label="거주상태" darkMode={darkMode} />
          <GridSelect value={fType} onChange={setFType} options={typeOpts} label="입주유형" darkMode={darkMode} />
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            입실 <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={selectCls} />~
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={selectCls} />
          </span>
        </div>

        {/* 툴바 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <button className={btnCls} onClick={() => setShowColMenu((v) => !v)}>컬럼 ▾</button>
            {showColMenu && (
              <div className={`absolute z-10 mt-1 w-40 rounded-lg border p-2 shadow-lg ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleHidden(c.key)} />{c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className={`${btnCls} ${pinName ? "text-blue-600" : ""}`} onClick={() => setPinName((v) => !v)}>이름 고정{pinName ? " ✓" : ""}</button>
          <button className={btnCls} onClick={() => void copyRows()}>{copied ? "복사됨 ✓" : "복사"}</button>
          <button className={btnCls} onClick={exportExcel}>Excel</button>
          <button className={btnCls} onClick={exportCsv}>CSV</button>
          <button className={btnCls} onClick={printGrid}>인쇄</button>
          <span className="ml-auto text-xs text-slate-400">행 더블클릭 → 직원 상세</span>
        </div>

        {/* 테이블 */}
        <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
              <tr>
                <th className={`px-2 py-2 ${pinName ? "sticky left-0 " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                {visibleCols.map((c) => (
                  <th key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:underline ${pinName && c.key === "name" ? "sticky left-9 z-[1] " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>
                    {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const key = rowKeyOf(r);
                const sel = selected.has(key);
                return (
                  <tr key={key} onDoubleClick={() => setDetail(r)}
                    className={`${sel ? (darkMode ? "bg-blue-950/40" : "bg-blue-50") : ""} border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"} cursor-pointer`}>
                    <td className={`px-2 py-2 ${pinName ? "sticky left-0 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSelect(key)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    {visibleCols.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${pinName && c.key === "name" ? "sticky left-9 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}>
                        {r[c.key] || "-"}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={visibleCols.length + 1} className="px-3 py-8 text-center text-slate-500">조건에 맞는 인원이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 하단 요약 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="font-semibold text-slate-600 dark:text-slate-300">총 {filtered.length}건</span>
          <span>비율 {pct}%</span>
          {summary.map(([k, v]) => (
            <span key={k}>{k} {v}명 ({filtered.length ? Math.round((v / filtered.length) * 100) : 0}%)</span>
          ))}
        </div>
      </div>

      {detail && (
        <EmployeeDetailModal
          member={detail}
          darkMode={darkMode}
          onClose={() => setDetail(null)}
          dormContracts={dormContracts}
          newHires={newHires}
          cleaningReports={cleaningReports}
          defects={defects}
          inventory={inventory}
        />
      )}
    </div>
  );
}

// ────────────────────────────── 직원 상세정보(7탭) ──────────────────────────────
type DetailProps = {
  member: SimMemberRow;
  darkMode: boolean;
  onClose: () => void;
  dormContracts: DormContract[];
  newHires: NewHireEmployee[];
  cleaningReports: CleaningReport[];
  defects: DefectRequest[];
  inventory: InventoryItem[];
};

function EmployeeDetailModal({ member, darkMode, onClose, dormContracts, newHires, cleaningReports, defects, inventory }: DetailProps) {
  const TABS = ["기본정보", "계약정보", "입주이력", "퇴실이력", "청소이력", "하자이력", "비품이력"] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]>("기본정보");
  const rk = roomKey(member.building, member.dong, member.roomHo);
  const pkName = member.name;
  const pkPhone = digits(member.phone);

  const personRecords = useMemo(
    () => newHires.filter((h) => !h.isDeleted && h.name === pkName && (!pkPhone || digits(h.phone) === pkPhone))
      .sort((a, b) => String(a.moveInDate || a.createdAt || "").localeCompare(String(b.moveInDate || b.createdAt || ""))),
    [newHires, pkName, pkPhone]
  );
  const contracts = useMemo(() => dormContracts.filter((c) => !c.isDeleted && roomKey(c.buildingName, c.dong, c.roomHo) === rk), [dormContracts, rk]);
  const cleanings = useMemo(() => cleaningReports.filter((c) => !c.isDeleted && roomKey(c.buildingName, c.dong, c.roomHo) === rk)
    .sort((a, b) => String(b.reportDate || "").localeCompare(String(a.reportDate || ""))), [cleaningReports, rk]);
  const defs = useMemo(() => defects.filter((d) => !d.isDeleted && roomKey(d.buildingName, d.dong, d.ho) === rk)
    .sort((a, b) => String(b.receiptDate || "").localeCompare(String(a.receiptDate || ""))), [defects, rk]);
  const invs = useMemo(() => inventory.filter((i) => !i.isDeleted && roomKey(i.buildingName, i.dong, i.roomHo) === rk), [inventory, rk]);

  const cell = darkMode ? "border-slate-700" : "border-slate-200";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">{member.name} <span className="text-sm font-normal text-slate-500">직원 상세정보</span></h3>
            <p className="text-sm text-slate-500">{member.site} · {member.department || "부서 미지정"} · {member.dorm}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600")}`}>{t}</button>
          ))}
        </div>

        {tab === "기본정보" && (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[["이름", member.name], ["연락처", member.phone], ["부서", member.department], ["근무지", member.site], ["성별", member.gender],
              ["기숙사", member.dorm], ["거주상태", member.residenceStatus], ["입주유형", member.moveInType],
              ["입실일", member.moveIn], ["계약종료일", member.contractEnd], ["실제퇴실일", member.actualMoveOut], ["천안이동일", member.cheonanMove]].map(([k, v]) => (
              <div key={k} className={`rounded-lg border p-2 ${cell}`}>
                <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{k}</div>
                <div className="mt-0.5">{v || "-"}</div>
              </div>
            ))}
          </dl>
        )}
        {tab === "계약정보" && (
          <HistoryTable darkMode={darkMode} cols={["건물", "동", "호수", "계약시작", "계약종료", "상태", "정원"]}
            rows={contracts.map((c) => [c.buildingName, formatDong(c.dong), formatRoomHo(c.roomHo), formatDateOnly(c.contractStart || ""), formatDateOnly(c.contractEnd || ""), c.contractStatus || "-", c.capacity ?? "-"])} />
        )}
        {tab === "입주이력" && (
          <HistoryTable darkMode={darkMode} cols={["기숙사", "입주유형", "예정입실", "입실일", "거주상태"]}
            rows={personRecords.map((h) => [`${h.buildingName || "-"} ${formatDong(h.dong)}-${formatRoomHo(h.roomHo)}`, h.moveInType || "-", formatDateOnly(h.expectedMoveInDate || ""), formatDateOnly(h.moveInDate || ""), h.residenceStatus || "-"])} />
        )}
        {tab === "퇴실이력" && (
          <HistoryTable darkMode={darkMode} cols={["기숙사", "계약종료일", "실제퇴실일", "천안이동일"]}
            rows={personRecords.filter((h) => h.moveOutDate || h.expectedMoveOutDate || h.actualMoveOutDate || h.cheonanMoveDate)
              .map((h) => [`${h.buildingName || "-"} ${formatDong(h.dong)}-${formatRoomHo(h.roomHo)}`, formatDateOnly(h.moveOutDate || h.expectedMoveOutDate || ""), formatDateOnly(h.actualMoveOutDate || ""), formatDateOnly(h.cheonanMoveDate || "")])} />
        )}
        {tab === "청소이력" && (
          <HistoryTable darkMode={darkMode} cols={["보고일", "상태", "점수", "담당자"]}
            rows={cleanings.map((c) => [formatDateOnly(c.reportDate || ""), c.cleanStatus || "-", c.score ?? "-", c.managerName || "-"])} />
        )}
        {tab === "하자이력" && (
          <HistoryTable darkMode={darkMode} cols={["접수일", "상태", "내용"]}
            rows={defs.map((d) => [formatDateOnly(d.receiptDate || ""), d.defectStatus || "-", (d.requestText || "").slice(0, 40)])} />
        )}
        {tab === "비품이력" && (
          <HistoryTable darkMode={darkMode} cols={["비품명", "수량", "상태", "구매일"]}
            rows={invs.map((i) => [i.itemName || "-", i.quantity ?? "-", i.status || "-", formatDateOnly(i.purchaseDate || "")])} />
        )}
      </div>
    </div>
  );
}
