import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { calculateCertExpiry } from "../services/examAutomationService";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import * as XLSX from "xlsx";
import {
  listExamRows, listExamRefOptions, upsertExamRow, softDeleteExamRow,
  writeExamAudit, listExamAudit, examSupabaseReady,
  type ExamRow,
} from "../services/examMasterService";

type RefOpt = { id: string; label: string };

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
const truthyFlag = (v: unknown): boolean => { if (typeof v === "boolean") return v; const s = String(v ?? "").trim().toLowerCase(); return !!s && !["0", "false", "n", "no", "x", "-", "없음", "미이수", "불필요"].includes(s); };

// 시험 응시(exam_applications)의 인증취득여부(취득/미취득) — 응시관리 certOf 와 동일 규칙(수동 확정 우선).
const appCertOf = (a: ExamRow): "취득" | "미취득" =>
  (a.cert_status_manual === true && (a.cert_status === "취득" || a.cert_status === "미취득"))
    ? (a.cert_status as "취득" | "미취득")
    : (ymd(a.practical_pass_date) ? "취득" : "미취득");

// 인증번호 생성(취득일 + 사번 + 짧은 랜덤). 이미 있으면 유지.
const genCertNo = (r: ExamRow, acquired: string): string =>
  `PM-${(acquired || "").replace(/-/g, "") || "00000000"}-${String(r.employee_no ?? "").trim() || "NA"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const isApproved = (r: ExamRow) => String(r.approval_status ?? "") === "승인";
const isCanceled = (r: ExamRow) => r.is_active === false && isApproved(r); // 승인 후 is_active=false → 취소(승인 기록은 보존).

const expiryInfo = (r: ExamRow): { state: "유효" | "만료예정" | "만료" | "-"; days: number | null } => {
  const s = ymd(r.expiry_date); if (!s) return { state: "-", days: null };
  const days = Math.floor((new Date(s).getTime() - Date.now()) / 86400000);
  if (days < 0) return { state: "만료", days };
  if (days <= 30) return { state: "만료예정", days };
  return { state: "유효", days };
};
// 인증 상태(통합): 승인대기/반려/취소/갱신완료/만료/만료예정/유효.
const certState = (r: ExamRow): string => {
  const ap = String(r.approval_status ?? "대기");
  if (ap === "반려") return "반려";
  if (isCanceled(r)) return "취소";
  if (ap !== "승인") return "승인대기";
  if (truthyFlag(r.renewal_date)) return "갱신완료";
  const ex = expiryInfo(r);
  if (ex.state === "만료") return "만료";
  if (ex.state === "만료예정") return "만료예정";
  return "유효";
};
const stateTone = (s: string): string => ({
  "유효": "bg-emerald-100 text-emerald-700", "만료예정": "bg-amber-100 text-amber-700", "만료": "bg-rose-100 text-rose-700",
  "갱신완료": "bg-emerald-100 text-emerald-700", "갱신대기": "bg-blue-100 text-blue-700", "승인완료": "bg-emerald-100 text-emerald-700",
  "승인대기": "bg-slate-200 text-slate-500", "반려": "bg-rose-100 text-rose-700", "취소": "bg-slate-300 text-slate-600",
}[s] || "bg-slate-200 text-slate-500");
const approvalLabel = (r: ExamRow): string => { const ap = String(r.approval_status ?? "대기"); if (isCanceled(r)) return "취소"; return ap === "승인" ? "승인완료" : ap === "반려" ? "반려" : "승인대기"; };

const COLS: Array<{ key: string; label: string; date?: boolean }> = [
  { key: "employee_no", label: "사번" }, { key: "name", label: "성명" }, { key: "group_name", label: "그룹" },
  { key: "product", label: "제품" }, { key: "part_name", label: "파트" }, { key: "process", label: "공정" },
  { key: "level_label", label: "인증 단계" }, { key: "equipment_label", label: "인증 설비" },
  { key: "current_pm_level", label: "현재 PM Level" }, { key: "pm_level", label: "취득 예정 레벨" },
  { key: "acquired_date", label: "취득일", date: true }, { key: "expiry_date", label: "만료일", date: true },
  { key: "cert_state", label: "인증 상태" }, { key: "approval_label", label: "승인 상태" }, { key: "cert_no", label: "인증번호" },
];

export default function ExamPmCertificationsPage({
  darkMode, canEdit, tenantId, userId, onToast, onDataChanged,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void;
  onDataChanged?: () => void;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [rules, setRules] = useState<ExamRow[]>([]);
  const [levelOpts, setLevelOpts] = useState<RefOpt[]>([]);
  const [equipOpts, setEquipOpts] = useState<RefOpt[]>([]);
  const [autoInfo, setAutoInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [acqFrom, setAcqFrom] = useState(""); const [acqTo, setAcqTo] = useState("");
  const [expFrom, setExpFrom] = useState(""); const [expTo, setExpTo] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailRow, setDetailRow] = useState<ExamRow | null>(null);
  const [detailAudit, setDetailAudit] = useState<ExamRow[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const [editBase, setEditBase] = useState("");
  const editKey = editRow ? String(editRow.id ?? "__new__") : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (editRow) setEditBase(JSON.stringify(editRow)); }, [editKey]);
  const editDirty = !!editRow && JSON.stringify(editRow) !== editBase;
  const requestCloseEdit = () => { if (saving) return; if (editDirty) setConfirmClose(true); else setEditRow(null); };
  const topClose = confirmClose ? undefined : detailRow ? () => setDetailRow(null) : editRow ? requestCloseEdit : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const personByEmp = useMemo(() => { const m = new Map<string, ExamRow>(); personnel.forEach((p) => m.set(String(p.employee_no ?? ""), p)); return m; }, [personnel]);
  const appById = useMemo(() => { const m = new Map<string, ExamRow>(); apps.forEach((a) => m.set(String(a.id ?? ""), a)); return m; }, [apps]);
  const levelLabel = useCallback((id: unknown) => (!id ? "" : (levelOpts.find((o) => o.id === String(id))?.label || "")), [levelOpts]);
  const equipLabel = useCallback((id: unknown) => (!id ? "" : (equipOpts.find((o) => o.id === String(id))?.label || "")), [equipOpts]);

  // pm_cert + 원본 응시(source_application_id) + 인력(employee_no)에서 파생 필드 계산.
  const enrich = useCallback((r: ExamRow): ExamRow => {
    const app = appById.get(String(r.source_application_id ?? "")) || null;
    const p = personByEmp.get(String(r.employee_no ?? "")) || null;
    return {
      ...r,
      group_name: r.group_name ?? app?.group_name ?? p?.group_name ?? "",
      product: r.product ?? app?.product ?? p?.product_group ?? "",
      part_name: p?.part_name ?? app?.process ?? "",
      process: app?.process ?? p?.part_name ?? "",
      level_label: levelLabel(r.level_id ?? app?.level_id),
      equipment_label: equipLabel(r.equipment_id ?? app?.equipment_id),
      current_pm_level: p?.current_pm_level ?? "",
      cert_state: certState(r),
      approval_label: approvalLabel(r),
    };
  }, [appById, personByEmp, levelLabel, equipLabel]);

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [certs, appRows, people, rule, lv, eq] = await Promise.all([
        listExamRows("pm_certifications", tenantId),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
        listExamRefOptions("exam_levels", tenantId).catch(() => [] as RefOpt[]),
        listExamRefOptions("exam_equipment", tenantId).catch(() => [] as RefOpt[]),
      ]);
      setApps(appRows); setPersonnel(people); setRules(rule); setLevelOpts(lv); setEquipOpts(eq);

      let finalCerts = certs;
      if (canEdit) {
        const pById = new Map<string, ExamRow>(); people.forEach((p) => pById.set(String(p.employee_no ?? ""), p));
        const existingSrc = new Set(certs.map((c) => String(c.source_application_id ?? "")).filter(Boolean));
        // 동일 인증 중복 방지: 이미 활성(미취소·미반려) 인증이 있는 사번+단계는 제외.
        const activeKey = new Set(certs.filter((c) => c.is_active !== false && c.approval_status !== "반려").map((c) => `${String(c.employee_no ?? "")}|${String(c.level_id ?? "")}`));
        const ruleFor = (a: ExamRow) => rule.find((r) => String(r.level_id ?? "") === String(a.level_id ?? "")) || null;
        const holds = (a: ExamRow): boolean => {
          const pr = String(ruleFor(a)?.prerequisite_level_id ?? ""); if (!pr) return true;
          const p = pById.get(String(a.employee_no ?? "")); if (!p) return false;
          const name = (lv.find((o) => o.id === pr)?.label || "").toLowerCase(); if (!name) return true;
          const flags: Record<string, unknown> = { single: p.single_job, m1: p.m1, m2: p.m2, m3: p.m3, m4: p.m4, "d.m": p.dm, dm: p.dm };
          for (const [k, v] of Object.entries(flags)) if (name.includes(k) && truthyFlag(v)) return true;
          return `${p.current_pm_level ?? ""} ${p.cert_level ?? ""}`.toLowerCase().includes(name);
        };
        const q = (a: ExamRow): boolean => {
          if (a.deleted_at || !a.id) return false;                                        // 삭제 제외
          const done = /인증\s*취득|완료/.test(String(a.status ?? ""));
          if (appCertOf(a) !== "취득" && !done) return false;                              // 인증취득 또는 자동 취득 후보
          const rl = ruleFor(a);
          if (rl?.require_written === true && !ymd(a.written_pass_date)) return false;     // 필기 필요 시 필기 합격
          if (rl?.require_practical === true && !ymd(a.practical_pass_date)) return false; // 실기 필요 시 실기 합격
          if (!rl && (!ymd(a.written_pass_date) || !ymd(a.practical_pass_date))) return false;
          return holds(a);                                                                // 선행 인증 충족
        };
        const toCreate = appRows.filter((a) => q(a) && !existingSrc.has(String(a.id)) && !activeKey.has(`${String(a.employee_no ?? "")}|${String(a.level_id ?? "")}`));
        if (toCreate.length) {
          for (const a of toCreate) {
            const person = pById.get(String(a.employee_no ?? ""));
            const acquired = ymd(a.cert_acquired_date) || ymd(a.practical_pass_date) || null;
            await upsertExamRow("pm_certifications", {
              source_application_id: a.id, employee_no: a.employee_no ?? null, name: a.name ?? null,
              pm_level: a.pm_level ?? null, level_id: a.level_id ?? null, personnel_id: person?.id ?? null,
              acquired_date: acquired, approval_status: "대기",
            }, tenantId, userId);
          }
          setAutoInfo(`승인대기 후보 ${toCreate.length}건을 자동 생성했습니다.`);
          finalCerts = await listExamRows("pm_certifications", tenantId);
        } else setAutoInfo("");
      }
      setRows(finalCerts);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, canEdit, userId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const enriched = useMemo(() => rows.map(enrich), [rows, enrich]);

  const filterDefs = useMemo(() => ([
    { key: "employee_no", label: "사번" }, { key: "name", label: "성명" }, { key: "group_name", label: "그룹" },
    { key: "product", label: "제품" }, { key: "part_name", label: "파트" }, { key: "process", label: "공정" },
    { key: "level_label", label: "인증 단계" }, { key: "pm_level", label: "PM Level" },
    { key: "cert_state", label: "인증 상태" }, { key: "approval_label", label: "승인 상태" },
  ]), []);
  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    filterDefs.forEach((c) => { m[c.key] = Array.from(new Set(enriched.map((r) => String(r[c.key] ?? "")).filter(Boolean))).sort(); });
    return m;
  }, [enriched, filterDefs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inRange = (v: unknown, from: string, to: string) => { const d = ymd(v); if (from && (!d || d < from)) return false; if (to && (!d || d > to)) return false; return true; };
    const list = enriched.filter((r) => {
      for (const c of filterDefs) { const f = filters[c.key]; if (f && f !== "전체" && String(r[c.key] ?? "") !== f) return false; }
      if (!inRange(r.acquired_date, acqFrom, acqTo)) return false;
      if (!inRange(r.expiry_date, expFrom, expTo)) return false;
      if (q) { const t = `${r.employee_no ?? ""} ${r.name ?? ""} ${r.pm_level ?? ""} ${r.level_label ?? ""} ${r.cert_no ?? ""} ${r.group_name ?? ""} ${r.process ?? ""}`.toLowerCase(); if (!t.includes(q)) return false; }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => { const av = String(a[sortKey] ?? ""), bv = String(b[sortKey] ?? ""); const an = Number(av), bn = Number(bv); if (!Number.isNaN(an) && !Number.isNaN(bn) && av && bv) return (an - bn) * dir; return av.localeCompare(bv, "ko") * dir; });
    }
    return list;
  }, [enriched, search, filters, filterDefs, acqFrom, acqTo, expFrom, expTo, sortKey, sortDir]);

  const kpi = useMemo(() => {
    const c = (fn: (r: ExamRow) => boolean) => enriched.filter(fn).length;
    return {
      total: enriched.length,
      pending: c((r) => String(r.approval_status ?? "대기") === "대기"),
      valid: c((r) => r.cert_state === "유효" || r.cert_state === "갱신완료"),
      soon: c((r) => r.cert_state === "만료예정"),
      expired: c((r) => r.cert_state === "만료"),
      renewal: c((r) => isApproved(r) && !isCanceled(r) && (r.cert_state === "만료" || r.cert_state === "만료예정") && !truthyFlag(r.renewal_date)),
      canceledRejected: c((r) => r.cert_state === "취소" || r.approval_status === "반려"),
    };
  }, [enriched]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };

  // 실제 함수 레벨 권한 검증(버튼 숨김만이 아님). viewer/manager 는 canEdit=false + RLS(admin=ALL/viewer=SELECT) 로도 차단.
  const guard = (): boolean => { if (!canEdit) { setError("승인/수정 권한이 없습니다."); return false; } return true; };

  const saveRow = async () => {
    if (!editRow || !guard()) return;
    if (isApproved(editRow)) { setError("승인된 인증은 일반 필드를 수정할 수 없습니다(취소/갱신으로 처리)."); return; }
    if (!String(editRow.employee_no ?? "").trim() || !String(editRow.pm_level ?? "").trim()) { setError("사번과 PM Level 은 필수입니다."); return; }
    for (const k of ["acquired_date", "expiry_date"]) if (!isValidDateCell(editRow[k])) { setError("날짜 형식이 올바르지 않습니다."); return; }
    setSaving(true); setError(null);
    try {
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      const saved = await upsertExamRow("pm_certifications", { approval_status: "대기", ...editRow }, tenantId, userId);
      await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null); onToast?.(isNew ? "등록되었습니다." : "수정되었습니다."); await reload(); onDataChanged?.();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!guard() || !r.id) return;
    if (isApproved(r)) { setError("승인된 인증은 후보 제외(삭제)할 수 없습니다. 취소로 처리하세요."); return; }
    try { await softDeleteExamRow("pm_certifications", String(r.id), userId); await writeExamAudit(tenantId, userId, "pm_certifications", String(r.id), "delete", r, null); onToast?.("후보에서 제외했습니다."); await reload(); onDataChanged?.(); }
    catch (e) { setError((e as { message?: string })?.message || "제외하지 못했습니다."); }
  };

  // 관리자 승인/반려. 승인 시 12단계 자동 처리.
  const decide = async (r: ExamRow, approve: boolean) => {
    if (!guard() || !r.id) return; setError(null);
    try {
      if (approve) {
        if (!String(r.pm_level ?? "").trim()) { setError("PM Level 이 비어 있어 승인할 수 없습니다."); return; }
        const acquired = ymd(r.acquired_date) || ymd(r.practical_pass_date) || new Date().toISOString().slice(0, 10); // ② 취득일 확정
        const certNo = String(r.cert_no ?? "").trim() || genCertNo(r, acquired);                                     // ① 인증번호 생성
        const expiry = ymd(r.expiry_date) || calculateCertExpiry({ ...r, acquired_date: acquired }, rules).value.expiryDate || null; // ③ 만료일 계산
        const payload: ExamRow = { ...r, approval_status: "승인", approved_by: userId, approved_at: nowIso(), cert_no: certNo, acquired_date: acquired, expiry_date: expiry, is_active: true };
        const saved = await upsertExamRow("pm_certifications", payload, tenantId, userId);                            // ⑤ pm_certifications 이력(승인 기록)
        // ⑥ 기존 유효 인증 정리: 동일 사번+동일 단계의 다른 승인·활성 인증을 비활성(대체/취소 이력화, 승인 기록은 덮어쓰지 않음).
        const supersede = rows.filter((x) => String(x.id) !== String(r.id) && String(x.employee_no ?? "") === String(r.employee_no ?? "") && String(x.level_id ?? "") === String(r.level_id ?? "") && isApproved(x) && x.is_active !== false);
        for (const old of supersede) {
          await upsertExamRow("pm_certifications", { ...old, is_active: false, notes: `${String(old.notes ?? "")} · 신규 인증(${certNo})으로 대체`.trim() }, tenantId, userId);
          await writeExamAudit(tenantId, userId, "pm_certifications", String(old.id), "update", old, null, `신규 인증(${certNo})으로 대체`);
        }
        // ⑦ 시험 응시관리 승인상태 반영: 원본 응시의 인증취득 확정(cert_status_manual=true).
        if (r.source_application_id) {
          const app = appById.get(String(r.source_application_id));
          if (app) { const upApp = await upsertExamRow("exam_applications", { ...app, cert_status: "취득", cert_status_manual: true }, tenantId, userId); await writeExamAudit(tenantId, userId, "exam_applications", String(upApp.id), "update", app, upApp, "PM 인증 승인 반영"); }
        }
        // ④/⑧ PM Level 갱신: 인력현황 현재 PM Level 갱신.
        const person = personByEmp.get(String(r.employee_no ?? ""));
        if (person && String(r.pm_level ?? "").trim()) { const up = await upsertExamRow("exam_personnel", { ...person, current_pm_level: r.pm_level }, tenantId, userId); await writeExamAudit(tenantId, userId, "exam_personnel", String(up.id), "update", { current_pm_level: person.current_pm_level }, { current_pm_level: r.pm_level }, "PM Level 갱신(PM 인증 승인)"); }
        // ⑫ 감사로그
        await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), "approve", r, saved, `승인 · 인증번호 ${certNo}`);
        onToast?.("승인 완료: 인증번호·취득일·만료일·PM Level·이력·응시반영·통계갱신 처리되었습니다.");
        setDetailRow(enrich(saved));
      } else {
        const saved = await upsertExamRow("pm_certifications", { ...r, approval_status: "반려", approved_by: userId, approved_at: nowIso() }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "pm_certifications", String(saved.id), "reject", r, saved, "반려");
        onToast?.("반려 처리했습니다."); setDetailRow(enrich(saved));
      }
      await reload(); onDataChanged?.(); // ⑨⑩⑪ 대시보드/연간목표/월간실적 통계 자동 갱신 신호
    } catch (e) { setError((e as { message?: string })?.message || "승인 처리 실패."); }
  };

  // 승인 후: 취소(별도 이력 — is_active=false, 승인 기록 보존) / 갱신(신규 대기 인증 생성).
  const cancelCert = async (r: ExamRow) => {
    if (!guard() || !r.id || !isApproved(r)) return;
    try {
      const up = await upsertExamRow("pm_certifications", { ...r, is_active: false, notes: `${String(r.notes ?? "")} · 취소(${nowIso().slice(0, 10)})`.trim() }, tenantId, userId);
      await writeExamAudit(tenantId, userId, "pm_certifications", String(up.id), "update", r, up, "인증 취소");
      onToast?.("인증을 취소 처리했습니다(이력 보존)."); setDetailRow(enrich(up)); await reload(); onDataChanged?.();
    } catch (e) { setError((e as { message?: string })?.message || "취소 실패."); }
  };
  const renewCert = async (r: ExamRow) => {
    if (!guard() || !r.id || !isApproved(r)) return;
    try {
      const created = await upsertExamRow("pm_certifications", {
        source_application_id: r.source_application_id ?? null, employee_no: r.employee_no ?? null, name: r.name ?? null,
        pm_level: r.pm_level ?? null, level_id: r.level_id ?? null, personnel_id: r.personnel_id ?? null,
        approval_status: "대기", notes: `갱신 대상: ${String(r.cert_no ?? "")}`,
      }, tenantId, userId);
      await writeExamAudit(tenantId, userId, "pm_certifications", String(created.id), "create", null, created, `갱신 요청(원본 ${String(r.cert_no ?? "")})`);
      onToast?.("갱신 대기 인증을 생성했습니다(승인 시 확정)."); await reload(); onDataChanged?.();
    } catch (e) { setError((e as { message?: string })?.message || "갱신 요청 실패."); }
  };

  const openDetail = async (r: ExamRow) => { setDetailRow(enrich(r)); try { setDetailAudit(await listExamAudit(tenantId, "pm_certifications", String(r.id))); } catch { setDetailAudit([]); } };
  const tableKeyDown = useTableKeyboardNav({ count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10, onEnter: (i) => paged[i] && void openDetail(paged[i]) });

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => { const o: Record<string, string> = {}; COLS.forEach((c) => { o[c.label] = c.date ? (ymd(r[c.key]) || "-") : (String(r[c.key] ?? "") || "-"); }); return o; }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PM인증"); XLSX.writeFile(wb, "시험관리_PM인증.xlsx");
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const kpiCard = (label: string, value: number, tone = "") => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
  const empCerts = (emp: string) => enriched.filter((x) => String(x.employee_no ?? "") === emp);
  const empApps = (emp: string) => apps.filter((a) => String(a.employee_no ?? "") === emp && !a.deleted_at);

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">PM 인증관리</h2>
        <p className="text-sm text-slate-500">시험 응시(필기·실기 합격, 선행 충족, 인증취득) 건을 승인대기로 자동 연결하고, 승인 시 인증번호·만료일·PM Level·이력을 자동 처리합니다.</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {kpiCard("전체 인증", kpi.total)}
        {kpiCard("승인대기", kpi.pending, "text-blue-600")}
        {kpiCard("유효", kpi.valid, "text-emerald-600")}
        {kpiCard("만료 예정", kpi.soon, "text-amber-600")}
        {kpiCard("만료", kpi.expired, "text-rose-600")}
        {kpiCard("갱신 필요", kpi.renewal, "text-amber-600")}
        {kpiCard("취소/반려", kpi.canceledRejected, "text-slate-500")}
      </div>

      {autoInfo && <div className="mb-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{autoInfo}</div>}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사번/성명/PM Level/단계/인증번호/그룹/공정)" className={`${inputCls} min-w-[230px]`} />
        {filterDefs.map((c) => (
          <select key={c.key} value={filters[c.key] || "전체"} onChange={(e) => { setFilters((p) => ({ ...p, [c.key]: e.target.value })); setPage(1); }} className={inputCls}>
            <option value="전체">{c.label}: 전체</option>
            {(filterOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>취득일</span><input type="date" value={acqFrom} onChange={(e) => { setAcqFrom(e.target.value); setPage(1); }} className={inputCls} /><span>~</span><input type="date" value={acqTo} onChange={(e) => { setAcqTo(e.target.value); setPage(1); }} className={inputCls} />
        <span className="ml-2">만료일</span><input type="date" value={expFrom} onChange={(e) => { setExpFrom(e.target.value); setPage(1); }} className={inputCls} /><span>~</span><input type="date" value={expTo} onChange={(e) => { setExpTo(e.target.value); setPage(1); }} className={inputCls} />
        <span className="ml-auto flex gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ approval_status: "대기" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="PM 인증 목록" className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              {COLS.map((c) => <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline">{c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>)}
              <th className="whitespace-nowrap px-2.5 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, ri) => (
              <tr key={String(r.id)} aria-selected={ri === activeIdx} onClick={() => setActiveIdx(ri)} onDoubleClick={() => void openDetail(r)} className={`${ri === activeIdx ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : ""} cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {COLS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2.5 py-2">
                    {c.key === "cert_state" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateTone(String(r.cert_state))}`}>{String(r.cert_state)}</span>
                      : c.key === "approval_label" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateTone(String(r.approval_label))}`}>{String(r.approval_label)}</span>
                        : c.date ? (ymd(r[c.key]) || "-") : (String(r[c.key] ?? "") || "-")}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2.5 py-2">
                  <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openDetail(r); }}>상세</button>
                  {canEdit && !isApproved(r) && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>제외</button></>}
                  {isApproved(r) && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-700">읽기전용</span>}
                </td>
              </tr>
            ))}
            {!loading && paged.length === 0 && <tr><td colSpan={COLS.length + 1} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" tabIndex={-1} className={`my-8 w-full max-w-xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">{editRow.id ? "PM 인증 수정" : "PM 인증 등록"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([["employee_no", "사번", "text"], ["name", "성명", "text"], ["pm_level", "PM Level", "text"], ["acquired_date", "취득일", "date"], ["expiry_date", "만료일", "date"], ["cert_no", "인증번호", "text"], ["notes", "비고", "text"]] as const).map(([k, label, type]) => (
                <div key={k}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
                  <input type={type === "date" ? "date" : "text"} className={`${inputCls} w-full`} value={type === "date" ? ymd(editRow[k]) : String(editRow[k] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [k]: e.target.value || null }))} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">※ 만료일/인증번호는 승인 시 자동 계산·생성됩니다(입력값 있으면 유지).</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (() => {
        const emp = String(detailRow.employee_no ?? ""); const p = personByEmp.get(emp) || null;
        const certs = empCerts(emp);
        const section = (title: string, body: ReactNode) => (<div className="mb-3"><div className="mb-1 text-sm font-semibold text-slate-500">{title}</div>{body}</div>);
        const listBox = (items: ReactNode[], empty: string) => items.length ? <div className={`max-h-32 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>{items}</div> : <div className="text-xs text-slate-400">{empty}</div>;
        return (
          <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
            <div className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between">
                <div><h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">PM 인증 상세</span></h3>
                  <p className="text-sm text-slate-500">사번 {emp || "-"} · {String(detailRow.level_label || "-")} · <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateTone(String(detailRow.cert_state))}`}>{String(detailRow.cert_state)}</span></p></div>
                <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
              </div>
              {section("기본 인력정보", (
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {([["사번", emp], ["성명", detailRow.name], ["그룹", detailRow.group_name], ["제품", detailRow.product], ["파트", detailRow.part_name], ["공정", detailRow.process], ["재직여부", p?.employment_status]] as Array<[string, unknown]>).map(([l, v]) => <div key={l} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{l}</div><div className="mt-0.5">{String(v ?? "") || "-"}</div></div>)}
                </dl>
              ))}
              {section("현재 PM Level", <div className="text-sm">{String(p?.current_pm_level ?? "") || "-"} <span className="text-xs text-slate-400">· 취득 예정: {String(detailRow.pm_level ?? "-")}</span></div>)}
              {section("시험 응시이력", listBox(empApps(emp).map((a) => <div key={String(a.id)} className="py-0.5">{ymd(a.written_exam_date) || "-"} · {String(a.status ?? "-")} · {appCertOf(a)} {a.level_id ? `· ${levelLabel(a.level_id)}` : ""}</div>), "응시이력 없음"))}
              {section("인증 취득이력", listBox(certs.filter(isApproved).map((c) => <div key={String(c.id)} className="py-0.5">{String(c.cert_no ?? "-")} · {String(c.pm_level ?? "-")} · 취득 {ymd(c.acquired_date) || "-"} {c.expiry_date ? `~ ${ymd(c.expiry_date)}` : ""} {c.is_active === false ? "· (대체/취소)" : ""}</div>), "취득이력 없음"))}
              {section("갱신이력", listBox(certs.filter((c) => truthyFlag(c.renewal_date) || /갱신/.test(String(c.notes ?? ""))).map((c) => <div key={String(c.id)} className="py-0.5">{String(c.cert_no ?? c.notes ?? "-")} · {ymd(c.renewal_date) || ymd(c.updated_at) || "-"}</div>), "갱신이력 없음"))}
              {section("만료이력", listBox(certs.filter((c) => c.cert_state === "만료").map((c) => <div key={String(c.id)} className="py-0.5">{String(c.cert_no ?? "-")} · 만료 {ymd(c.expiry_date) || "-"}</div>), "만료이력 없음"))}
              {section("취소/반려이력", listBox(certs.filter((c) => c.cert_state === "취소" || c.approval_status === "반려").map((c) => <div key={String(c.id)} className="py-0.5">{String(c.cert_no ?? c.pm_level ?? "-")} · {c.approval_status === "반려" ? "반려" : "취소"}</div>), "취소/반려이력 없음"))}
              {section("관련 설비", listBox([detailRow.equipment_label, ...empApps(emp).map((a) => equipLabel(a.equipment_id))].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).map((e, i) => <div key={i} className="py-0.5">{String(e)}</div>), "관련 설비 없음"))}
              {section("감사로그", listBox(detailAudit.map((h) => <div key={String(h.id)} className="py-0.5"><span className="font-semibold">{String(h.action_type)}</span>{h.memo ? <span className="ml-2 text-slate-500">{String(h.memo)}</span> : null}<span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span></div>), "감사로그 없음"))}

              {canEdit && (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {!isApproved(detailRow) ? (
                    <>
                      <button onClick={() => void decide(detailRow, false)} className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">반려</button>
                      <button onClick={() => void decide(detailRow, true)} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">승인</button>
                    </>
                  ) : !isCanceled(detailRow) ? (
                    <>
                      <button onClick={() => void renewCert(detailRow)} className="rounded-2xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50">갱신</button>
                      <button onClick={() => void cancelCert(detailRow)} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">취소</button>
                    </>
                  ) : <span className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-medium text-slate-600">취소된 인증(읽기전용)</span>}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <UnsavedChangesDialog open={confirmClose} darkMode={darkMode}
        onKeepEditing={() => setConfirmClose(false)}
        onDiscard={() => { setConfirmClose(false); setEditRow(null); }}
        onSave={() => { setConfirmClose(false); void saveRow(); }} />
    </section>
  );
}
