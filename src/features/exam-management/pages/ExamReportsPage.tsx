import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listExamRows, listExamRefOptions, examSupabaseReady, type ExamRow } from "../services/examMasterService";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const truthy = (v: unknown) => { if (typeof v === "boolean") return v; const s = str(v).trim().toLowerCase(); return !!s && !["0", "false", "n", "no", "x", "-", "없음"].includes(s); };
const pct = (a: unknown, t: unknown): number => { const tt = num(t); if (!(tt > 0)) return 0; const v = Math.round((num(a) / tt) * 1000) / 10; return Number.isFinite(v) ? v : 0; };
const ymd = (v: unknown) => { if (v == null || v === "") return ""; if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10); const s = String(v).trim(); const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10); };
const isFail = (a: ExamRow) => /불합격/.test(str(a.status));
const isTaken = (a: ExamRow) => !["예정", "취소", ""].includes(str(a.status));
const isAcquired = (a: ExamRow) => !!a.practical_pass_date || str(a.status) === "인증 취득";
const isPass = (a: ExamRow) => !isFail(a) && (isAcquired(a) || /합격/.test(str(a.status)));
const expiryState = (r: ExamRow) => { const s = ymd(r.expiry_date); if (!s) return "-"; const d = Math.floor((new Date(s).getTime() - Date.now()) / 86400000); return d < 0 ? "만료" : d <= 30 ? "만료예정" : "유효"; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Column = { label: string; get: (r: ExamRow) => string };
type Report = { columns: Column[]; rows: ExamRow[]; wide?: boolean };
const MONTHS = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);

const REPORT_TYPES = [
  "전체 인증 현황", "그룹별 인증 현황", "파트별 인증 현황", "공정별 인증 현황",
  "직원별 인증 이력", "시험 응시 결과", "합격/불합격 현황", "만료 예정 인증",
  "연간 목표 실적", "월간 실적", "D.M 인증 현황", "미취득자 현황",
] as const;
type ReportType = typeof REPORT_TYPES[number];

export default function ExamReportsPage({ darkMode, tenantId, author }: { darkMode: boolean; canEdit?: boolean; tenantId: string; userId?: string; author?: string; onToast?: (m: string) => void; }) {
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [certs, setCerts] = useState<ExamRow[]>([]);
  const [targets, setTargets] = useState<ExamRow[]>([]);
  const [monthly, setMonthly] = useState<ExamRow[]>([]);
  const [levels, setLevels] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportType>("전체 인증 현황");
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" });

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, c, t, m, lv] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("dm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_annual_targets", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_monthly_results", tenantId).catch(() => [] as ExamRow[]),
        listExamRefOptions("exam_levels", tenantId).catch(() => []),
      ]);
      setPersonnel(p); setApps(a); setCerts(c); setTargets(t); setMonthly(m); setLevels(lv);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const levelLabel = useCallback((id: unknown) => (!id ? "-" : (levels.find((o) => o.id === str(id))?.label || "-")), [levels]);
  const appMonth = (a: ExamRow) => ymd(a.practical_pass_date || a.written_pass_date || a.written_exam_date).slice(0, 7);

  const opts = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    return {
      years: uniq([...apps.map((a) => appMonth(a).slice(0, 4)), ...targets.map((t) => str(t.year)), ...monthly.map((t) => str(t.year))]),
      groups: uniq([...personnel.map((r) => str(r.group_name)), ...apps.map((r) => str(r.group_name)), ...targets.map((r) => str(r.group_name))]),
      products: uniq([...personnel.map((r) => str(r.product_group)), ...apps.map((r) => str(r.product))]),
      parts: uniq([...personnel.map((r) => str(r.part_name)), ...targets.map((r) => str(r.part_name))]),
      processes: uniq(apps.map((r) => str(r.process))),
      levels: uniq(levels.map((l) => l.label)),
    };
  }, [personnel, apps, targets, monthly, levels]);

  // 데이터셋별 필터.
  const fPersonnel = useMemo(() => personnel.filter((r) =>
    (f.group === "전체" || str(r.group_name) === f.group) && (f.product === "전체" || str(r.product_group) === f.product) &&
    (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || str(r.cert_level) === f.level)
  ), [personnel, f]);
  const fApps = useMemo(() => apps.filter((r) => {
    const ym = appMonth(r);
    return (f.year === "전체" || ym.slice(0, 4) === f.year) && (f.month === "전체" || ym.slice(5, 7) === f.month) &&
      (f.group === "전체" || str(r.group_name) === f.group) && (f.product === "전체" || str(r.product) === f.product) &&
      (f.process === "전체" || str(r.process) === f.process) && (f.level === "전체" || levelLabel(r.level_id) === f.level);
  }), [apps, f, levelLabel]);
  const fCerts = useMemo(() => certs.filter((r) => { const ym = ymd(r.acquired_date).slice(0, 7); return (f.year === "전체" || !ym || ym.slice(0, 4) === f.year) && (f.month === "전체" || !ym || ym.slice(5, 7) === f.month); }), [certs, f]);
  const fTargets = useMemo(() => targets.filter((r) =>
    (f.year === "전체" || str(r.year) === f.year) && (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) && (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || levelLabel(r.level_id) === f.level)
  ), [targets, f, levelLabel]);
  const fMonthly = useMemo(() => monthly.filter((r) =>
    (f.year === "전체" || str(r.year) === f.year) && (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) && (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || levelLabel(r.level_id) === f.level)
  ), [monthly, f, levelLabel]);

  // 집계 헬퍼.
  const aggFlags = (rows: ExamRow[], keyFn: (r: ExamRow) => string): ExamRow[] => {
    const m = new Map<string, ExamRow[]>();
    rows.forEach((r) => { const k = keyFn(r) || "(미지정)"; (m.get(k) || m.set(k, []).get(k)!).push(r); });
    return Array.from(m.entries()).map(([label, rs]) => ({
      label, total: rs.length,
      single: rs.filter((r) => truthy(r.single_job)).length, m1: rs.filter((r) => truthy(r.m1)).length, m2: rs.filter((r) => truthy(r.m2)).length,
      m3: rs.filter((r) => truthy(r.m3)).length, m4: rs.filter((r) => truthy(r.m4)).length,
      dm: rs.filter((r) => truthy(r.dm)).length, dual: rs.filter((r) => r.dual_multi === true || truthy(r.dual_multi)).length,
      master: rs.filter((r) => /master/i.test(str(r.cert_level))).length,
    })).sort((a, b) => num(b.total) - num(a.total));
  };

  const built: Report = useMemo(() => {
    const L = (label: string, get: (r: ExamRow) => string): Column => ({ label, get });
    switch (report) {
      case "전체 인증 현황": return { rows: fPersonnel, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("제품군", (r) => str(r.product_group)), L("파트", (r) => str(r.part_name)),
        L("Single", (r) => truthy(r.single_job) ? "○" : ""), L("M1", (r) => truthy(r.m1) ? "○" : ""), L("M2", (r) => truthy(r.m2) ? "○" : ""), L("M3", (r) => truthy(r.m3) ? "○" : ""), L("M4", (r) => truthy(r.m4) ? "○" : ""),
        L("D.M", (r) => truthy(r.dm) ? "○" : ""), L("Dual", (r) => (r.dual_multi === true || truthy(r.dual_multi)) ? "○" : ""), L("인증Level", (r) => str(r.cert_level)) ] };
      case "그룹별 인증 현황": case "파트별 인증 현황": {
        const rows = aggFlags(fPersonnel, (r) => str(report === "그룹별 인증 현황" ? r.group_name : r.part_name));
        return { rows, columns: [
          L(report === "그룹별 인증 현황" ? "그룹" : "파트", (r) => str(r.label)), L("대상자", (r) => str(r.total)),
          L("Single", (r) => str(r.single)), L("M1", (r) => str(r.m1)), L("M2", (r) => str(r.m2)), L("M3", (r) => str(r.m3)), L("M4", (r) => str(r.m4)),
          L("D.M", (r) => str(r.dm)), L("Dual", (r) => str(r.dual)), L("Master", (r) => str(r.master)) ] };
      }
      case "공정별 인증 현황": {
        const m = new Map<string, ExamRow[]>();
        fApps.forEach((r) => { const k = str(r.process) || "(미지정)"; (m.get(k) || m.set(k, []).get(k)!).push(r); });
        const rows = Array.from(m.entries()).map(([label, rs]) => { const taken = rs.filter(isTaken).length, acq = rs.filter(isAcquired).length; return { label, taken, pass: rs.filter(isPass).length, acq, rate: pct(acq, taken) } as ExamRow; }).sort((a, b) => num(b.taken) - num(a.taken));
        return { rows, columns: [ L("공정", (r) => str(r.label)), L("응시", (r) => str(r.taken)), L("합격", (r) => str(r.pass)), L("취득", (r) => str(r.acq)), L("취득률", (r) => `${r.rate}%`) ] };
      }
      case "직원별 인증 이력": return { rows: [...fApps].sort((a, b) => str(a.employee_no).localeCompare(str(b.employee_no))), wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("공정", (r) => str(r.process)), L("구분", (r) => str(r.category)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("응시상태", (r) => str(r.status) || "-"), L("필기합격", (r) => ymd(r.written_pass_date) || "-"), L("실기합격", (r) => ymd(r.practical_pass_date) || "-"), L("취득", (r) => isAcquired(r) ? "취득" : "미취득") ] };
      case "시험 응시 결과": return { rows: fApps, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("필기진행", (r) => ymd(r.written_exam_date) || "-"), L("필기합격", (r) => ymd(r.written_pass_date) || "-"), L("실기합격", (r) => ymd(r.practical_pass_date) || "-"), L("응시상태", (r) => str(r.status) || "-") ] };
      case "합격/불합격 현황": return { rows: fApps.filter(isTaken), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("응시상태", (r) => str(r.status) || "-"), L("결과", (r) => isFail(r) ? "불합격" : isPass(r) ? "합격" : "진행중") ] };
      case "만료 예정 인증": return { rows: fCerts.filter((r) => ["만료예정", "만료"].includes(expiryState(r))).sort((a, b) => ymd(a.expiry_date).localeCompare(ymd(b.expiry_date))), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("D.M 단계", (r) => str(r.dm_stage)), L("Level", (r) => str(r.dm_level)),
        L("취득일", (r) => ymd(r.acquired_date) || "-"), L("만료일", (r) => ymd(r.expiry_date) || "-"), L("상태", (r) => expiryState(r)) ] };
      case "연간 목표 실적": return { rows: fTargets, columns: [
        L("연도", (r) => str(r.year)), L("그룹", (r) => str(r.group_name)), L("제품군", (r) => str(r.product_group)), L("파트", (r) => str(r.part_name)), L("레벨", (r) => levelLabel(r.level_id)),
        L("현재인원", (r) => str(r.current_count)), L("목표인원", (r) => str(r.target_count)), L("차이", (r) => str(num(r.target_count) - num(r.current_count))), L("달성률", (r) => `${pct(r.current_count, r.target_count)}%`) ] };
      case "월간 실적": return { rows: fMonthly, wide: true, columns: [
        L("연도", (r) => str(r.year)), L("그룹", (r) => str(r.group_name)), L("파트", (r) => str(r.part_name)), L("레벨", (r) => levelLabel(r.level_id)),
        ...MONTHS.map((k, i) => L(`${i + 1}월`, (r) => str(num(r[k]) || ""))),
        L("누계", (r) => str(MONTHS.reduce((s, k) => s + num(r[k]), 0))), L("목표", (r) => str(r.target_count)), L("달성률", (r) => `${pct(MONTHS.reduce((s, k) => s + num(r[k]), 0), r.target_count)}%`) ] };
      case "D.M 인증 현황": return { rows: fCerts, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("D.M 단계", (r) => str(r.dm_stage)), L("Level", (r) => str(r.dm_level)), L("공정수", (r) => str(r.process_count)), L("장비수", (r) => str(r.equipment_count)),
        L("취득일", (r) => ymd(r.acquired_date) || "-"), L("만료일", (r) => ymd(r.expiry_date) || "-"), L("상태", (r) => expiryState(r)), L("승인", (r) => str(r.approval_status) || "대기") ] };
      case "미취득자 현황": return { rows: fApps.filter((a) => isTaken(a) && !isAcquired(a) && !isFail(a)), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)), L("응시상태", (r) => str(r.status) || "-") ] };
      default: return { rows: [], columns: [] };
    }
  }, [report, fPersonnel, fApps, fCerts, fTargets, fMonthly, levelLabel]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase(); if (!q) return built.rows;
    return built.rows.filter((r) => built.columns.some((c) => c.get(r).toLowerCase().includes(q)));
  }, [built, search]);

  const activeFilters = useMemo(() => {
    const parts: string[] = [];
    const labels: Record<string, string> = { year: "연도", month: "월", group: "그룹", product: "제품군", part: "파트", process: "공정", level: "레벨" };
    (Object.keys(f) as Array<keyof typeof f>).forEach((k) => { if (f[k] !== "전체") parts.push(`${labels[k]}=${k === "month" ? `${Number(f[k])}월` : f[k]}`); });
    if (search.trim()) parts.push(`검색='${search.trim()}'`);
    return parts;
  }, [f, search]);

  const today = new Date().toISOString().slice(0, 10);
  const authorName = author || "-";

  // ── 내보내기 ──
  const exportRows = () => rows.map((r) => { const o: Record<string, string> = {}; built.columns.forEach((c) => { o[c.label] = c.get(r); }); return o; });
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(exportRows()); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, report.slice(0, 28)); XLSX.writeFile(wb, `시험보고서_${report}.xlsx`); };
  const exportCsv = () => {
    const head = built.columns.map((c) => c.label);
    const lines = [head.join(",")].concat(rows.map((r) => built.columns.map((c) => `"${c.get(r).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `시험보고서_${report}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const openPrint = () => {
    const w = window.open("", "_blank", "width=1100,height=800"); if (!w) return;
    const wide = built.wide; const perPage = wide ? 18 : 26;
    const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
    const thead = `<tr>${built.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
    const metaHtml = `<div class="meta"><b>${esc(report)}</b><span>출력일 ${today} · 작성자 ${esc(authorName)}</span><span>필터: ${activeFilters.length ? esc(activeFilters.join(", ")) : "전체"} · 총 ${rows.length}건</span></div>`;
    let body = "";
    for (let p = 0; p < pageCount; p++) {
      const slice = rows.slice(p * perPage, (p + 1) * perPage);
      const trs = slice.map((r) => `<tr>${built.columns.map((c) => `<td>${esc(c.get(r))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${built.columns.length}" style="text-align:center;padding:20px;color:#94a3b8">데이터가 없습니다.</td></tr>`;
      body += `<div class="page">${metaHtml}<table><thead>${thead}</thead><tbody>${trs}</tbody></table><div class="foot">페이지 ${p + 1} / ${pageCount} · 출력일 ${today}</div></div>`;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report)}</title><style>
      @page{size:A4 ${wide ? "landscape" : "portrait"};margin:12mm}
      *{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#0f172a;margin:0}
      .page{page-break-after:always}.page:last-child{page-break-after:auto}
      .meta{display:flex;flex-direction:column;gap:2px;margin-bottom:8px;border-bottom:2px solid #334155;padding-bottom:6px}
      .meta b{font-size:15px}.meta span{color:#475569;font-size:10.5px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:center;word-break:break-all}
      thead{display:table-header-group}th{background:#f1f5f9;font-weight:600}
      .foot{margin-top:6px;text-align:right;color:#64748b;font-size:10px}
      @media print{.page{padding:0}}
    </style></head><body>${body}<scr`+`ipt>window.onload=function(){window.focus();window.print();}</scr`+`ipt></body></html>`);
    w.document.close();
  };

  const section = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const selCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div className="space-y-5">
      <section className={section}>
        <div className="mb-4"><h2 className="text-lg font-semibold">시험 보고서</h2><p className="text-sm text-slate-500">보고서 종류를 선택하고 검색·필터 후 Excel·CSV·PDF·인쇄로 출력합니다. (A4 자동 분할·페이지 번호·출력일·작성자·필터조건 포함)</p></div>

        {/* 보고서 종류 */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {REPORT_TYPES.map((t) => (
            <button key={t} onClick={() => setReport(t)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${report === t ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{t}</button>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(모든 컬럼)" className={`${selCls} min-w-[200px]`} />
          {([["year", "연도", opts.years], ["month", "월", Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))], ["group", "그룹", opts.groups], ["product", "제품군", opts.products], ["part", "파트", opts.parts], ["process", "공정", opts.processes], ["level", "레벨", opts.levels]] as Array<[keyof typeof f, string, string[]]>).map(([key, label, list]) => (
            <select key={key} value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} className={selCls}>
              <option value="전체">{label}: 전체</option>
              {list.map((o) => <option key={o} value={o}>{key === "month" ? `${Number(o)}월` : o}</option>)}
            </select>
          ))}
          <button className={btn} onClick={() => { setF({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" }); setSearch(""); }}>초기화</button>
        </div>

        {/* 내보내기 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportCsv}>CSV</button>
          <button className={btn} onClick={openPrint}>PDF</button>
          <button className={btn} onClick={openPrint}>인쇄</button>
          <span className="ml-auto text-xs text-slate-500">출력일 {today} · 작성자 {authorName} · 총 {rows.length}건</span>
        </div>
      </section>

      <section className={section}>
        {/* 필터 조건 표시 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-500">{report}</span>
          {activeFilters.length ? activeFilters.map((c) => <span key={c} className={`rounded-lg px-2 py-0.5 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>{c}</span>) : <span className="text-slate-400">필터 없음(전체)</span>}
        </div>

        {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
        {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

        <div className="max-h-[58vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
              <tr>{built.columns.map((c) => <th key={c.label} className="whitespace-nowrap px-2.5 py-2">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={str(r.id) || i} className={`border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                  {built.columns.map((c) => <td key={c.label} className="whitespace-nowrap px-2.5 py-2">{c.get(r) || "-"}</td>)}
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={built.columns.length} className="px-3 py-10 text-center text-slate-400">조건에 맞는 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-500">총 {rows.length}건 · PDF/인쇄 시 A4 {built.wide ? "가로" : "세로"} 자동 분할</div>
      </section>
    </div>
  );
}
