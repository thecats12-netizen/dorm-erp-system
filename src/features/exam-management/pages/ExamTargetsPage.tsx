import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  listExamRows, listExamRefOptions, upsertExamRow, softDeleteExamRow,
  writeExamAudit, examSupabaseReady, type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";

type RefOpt = { id: string; label: string };
type ColType = "text" | "number" | "select" | "ref" | "computed";
type Col = {
  key: string; label: string; type: ColType; options?: string[]; refTable?: ExamMasterTable;
  required?: boolean; filter?: boolean; hideable?: boolean; compute?: (r: ExamRow) => number; tone?: boolean;
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// 달성률 = 실적/목표×100. 목표 0 이하 → 0%. NaN/Infinity 금지. 소수 첫째자리.
const pct = (actual: unknown, target: unknown): number => {
  const t = num(target); if (!(t > 0)) return 0;
  const v = Math.round((num(actual) / t) * 1000) / 10;
  return Number.isFinite(v) ? v : 0;
};
const MONTHS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
const sumMonths = (r: ExamRow) => MONTHS.reduce((a, k) => a + num(r[k]), 0);
const IDENTITY = ["year", "group_name", "product_group", "part_name", "level_id"];
const PAGE_SIZE = 20;

type GridConfig = {
  table: ExamMasterTable;
  title: string;
  subtitle: string;
  fileBase: string;
  cols: Col[];
  actualOf: (r: ExamRow) => number;
  targetOf: (r: ExamRow) => number;
  actualLabel: string;
};

function TargetGrid({ cfg, darkMode, canEdit, tenantId, userId, onToast }: {
  cfg: GridConfig; darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [levels, setLevels] = useState<RefOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [importPreview, setImportPreview] = useState<{ okRows: ExamRow[]; dup: number; err: Array<{ row: number; reason: string }> } | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);

  const filterCols = useMemo(() => cfg.cols.filter((c) => c.filter), [cfg.cols]);
  const formCols = useMemo(() => cfg.cols.filter((c) => c.type !== "computed"), [cfg.cols]);
  const hasLevel = useMemo(() => cfg.cols.some((c) => c.type === "ref"), [cfg.cols]);

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [data, lv] = await Promise.all([
        listExamRows(cfg.table, tenantId),
        hasLevel ? listExamRefOptions("exam_levels", tenantId) : Promise.resolve([] as RefOpt[]),
      ]);
      setRows(data); setLevels(lv);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [cfg.table, tenantId, hasLevel]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const levelLabel = (id: unknown) => (!id ? "-" : (levels.find((o) => o.id === String(id))?.label || "-"));
  const cellText = (c: Col, r: ExamRow) => {
    if (c.type === "computed") return String(c.compute!(r));
    if (c.type === "ref") return levelLabel(r[c.key]);
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return "-";
    return String(v);
  };
  const identityKey = (r: ExamRow) => IDENTITY.map((k) => String(r[k] ?? "")).join("|");

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    filterCols.forEach((c) => {
      const vals = rows.map((r) => (c.type === "ref" ? levelLabel(r[c.key]) : String(r[c.key] ?? ""))).filter((v) => v && v !== "-");
      m[c.key] = Array.from(new Set(vals)).sort();
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, levels, filterCols]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      for (const c of filterCols) {
        const f = filters[c.key]; if (!f || f === "전체") continue;
        const val = c.type === "ref" ? levelLabel(r[c.key]) : String(r[c.key] ?? "");
        if (val !== f) return false;
      }
      if (q) { const t = `${r.group_name ?? ""} ${r.product_group ?? ""} ${r.part_name ?? ""} ${levelLabel(r.level_id)} ${r.notes ?? ""}`.toLowerCase(); if (!t.includes(q)) return false; }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = cfg.cols.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? ""), bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "-" && bv !== "-") return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "ko") * dir;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filters, sortKey, sortDir, levels, filterCols, cfg.cols]);

  const kpi = useMemo(() => {
    const target = filtered.reduce((a, r) => a + cfg.targetOf(r), 0);
    const actual = filtered.reduce((a, r) => a + cfg.actualOf(r), 0);
    const below = filtered.filter((r) => pct(cfg.actualOf(r), cfg.targetOf(r)) < 100).length;
    return { count: filtered.length, target, actual, rate: pct(actual, target), below };
  }, [filtered, cfg]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const visibleCols = cfg.cols.filter((c) => !hidden.has(c.key));
  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };

  const saveRow = async () => {
    if (!editRow) return;
    for (const c of formCols) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    setSaving(true); setError(null);
    try {
      const key = identityKey(editRow);
      if (rows.some((r) => r.id !== editRow.id && identityKey(r) === key)) { setError("동일한 연도/그룹/제품군/파트/인증레벨 항목이 이미 있습니다."); setSaving(false); return; }
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow(cfg.table, editRow, tenantId, userId);
      await writeExamAudit(tenantId, userId, cfg.table, String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null); onToast?.(isNew ? "등록되었습니다." : "수정되었습니다."); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try { await softDeleteExamRow(cfg.table, String(r.id), userId); await writeExamAudit(tenantId, userId, cfg.table, String(r.id), "delete", r, null); onToast?.("삭제되었습니다."); await reload(); }
    catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  const exportRows = () => filtered.map((r) => { const o: Record<string, string | number> = {}; cfg.cols.forEach((c) => { o[c.label] = c.type === "computed" ? c.compute!(r) : (c.type === "ref" ? levelLabel(r[c.key]) : (r[c.key] as string ?? "")); }); return o; });
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(exportRows()); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, cfg.title); XLSX.writeFile(wb, `시험관리_${cfg.fileBase}.xlsx`); };
  const exportPdf = () => {
    const w = window.open("", "_blank", "width=1180,height=800"); if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${visibleCols.map((c) => `<td>${cellText(c, r)}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${cfg.title}</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#0f172a}h3{margin:0 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:center}th{background:#f1f5f9}</style><h3>${cfg.title} — ${filtered.length}건 (목표 ${kpi.target} · ${cfg.actualLabel} ${kpi.actual} · 달성률 ${kpi.rate}%)</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table><scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt>`);
    w.document.close(); w.focus();
  };

  const buildImportPreview = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const okRows: ExamRow[] = []; const err: Array<{ row: number; reason: string }> = []; let dup = 0;
      const seen = new Set(rows.map(identityKey));
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i]; const row: ExamRow = {};
        for (const c of formCols) {
          const v = r[c.label];
          if (c.type === "number") { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); row[c.key] = s === "" ? null : Math.round(Number(s)); }
          else if (c.type === "ref") { const s = String(v ?? "").trim(); const opt = levels.find((o) => o.label === s || o.label.includes(s)); row[c.key] = opt ? opt.id : null; }
          else { const s = String(v ?? "").replace(/#REF!|#N\/A|#VALUE!/gi, "").trim(); row[c.key] = s || null; }
        }
        if (!num(row.year)) { err.push({ row: i + 2, reason: "연도 누락/오류" }); continue; }
        const key = identityKey(row);
        if (seen.has(key)) { dup++; continue; }
        seen.add(key); okRows.push(row);
      }
      setImportPreview({ okRows, dup, err });
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석 실패."); }
  };
  const commitImport = async () => {
    if (!importPreview) return;
    try {
      for (const row of importPreview.okRows) { const saved = await upsertExamRow(cfg.table, row, tenantId, userId); await writeExamAudit(tenantId, userId, cfg.table, String(saved.id), "import", null, saved); }
      onToast?.(`정상 ${importPreview.okRows.length}건 · 중복 ${importPreview.dup}건 · 오류 ${importPreview.err.length}건`);
      setImportPreview(null); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "Excel 반영 실패."); }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const rateTone = (v: number) => v >= 100 ? "text-emerald-600" : v >= 80 ? "text-amber-600" : "text-rose-600";
  const kpiCard = (label: string, value: string, tone = "") => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{cfg.title}</h2>
        <p className="text-sm text-slate-500">{cfg.subtitle}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {kpiCard("항목 수", String(kpi.count))}
        {kpiCard("목표 합계", String(kpi.target))}
        {kpiCard(`${cfg.actualLabel} 합계`, String(kpi.actual))}
        {kpiCard("달성률", `${kpi.rate}%`, rateTone(kpi.rate))}
        {kpiCard("미달 항목", String(kpi.below), kpi.below ? "text-rose-600" : "")}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(그룹/제품군/파트/레벨/비고)" className={`${inputCls} min-w-[220px]`} />
        {filterCols.map((c) => (
          <select key={c.key} value={filters[c.key] || "전체"} onChange={(e) => { setFilters((p) => ({ ...p, [c.key]: e.target.value })); setPage(1); }} className={inputCls}>
            <option value="전체">{c.label}: 전체</option>
            {(filterOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button className={btn} onClick={() => setShowColMenu((v) => !v)}>컬럼 ▾</button>
          {showColMenu && (
            <div className={`absolute z-10 mt-1 max-h-64 w-40 overflow-auto rounded-lg border p-2 shadow-lg ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
              {cfg.cols.filter((c) => c.hideable).map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportPdf}>PDF 출력</button>
          {canEdit && <label className={`${btn} cursor-pointer`}>Excel 등록<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void buildImportPreview(f); e.currentTarget.value = ""; }} /></label>}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ year: new Date().getFullYear() })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              {visibleCols.map((c) => <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline">{c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>)}
              {canEdit && <th className="whitespace-nowrap px-2.5 py-2">작업</th>}
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={String(r.id)} className={`border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {visibleCols.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2.5 py-2">
                    {c.type === "computed" && c.tone ? <span className={`font-semibold ${rateTone(c.compute!(r))}`}>{c.compute!(r)}%</span> : cellText(c, r)}
                  </td>
                ))}
                {canEdit && (
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <button className="text-blue-600 hover:underline" onClick={() => setEditRow({ ...r })}>수정</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-rose-600 hover:underline" onClick={() => void removeRow(r)}>삭제</button>
                  </td>
                )}
              </tr>
            ))}
            {!loading && paged.length === 0 && <tr><td colSpan={visibleCols.length + 1} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {/* 등록/수정 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => !saving && setEditRow(null)}>
          <div className={`my-8 w-full max-w-3xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">{editRow.id ? `${cfg.title} 수정` : `${cfg.title} 등록`}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {formCols.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "ref" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{levels.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  ) : c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : (
                    <input inputMode={c.type === "number" ? "numeric" : undefined} className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Math.round(Number(e.target.value.replace(/[^0-9.-]/g, "")) || 0)) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
            </div>
            {/* 계산 미리보기 */}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>{cfg.actualLabel}: <b>{cfg.actualOf(editRow)}</b></span>
              <span className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>목표: <b>{cfg.targetOf(editRow)}</b></span>
              <span className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>달성률: <b className={rateTone(pct(cfg.actualOf(editRow), cfg.targetOf(editRow)))}>{pct(cfg.actualOf(editRow), cfg.targetOf(editRow))}%</b></span>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} className={`rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button onClick={() => void saveRow()} disabled={saving} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Excel 미리보기 */}
      {importPreview && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setImportPreview(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Excel 등록 미리보기</h3>
            <div className="mb-3 flex gap-2 text-sm">
              <span className="rounded-lg bg-emerald-100 px-3 py-1 text-emerald-700">정상 {importPreview.okRows.length}</span>
              <span className="rounded-lg bg-amber-100 px-3 py-1 text-amber-700">중복 {importPreview.dup}</span>
              <span className="rounded-lg bg-rose-100 px-3 py-1 text-rose-700">오류 {importPreview.err.length}</span>
            </div>
            {importPreview.err.length > 0 && <div className={`mb-3 max-h-40 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>{importPreview.err.slice(0, 30).map((e, i) => <div key={i} className="py-0.5">{e.row}행: {e.reason}</div>)}</div>}
            <p className="mb-4 text-xs text-slate-500">정상 {importPreview.okRows.length}건만 반영됩니다(중복/오류 제외).</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportPreview(null)} className={`rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button onClick={() => void commitImport()} disabled={importPreview.okRows.length === 0} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${importPreview.okRows.length === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{importPreview.okRows.length}건 반영</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const ANNUAL_COLS: Col[] = [
  { key: "year", label: "연도", type: "number", required: true, filter: true },
  { key: "group_name", label: "그룹", type: "text", filter: true },
  { key: "product_group", label: "제품군", type: "text", filter: true },
  { key: "part_name", label: "파트", type: "text", filter: true },
  { key: "level_id", label: "인증레벨", type: "ref", refTable: "exam_levels", filter: true },
  { key: "current_count", label: "현재인원", type: "number" },
  { key: "target_count", label: "목표인원", type: "number" },
  { key: "diff", label: "차이", type: "computed", compute: (r) => num(r.target_count) - num(r.current_count) },
  { key: "rate", label: "달성률", type: "computed", tone: true, compute: (r) => pct(r.current_count, r.target_count) },
  { key: "notes", label: "비고", type: "text", hideable: true },
];

const MONTHLY_COLS: Col[] = [
  { key: "year", label: "연도", type: "number", required: true, filter: true },
  { key: "group_name", label: "그룹", type: "text", filter: true },
  { key: "product_group", label: "제품군", type: "text", filter: true },
  { key: "part_name", label: "파트", type: "text", filter: true },
  { key: "level_id", label: "인증레벨", type: "ref", refTable: "exam_levels", filter: true },
  ...MONTHS.map((k, i) => ({ key: k, label: `${i + 1}월`, type: "number" as ColType, hideable: true })),
  { key: "cumulative", label: "누계", type: "computed", compute: sumMonths },
  { key: "target_count", label: "목표", type: "number" },
  { key: "rate", label: "달성률", type: "computed", tone: true, compute: (r) => pct(sumMonths(r), r.target_count) },
  { key: "notes", label: "비고", type: "text", hideable: true },
];

type PageProps = { darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void };

export function ExamAnnualTargetsPage(props: PageProps) {
  return <TargetGrid cfg={{
    table: "exam_annual_targets", title: "연간목표", subtitle: "시험관리 · 연도별 인증 목표/현재 인원과 달성률을 관리합니다. (기준: Excel 년간목표)",
    fileBase: "연간목표", cols: ANNUAL_COLS, actualLabel: "현재인원",
    actualOf: (r) => num(r.current_count), targetOf: (r) => num(r.target_count),
  }} {...props} />;
}

export function ExamMonthlyResultsPage(props: PageProps) {
  return <TargetGrid cfg={{
    table: "exam_monthly_results", title: "월간실적", subtitle: "시험관리 · 월별 실적/누계/목표와 달성률을 관리합니다. (기준: Excel D.M 월간 실적)",
    fileBase: "월간실적", cols: MONTHLY_COLS, actualLabel: "누계",
    actualOf: sumMonths, targetOf: (r) => num(r.target_count),
  }} {...props} />;
}
