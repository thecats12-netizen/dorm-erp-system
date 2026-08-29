// 설비 인증현황 승인 보드 — 설비취득 후보/승인/반려/취소/수동취득.
//  서비스(equipmentCertificationService)·엔진 재사용. UI 는 한글만(코드값/UUID 비노출). DB 미적용/RLS 오류 안전 가드.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listExamRows, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { loadMyExamPermissions } from "../services/examPermissionService";
import EmployeeSelector from "../components/EmployeeSelector";
import type { EmployeeLite } from "../types/employeeLookup";
import {
  listEquipmentCertifications, setEquipmentCertificationStatus, createManualEquipmentCertification,
  eqCertStatusKo, type EqCertStatus,
} from "../services/equipmentCertificationService";
import { listEquipmentStageRules } from "../services/equipmentStageRuleService";
import EquipmentStageProgressPanel from "./EquipmentStageProgressPanel";

const PAGE_SIZE = 20;
// 상태 탭(전체 + 실제 상태 + 재평가 필요는 metadata.needs_reeval 플래그). 코드값은 내부 전용.
const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "all", label: "전체" },
  { key: "eligible", label: "후보" },
  { key: "pending", label: "승인 대기" },
  { key: "approved", label: "승인 완료" },
  { key: "rejected", label: "반려" },
  { key: "suspended", label: "일시중지" },
  { key: "revoked", label: "취소" },
  { key: "expired", label: "만료" },
  { key: "reeval", label: "재평가 필요" },
];
const SOURCE_KO = (s: unknown) => (String(s ?? "") === "manual" ? "수동" : "응시");
const ymd = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : "-"; };

type Props = { darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void };

export default function EquipmentCertificationBoard({ darkMode, canEdit, tenantId, userId, onToast }: Props) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [master, setMaster] = useState<{ groups: ExamRow[]; categories: ExamRow[]; processes: ExamRow[]; equipment: ExamRow[]; levels: ExamRow[]; personnel: ExamRow[]; stageRules: ExamRow[]; applications: ExamRow[]; pmCertifications: ExamRow[] }>({ groups: [], categories: [], processes: [], equipment: [], levels: [], personnel: [], stageRules: [], applications: [], pmCertifications: [] });
  const [view, setView] = useState<"approve" | "progress">("approve"); // 기본: 기존 승인 관리
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [fProcess, setFProcess] = useState(""); const [fEquip, setFEquip] = useState("");
  const [fFrom, setFFrom] = useState(""); const [fTo, setFTo] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 모달: 반려/취소 사유, 수동 취득
  const [reasonModal, setReasonModal] = useState<{ id: string; next: EqCertStatus; title: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [certs, g, c, p, e, lv, pe, sr, ap, pm] = await Promise.all([
        listEquipmentCertifications(tenantId),   // 미적용/오류 시 [] (서비스가 안전 처리)
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]), // 단계별 현황 대상설비(분모) · 실패 시 [] 안전
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),   // 현재 Level canonical(확정 취득)
        listExamRows("pm_certifications", tenantId).catch(() => [] as ExamRow[]),   // 현재 Level canonical(승인 인증)
      ]);
      setRows(certs); setMaster({ groups: g, categories: c, processes: p, equipment: e, levels: lv, personnel: pe, stageRules: sr, applications: ap, pmCertifications: pm });
    } catch (err) { setError((err as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { let alive = true; loadMyExamPermissions(tenantId).then((pm) => { if (alive) setIsAdmin(!!pm.isAdmin); }).catch(() => {}); return () => { alive = false; }; }, [tenantId]);

  const nameMap = (arr: ExamRow[]) => new Map(arr.map((r) => [String(r.id), String(r.name ?? r.code ?? "").trim()]));
  const groupMap = useMemo(() => nameMap(master.groups), [master.groups]);
  const catMap = useMemo(() => nameMap(master.categories), [master.categories]);
  const procMap = useMemo(() => nameMap(master.processes), [master.processes]);
  const equipMap = useMemo(() => nameMap(master.equipment), [master.equipment]);
  const levelMap = useMemo(() => nameMap(master.levels), [master.levels]);
  const empByPid = useMemo(() => new Map(master.personnel.map((r) => [String(r.id), r])), [master.personnel]);
  const procById = useMemo(() => new Map(master.processes.map((r) => [String(r.id), r])), [master.processes]); // 공정→group_id/category_id 역추적용
  const nm = (m: Map<string, string>, id: unknown) => { const s = String(id ?? "").trim(); if (!s) return "-"; return m.get(s) || "-"; };
  // 그룹/제품군: cert row 값 우선 → 없으면 공정(process)의 group_id/category_id → 인력(personnel) 순 fallback(이름 표시, UUID 미노출).
  const scopeGroupId = (r: ExamRow, pe: ExamRow | undefined) => { const p = procById.get(String(r.process_id ?? "")); return r.group_id ?? p?.group_id ?? pe?.group_id ?? null; };
  const scopeCategoryId = (r: ExamRow, pe: ExamRow | undefined) => { const p = procById.get(String(r.process_id ?? "")); return r.category_id ?? p?.category_id ?? pe?.category_id ?? null; };

  const procOpts = useMemo(() => master.processes.filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [master.processes]);
  const equipOpts = useMemo(() => master.equipment.filter((r) => r.is_active !== false && (!fProcess || String(r.process_id ?? "") === fProcess)).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [master.equipment, fProcess]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "reeval") { if (!((r.metadata as { needs_reeval?: boolean })?.needs_reeval === true)) return false; }
      else if (tab !== "all" && String(r.status ?? "") !== tab) return false;
      if (fProcess && String(r.process_id ?? "") !== fProcess) return false;
      if (fEquip && String(r.equipment_id ?? "") !== fEquip) return false;
      const ad = ymd(r.acquired_date);
      if (fFrom && (ad === "-" || ad < fFrom)) return false;
      if (fTo && (ad === "-" || ad > fTo)) return false;
      if (q) {
        const pe = empByPid.get(String(r.personnel_id ?? ""));
        const t = `${pe?.employee_no ?? ""} ${pe?.name ?? ""} ${nm(equipMap, r.equipment_id)} ${nm(procMap, r.process_id)}`.toLowerCase();
        if (!t.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, fProcess, fEquip, fFrom, fTo, search, empByPid, equipMap, procMap]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  // Excel 내보내기: 현재 필터가 적용된 "전체 filtered rows"(페이지네이션 이전) · 상태는 한글 라벨(eqCertStatusKo) · UUID/코드값 미노출. 재조회 없음.
  const exportExcel = () => {
    const data = filtered.map((r) => {
      const pe = empByPid.get(String(r.personnel_id ?? ""));
      return {
        "사번": String(pe?.employee_no ?? "-"), "이름": String(pe?.name ?? "-"),
        "그룹": nm(groupMap, scopeGroupId(r, pe)), "제품군": nm(catMap, scopeCategoryId(r, pe)),
        "공정": nm(procMap, r.process_id), "설비": nm(equipMap, r.equipment_id), "기준단계": nm(levelMap, r.level_id),
        "원천": SOURCE_KO(r.source), "취득 예정일": ymd(r.acquired_date), "상태": eqCertStatusKo(String(r.status ?? "") as EqCertStatus),
        "신청일": ymd(r.requested_at), "승인일": ymd(r.approved_at),
      };
    });
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "사번": "" }]);
    ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PM 승인관리");
    XLSX.writeFile(wb, `시험관리_PM승인관리_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const doStatus = async (id: string, next: EqCertStatus, reason?: string) => {
    setBusyId(id); setError(null);
    try { await setEquipmentCertificationStatus(id, next, tenantId, userId, reason ? { reason } : undefined); onToast?.(`설비 취득: ${eqCertStatusKo(next)} 처리했습니다.`); await reload(); }
    catch (err) { console.warn("[설비취득] 상태 변경 실패", err); setError("처리하지 못했습니다. 권한 또는 설비 인증 DB 설정을 확인해 주세요."); }
    finally { setBusyId(null); }
  };
  const openReason = (id: string, next: EqCertStatus, title: string) => { setReasonText(""); setReasonModal({ id, next, title }); };
  const submitReason = async () => {
    if (!reasonModal) return;
    if (!reasonText.trim()) { setError("사유를 입력해 주세요."); return; }
    const { id, next } = reasonModal; setReasonModal(null);
    await doStatus(id, next, reasonText.trim());
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">설비 인증현황</h2>
          <p className="text-sm text-slate-500">응시 합격으로 생성된 설비 취득 후보를 검토·승인합니다.</p>
        </div>
        {view === "approve" && isAdmin && <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => setManualOpen(true)}>수동 취득 등록</button>}
      </div>

      {/* 뷰 전환: 승인 관리(기존 · 기본) / 단계별 현황(신규) */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={() => setView("approve")} className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${view === "approve" ? "bg-slate-900 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>승인 관리</button>
        <button onClick={() => setView("progress")} className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${view === "progress" ? "bg-slate-900 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>단계별 현황</button>
      </div>

      {view === "progress" && (
        <EquipmentStageProgressPanel darkMode={darkMode} personnel={master.personnel} levels={master.levels} processes={master.processes} equipment={master.equipment} stageRules={master.stageRules} certs={rows} applications={master.applications} pmCertifications={master.pmCertifications} />
      )}

      {view === "approve" && (<>
      {/* 상태 탭 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${tab === t.key ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{t.label}</button>
        ))}
      </div>

      {/* 필터: 공정 → 설비 → 취득일 기간 → 검색 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <select value={fProcess} onChange={(e) => { setFProcess(e.target.value); setFEquip(""); setPage(1); }} className={inputCls}><option value="">공정: 전체</option>{procOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fEquip} onChange={(e) => { setFEquip(e.target.value); setPage(1); }} className={inputCls}><option value="">설비: 전체</option>{equipOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <input type="date" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setPage(1); }} className={inputCls} title="취득 예정일 시작" />
        <span className="text-xs text-slate-400">~</span>
        <input type="date" value={fTo} onChange={(e) => { setFTo(e.target.value); setPage(1); }} className={inputCls} title="취득 예정일 종료" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사번/이름/설비/공정)" className={`${inputCls} min-w-[180px]`} />
        <button className={`${btn} ml-auto`} onClick={exportExcel}>Excel 내보내기</button>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{["사번", "이름", "그룹", "제품군", "공정", "설비", "기준단계", "원천", "취득 예정일", "상태", "신청일", "승인일", "작업"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const pe = empByPid.get(String(r.personnel_id ?? ""));
              const st = String(r.status ?? "") as EqCertStatus;
              const canAct = canEdit && (st === "eligible" || st === "pending");
              return (
                <tr key={String(r.id)} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <td className="whitespace-nowrap px-2.5 py-2">{String(pe?.employee_no ?? "-")}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{String(pe?.name ?? "-")}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{nm(groupMap, scopeGroupId(r, pe))}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{nm(catMap, scopeCategoryId(r, pe))}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{nm(procMap, r.process_id)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{nm(equipMap, r.equipment_id)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{nm(levelMap, r.level_id)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{SOURCE_KO(r.source)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.acquired_date)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2"><span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${st === "approved" ? "bg-emerald-100 text-emerald-700" : st === "rejected" || st === "revoked" ? "bg-rose-100 text-rose-600" : "bg-slate-200 text-slate-600"}`}>{eqCertStatusKo(st)}</span></td>
                  <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.requested_at)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.approved_at)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    {canAct && <button disabled={busyId === String(r.id)} className="text-emerald-600 hover:underline disabled:opacity-50" onClick={() => void doStatus(String(r.id), "approved")}>승인</button>}
                    {canAct && <><span className="mx-1 text-slate-300">·</span><button disabled={busyId === String(r.id)} className="text-amber-600 hover:underline disabled:opacity-50" onClick={() => openReason(String(r.id), "rejected", "반려 사유")}>반려</button></>}
                    {isAdmin && st === "approved" && <button disabled={busyId === String(r.id)} className="text-rose-600 hover:underline disabled:opacity-50" onClick={() => openReason(String(r.id), "revoked", "취소 사유")}>취소</button>}
                    {!canAct && !(isAdmin && st === "approved") && <span className="text-slate-400">-</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && paged.length === 0 && <tr><td colSpan={13} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>
      </>)}

      {/* 사유 모달(반려/취소) */}
      {reasonModal && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setReasonModal(null)}>
          <div className={`my-16 w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">{reasonModal.title}</h3>
            <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={3} className={`${inputCls} w-full`} placeholder="사유를 입력해 주세요(필수)" />
            <div className="mt-4 flex justify-end gap-2">
              <button className={btn} onClick={() => setReasonModal(null)}>취소</button>
              <button className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500" onClick={() => void submitReason()}>확인</button>
            </div>
          </div>
        </div>
      )}

      {manualOpen && isAdmin && (
        <ManualAcquireModal darkMode={darkMode} tenantId={tenantId} userId={userId} inputCls={inputCls} btn={btn}
          master={master} onClose={() => setManualOpen(false)} onDone={() => { setManualOpen(false); onToast?.("수동 설비 취득을 등록했습니다."); void reload(); }} onError={setError} />
      )}
    </section>
  );
}

// 수동 취득 모달(admin) — 직원/공정/설비/취득일/사유. source=manual, 사유 필수, 중복 approved 차단(서비스).
function ManualAcquireModal({ darkMode, tenantId, userId, inputCls, btn, master, onClose, onDone, onError }: {
  darkMode: boolean; tenantId: string; userId: string; inputCls: string; btn: string;
  master: { groups: ExamRow[]; categories: ExamRow[]; processes: ExamRow[]; equipment: ExamRow[]; levels: ExamRow[]; personnel: ExamRow[] };
  onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const [emp, setEmp] = useState<EmployeeLite | null>(null);
  const [processId, setProcessId] = useState(""); const [equipId, setEquipId] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(""); const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const procOpts = master.processes.filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") }));
  const equipOpts = master.equipment.filter((r) => r.is_active !== false && (!processId || String(r.process_id ?? "") === processId)).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") }));
  const submit = async () => {
    const pid = emp ? String(emp.id) : "";
    if (!pid) { onError("직원을 선택해 주세요."); return; }
    if (!processId || !equipId) { onError("공정과 설비를 선택해 주세요."); return; }
    if (!reason.trim()) { onError("사유를 입력해 주세요."); return; }
    const proc = master.processes.find((r) => String(r.id) === processId);
    setSaving(true);
    try {
      await createManualEquipmentCertification({ personnel_id: pid, process_id: processId, equipment_id: equipId, category_id: (proc?.category_id as string) ?? null, group_id: (proc?.group_id as string) ?? null, acquired_date: acquiredDate || null, reason: reason.trim() }, tenantId, userId);
      onDone();
    } catch (e) { onError((e as { message?: string })?.message || "등록하지 못했습니다."); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-12 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">수동 설비 취득 등록</h3>
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">직원</label>
            <EmployeeSelector value={emp} onChange={setEmp} tenantId={tenantId} darkMode={darkMode} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">공정</label>
              <select className={`${inputCls} w-full`} value={processId} onChange={(e) => { setProcessId(e.target.value); setEquipId(""); }}><option value="">선택</option>{procOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">설비</label>
              <select className={`${inputCls} w-full`} value={equipId} disabled={!processId} onChange={(e) => setEquipId(e.target.value)}><option value="">{processId ? "선택" : "공정 먼저"}</option>{equipOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          </div>
          <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">취득일</label>
            <input type="date" className={`${inputCls} w-full`} value={acquiredDate} onChange={(e) => setAcquiredDate(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">사유 <span className="text-rose-500">*</span></label>
            <textarea rows={2} className={`${inputCls} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="수동 취득 사유(필수)" /></div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className={btn} onClick={onClose}>취소</button>
          <button disabled={saving} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`} onClick={() => void submit()}>{saving ? "등록 중…" : "등록(승인 확정)"}</button>
        </div>
      </div>
    </div>
  );
}
