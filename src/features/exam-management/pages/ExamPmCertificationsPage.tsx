import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { calculateCertExpiry } from "../services/examAutomationService";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import * as XLSX from "xlsx";
import {
  listExamRows, upsertExamRow, softDeleteExamRow,
  writeExamAudit, listExamAudit, examSupabaseReady,
  type ExamRow,
} from "../services/examMasterService";

type ColType = "text" | "date" | "number" | "select" | "expiry";
type Col = { key: string; label: string; type: ColType; options?: string[]; required?: boolean; filter?: boolean; hideable?: boolean };

const APPROVAL_OPTIONS = ["대기", "승인", "반려"];
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
const nowIso = () => new Date().toISOString();

// 만료 상태(취득/만료일 기준 자동 판정).
const expiryOf = (r: ExamRow): { label: string; tone: string } => {
  const s = ymd(r.expiry_date); if (!s) return { label: "-", tone: "text-slate-400" };
  const days = Math.floor((new Date(s).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "만료", tone: "bg-rose-100 text-rose-700" };
  if (days <= 30) return { label: `임박(${days}일)`, tone: "bg-amber-100 text-amber-700" };
  return { label: "유효", tone: "bg-emerald-100 text-emerald-700" };
};

// 시험 응시(exam_applications)의 인증취득여부(취득/미취득) — 목록/필터의 certOf 와 동일 규칙(수동 확정 우선).
const appCertOf = (a: ExamRow): "취득" | "미취득" =>
  (a.cert_status_manual === true && (a.cert_status === "취득" || a.cert_status === "미취득"))
    ? (a.cert_status as "취득" | "미취득")
    : (ymd(a.practical_pass_date) ? "취득" : "미취득");
// 자동생성 대상: 필기 합격 + 실기 합격 + 인증취득여부 = 취득.
const qualifiesForPm = (a: ExamRow): boolean =>
  !a.deleted_at && !!a.id && !!ymd(a.written_pass_date) && !!ymd(a.practical_pass_date) && appCertOf(a) === "취득";

const COLS: Col[] = [
  { key: "employee_no", label: "사원번호", type: "text", required: true },
  { key: "name", label: "성명", type: "text", required: true },
  { key: "pm_level", label: "PM Level", type: "text", required: true, filter: true },
  { key: "acquired_date", label: "취득일", type: "date" },
  { key: "expiry_date", label: "만료일", type: "date" },
  { key: "expiry_state", label: "만료상태", type: "expiry", filter: true },
  { key: "cert_no", label: "인증번호", type: "text", hideable: true },
  { key: "approval_status", label: "승인상태", type: "select", options: APPROVAL_OPTIONS, filter: true },
  { key: "notes", label: "비고", type: "text", hideable: true },
];
const FILTERS = COLS.filter((c) => c.filter);
const FORM_COLS = COLS.filter((c) => c.type !== "expiry");

const isApproved = (r: ExamRow) => String(r.approval_status ?? "") === "승인";
// 인증번호 생성(취득일 + 사번 + 짧은 랜덤). 이미 있으면 유지.
const genCertNo = (r: ExamRow, acquired: string): string =>
  `PM-${(acquired || "").replace(/-/g, "") || "00000000"}-${String(r.employee_no ?? "").trim() || "NA"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export default function ExamPmCertificationsPage({
  darkMode, canEdit, tenantId, userId, onToast, onDataChanged,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void;
  onDataChanged?: () => void; // 승인 등 데이터 변경 시 시험 통계 자동 갱신 신호(App 에서 버전 증가).
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [rules, setRules] = useState<ExamRow[]>([]);
  const [autoInfo, setAutoInfo] = useState<string>("");
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
  const [detailRow, setDetailRow] = useState<ExamRow | null>(null);
  const [historyRow, setHistoryRow] = useState<ExamRow | null>(null);
  const [historyList, setHistoryList] = useState<ExamRow[]>([]);
  const [showColMenu, setShowColMenu] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  // 미저장 변경 보호 + 앱 공통 닫기(ESC·뒤로가기·최상위 우선) 연동.
  const [editBase, setEditBase] = useState("");
  const editKey = editRow ? String(editRow.id ?? "__new__") : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (editRow) setEditBase(JSON.stringify(editRow)); }, [editKey]);
  const editDirty = !!editRow && JSON.stringify(editRow) !== editBase;
  const requestCloseEdit = () => { if (saving) return; if (editDirty) setConfirmClose(true); else setEditRow(null); };
  const topClose = confirmClose ? undefined
    : historyRow ? () => setHistoryRow(null)
      : detailRow ? () => setDetailRow(null)
        : editRow ? requestCloseEdit
          : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [certs, apps, people, rule] = await Promise.all([
        listExamRows("pm_certifications", tenantId),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPersonnel(people); setRules(rule);

      // 자동생성: 필기합격+실기합격+취득 응시건 → 승인대기 PM 인증(중복 제외: source_application_id). 관리자만 생성.
      let finalCerts = certs;
      if (canEdit) {
        const existingSrc = new Set(certs.map((c) => String(c.source_application_id ?? "")).filter(Boolean));
        const toCreate = apps.filter((a) => qualifiesForPm(a) && !existingSrc.has(String(a.id)));
        if (toCreate.length) {
          for (const a of toCreate) {
            const person = people.find((p) => String(p.employee_no ?? "") === String(a.employee_no ?? ""));
            const acquired = ymd(a.cert_acquired_date) || ymd(a.practical_pass_date) || null;
            await upsertExamRow("pm_certifications", {
              source_application_id: a.id,
              employee_no: a.employee_no ?? null,
              name: a.name ?? null,
              pm_level: a.pm_level ?? null,
              level_id: a.level_id ?? null,
              personnel_id: person?.id ?? null,
              acquired_date: acquired,
              approval_status: "대기",
            }, tenantId, userId);
          }
          setAutoInfo(`시험 응시(필기합격·실기합격·취득) ${toCreate.length}건을 승인대기로 자동 생성했습니다.`);
          finalCerts = await listExamRows("pm_certifications", tenantId);
        } else setAutoInfo("");
      }
      setRows(finalCerts);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, canEdit, userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const cellText = (c: Col, r: ExamRow) => {
    if (c.type === "expiry") return expiryOf(r).label;
    const v = r[c.key];
    if (c.type === "date") return ymd(v) || "-";
    if (v === null || v === undefined || v === "") return "-";
    return String(v);
  };

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    FILTERS.forEach((c) => {
      if (c.type === "expiry") { m[c.key] = ["유효", "임박", "만료"]; return; }
      m[c.key] = Array.from(new Set(rows.map((r) => String(r[c.key] ?? "")).filter(Boolean))).sort();
    });
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      for (const c of FILTERS) {
        const f = filters[c.key]; if (!f || f === "전체") continue;
        if (c.type === "expiry") { const lab = expiryOf(r).label; if (f === "임박" ? !lab.startsWith("임박") : (f === "유효" ? lab !== "유효" : lab !== "만료")) return false; continue; }
        if (String(r[c.key] ?? "") !== f) return false;
      }
      if (q) { const t = `${r.employee_no ?? ""} ${r.name ?? ""} ${r.pm_level ?? ""} ${r.cert_no ?? ""}`.toLowerCase(); if (!t.includes(q)) return false; }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = COLS.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? ""), bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "-" && bv !== "-") return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "ko") * dir;
      });
    }
    return list;
  }, [rows, search, filters, sortKey, sortDir]);

  const kpi = useMemo(() => {
    const cnt = (fn: (r: ExamRow) => boolean) => filtered.filter(fn).length;
    return {
      total: filtered.length,
      pending: cnt((r) => (r.approval_status ?? "대기") === "대기"),
      approved: cnt(isApproved),
      rejected: cnt((r) => r.approval_status === "반려"),
      valid: cnt((r) => expiryOf(r).label === "유효"),
      soon: cnt((r) => expiryOf(r).label.startsWith("임박")),
      expired: cnt((r) => expiryOf(r).label === "만료"),
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const visibleCols = COLS.filter((c) => !hidden.has(c.key));
  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };

  const saveRow = async () => {
    if (!editRow) return;
    if (isApproved(editRow)) { setError("승인된 인증은 수정할 수 없습니다."); return; } // 승인 후 읽기전용
    for (const c of FORM_COLS) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    for (const c of FORM_COLS) if (c.type === "date" && !isValidDateCell(editRow[c.key])) { setError(`${c.label} 날짜 형식이 올바르지 않습니다.`); return; }
    setSaving(true); setError(null);
    try {
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow("pm_certifications", { approval_status: "대기", ...editRow }, tenantId, userId);
      await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null); onToast?.(isNew ? "PM 인증이 등록되었습니다." : "PM 인증이 수정되었습니다."); await reload(); onDataChanged?.();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    if (isApproved(r)) { setError("승인된 인증은 삭제할 수 없습니다."); return; }
    try { await softDeleteExamRow("pm_certifications", String(r.id), userId); await writeExamAudit(tenantId, userId, "pm_certifications", String(r.id), "delete", r, null); onToast?.("PM 인증이 삭제되었습니다."); await reload(); onDataChanged?.(); }
    catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  // 승인/반려. 승인 시: 인증번호 생성 + 취득일 저장 + 만료일 계산 + PM Level 갱신(인력) + 인증이력(감사로그).
  const decide = async (r: ExamRow, approve: boolean) => {
    if (!r.id) return; setError(null);
    try {
      if (approve) {
        if (!String(r.pm_level ?? "").trim()) { setError("PM Level 이 비어 있어 승인할 수 없습니다. 먼저 입력해주세요."); return; }
        const acquired = ymd(r.acquired_date) || ymd(r.practical_pass_date) || new Date().toISOString().slice(0, 10);
        const certNo = String(r.cert_no ?? "").trim() || genCertNo(r, acquired);
        const expiry = ymd(r.expiry_date) || calculateCertExpiry({ ...r, acquired_date: acquired }, rules).value.expiryDate || null;
        const payload: ExamRow = { ...r, approval_status: "승인", approved_by: userId, approved_at: nowIso(), cert_no: certNo, acquired_date: acquired, expiry_date: expiry };
        const saved = await upsertExamRow("pm_certifications", payload, tenantId, userId);
        await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), "approve", r, saved, `승인 · 인증번호 ${certNo}`);
        // PM Level 갱신: 연결된 인력(연명부)의 현재 PM Level 을 인증 값으로 갱신.
        const person = personnel.find((p) => String(p.employee_no ?? "") === String(r.employee_no ?? ""));
        if (person && String(r.pm_level ?? "").trim()) {
          const up = await upsertExamRow("exam_personnel", { ...person, current_pm_level: r.pm_level }, tenantId, userId);
          await writeExamAudit(tenantId, userId, "exam_personnel", String(up.id), "update", { current_pm_level: person.current_pm_level }, { current_pm_level: r.pm_level }, "PM Level 갱신(PM 인증 승인)");
        }
        onToast?.("승인 완료: 인증번호 생성·취득일 저장·만료일 계산·PM Level 갱신·인증이력 저장 완료.");
        setDetailRow(saved);
      } else {
        const saved = await upsertExamRow("pm_certifications", { ...r, approval_status: "반려", approved_by: userId, approved_at: nowIso() }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), "reject", r, saved, "반려");
        onToast?.("반려 처리했습니다."); setDetailRow(saved);
      }
      await reload();
      onDataChanged?.(); // 승인/반려로 데이터 변경 → 시험 통계(대시보드/인력/목표/실적/보고서) 자동 갱신.
    } catch (e) { setError((e as { message?: string })?.message || "승인 처리 실패."); }
  };

  const openHistory = async (r: ExamRow) => { setHistoryRow(r); try { setHistoryList(await listExamAudit(tenantId, "pm_certifications", String(r.id))); } catch { setHistoryList([]); } };

  const tableKeyDown = useTableKeyboardNav({
    count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => paged[i] && setDetailRow(paged[i]),
  });

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => { const o: Record<string, string> = {}; COLS.forEach((c) => { o[c.label] = cellText(c, r); }); return o; }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PM인증"); XLSX.writeFile(wb, "시험관리_PM인증.xlsx");
  };
  const printTable = () => {
    const w = window.open("", "_blank", "width=1100,height=760"); if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${visibleCols.map((c) => `<td>${cellText(c, r)}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>PM 인증</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic';font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px}th{background:#f1f5f9}</style><h3>PM 인증 (${filtered.length}건)</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const kpiCard = (label: string, value: string, tone = "") => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">PM 인증관리</h2>
        <p className="text-sm text-slate-500">시험관리 · 필기합격·실기합격·인증취득 응시건을 승인대기로 자동 생성하고, 승인 시 인증번호·만료일·PM Level 을 자동 처리합니다.</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {kpiCard("전체", String(kpi.total))}
        {kpiCard("승인 대기", String(kpi.pending), "text-blue-600")}
        {kpiCard("승인", String(kpi.approved), "text-emerald-600")}
        {kpiCard("반려", String(kpi.rejected), "text-rose-600")}
        {kpiCard("유효", String(kpi.valid), "text-emerald-600")}
        {kpiCard("만료 임박", String(kpi.soon), "text-amber-600")}
        {kpiCard("만료", String(kpi.expired), "text-rose-600")}
      </div>

      {autoInfo && <div className="mb-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{autoInfo}</div>}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사원번호/성명/PM Level/인증번호)" className={`${inputCls} min-w-[220px]`} />
        {FILTERS.map((c) => (
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
            <div className={`absolute z-10 mt-1 w-40 rounded-lg border p-2 shadow-lg ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
              {COLS.filter((c) => c.hideable).map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={printTable}>인쇄</button>
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ approval_status: "대기" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="PM 인증 목록" className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              {visibleCols.map((c) => <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline">{c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>)}
              <th className="whitespace-nowrap px-2.5 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, ri) => (
              <tr key={String(r.id)} aria-selected={ri === activeIdx} onClick={() => setActiveIdx(ri)} onDoubleClick={() => setDetailRow(r)} className={`${ri === activeIdx ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : ""} cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {visibleCols.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2.5 py-2">
                    {c.type === "expiry" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${expiryOf(r).tone}`}>{expiryOf(r).label}</span>
                      : c.key === "approval_status" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isApproved(r) ? "bg-emerald-100 text-emerald-700" : r.approval_status === "반려" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-500"}`}>{String(r.approval_status ?? "대기")}</span>
                        : cellText(c, r)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2.5 py-2">
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); setDetailRow(r); }}>상세</button>
                  <span className="mx-1 text-slate-300">·</span>
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                  {/* 승인 후에는 읽기전용(수정/삭제 숨김). 승인 전에만 수정/삭제 가능. */}
                  {canEdit && !isApproved(r) && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button></>}
                  {isApproved(r) && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-700">읽기전용</span>}
                </td>
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

      {/* 등록/수정 (승인 전만) */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-pm-edit-title" tabIndex={-1} className={`my-8 w-full max-w-2xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-pm-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? "PM 인증 수정" : "PM 인증 등록"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FORM_COLS.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : (
                    <input type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined} className={`${inputCls} w-full`} value={c.type === "date" ? ymd(editRow[c.key]) : String(editRow[c.key] ?? "")} onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">※ 만료일/인증번호는 승인 시 자동 계산·생성됩니다(직접 입력값이 있으면 유지).</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 상세보기(더블클릭) — 승인/반려 처리 */}
      {detailRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">PM 인증 상세</span></h3>
                <p className="text-sm text-slate-500">사번 {String(detailRow.employee_no || "-")} · PM Level {String(detailRow.pm_level || "-")}</p></div>
              <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            {[
              ["직원/인증", ["employee_no", "name", "pm_level"]],
              ["취득·만료", ["acquired_date", "expiry_date", "expiry_state"]],
              ["승인·인증번호", ["cert_no", "approval_status", "notes"]],
            ].map(([title, keys]) => (
              <div key={title as string} className="mb-3">
                <div className="mb-1 text-sm font-semibold text-slate-500">{title as string}</div>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {(keys as string[]).map((key) => { const c = COLS.find((x) => x.key === key)!; return (
                    <div key={key} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-0.5">{cellText(c, detailRow)}</div></div>
                  ); })}
                </dl>
              </div>
            ))}

            {/* 만료 자동판정(취득일 + exam_rules 유효기간) — 표시 전용 */}
            {(() => {
              const ex = calculateCertExpiry(detailRow, rules).value;
              const tone = ex.status === "만료" ? "bg-rose-100 text-rose-700" : ex.isExpiringSoon ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
              return (
                <div className="mb-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                    만료 자동판정 <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{ex.status}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">만료일</div><div className="mt-0.5">{ex.expiryDate || "-"}</div></div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">남은 일수</div><div className="mt-0.5">{ex.remainingDays === null ? "-" : `${ex.remainingDays}일`}</div></div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">상태</div><div className="mt-0.5">{ex.status}</div></div>
                  </dl>
                </div>
              );
            })()}

            {isApproved(detailRow) ? (
              <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">승인 완료된 인증입니다(읽기전용). 인증번호: {String(detailRow.cert_no || "-")}</div>
            ) : canEdit ? (
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => void decide(detailRow, false)} className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">반려</button>
                <button onClick={() => void decide(detailRow, true)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">승인</button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 변경·승인 이력 */}
      {historyRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setHistoryRow(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold">변경·승인 이력</h3><button onClick={() => setHistoryRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button></div>
            <div className="max-h-[50vh] overflow-auto">
              {historyList.length ? historyList.map((h) => <div key={String(h.id)} className={`border-b py-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-100"}`}><span className="font-semibold">{String(h.action_type)}</span>{h.memo ? <span className="ml-2 text-slate-500">{String(h.memo)}</span> : null}<span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span></div>) : <div className="py-8 text-center text-sm text-slate-500">이력이 없습니다.</div>}
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
