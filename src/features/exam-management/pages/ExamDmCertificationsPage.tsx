import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { calculateDmLevel, calculateCertExpiry, buildDmCandidates } from "../services/examAutomationService";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import * as XLSX from "xlsx";
import {
  listExamRows, upsertExamRow, softDeleteExamRow,
  writeExamAudit, listExamAudit, isDuplicateDm, examSupabaseReady,
  type ExamRow,
} from "../services/examMasterService";
import { loadMyExamPermissions } from "../services/examPermissionService";

const nowIso = () => new Date().toISOString();
const genDmCertNo = (emp: string, stage: string, acquired: string): string =>
  `DM-${(acquired || "").replace(/-/g, "") || "00000000"}-${emp || "NA"}-${(stage || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "STG"}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

type ColType = "text" | "date" | "number" | "select" | "bool" | "expiry";
type Col = { key: string; label: string; type: ColType; options?: string[]; required?: boolean; filter?: boolean; hideable?: boolean };

// D.M 단계(관리 대상). 계산 규칙이 아닌 도메인 단계값.
const DM_STAGES = ["Single Job", "Multi Job 1", "Multi Job 2", "Multi Job 3", "Multi Job 4", "Dual Multi", "Master"];
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
const toBool = (v: unknown) => { if (typeof v === "boolean") return v; const s = String(v ?? "").trim().toLowerCase(); return ["y", "yes", "true", "1", "o", "예", "가능"].includes(s); };

// 만료 상태(취득/만료일 기준 자동 판정).
const expiryOf = (r: ExamRow): { label: string; tone: string } => {
  const s = ymd(r.expiry_date); if (!s) return { label: "-", tone: "text-slate-400" };
  const days = Math.floor((new Date(s).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "만료", tone: "bg-rose-100 text-rose-700" };
  if (days <= 30) return { label: `임박(${days}일)`, tone: "bg-amber-100 text-amber-700" };
  return { label: "유효", tone: "bg-emerald-100 text-emerald-700" };
};

const COLS: Col[] = [
  { key: "employee_no", label: "사원번호", type: "text", required: true },
  { key: "name", label: "성명", type: "text", required: true },
  { key: "dm_stage", label: "D.M 단계", type: "select", options: DM_STAGES, required: true, filter: true },
  { key: "dm_level", label: "D.M Level", type: "text", filter: true },
  { key: "process_count", label: "인증 공정 수", type: "number" },
  { key: "equipment_count", label: "인증 장비 수", type: "number" },
  { key: "process_combination", label: "공정 조합", type: "text", hideable: true },
  { key: "dual_multi", label: "Dual Multi", type: "bool", filter: true },
  { key: "acquired_date", label: "취득일", type: "date" },
  { key: "expiry_date", label: "만료일", type: "date" },
  { key: "expiry_state", label: "만료상태", type: "expiry", filter: true },
  { key: "renewal_date", label: "갱신일", type: "date", hideable: true },
  { key: "cert_no", label: "인증번호", type: "text", hideable: true },
  { key: "proof_file", label: "인증 증빙", type: "text", hideable: true },
  { key: "approval_status", label: "승인상태", type: "select", options: APPROVAL_OPTIONS, filter: true },
  { key: "notes", label: "비고", type: "text", hideable: true },
];
const FILTERS = COLS.filter((c) => c.filter);
const FORM_COLS = COLS.filter((c) => c.type !== "expiry");

// exam_rules 중 D.M 관련 규칙만 추출(하드코딩 금지 — 기준정보에서 읽음).
const isDmRule = (r: ExamRow) => /d\.?m|dual|multi|single\s*job|master/i.test(JSON.stringify(r));
// D.M Level 자동 제안: 규칙에 담긴 공정 수 임계치 기준(임계치 없으면 제안 없음 → 수동).
const suggestDmLevel = (row: ExamRow, rules: ExamRow[]): string | null => {
  const pc = Number(row.process_count); if (!Number.isFinite(pc)) return null;
  let best: { th: number; label: string } | null = null;
  for (const rule of rules) {
    const th = [rule.threshold, rule.min_process, rule.process_count, rule.value, rule.min_value]
      .map(Number).find((n) => Number.isFinite(n));
    if (th == null || !Number.isFinite(th) || th > pc) continue;
    const label = String(rule.result_level || rule.dm_level || rule.level || rule.name || rule.code || "").trim();
    if (!label) continue;
    if (!best || th > best.th) best = { th, label };
  }
  return best?.label ?? null;
};

export default function ExamDmCertificationsPage({
  darkMode, canEdit, tenantId, userId, onToast, refreshKey, onDataChanged,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void;
  refreshKey?: number; onDataChanged?: () => void;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [pmRows, setPmRows] = useState<ExamRow[]>([]);
  const [rules, setRules] = useState<ExamRow[]>([]);
  const [autoInfo, setAutoInfo] = useState("");
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
  const [importPreview, setImportPreview] = useState<{ okRows: ExamRow[]; dup: number; err: Array<{ row: number; reason: string }> } | null>(null);
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
  const topClose = importPreview ? () => setImportPreview(null)
    : confirmClose ? undefined
      : historyRow ? () => setHistoryRow(null)
        : detailRow ? () => setDetailRow(null)
          : editRow ? requestCloseEdit
            : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      // PM 인증은 참조용(읽기 전용) — 원본 미수정. exam_rules 는 D.M 계산 규칙.
      const [data, pm, people, rule] = await Promise.all([
        listExamRows("dm_certifications", tenantId),
        listExamRows("pm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPmRows(pm); setRules(rule.filter(isDmRule));

      let finalRows = data;
      if (canEdit) {
        // 승인된 PM 인증 → D.M 후보 자동 도출(공정 수는 승인 PM 인증의 distinct level 기준 프록시). PM 원본은 수정하지 않음.
        const cands = buildDmCandidates(
          pm as Record<string, unknown>[], people as Record<string, unknown>[], rule as Record<string, unknown>[], data as Record<string, unknown>[],
          { process: (c) => String((c as ExamRow).process ?? (c as ExamRow).part_name ?? (c as ExamRow).level_id ?? (c as ExamRow).pm_level ?? ""), equipment: (c) => String((c as ExamRow).equipment_id ?? "") }
        );
        // 공정별 권한: 공정 담당자는 허용 공정 후보만 생성(관리자/조회자 전체). RLS 서버 재차 강제.
        let scopeOk: (personnelId: string | null) => boolean = () => true;
        try {
          const perms = await loadMyExamPermissions(tenantId);
          if (!perms.isAdmin && !perms.isViewerAll) {
            const procByPerson = new Map<string, string | null>();
            people.forEach((p) => procByPerson.set(String(p.id ?? ""), (p.process_id ?? null) as string | null));
            scopeOk = (pid) => perms.can(pid ? procByPerson.get(pid) ?? null : null, "create");
          }
        } catch { /* 권한 로드 실패 → 전체(관리자 가정) */ }
        // 이미 대기/활성 후보가 있는 사번+단계는 제외(중복 방지).
        const activeKey = new Set(data.filter((d) => d.is_active !== false && d.approval_status !== "반려").map((d) => `${String(d.employee_no ?? "")}|${String(d.dm_stage ?? "")}`));
        const toCreate = cands.filter((c) => c.targetStageIdx > c.currentStageIdx && c.acquirable && scopeOk(c.personnel_id) && !activeKey.has(`${c.employee_no}|${c.dm_stage}`));
        if (toCreate.length) {
          for (const c of toCreate) {
            await upsertExamRow("dm_certifications", {
              employee_no: c.employee_no, name: c.name, personnel_id: c.personnel_id,
              dm_stage: c.dm_stage, dm_level: c.dm_level,
              process_count: c.process_count, equipment_count: c.equipment_count, process_combination: c.process_combination,
              dual_multi: c.dual_multi, approval_status: "대기",
              notes: c.master_candidate ? "Master 후보(관리자 승인 필요)" : null,
            }, tenantId, userId);
          }
          setAutoInfo(`승인대기 D.M 후보 ${toCreate.length}건을 자동 생성했습니다(승인 전에는 확정 집계 제외).`);
          finalRows = await listExamRows("dm_certifications", tenantId);
        } else setAutoInfo("");
      }
      setRows(finalRows);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refreshKey, canEdit, userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  // 특정 직원의 PM 인증 참조(사원번호 우선, 없으면 personnel_id).
  const pmForRow = useCallback((r: ExamRow) => pmRows.filter((p) =>
    (r.employee_no && p.employee_no && String(p.employee_no) === String(r.employee_no)) ||
    (r.personnel_id && p.personnel_id && String(p.personnel_id) === String(r.personnel_id))
  ), [pmRows]);

  const cellText = (c: Col, r: ExamRow) => {
    if (c.type === "expiry") return expiryOf(r).label;
    if (c.type === "bool") return r[c.key] ? "예" : "-";
    const v = r[c.key];
    if (c.type === "date") return ymd(v) || "-";
    if (v === null || v === undefined || v === "") return "-";
    return String(v);
  };

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    FILTERS.forEach((c) => {
      if (c.type === "expiry") { m[c.key] = ["유효", "임박", "만료"]; return; }
      if (c.type === "bool") { m[c.key] = ["예", "아니오"]; return; }
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
        if (c.type === "bool") { const yes = !!r[c.key]; if ((f === "예") !== yes) return false; continue; }
        if (String(r[c.key] ?? "") !== f) return false;
      }
      if (q) { const t = `${r.employee_no ?? ""} ${r.name ?? ""} ${r.dm_stage ?? ""} ${r.dm_level ?? ""} ${r.cert_no ?? ""}`.toLowerCase(); if (!t.includes(q)) return false; }
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

  // 확정 집계는 "승인 + 활성"만 포함(승인 전 후보는 제외). pending 은 별도로 표기.
  const isConfirmed = (r: ExamRow) => String(r.approval_status ?? "대기") === "승인" && r.is_active !== false;
  const kpi = useMemo(() => {
    const cnt = (fn: (r: ExamRow) => boolean) => filtered.filter(fn).length;
    const conf = (fn: (r: ExamRow) => boolean) => filtered.filter((r) => isConfirmed(r) && fn(r)).length;
    return {
      total: filtered.length,
      master: conf((r) => r.dm_stage === "Master"),
      dual: conf((r) => !!r.dual_multi || r.dm_stage === "Dual Multi"),
      valid: conf((r) => expiryOf(r).label === "유효"),
      soon: conf((r) => expiryOf(r).label.startsWith("임박")),
      expired: conf((r) => expiryOf(r).label === "만료"),
      pending: cnt((r) => (r.approval_status ?? "대기") === "대기"),
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const visibleCols = COLS.filter((c) => !hidden.has(c.key));
  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };

  const saveRow = async () => {
    if (!editRow) return;
    for (const c of FORM_COLS) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    for (const c of FORM_COLS) if (c.type === "date" && !isValidDateCell(editRow[c.key])) { setError(`${c.label} 날짜 형식이 올바르지 않습니다.`); return; }
    setSaving(true); setError(null);
    try {
      const empNo = String(editRow.employee_no ?? "").trim(), stage = String(editRow.dm_stage ?? "").trim(), acq = ymd(editRow.acquired_date) || null;
      if (await isDuplicateDm(tenantId, empNo, stage, acq, editRow.id ? String(editRow.id) : undefined)) {
        setError(`이미 등록된 D.M 인증입니다(사원번호+단계+취득일 중복): ${empNo} / ${stage}`); setSaving(false); return;
      }
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow("dm_certifications", editRow, tenantId, userId);
      await writeExamAudit(tenantId, userId, "dm_certifications", String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null); onToast?.(isNew ? "D.M 인증이 등록되었습니다." : "D.M 인증이 수정되었습니다."); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try { await softDeleteExamRow("dm_certifications", String(r.id), userId); await writeExamAudit(tenantId, userId, "dm_certifications", String(r.id), "delete", r, null); onToast?.("D.M 인증이 삭제되었습니다."); await reload(); }
    catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  const decide = async (r: ExamRow, approve: boolean) => {
    if (!canEdit) { setError("승인/반려 권한이 없습니다."); return; }
    if (!r.id) return; setError(null);
    try {
      if (approve) {
        // 승인 시 자동 확정: 취득일 → 만료일(유효기간) → 인증번호. 기존 값이 있으면 유지.
        const acquired = ymd(r.acquired_date) || new Date().toISOString().slice(0, 10);
        const expiry = ymd(r.expiry_date) || calculateCertExpiry({ ...r, acquired_date: acquired }, rules).value.expiryDate || null;
        const certNo = String(r.cert_no ?? "").trim() || genDmCertNo(String(r.employee_no ?? ""), String(r.dm_stage ?? ""), acquired);
        const saved = await upsertExamRow("dm_certifications", { ...r, approval_status: "승인", approved_by: userId, approved_at: nowIso(), acquired_date: acquired, expiry_date: expiry, cert_no: certNo, is_active: true }, tenantId, userId);
        // 동일 사번+동일 단계의 다른 승인·활성 인증을 대체(비활성 · 이력 보존).
        const supersede = rows.filter((x) => String(x.id) !== String(r.id) && String(x.employee_no ?? "") === String(r.employee_no ?? "") && String(x.dm_stage ?? "") === String(r.dm_stage ?? "") && String(x.approval_status ?? "") === "승인" && x.is_active !== false);
        for (const old of supersede) { await upsertExamRow("dm_certifications", { ...old, is_active: false, notes: `${String(old.notes ?? "")} · 신규 인증(${certNo})으로 대체`.trim() }, tenantId, userId); await writeExamAudit(tenantId, userId, "dm_certifications", String(old.id), "update", old, null, `신규 인증(${certNo})으로 대체`); }
        await writeExamAudit(tenantId, userId, "dm_certifications", String(saved.id), "approve", r, saved, `승인 · 인증번호 ${certNo}`);
        onToast?.("승인 완료: 취득일·만료일·인증번호·이력이 자동 처리되었습니다."); setDetailRow(saved);
      } else {
        const saved = await upsertExamRow("dm_certifications", { ...r, approval_status: "반려", approved_by: userId, approved_at: nowIso() }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "dm_certifications", String(saved.id), "reject", r, saved, "반려");
        onToast?.("반려 처리했습니다."); setDetailRow(saved);
      }
      await reload();
      onDataChanged?.(); // 승인/반려로 실적 변경 → 시험 통계(대시보드/연간/월간/보고서) 자동 갱신.
    } catch (e) { setError((e as { message?: string })?.message || "승인 처리 실패."); }
  };

  const openHistory = async (r: ExamRow) => { setHistoryRow(r); try { setHistoryList(await listExamAudit(tenantId, "dm_certifications", String(r.id))); } catch { setHistoryList([]); } };

  // 테이블 행 키보드 이동 + Enter 상세보기.
  const tableKeyDown = useTableKeyboardNav({
    count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => paged[i] && setDetailRow(paged[i]),
  });

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => { const o: Record<string, string> = {}; COLS.forEach((c) => { o[c.label] = cellText(c, r); }); return o; }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "DM인증"); XLSX.writeFile(wb, "시험관리_DM인증.xlsx");
  };
  const printTable = () => {
    const w = window.open("", "_blank", "width=1100,height=760"); if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${visibleCols.map((c) => `<td>${cellText(c, r)}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>D.M 인증</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic';font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px}th{background:#f1f5f9}</style><h3>D.M 인증 (${filtered.length}건)</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  const buildImportPreview = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const okRows: ExamRow[] = []; const err: Array<{ row: number; reason: string }> = []; let dup = 0;
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i]; const row: ExamRow = {}; let bad = "";
        for (const c of FORM_COLS) {
          const v = r[c.label];
          if (c.type === "date") { if (!isValidDateCell(v)) bad = bad || `${c.label} 날짜 오류`; row[c.key] = ymd(v) || null; }
          else if (c.type === "number") { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); row[c.key] = s === "" ? null : Number(s); }
          else if (c.type === "bool") row[c.key] = toBool(v);
          else { const s = String(v ?? "").replace(/#REF!|#N\/A|#VALUE!/gi, "").trim(); row[c.key] = s || null; }
        }
        if (!String(row.employee_no ?? "").trim() || !String(row.name ?? "").trim()) { err.push({ row: i + 2, reason: "사원번호/성명 누락" }); continue; }
        if (!String(row.dm_stage ?? "").trim()) { err.push({ row: i + 2, reason: "D.M 단계 누락" }); continue; }
        if (bad) { err.push({ row: i + 2, reason: bad }); continue; }
        if (await isDuplicateDm(tenantId, String(row.employee_no), String(row.dm_stage), ymd(row.acquired_date) || null)) { dup++; continue; }
        okRows.push(row);
      }
      setImportPreview({ okRows, dup, err });
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석 실패."); }
  };
  const commitImport = async () => {
    if (!importPreview) return;
    try {
      for (const row of importPreview.okRows) { const saved = await upsertExamRow("dm_certifications", row, tenantId, userId); await writeExamAudit(tenantId, userId, "dm_certifications", String(saved.id), "import", null, saved); }
      onToast?.(`정상 ${importPreview.okRows.length}건 등록 · 중복 ${importPreview.dup}건 · 오류 ${importPreview.err.length}건`);
      setImportPreview(null); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "Excel 반영 실패."); }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const kpiCard = (label: string, value: string, tone = "") => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
  const suggestion = editRow ? suggestDmLevel(editRow, rules) : null;

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">D.M 인증관리</h2>
        <p className="text-sm text-slate-500">시험관리 · Single Job ~ Master 단계 D.M 인증을 관리합니다. (PM 인증 데이터 참조, 원본 미수정)</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {kpiCard("전체 인증", String(kpi.total))}
        {kpiCard("Master", String(kpi.master))}
        {kpiCard("Dual Multi", String(kpi.dual))}
        {kpiCard("유효", String(kpi.valid), "text-emerald-600")}
        {kpiCard("만료 임박", String(kpi.soon), "text-amber-600")}
        {kpiCard("만료", String(kpi.expired), "text-rose-600")}
        {kpiCard("승인 대기", String(kpi.pending), "text-blue-600")}
      </div>

      {autoInfo && <div className="mb-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{autoInfo}</div>}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사원번호/성명/단계/Level/인증번호)" className={`${inputCls} min-w-[220px]`} />
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
          {canEdit && <label className={`${btn} cursor-pointer`}>Excel 등록<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void buildImportPreview(f); e.currentTarget.value = ""; }} /></label>}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ approval_status: "대기", dm_stage: "Single Job" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="D.M 인증 목록" className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
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
                      : c.key === "approval_status" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.approval_status === "승인" ? "bg-emerald-100 text-emerald-700" : r.approval_status === "반려" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-500"}`}>{String(r.approval_status ?? "대기")}</span>
                      : c.key === "dm_level" ? (() => {
                        // 저장된 D.M Level 은 그대로 두고, 자동계산 D.M 판정을 배지+툴팁(근거)으로 보조 표시.
                        const dm = calculateDmLevel(r, pmForRow(r), rules);
                        return (
                          <span className="inline-flex items-center gap-1">
                            <span>{cellText(c, r)}</span>
                            <span title={`자동계산 근거: ${dm.reasons.join(", ") || "-"}${dm.warnings.length ? " · " + dm.warnings.join(", ") : ""}`} className={`rounded px-1 py-0.5 text-[0.6rem] font-medium ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>자동:{dm.value}</span>
                          </span>
                        );
                      })()
                        : cellText(c, r)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2.5 py-2">
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); setDetailRow(r); }}>상세</button>
                  <span className="mx-1 text-slate-300">·</span>
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                  {canEdit && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button></>}
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

      {/* 등록/수정 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-dm-edit-title" tabIndex={-1} className={`my-8 w-full max-w-3xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-dm-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? "D.M 인증 수정" : "D.M 인증 등록"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FORM_COLS.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : c.type === "bool" ? (
                    <label className="flex h-[34px] items-center gap-2 text-sm"><input type="checkbox" checked={!!editRow[c.key]} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.checked }))} />{c.label}</label>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined} className={`${inputCls} w-full`} value={c.type === "date" ? ymd(editRow[c.key]) : String(editRow[c.key] ?? "")} onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                      {c.key === "dm_level" && suggestion && <button type="button" className="whitespace-nowrap rounded-lg bg-blue-100 px-2 py-1 text-[0.65rem] font-medium text-blue-700" onClick={() => setEditRow((f) => ({ ...(f || {}), dm_level: suggestion }))} title="exam_rules 규칙 적용">규칙: {suggestion}</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rules.length === 0 && <p className="mt-3 text-xs text-amber-600">※ exam_rules에 D.M 계산 규칙이 없어 D.M Level 자동 제안이 비활성화됩니다(수동 입력).</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
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

      {/* 상세보기(더블클릭) */}
      {detailRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">D.M 인증 상세</span></h3>
                <p className="text-sm text-slate-500">사번 {String(detailRow.employee_no || "-")} · {String(detailRow.dm_stage || "-")} · {String(detailRow.dm_level || "-")}</p></div>
              <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            {[
              ["직원 기본정보", ["employee_no", "name", "dm_stage", "dm_level"]],
              ["공정·장비", ["process_count", "equipment_count", "process_combination", "dual_multi"]],
              ["취득·만료·갱신", ["acquired_date", "expiry_date", "expiry_state", "renewal_date"]],
              ["증빙·승인", ["cert_no", "proof_file", "approval_status", "notes"]],
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

            {/* D.M 자동판정(exam_rules 기준, 유효 공정 인증 참조) — 저장값 미변경, 표시 전용. 승인/수동 확정 시 그 값 유지. */}
            {(() => {
              const dm = calculateDmLevel(detailRow, pmForRow(detailRow), rules);
              const approved = String(detailRow.approval_status ?? "") === "승인";
              const tone = dm.value === "Master 후보" ? "bg-purple-100 text-purple-700"
                : dm.value === "확인 필요" ? "bg-amber-100 text-amber-700"
                  : "bg-blue-100 text-blue-700";
              return (
                <div className="mb-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                    D.M 자동판정
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{dm.value}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[0.6rem] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">자동계산</span>
                    {approved && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.6rem] font-medium text-emerald-700">관리자 승인 확정: {String(detailRow.dm_level || detailRow.dm_stage || "-")}</span>}
                  </div>
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-emerald-500">계산 근거</div>
                      <div className="mt-0.5">{dm.reasons.length ? dm.reasons.join(" · ") : "-"}</div>
                    </div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-amber-500">미충족 / 다음 단계</div>
                      <div className="mt-0.5">{dm.warnings.length ? dm.warnings.join(" · ") : "-"}</div>
                    </div>
                  </dl>
                  <p className="mt-1 text-[0.7rem] text-slate-400">※ D.M / Dual Multi / Master 는 자동계산 후 관리자 승인 시 확정됩니다(수동 확정값은 자동계산이 덮어쓰지 않음).</p>
                </div>
              );
            })()}

            {/* 인증 만료·갱신 자동판정(취득일 + exam_rules 유효기간 기준) — 표시 전용 */}
            {(() => {
              const ex = calculateCertExpiry(detailRow, rules).value;
              const tone = ex.status === "만료" ? "bg-rose-100 text-rose-700"
                : ex.status === "만료 30일 전" ? "bg-amber-100 text-amber-700"
                  : ex.status === "만료 90일 전" ? "bg-yellow-100 text-yellow-700"
                    : ex.status === "갱신완료" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500";
              return (
                <div className="mb-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                    인증 만료·갱신 자동판정
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{ex.status}</span>
                    {ex.isExpiringSoon && ex.status !== "만료" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.6rem] font-medium text-amber-700">만료예정</span>}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">만료일</div><div className="mt-0.5">{ex.expiryDate || "-"}</div></div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">남은 일수</div><div className="mt-0.5">{ex.remainingDays === null ? "-" : `${ex.remainingDays}일`}</div></div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">현재 상태</div><div className="mt-0.5">{ex.status}</div></div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">갱신 필요</div><div className={`mt-0.5 ${ex.needRenewal ? "font-semibold text-rose-600" : ""}`}>{ex.needRenewal ? "필요" : "불필요"}</div></div>
                  </dl>
                </div>
              );
            })()}
            {/* PM 인증 참조(읽기 전용) */}
            <div className="mb-3">
              <div className="mb-1 text-sm font-semibold text-slate-500">PM 인증 참조 <span className="text-xs font-normal text-slate-400">(원본 미수정)</span></div>
              {pmForRow(detailRow).length ? (
                <div className={`max-h-32 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  {pmForRow(detailRow).map((p) => <div key={String(p.id)} className="py-0.5">{String(p.pm_level || p.level || p.name || "PM")} · {ymd(p.acquired_date) || "-"} {p.expiry_date ? `~ ${ymd(p.expiry_date)}` : ""}</div>)}
                </div>
              ) : <div className="text-xs text-slate-400">연결된 PM 인증 데이터가 없습니다.</div>}
            </div>
            {/* D.M 계산 규칙(exam_rules) */}
            <div className="mb-3">
              <div className="mb-1 text-sm font-semibold text-slate-500">D.M 계산 규칙 <span className="text-xs font-normal text-slate-400">(exam_rules)</span></div>
              {rules.length ? (
                <div className={`max-h-32 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  {rules.map((r) => <div key={String(r.id)} className="py-0.5">{String(r.name || r.code || r.rule_type || "규칙")}{r.description ? ` · ${String(r.description)}` : ""}</div>)}
                </div>
              ) : <div className="text-xs text-slate-400">등록된 D.M 계산 규칙이 없습니다(인증 기준관리에서 추가).</div>}
            </div>
            {canEdit && (
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => void decide(detailRow, false)} className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">반려</button>
                <button onClick={() => void decide(detailRow, true)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">승인</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 변경/승인 이력 */}
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
