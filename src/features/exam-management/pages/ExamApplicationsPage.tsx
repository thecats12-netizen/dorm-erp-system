import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import {
  listExamRows, listExamRefOptions, upsertExamRow, softDeleteExamRow,
  writeExamAudit, listExamAudit, isDuplicateApplication, examSupabaseReady,
  type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";

type RefOpt = { id: string; label: string };
type ColType = "text" | "date" | "number" | "select" | "ref" | "cert";
type Col = { key: string; label: string; type: ColType; options?: string[]; refTable?: ExamMasterTable; required?: boolean; filter?: boolean; hideable?: boolean };

// 응시 상태(개발용 코드값 노출 금지 — 한글 라벨만 저장/표시)
const STATUS_OPTIONS = ["예정", "필기 진행", "필기 합격", "필기 불합격", "실기 진행", "실기 합격", "실기 불합격", "인증 취득", "미취득", "취소", "재응시"];
const TIMING_OPTIONS = ["조기취득", "정상취득", "지연취득"];
const PAGE_SIZE = 20;

const ymd = (v: unknown) => {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return s.slice(0, 10);
};
const isValidDateCell = (v: unknown) => { const s = ymd(v); return s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s); };

// 표시/필터/폼 컬럼 정의
const COLS: Col[] = [
  { key: "seq_no", label: "연번", type: "number", hideable: true },
  { key: "employee_no", label: "사원번호", type: "text", required: true },
  { key: "name", label: "성명", type: "text", required: true },
  { key: "group_name", label: "그룹", type: "text", filter: true },
  { key: "product", label: "제품", type: "text", filter: true },
  { key: "process", label: "공정", type: "text", filter: true },
  { key: "category_code", label: "구분코드", type: "text" },
  { key: "category", label: "구분", type: "text", hideable: true },
  { key: "level_id", label: "인증단계", type: "ref", refTable: "exam_levels", filter: true },
  { key: "equipment_id", label: "인증 설비", type: "ref", refTable: "exam_equipment", filter: true },
  { key: "status", label: "응시상태", type: "select", options: STATUS_OPTIONS, filter: true },
  { key: "written_exam_date", label: "필기 진행일", type: "date" },
  { key: "written_pass_date", label: "필기 합격일", type: "date" },
  { key: "practical_acquire_date", label: "실기 취득일", type: "date" },
  { key: "practical_pass_date", label: "실기 합격일", type: "date" },
  { key: "cert_acquired_date", label: "인증 취득일", type: "date", hideable: true },
  { key: "cert_status", label: "인증취득여부", type: "cert", filter: true },
  { key: "timing_status", label: "조기/지연취득", type: "select", options: TIMING_OPTIONS, filter: true },
  { key: "pm_level", label: "PM Level", type: "text", filter: true },
  { key: "dm_process", label: "D.M 공정", type: "text", filter: true, hideable: true },
  { key: "notes", label: "비고", type: "text", hideable: true },
];
const FILTERS = COLS.filter((c) => c.filter);

// 인증취득여부: 수동 확정값 우선, 아니면 실기 합격일 존재 시 "취득"(자동계산).
const certOf = (r: ExamRow): "취득" | "미취득" => {
  if (r.cert_status_manual && (r.cert_status === "취득" || r.cert_status === "미취득")) return r.cert_status as "취득" | "미취득";
  return r.practical_pass_date ? "취득" : "미취득";
};

export default function ExamApplicationsPage({
  darkMode, canEdit, tenantId, userId, onToast,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [refMap, setRefMap] = useState<Record<string, RefOpt[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [yearF, setYearF] = useState("전체");
  const [monthF, setMonthF] = useState("전체");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pinFirst, setPinFirst] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailRow, setDetailRow] = useState<ExamRow | null>(null);
  const [historyRow, setHistoryRow] = useState<ExamRow | null>(null);
  const [historyList, setHistoryList] = useState<ExamRow[]>([]);
  const [importPreview, setImportPreview] = useState<{ okRows: ExamRow[]; dup: number; err: Array<{ row: number; reason: string }> } | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // 미저장 변경 보호 + 앱 공통 닫기(ESC·뒤로가기·최상위 우선) 연동.
  const [editBase, setEditBase] = useState("");
  const editKey = editRow ? String(editRow.id ?? "__new__") : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (editRow) setEditBase(JSON.stringify(editRow)); }, [editKey]);
  const editDirty = !!editRow && JSON.stringify(editRow) !== editBase;
  const requestCloseEdit = () => { if (saving) return; if (editDirty) setConfirmClose(true); else setEditRow(null); };
  const topClose = importPreview ? () => setImportPreview(null)
    : confirmClose ? undefined
      : historyRow ? () => setHistoryRow(null)
        : detailRow ? () => setDetailRow(null)
          : editRow ? requestCloseEdit
            : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const [activeIdx, setActiveIdx] = useState(-1);

  const refCols = useMemo(() => COLS.filter((c) => c.type === "ref"), []);
  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [data, refs] = await Promise.all([
        listExamRows("exam_applications", tenantId),
        Promise.all(refCols.map(async (c) => [c.refTable as string, await listExamRefOptions(c.refTable as ExamMasterTable, tenantId)] as const)),
      ]);
      setRows(data); setRefMap(Object.fromEntries(refs));
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refCols]);

  // 최초 로드(내부 비동기).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const refLabel = (c: Col, id: unknown) => (!id ? "-" : ((refMap[c.refTable as string] || []).find((o) => o.id === String(id))?.label || "-"));
  const cellText = (c: Col, r: ExamRow) => {
    if (c.type === "cert") return certOf(r);
    if (c.type === "ref") return refLabel(c, r[c.key]);
    const v = r[c.key];
    if (c.type === "date") return ymd(v) || "-";
    if (v === null || v === undefined || v === "") return "-";
    return String(v);
  };
  const rowMonth = (r: ExamRow) => ymd(r.written_exam_date || r.cert_acquired_date || r.practical_pass_date).slice(0, 7);

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    FILTERS.forEach((c) => {
      if (c.type === "cert") { m[c.key] = ["취득", "미취득"]; return; }
      const vals = rows.map((r) => (c.type === "ref" ? refLabel(c, r[c.key]) : String(r[c.key] ?? ""))).filter((v) => v && v !== "-");
      m[c.key] = Array.from(new Set(vals)).sort();
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, refMap]);

  const years = useMemo(() => Array.from(new Set(rows.map((r) => rowMonth(r).slice(0, 4)).filter(Boolean))).sort().reverse(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      const ym = rowMonth(r);
      if (yearF !== "전체" && ym.slice(0, 4) !== yearF) return false;
      if (monthF !== "전체" && ym.slice(5, 7) !== monthF) return false;
      for (const c of FILTERS) {
        const f = filters[c.key]; if (!f || f === "전체") continue;
        const val = c.type === "cert" ? certOf(r) : (c.type === "ref" ? refLabel(c, r[c.key]) : String(r[c.key] ?? ""));
        if (val !== f) return false;
      }
      if (q) {
        const text = `${r.employee_no ?? ""} ${r.name ?? ""} ${r.category_code ?? ""} ${refLabel(COLS.find((c) => c.key === "equipment_id")!, r.equipment_id)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = COLS.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? "");
        const bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "-" && bv !== "-") return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "ko") * dir;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filters, yearF, monthF, sortKey, sortDir, refMap]);

  const kpi = useMemo(() => {
    const byStatus = (s: string) => filtered.filter((r) => r.status === s).length;
    const acquired = filtered.filter((r) => certOf(r) === "취득").length;
    const total = filtered.length;
    return {
      total, w진행: byStatus("필기 진행"), w합격: byStatus("필기 합격"), s진행: byStatus("실기 진행"), s합격: byStatus("실기 합격"),
      acquired, notAcquired: total - acquired, re: byStatus("재응시"), rate: total ? Math.round((acquired / total) * 100) : 0,
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const visibleCols = COLS.filter((c) => !hidden.has(c.key));

  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };
  const rowKey = (r: ExamRow) => String(r.id);
  const toggleSel = (k: string) => setSelected((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allPagedSel = paged.length > 0 && paged.every((r) => selected.has(rowKey(r)));

  const saveRow = async () => {
    if (!editRow) return;
    for (const c of COLS) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    for (const c of COLS) if (c.type === "date" && !isValidDateCell(editRow[c.key])) { setError(`${c.label} 날짜 형식이 올바르지 않습니다.`); return; }
    setSaving(true); setError(null);
    try {
      const empNo = String(editRow.employee_no ?? "").trim(), code = String(editRow.category_code ?? "").trim();
      if (code && await isDuplicateApplication(tenantId, empNo, code, editRow.id ? String(editRow.id) : undefined)) {
        setError(`이미 등록된 응시입니다(사원번호+구분코드 중복): ${empNo} / ${code}`); setSaving(false); return;
      }
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow("exam_applications", editRow, tenantId, userId);
      await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null); onToast?.(isNew ? "응시 항목이 등록되었습니다." : "응시 항목이 수정되었습니다."); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try { await softDeleteExamRow("exam_applications", String(r.id), userId); await writeExamAudit(tenantId, userId, "exam_applications", String(r.id), "delete", r, null); onToast?.("응시 항목이 삭제되었습니다."); await reload(); }
    catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus || selected.size === 0) return;
    setError(null);
    try {
      const targets = rows.filter((r) => selected.has(rowKey(r)));
      for (const r of targets) {
        const saved = await upsertExamRow("exam_applications", { ...r, status: bulkStatus }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), "update", r, saved, "일괄 상태 변경");
      }
      onToast?.(`${targets.length}건 상태를 '${bulkStatus}'(으)로 변경했습니다.`);
      setSelected(new Set()); setBulkStatus(""); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "일괄 변경 실패."); }
  };

  const openDetail = (r: ExamRow) => setDetailRow(r);
  const openHistory = async (r: ExamRow) => { setHistoryRow(r); try { setHistoryList(await listExamAudit(tenantId, "exam_applications", String(r.id))); } catch { setHistoryList([]); } };

  // 테이블 행 키보드 이동(위/아래/Home/End/PageUp·Down) + Enter 상세 + Space 선택 토글.
  const tableKeyDown = useTableKeyboardNav({
    count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => paged[i] && openDetail(paged[i]),
    onSpace: (i) => paged[i] && toggleSel(rowKey(paged[i])),
  });

  const exportRows = () => filtered.map((r) => { const o: Record<string, string> = {}; COLS.forEach((c) => { o[c.label] = cellText(c, r); }); return o; });
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(exportRows()); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "시험응시"); XLSX.writeFile(wb, "시험관리_시험응시.xlsx"); };
  const exportCsv = () => {
    const cols = COLS.map((c) => c.label);
    const lines = [cols.join(",")].concat(filtered.map((r) => COLS.map((c) => `"${String(cellText(c, r)).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "시험관리_시험응시.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const printTable = () => {
    const w = window.open("", "_blank", "width=1100,height=760"); if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${visibleCols.map((c) => `<td>${cellText(c, r)}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>시험 응시</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic';font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px}th{background:#f1f5f9}</style><h3>시험 응시 (${filtered.length}건)</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  const buildImportPreview = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const okRows: ExamRow[] = []; const err: Array<{ row: number; reason: string }> = []; let dup = 0;
      const levelOpts = refMap["exam_levels"] || []; const equipOpts = refMap["exam_equipment"] || [];
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i]; const row: ExamRow = {}; let bad = "";
        for (const c of COLS) {
          if (c.type === "cert") continue;
          const v = r[c.label];
          if (c.type === "date") { if (!isValidDateCell(v)) bad = bad || `${c.label} 날짜 오류`; row[c.key] = ymd(v) || null; }
          else if (c.type === "number") { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); row[c.key] = s === "" ? null : Number(s); }
          else if (c.type === "ref") {
            const s = String(v ?? "").trim(); if (!s) { row[c.key] = null; continue; }
            const opts = c.refTable === "exam_levels" ? levelOpts : equipOpts;
            const opt = opts.find((o) => o.label === s || o.label.startsWith(s) || o.label.includes(s));
            if (opt) row[c.key] = opt.id; else { row[c.key] = null; if (c.key === "equipment_id") bad = bad || "설비 확인 필요"; }
          } else { const s = String(v ?? "").replace(/#REF!|#N\/A|#VALUE!/gi, "").trim(); row[c.key] = s || null; }
        }
        if (!String(row.employee_no ?? "").trim() || !String(row.name ?? "").trim()) { err.push({ row: i + 2, reason: "사원번호/성명 누락" }); continue; }
        if (bad) { err.push({ row: i + 2, reason: bad }); continue; }
        const code = String(row.category_code ?? "").trim();
        if (code && await isDuplicateApplication(tenantId, String(row.employee_no), code)) { dup++; continue; }
        okRows.push(row);
      }
      setImportPreview({ okRows, dup, err });
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석 실패."); }
  };
  const commitImport = async () => {
    if (!importPreview) return;
    try {
      for (const row of importPreview.okRows) { const saved = await upsertExamRow("exam_applications", row, tenantId, userId); await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), "import", null, saved); }
      onToast?.(`정상 ${importPreview.okRows.length}건 등록 · 중복 ${importPreview.dup}건 · 오류 ${importPreview.err.length}건`);
      setImportPreview(null); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "Excel 반영 실패."); }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const kpiCard = (label: string, value: string) => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">시험 응시관리</h2>
        <p className="text-sm text-slate-500">시험관리 · 인증시험 응시데이터를 관리합니다.</p>
      </div>

      {/* KPI */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {kpiCard("전체 응시", String(kpi.total))}
        {kpiCard("필기 진행", String(kpi.w진행))}
        {kpiCard("필기 합격", String(kpi.w합격))}
        {kpiCard("실기 진행", String(kpi.s진행))}
        {kpiCard("실기 합격", String(kpi.s합격))}
        {kpiCard("인증 취득", String(kpi.acquired))}
        {kpiCard("미취득", String(kpi.notAcquired))}
        {kpiCard("재응시", String(kpi.re))}
        {kpiCard("취득률", `${kpi.rate}%`)}
      </div>

      {/* 필터/검색 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사원번호/성명/구분코드/설비명)" className={`${inputCls} min-w-[210px]`} />
        <select value={yearF} onChange={(e) => { setYearF(e.target.value); setPage(1); }} className={inputCls}><option value="전체">연도: 전체</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={monthF} onChange={(e) => { setMonthF(e.target.value); setPage(1); }} className={inputCls}><option value="전체">월: 전체</option>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{m}</option>)}</select>
        {FILTERS.map((c) => (
          <select key={c.key} value={filters[c.key] || "전체"} onChange={(e) => { setFilters((p) => ({ ...p, [c.key]: e.target.value })); setPage(1); }} className={inputCls}>
            <option value="전체">{c.label}: 전체</option>
            {(filterOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>

      {/* 툴바 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button className={btn} onClick={() => setShowColMenu((v) => !v)}>컬럼 ▾</button>
          {showColMenu && (
            <div className={`absolute z-10 mt-1 w-40 rounded-lg border p-2 shadow-lg ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
              {COLS.filter((c) => c.hideable).map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
        <button className={`${btn} ${pinFirst ? "text-blue-600" : ""}`} onClick={() => setPinFirst((v) => !v)}>사번 고정{pinFirst ? " ✓" : ""}</button>
        {canEdit && selected.size > 0 && (
          <span className="flex items-center gap-1">
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className={inputCls}><option value="">일괄 상태…</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500" onClick={() => void applyBulkStatus()}>적용 ({selected.size})</button>
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportCsv}>CSV</button>
          <button className={btn} onClick={printTable}>인쇄</button>
          {canEdit && <label className={`${btn} cursor-pointer`}>Excel 등록<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void buildImportPreview(f); e.currentTarget.value = ""; }} /></label>}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ status: "예정" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      {/* 테이블 */}
      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="시험 응시 목록" className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              <th className={`px-2 py-2 ${pinFirst ? "sticky left-0 " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>
                <input type="checkbox" checked={allPagedSel} onChange={() => setSelected((p) => { const n = new Set(p); if (paged.every((r) => n.has(rowKey(r)))) paged.forEach((r) => n.delete(rowKey(r))); else paged.forEach((r) => n.add(rowKey(r))); return n; })} />
              </th>
              {visibleCols.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className={`cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline ${pinFirst && c.key === "employee_no" ? "sticky left-9 " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>{c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
              ))}
              <th className="whitespace-nowrap px-2.5 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, ri) => {
              const k = rowKey(r); const sel = selected.has(k); const activeRow = ri === activeIdx;
              return (
                <tr key={k} aria-selected={activeRow} onClick={() => setActiveIdx(ri)} onDoubleClick={() => openDetail(r)} className={`${activeRow ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : sel ? (darkMode ? "bg-blue-950/40" : "bg-blue-50") : ""} cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                  <td className={`px-2 py-2 ${pinFirst ? "sticky left-0 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}><input type="checkbox" checked={sel} onChange={() => toggleSel(k)} onClick={(e) => e.stopPropagation()} /></td>
                  {visibleCols.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-2.5 py-2 ${pinFirst && c.key === "employee_no" ? "sticky left-9 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}>
                      {c.type === "cert" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certOf(r) === "취득" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{certOf(r)}{r.cert_status_manual ? " ✓" : ""}</span> : cellText(c, r)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>상세</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                    {canEdit && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button></>}
                  </td>
                </tr>
              );
            })}
            {!loading && paged.length === 0 && <tr><td colSpan={visibleCols.length + 2} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건{selected.size ? ` · 선택 ${selected.size}` : ""}</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {/* 등록/수정 모달 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-app-edit-title" tabIndex={-1} className={`my-8 w-full max-w-3xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-app-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? "시험 응시 수정" : "시험 응시 등록"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLS.filter((c) => c.type !== "cert").map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "ref" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(refMap[c.refTable as string] || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  ) : c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : (
                    <input type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined} className={`${inputCls} w-full`} value={c.type === "date" ? ymd(editRow[c.key]) : String(editRow[c.key] ?? "")} onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
              {/* 인증취득여부 수동 확정 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">인증취득여부 (수동 확정)</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editRow.cert_status_manual} onChange={(e) => setEditRow((f) => ({ ...(f || {}), cert_status_manual: e.target.checked }))} />수동</label>
                  <select disabled={!editRow.cert_status_manual} className={`${inputCls} flex-1`} value={String(editRow.cert_status ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), cert_status: e.target.value || null }))}><option value="">자동({editRow.practical_pass_date ? "취득" : "미취득"})</option><option value="취득">취득</option><option value="미취득">미취득</option></select>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Excel 미리보기(정상/중복/오류) */}
      {importPreview && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setImportPreview(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Excel 등록 미리보기</h3>
            <div className="mb-3 flex gap-2 text-sm">
              <span className="rounded-lg bg-emerald-100 px-3 py-1 text-emerald-700">정상 {importPreview.okRows.length}</span>
              <span className="rounded-lg bg-amber-100 px-3 py-1 text-amber-700">중복 {importPreview.dup}</span>
              <span className="rounded-lg bg-rose-100 px-3 py-1 text-rose-700">오류 {importPreview.err.length}</span>
            </div>
            {importPreview.err.length > 0 && (
              <div className={`mb-3 max-h-40 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                {importPreview.err.slice(0, 30).map((e, i) => <div key={i} className="py-0.5">{e.row}행: {e.reason}</div>)}
              </div>
            )}
            <p className="mb-4 text-xs text-slate-500">정상 {importPreview.okRows.length}건만 반영됩니다(중복/오류 제외, 자동 저장 안 함).</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportPreview(null)} className={`rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button onClick={() => void commitImport()} disabled={importPreview.okRows.length === 0} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${importPreview.okRows.length === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{importPreview.okRows.length}건 반영</button>
            </div>
          </div>
        </div>
      )}

      {/* 상세보기(더블클릭) */}
      {detailRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">시험 응시 상세</span></h3>
                <p className="text-sm text-slate-500">사번 {String(detailRow.employee_no || "-")} · 구분코드 {String(detailRow.category_code || "-")}</p></div>
              <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            {[
              ["직원 기본정보", ["employee_no", "name", "group_name", "product", "process"]],
              ["시험 정보", ["category_code", "category", "level_id", "equipment_id", "status"]],
              ["필기 이력", ["written_exam_date", "written_pass_date"]],
              ["실기 이력", ["practical_acquire_date", "practical_pass_date"]],
              ["인증 결과", ["cert_status", "cert_acquired_date", "timing_status"]],
              ["PM Level 근거", ["pm_level"]],
              ["D.M 근거", ["dm_process"]],
              ["비고", ["notes"]],
            ].map(([title, keys]) => (
              <div key={title as string} className="mb-3">
                <div className="mb-1 text-sm font-semibold text-slate-500">{title as string}</div>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {(keys as string[]).map((key) => { const c = COLS.find((x) => x.key === key) || { key, label: key, type: "text" } as Col; return (
                    <div key={key} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-0.5">{cellText(c, detailRow)}</div></div>
                  ); })}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 변경이력 */}
      {historyRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setHistoryRow(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold">변경이력</h3><button onClick={() => setHistoryRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button></div>
            <div className="max-h-[50vh] overflow-auto">
              {historyList.length ? historyList.map((h) => <div key={String(h.id)} className={`border-b py-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-100"}`}><span className="font-semibold">{String(h.action_type)}</span>{h.memo ? <span className="ml-2 text-slate-500">{String(h.memo)}</span> : null}<span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span></div>) : <div className="py-8 text-center text-sm text-slate-500">변경이력이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesDialog open={confirmClose} darkMode={darkMode}
        onKeepEditing={() => setConfirmClose(false)}
        onDiscard={() => { setConfirmClose(false); setEditRow(null); }}
        onSave={() => { setConfirmClose(false); void saveRow(); }} />
    </section>
  );
}
