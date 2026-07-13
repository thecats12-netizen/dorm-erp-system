import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { formatDateOnly } from "../utils/formatters";

// 공통 보고서 뷰: 필터 + KPI + 차트 + 테이블 + Excel/CSV/PDF(A4 인쇄).
// 9개 보고서가 rows/columns/차트/KPI 설정만 바꿔 재사용한다(기존 디자인 톤 유지).
export type ReportColumn = { key: string; label: string };
export type ReportChart = { type: "bar" | "pie"; groupKey: string; valueKey?: string; label: string };
export type ReportConfig = {
  title: string;
  subtitle?: string;
  rows: Record<string, string | number>[];
  columns: ReportColumn[];
  dateField?: string;           // KPI 시간 버킷(오늘/주/월)용 컬럼(YYYY-MM-DD)
  filterKeys?: string[];        // 드롭다운 필터 대상 컬럼 key
  chart?: ReportChart;
  extraKpis?: { label: string; value: string; sub?: string }[]; // 보고서 특화 KPI(공실률/정원초과 등). sub = 보조 문구.
};

const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#64748b"];

const uniqueSorted = (arr: (string | number)[]) =>
  Array.from(new Set(arr.map((v) => String(v ?? "")).filter((v) => v && v !== "-"))).sort();
const ymd = (v: unknown) => String(v ?? "").slice(0, 10);
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };

function GridSelect({ value, onChange, options, label, darkMode }: { value: string; onChange: (v: string) => void; options: string[]; label: string; darkMode: boolean }) {
  const cls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs outline-none" : "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none";
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cls} aria-label={label}>
      <option value="전체">{label}: 전체</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function ReportView({ config, darkMode }: { config: ReportConfig; darkMode: boolean }) {
  const { title, subtitle, rows, columns, dateField, filterKeys = [], chart, extraKpis = [] } = config;
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    filterKeys.forEach((k) => { m[k] = uniqueSorted(rows.map((r) => r[k])); });
    return m;
  }, [rows, filterKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      for (const k of filterKeys) { const f = filters[k]; if (f && f !== "전체" && String(r[k] ?? "") !== f) return false; }
      if (dateField && (fromDate || toDate)) {
        const d = ymd(r[dateField]);
        if (fromDate && (!d || d < fromDate)) return false;
        if (toDate && (!d || d > toDate)) return false;
      }
      if (q) { if (!columns.map((c) => String(r[c.key] ?? "")).join(" ").toLowerCase().includes(q)) return false; }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") return (an - bn) * dir;
        return String(av ?? "").localeCompare(String(bv ?? ""), "ko") * dir;
      });
    }
    return list;
  }, [rows, columns, filterKeys, filters, search, dateField, fromDate, toDate, sortKey, sortDir]);

  // ── KPI: 총건수 + (dateField 있으면) 오늘/이번주/이번달/지난달/전월대비 ──
  const kpis = useMemo(() => {
    const out: { label: string; value: string; sub?: string }[] = [{ label: "총 건수", value: String(filtered.length) }];
    if (dateField) {
      const now = new Date();
      const today = ymd(now.toISOString());
      const wk = ymd(startOfWeek(now).toISOString());
      const thisM = today.slice(0, 7);
      const lastMDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastM = `${lastMDate.getFullYear()}-${String(lastMDate.getMonth() + 1).padStart(2, "0")}`;
      let cToday = 0, cWeek = 0, cThisM = 0, cLastM = 0;
      filtered.forEach((r) => {
        const d = ymd(r[dateField]); if (!d) return;
        if (d === today) cToday++;
        if (d >= wk) cWeek++;
        if (d.slice(0, 7) === thisM) cThisM++;
        if (d.slice(0, 7) === lastM) cLastM++;
      });
      const delta = cLastM === 0 ? (cThisM > 0 ? 100 : 0) : Math.round(((cThisM - cLastM) / cLastM) * 100);
      out.push({ label: "오늘", value: String(cToday) });
      out.push({ label: "이번주", value: String(cWeek) });
      out.push({ label: "이번달", value: String(cThisM) });
      out.push({ label: "지난달", value: String(cLastM) });
      out.push({ label: "전월 대비", value: `${delta >= 0 ? "+" : ""}${delta}%`, sub: `${cThisM} vs ${cLastM}` });
    }
    extraKpis.forEach((k) => out.push({ label: k.label, value: k.value, sub: k.sub }));
    return out;
  }, [filtered, dateField, extraKpis]);

  // ── 차트 데이터(그룹 집계) ──
  const chartData = useMemo(() => {
    if (!chart) return [];
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      const k = String(r[chart.groupKey] ?? "미지정") || "미지정";
      const v = chart.valueKey ? Number(r[chart.valueKey]) || 0 : 1;
      m.set(k, (m.get(k) || 0) + v);
    });
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [filtered, chart]);
  const chartTotal = chartData.reduce((s, d) => s + d.value, 0);
  const chartMax = Math.max(1, ...chartData.map((d) => d.value));

  const toggleSort = (k: string) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  const asObj = (r: Record<string, string | number>) => columns.reduce((o, c) => { o[c.label] = r[c.key] ?? ""; return o; }, {} as Record<string, string | number>);
  const safeName = title.replace(/[\\/:*?"<>|]/g, "_");
  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(asObj));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "보고서");
    XLSX.writeFile(wb, `${safeName}.xlsx`);
  };
  const exportCsv = () => {
    const lines = [columns.map((c) => c.label).join(",")].concat(
      filtered.map((r) => columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${safeName}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const printPdf = () => {
    const w = window.open("", "_blank", "width=1000,height=760"); if (!w) return;
    const th = columns.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${columns.map((c) => `<td>${String(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("");
    const kpiHtml = kpis.map((k) => `<div class="kpi"><div class="kl">${k.label}</div><div class="kv">${k.value}</div></div>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${title}</title>
      <style>
        @page{size:A4;margin:14mm}
        body{font-family:'Malgun Gothic',sans-serif;color:#111;font-size:12px}
        h1{font-size:18px;margin:0 0 2px}.sub{color:#666;font-size:11px;margin-bottom:10px}
        .kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
        .kpi{border:1px solid #cbd5e1;border-radius:8px;padding:6px 12px;min-width:80px}
        .kl{font-size:10px;color:#64748b}.kv{font-size:15px;font-weight:700}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left}
        th{background:#f1f5f9}tr{page-break-inside:avoid}thead{display:table-header-group}
      </style>
      <h1>${title}</h1><div class="sub">${subtitle || ""} · 총 ${filtered.length}건 · 출력 ${formatDateOnly(new Date().toISOString())}</div>
      <div class="kpis">${kpiHtml}</div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  const card = darkMode ? "bg-slate-950 border-slate-700" : "bg-slate-50 border-slate-200";
  const btn = darkMode ? "rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100";
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs outline-none" : "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none";

  return (
    <div>
      {/* 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색" className={`${inputCls} min-w-[160px]`} />
        {filterKeys.map((k) => {
          const col = columns.find((c) => c.key === k);
          return <GridSelect key={k} label={col?.label || k} darkMode={darkMode} value={filters[k] || "전체"} options={filterOptions[k] || []} onChange={(v) => setFilters((p) => ({ ...p, [k]: v }))} />;
        })}
        {dateField && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            기간 <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />~
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportCsv}>CSV</button>
          <button className={btn} onClick={printPdf}>PDF/인쇄</button>
        </span>
      </div>

      {/* KPI 카드 */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => (
          <div key={i} className={`rounded-2xl border p-3 ${card}`}>
            <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">{k.label}</div>
            <div className="mt-1 text-xl font-bold">{k.value}</div>
            {k.sub && <div className="text-[0.65rem] text-slate-400">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* 차트 */}
      {chart && chartData.length > 0 && (
        <div className={`mb-4 rounded-2xl border p-4 ${card}`}>
          <div className="mb-2 text-sm font-semibold text-slate-500">{chart.label}</div>
          {chart.type === "bar" ? (
            <div className="space-y-1.5">
              {chartData.map((d, i) => (
                <div key={d.label} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate text-slate-500">{d.label}</span>
                  <span className="h-4 rounded" style={{ width: `${Math.max(4, (d.value / chartMax) * 100)}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="font-medium">{d.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 36 36" className="h-32 w-32">
                {(() => {
                  let acc = 0;
                  return chartData.map((d, i) => {
                    const frac = chartTotal ? d.value / chartTotal : 0;
                    const dash = frac * 100;
                    const el = (
                      <circle key={d.label} cx="18" cy="18" r="15.915" fill="transparent"
                        stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth="4.8"
                        strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-acc} transform="rotate(-90 18 18)" />
                    );
                    acc += dash; return el;
                  });
                })()}
              </svg>
              <div className="space-y-1 text-xs">
                {chartData.map((d, i) => (
                  <div key={d.label} className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-slate-500">{d.label}</span>
                    <span className="font-medium">{d.value} ({chartTotal ? Math.round((d.value / chartTotal) * 100) : 0}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 테이블 */}
      <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{columns.map((c) => (
              <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:underline">
                {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className={`border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {columns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2">{r[c.key] === "" || r[c.key] == null ? "-" : r[c.key]}</td>)}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">총 {filtered.length}건</div>
    </div>
  );
}
