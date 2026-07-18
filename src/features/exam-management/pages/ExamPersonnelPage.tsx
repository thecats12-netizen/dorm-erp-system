import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import * as XLSX from "xlsx";
import {
  listExamRows, upsertExamRow, softDeleteExamRow, writeExamAudit, listExamAudit,
  isDuplicateEmployeeNo, listByPersonnel, examSupabaseReady, type ExamRow, type ExamPersonnelChildTable,
} from "../services/examMasterService";
import { calculatePmLevel } from "../services/examAutomationService";
// [자동 라이선스 관리] 인력 저장 후 employee_license_plan 자동 생성(추가 전용·비차단). 기존 저장 흐름 무변경.
import { generatePlanForEmployeeAuto, generatePlanForEmployee, loadLadder } from "../services/licensePlanService";

type ColType = "text" | "date" | "number" | "select" | "boolean";
type Col = { key: string; label: string; type: ColType; options?: string[]; required?: boolean; filter?: boolean };

const COLS: Col[] = [
  { key: "employee_no", label: "사번", type: "text", required: true },
  { key: "name", label: "이름", type: "text", required: true },
  { key: "group_name", label: "그룹", type: "text", filter: true },
  { key: "product_group", label: "제품군", type: "text", filter: true },
  { key: "part_name", label: "파트", type: "text", filter: true },
  { key: "position", label: "직책", type: "text" },
  { key: "hire_date", label: "입사일", type: "date" },
  { key: "employment_status", label: "재직여부", type: "select", options: ["재직", "휴직", "퇴직"], filter: true },
  { key: "career_type", label: "경력/신입", type: "select", options: ["경력", "신입"] },
  { key: "current_pm_level", label: "현재 PM Level", type: "text" },
  { key: "pm_capable_rate", label: "PM 가능률", type: "number" },
  { key: "single_job", label: "Single Job", type: "text" },
  { key: "m1", label: "M1", type: "text" },
  { key: "m2", label: "M2", type: "text" },
  { key: "m3", label: "M3", type: "text" },
  { key: "m4", label: "M4", type: "text" },
  { key: "dm", label: "D.M", type: "text" },
  { key: "cert_level", label: "인증 Level", type: "text", filter: true },
  { key: "dual_multi", label: "Dual Multi", type: "boolean" },
  { key: "notes", label: "비고", type: "text" },
];
const FILTERS = COLS.filter((c) => c.filter);
const PAGE_SIZE = 20;

const ymd = (v: unknown) => {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const tenureText = (hire: unknown) => {
  const s = ymd(hire); if (!s) return "-";
  const d = new Date(s); if (isNaN(d.getTime())) return "-";
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) return "-";
  return `${Math.floor(months / 12)}년 ${months % 12}개월`;
};
const boolText = (v: unknown) => (v === true ? "O" : v === false ? "X" : "-");
const cellText = (c: Col, r: ExamRow) => {
  const v = r[c.key];
  if (c.type === "boolean") return boolText(v);
  if (c.type === "date") return ymd(v) || "-";
  if (v === null || v === undefined || v === "") return "-";
  if (c.key === "pm_capable_rate") return `${v}%`;
  return String(v);
};

export default function ExamPersonnelPage({
  darkMode, canEdit, tenantId, userId, onToast, refreshKey,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void; refreshKey?: number;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [rules, setRules] = useState<ExamRow[]>([]); // exam_rules(PM 승급 요건 검증용)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailRow, setDetailRow] = useState<ExamRow | null>(null);
  const [detailData, setDetailData] = useState<Record<string, ExamRow[]>>({});
  const [historyRow, setHistoryRow] = useState<ExamRow | null>(null);
  const [historyList, setHistoryList] = useState<ExamRow[]>([]);
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
      const [people, ruleRows] = await Promise.all([
        listExamRows("exam_personnel", tenantId),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setRows(people); setRules(ruleRows);
    }
    catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refreshKey]);

  // 최초 로드(내부 비동기 — 렌더 캐스케이드 아님).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    FILTERS.forEach((c) => { m[c.key] = Array.from(new Set(rows.map((r) => String(r[c.key] ?? "")).filter(Boolean))).sort(); });
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      for (const c of FILTERS) { const f = filters[c.key]; if (f && f !== "전체" && String(r[c.key] ?? "") !== f) return false; }
      if (q) { if (!COLS.map((c) => cellText(c, r)).join(" ").toLowerCase().includes(q)) return false; }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = COLS.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? "");
        const bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(String(av).replace("%", "")), bn = Number(String(bv).replace("%", ""));
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "-" && bv !== "-") return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "ko") * dir;
      });
    }
    return list;
  }, [rows, search, filters, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const toggleSort = (k: string) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  const saveRow = async () => {
    if (!editRow) return;
    for (const c of COLS) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    setSaving(true); setError(null);
    try {
      const empNo = String(editRow.employee_no ?? "").trim();
      if (await isDuplicateEmployeeNo(tenantId, empNo, editRow.id ? String(editRow.id) : undefined)) {
        setError(`이미 등록된 사번입니다: ${empNo}`); setSaving(false); return;
      }
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow("exam_personnel", editRow, tenantId, userId);
      await writeExamAudit(tenantId, userId, "exam_personnel", String(saved.id), isNew ? "create" : "update", before, saved);
      // [자동 라이선스] 신규 등록에만 계획 자동 생성(수정 시 중복 실행/불필요 쿼리 방지). 비활성(퇴사) 직원은 제외.
      //  생성 자체도 idempotent(기존 단계 skip). 실패해도 인력 저장은 유지(비차단).
      if (isNew) {
        const empStatus = String(saved.employment_status ?? "").trim();
        const inactive = /퇴사|퇴직|비활성|중지|해지/.test(empStatus);
        if (!inactive) {
          try {
            const res = await generatePlanForEmployeeAuto(String(saved.id), tenantId, saved.hire_date, userId);
            if (res.created > 0) onToast?.(`라이선스 계획 ${res.created}단계가 자동 생성되었습니다.`);
          } catch (e) { console.warn("[licensePlan] 계획 생성 실패(무시)", e); }
        }
      }
      setEditRow(null);
      onToast?.(isNew ? "인력현황 항목이 등록되었습니다." : "인력현황 항목이 수정되었습니다.");
      await reload();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try {
      await softDeleteExamRow("exam_personnel", String(r.id), userId);
      await writeExamAudit(tenantId, userId, "exam_personnel", String(r.id), "delete", r, null);
      onToast?.("인력현황 항목이 삭제되었습니다.");
      await reload();
    } catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  const openDetail = async (r: ExamRow) => {
    setDetailRow(r); setDetailData({});
    try {
      const tables: ExamPersonnelChildTable[] = ["exam_applications", "exam_results", "pm_certifications", "dm_certifications"];
      const results = await Promise.all(tables.map((t) => listByPersonnel(t, tenantId, String(r.id)).catch(() => [])));
      setDetailData(Object.fromEntries(tables.map((t, i) => [t, results[i]])));
    } catch { /* 무시 */ }
  };

  const openHistory = async (r: ExamRow) => {
    setHistoryRow(r);
    try { setHistoryList(await listExamAudit(tenantId, "exam_personnel", String(r.id))); } catch { setHistoryList([]); }
  };

  // 테이블 행 키보드 이동 + Enter 상세보기.
  const tableKeyDown = useTableKeyboardNav({
    count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => paged[i] && void openDetail(paged[i]),
  });

  const exportExcel = () => {
    const data = filtered.map((r) => {
      const o: Record<string, string> = {};
      COLS.forEach((c) => { o[c.label] = cellText(c, r); });
      o["재직기간"] = tenureText(r.hire_date);
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "인력현황");
    XLSX.writeFile(wb, "시험관리_인력현황.xlsx");
  };

  const importExcel = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      let ok = 0, skipped = 0;
      // [자동 라이선스] 업로드 사원별 계획 생성을 위해 사다리를 1회만 로드(반복 쿼리 방지). 실패 시 빈 배열→생성 skip.
      const ladder = await loadLadder(tenantId).catch(() => []);
      for (const r of raw) {
        const row: ExamRow = {};
        for (const c of COLS) {
          const v = r[c.label];
          if (c.type === "number") { const n = String(v ?? "").replace(/[^0-9.-]/g, ""); row[c.key] = n === "" ? null : Number(n); }
          else if (c.type === "date") { row[c.key] = ymd(v) || null; }
          else if (c.type === "boolean") { const s = String(v ?? "").trim().toLowerCase(); row[c.key] = ["o", "예", "y", "true", "1", "가능"].includes(s) ? true : (s === "" ? null : false); }
          else { row[c.key] = String(v ?? "").trim() || null; }
        }
        const empNo = String(row.employee_no ?? "").trim();
        if (!empNo || !String(row.name ?? "").trim()) { skipped++; continue; }
        if (await isDuplicateEmployeeNo(tenantId, empNo)) { skipped++; continue; } // 중복 사번 스킵
        const saved = await upsertExamRow("exam_personnel", row, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_personnel", String(saved.id), "import", null, saved);
        // [자동 라이선스] 신규 사원 계획 자동 생성(idempotent·비차단). 실패해도 Excel 등록은 유지.
        if (ladder.length > 0) {
          try { await generatePlanForEmployee(String(saved.id), tenantId, saved.hire_date, ladder, userId); }
          catch (e) { console.warn("[licensePlan] Excel 계획 생성 실패(무시)", e); }
        }
        ok++;
      }
      onToast?.(`인력현황 Excel ${ok}건 등록${skipped ? ` · ${skipped}건 제외(사번 누락/중복)` : ""}`);
      await reload();
    } catch (e) { setError((e as { message?: string })?.message || "Excel 등록에 실패했습니다."); }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">인력현황</h2>
        <p className="text-sm text-slate-500">시험관리 · 직원 인증 현황(연명부)을 관리합니다.</p>
      </div>

      {/* 필터/툴바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사번/이름 등)" className={`${inputCls} min-w-[170px]`} />
        {FILTERS.map((c) => (
          <select key={c.key} value={filters[c.key] || "전체"} onChange={(e) => { setFilters((p) => ({ ...p, [c.key]: e.target.value })); setPage(1); }} className={inputCls}>
            <option value="전체">{c.label}: 전체</option>
            {(filterOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel 내보내기</button>
          {canEdit && <label className={`${btn} cursor-pointer`}>Excel 등록<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); e.currentTarget.value = ""; }} /></label>}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ employment_status: "재직" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      {/* 테이블 */}
      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="인력현황 목록" className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline">
                  {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  {c.key === "hire_date" ? "" : ""}
                </th>
              ))}
              <th className="whitespace-nowrap px-2.5 py-2">재직기간</th>
              <th className="whitespace-nowrap px-2.5 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, ri) => (
              <tr key={String(r.id)} aria-selected={ri === activeIdx} onClick={() => setActiveIdx(ri)} onDoubleClick={() => void openDetail(r)}
                className={`${ri === activeIdx ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : ""} cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {COLS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2.5 py-2">
                    {c.key === "current_pm_level" ? (() => {
                      // 저장된 현재 PM Level 은 그대로 두고, 자동계산 PM Level 을 작은 배지+툴팁(근거)으로 보조 표시.
                      const pm = calculatePmLevel(r, [], rules);
                      return (
                        <span className="inline-flex items-center gap-1">
                          <span>{cellText(c, r)}</span>
                          <span title={`자동계산 근거: ${pm.reasons.join(", ") || "-"}`} className={`rounded px-1 py-0.5 text-[0.6rem] font-medium ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>자동:{pm.value}</span>
                        </span>
                      );
                    })() : cellText(c, r)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2.5 py-2">{tenureText(r.hire_date)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openDetail(r); }}>상세</button>
                  <span className="mx-1 text-slate-300">·</span>
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                  {canEdit && <>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button>
                  </>}
                </td>
              </tr>
            ))}
            {!loading && paged.length === 0 && <tr><td colSpan={COLS.length + 2} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2">
          <button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button>
          <span>{curPage} / {pageCount}</span>
          <button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button>
        </span>
      </div>

      {/* 등록/수정 모달 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-personnel-edit-title" tabIndex={-1} className={`my-8 w-full max-w-2xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-personnel-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? "인력현황 수정" : "인력현황 등록"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {COLS.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}>
                      <option value="">선택</option>
                      {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : c.type === "boolean" ? (
                    <select className={`${inputCls} w-full`} value={editRow[c.key] === true ? "O" : editRow[c.key] === false ? "X" : ""} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value === "" ? null : e.target.value === "O" }))}>
                      <option value="">선택</option><option value="O">O</option><option value="X">X</option>
                    </select>
                  ) : (
                    <input type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined}
                      className={`${inputCls} w-full`} value={c.type === "date" ? ymd(editRow[c.key]) : String(editRow[c.key] ?? "")}
                      onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 직원 상세(더블클릭) — 기본정보 + 시험/인증 이력 */}
      {detailRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">인증 상세</span></h3>
                <p className="text-sm text-slate-500">사번 {String(detailRow.employee_no || "-")} · {String(detailRow.part_name || "-")} · {String(detailRow.position || "-")}</p>
              </div>
              <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {COLS.map((c) => (
                <div key={c.key} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{c.label}</div>
                  <div className="mt-0.5">{cellText(c, detailRow)}</div>
                </div>
              ))}
              <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">재직기간</div>
                <div className="mt-0.5">{tenureText(detailRow.hire_date)}</div>
              </div>
            </dl>

            {/* PM Level 자동판정(exam_rules 기준, 인증 이력 참조) — 저장값 미변경, 표시 전용. 수동 확정 시 그 값 유지. */}
            {(() => {
              const pm = calculatePmLevel(detailRow, detailData["pm_certifications"] || [], rules);
              const stored = String(detailRow.current_pm_level || "").trim();
              const manual = detailRow.pm_level_manual === true && stored;
              const nextUnmet = pm.warnings.filter((w) => /승급/.test(w));
              return (
                <div className="mb-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                    PM Level 자동판정
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${darkMode ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700"}`}>{pm.value}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[0.6rem] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">자동계산</span>
                    {manual && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.6rem] font-medium text-amber-700">수동 확정값 유지: {stored}</span>}
                  </div>
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">현재 PM Level(저장값)</div>
                      <div className="mt-0.5">{stored || "-"}</div>
                    </div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-emerald-500">계산 근거</div>
                      <div className="mt-0.5">{pm.reasons.length ? pm.reasons.join(" · ") : "-"}</div>
                    </div>
                    <div className={`rounded-lg border p-2 sm:col-span-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-amber-500">다음 단계 미충족 조건</div>
                      <div className="mt-0.5">{nextUnmet.length ? nextUnmet.join(" · ") : (pm.value === "Master" ? "최고 단계(Master) 달성" : "없음(다음 단계 요건 충족)")}</div>
                    </div>
                  </dl>
                </div>
              );
            })()}
            {([["exam_applications", "시험 응시"], ["exam_results", "시험 결과"], ["pm_certifications", "PM 인증"], ["dm_certifications", "D.M 인증"]] as const).map(([t, label]) => (
              <div key={t} className="mb-3">
                <div className="mb-1 text-sm font-semibold text-slate-500">{label} ({(detailData[t] || []).length})</div>
                {(detailData[t] || []).length ? (
                  <div className={`rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    {(detailData[t] || []).slice(0, 20).map((x) => (
                      <div key={String(x.id)} className="truncate py-0.5">
                        {[x.acquired_date, x.result_date, x.applied_at, x.status, x.passed === true ? "합격" : x.passed === false ? "불합격" : "", x.score, x.cert_no].filter((v) => v !== undefined && v !== null && v !== "").map((v) => String(v).slice(0, 19)).join(" · ") || "-"}
                      </div>
                    ))}
                  </div>
                ) : <div className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-slate-400 dark:border-slate-700">이력이 없습니다.</div>}
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
              {historyList.length ? historyList.map((h) => (
                <div key={String(h.id)} className={`border-b py-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <span className="font-semibold">{String(h.action_type)}</span>
                  <span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span>
                </div>
              )) : <div className="py-8 text-center text-sm text-slate-500">변경이력이 없습니다.</div>}
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
