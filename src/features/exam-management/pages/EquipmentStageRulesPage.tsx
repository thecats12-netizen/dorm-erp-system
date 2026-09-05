// 설비별 인증단계 CRUD — exam_equipment_stage_rules. 그룹→제품군→공정→설비 종속 선택 + 기준단계(PM tier).
//  criteria 엔진의 판단 입력(설비 1개 취득=공정 확정 아님). 서비스 재사용 · 한글 표시 · DB 미적용 안전.
import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamRows, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { deriveExamHierarchyScope } from "../utils/examHierarchyScope";
import { loadMyExamPermissions } from "../services/examPermissionService";
import { listEquipmentStageRules, upsertEquipmentStageRule, softDeleteEquipmentStageRule, restoreEquipmentStageRule } from "../services/equipmentStageRuleService";

const PAGE_SIZE = 20;
const ymd = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : "-"; };
type Props = { darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void; allowedExamProcessIds?: Set<string> | null };

export default function EquipmentStageRulesPage({ darkMode, canEdit, tenantId, userId, onToast, allowedExamProcessIds = null }: Props) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [master, setMaster] = useState<{ groups: ExamRow[]; categories: ExamRow[]; processes: ExamRow[]; equipment: ExamRow[]; levels: ExamRow[] }>({ groups: [], categories: [], processes: [], equipment: [], levels: [] });
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fGroup, setFGroup] = useState(""); const [fProcess, setFProcess] = useState(""); const [fLevel, setFLevel] = useState(""); const [fCore, setFCore] = useState(""); const [fActive, setFActive] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [r, g, c, p, e, lv] = await Promise.all([
        listEquipmentStageRules(tenantId),
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setRows(r); setMaster({ groups: g, categories: c, processes: p, equipment: e, levels: lv });
    } catch (err) { setError((err as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { let alive = true; loadMyExamPermissions(tenantId).then((pm) => { if (alive) setIsAdmin(!!pm.isAdmin); }).catch(() => {}); return () => { alive = false; }; }, [tenantId]);

  const map = (arr: ExamRow[]) => new Map(arr.map((r) => [String(r.id), r]));
  const groupById = useMemo(() => map(master.groups), [master.groups]);
  const catById = useMemo(() => map(master.categories), [master.categories]);
  const procById = useMemo(() => map(master.processes), [master.processes]);
  const equipById = useMemo(() => map(master.equipment), [master.equipment]);
  const levelById = useMemo(() => map(master.levels), [master.levels]);
  const nm = (m: Map<string, ExamRow>, id: unknown) => { const r = m.get(String(id ?? "")); return r ? (String(r.name ?? "").trim() || String(r.code ?? "").trim() || "-") : "-"; };
  const code = (m: Map<string, ExamRow>, id: unknown) => { const r = m.get(String(id ?? "")); return r ? String(r.code ?? "").trim() : ""; };
  // [source of truth] 인증 레벨 화면과 동일하게 활성 exam_levels 전체를 기준단계 옵션으로 사용(tier 하드코딩 필터 제거 · rank_order 순).
  const levelOpts = useMemo(() => master.levels.filter((r) => r.is_active !== false)
    .map((r) => ({ id: String(r.id), name: String(r.name ?? "").trim() || String(r.code ?? ""), rank: Number(r.rank_order ?? 0) }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ko")), [master.levels]);
  // [수정 복원] 수정 대상의 기존 기준단계(level_id)가 현재 활성 목록 밖(비활성/삭제)이면 옵션에 포함 → "선택"으로 풀리지 않게(FK 재매핑 없음).
  const formLevelOpts = useMemo(() => {
    if (!editRow) return levelOpts;
    const id = String(editRow.level_id ?? "");
    if (!id || levelOpts.some((o) => o.id === id)) return levelOpts;
    const lv = master.levels.find((r) => String(r.id) === id);
    const extra = lv ? { id, name: `${String(lv.name ?? "").trim() || String(lv.code ?? "")} (미사용)`, rank: Number(lv.rank_order ?? 900) } : { id, name: "삭제된 기준(현재값 보존)", rank: 999 };
    return [...levelOpts, extra].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ko"));
  }, [editRow, levelOpts, master.levels]);
  // [데이터 범위] 허용 process → 상위 Group/제품군 파생. null(admin/무범위)=전체 유지(무회귀).
  const hierScope = useMemo(() => deriveExamHierarchyScope(allowedExamProcessIds, master.processes, master.categories), [allowedExamProcessIds, master.processes, master.categories]);
  const groupOpts = useMemo(() => master.groups.filter((r) => r.is_active !== false && (!hierScope || hierScope.groupIds.has(String(r.id)))).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [master.groups, hierScope]);
  // [계층 역전] 제품군은 그룹 소속(category.group_id), 공정은 제품군 소속(process.category_id, 없으면 group_id fallback).
  const catOptsFor = (groupId: string) => master.categories.filter((r) => r.is_active !== false && (!groupId || String(r.group_id ?? "") === groupId) && (!hierScope || hierScope.categoryIds.has(String(r.id)))).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const procOptsForGroup = (groupId: string) => master.processes.filter((r) => r.is_active !== false && (!groupId || String(r.group_id ?? "") === groupId || String(catById.get(String(r.category_id ?? ""))?.group_id ?? "") === groupId) && (!allowedExamProcessIds || allowedExamProcessIds.has(String(r.id)))).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") }));
  const procOptsForCat = (catId: string, groupId: string) => master.processes.filter((r) => r.is_active !== false && (catId ? (String(r.category_id ?? "") === catId || (!r.category_id && String(r.group_id ?? "") === groupId)) : false) && (!allowedExamProcessIds || allowedExamProcessIds.has(String(r.id)))).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") }));
  const equipOptsFor = (processId: string) => master.equipment.filter((r) => r.is_active !== false && (!processId || String(r.process_id ?? "") === processId) && (!allowedExamProcessIds || (r.process_id != null && allowedExamProcessIds.has(String(r.process_id))))).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // [데이터 범위] 허용 process 밖 설비단계 규칙은 숨김(현재값 보존 불필요 — 목록 조회 전용).
      if (allowedExamProcessIds && !(r.process_id != null && allowedExamProcessIds.has(String(r.process_id)))) return false;
      if (!includeDeleted && r.deleted_at) return false;
      if (fGroup && String(r.group_id ?? "") !== fGroup) return false;
      if (fProcess && String(r.process_id ?? "") !== fProcess) return false;
      if (fLevel && String(r.level_id ?? "") !== fLevel) return false;
      if (fCore === "core" && r.is_core_equipment !== true) return false;
      if (fCore === "normal" && r.is_core_equipment === true) return false;
      if (fActive === "on" && r.is_active === false) return false;
      if (fActive === "off" && r.is_active !== false) return false;
      if (q) { const t = `${code(equipById, r.equipment_id)} ${nm(equipById, r.equipment_id)} ${nm(procById, r.process_id)} ${nm(groupById, r.group_id)}`.toLowerCase(); if (!t.includes(q)) return false; }
      return true;
    });
  }, [rows, includeDeleted, fGroup, fProcess, fLevel, fCore, fActive, search, equipById, procById, groupById, allowedExamProcessIds]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const openNew = () => setEditRow({ is_active: true, is_core_equipment: false });
  const save = async () => {
    if (!editRow) return;
    const gid = String(editRow.group_id ?? ""), cid = String(editRow.category_id ?? ""), pid = String(editRow.process_id ?? ""), eid = String(editRow.equipment_id ?? ""), lid = String(editRow.level_id ?? "");
    if (!gid) { setError("그룹을 선택해 주세요."); return; }
    if (!cid) { setError("제품군을 선택해 주세요."); return; }
    if (!pid) { setError("공정을 선택해 주세요."); return; }
    if (!eid) { setError("설비를 선택해 주세요."); return; }
    if (!lid) { setError("기준단계를 선택해 주세요."); return; }
    // 계층 일치: 제품군이 선택 그룹 소속인지(category.group_id === 그룹). legacy(group_id 미지정) 제품군은 통과.
    const cat = catById.get(cid); const catG = String(cat?.group_id ?? "");
    if (cat && catG && catG !== gid) { setError("선택한 제품군이 해당 그룹에 속하지 않습니다."); return; }
    const eq = equipById.get(eid); if (eq && String(eq.process_id ?? "") !== pid) { setError("선택한 설비가 해당 공정에 속하지 않습니다."); return; }
    const from = String(editRow.effective_from ?? ""), to = String(editRow.effective_to ?? "");
    if (from && to && from > to) { setError("적용 시작일이 종료일보다 늦을 수 없습니다."); return; }
    setSaving(true); setError(null);
    try {
      await upsertEquipmentStageRule({ ...editRow, group_id: gid, category_id: cid, process_id: pid, equipment_id: eid, level_id: lid }, tenantId, userId);
      setEditRow(null); onToast?.("설비별 인증단계 기준을 저장했습니다."); await reload();
    } catch (err) { setError((err as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const doDelete = async (r: ExamRow) => { try { await softDeleteEquipmentStageRule(String(r.id), tenantId, userId); onToast?.("삭제했습니다."); setConfirmDel(null); await reload(); } catch (err) { setError((err as { message?: string })?.message || "삭제하지 못했습니다."); } };
  const doRestore = async (r: ExamRow) => { try { await restoreEquipmentStageRule(String(r.id), tenantId, userId); onToast?.("복구했습니다."); await reload(); } catch (err) { setError((err as { message?: string })?.message || "복구하지 못했습니다."); } };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const e = editRow;
  const eGroup = String(e?.group_id ?? "");
  const eCat = String(e?.category_id ?? "");
  const eProc = String(e?.process_id ?? "");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">설비별 기준단계 매핑(주력설비·유효기간). 설비 1개 취득만으로 공정 단계를 확정하지 않으며, 인증단계 계산의 판단 입력입니다.</p>
        {canEdit && <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={openNew}>기준 추가</button>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <select value={fGroup} onChange={(ev) => { setFGroup(ev.target.value); setFProcess(""); setPage(1); }} className={inputCls}><option value="">그룹: 전체</option>{groupOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fProcess} onChange={(ev) => { setFProcess(ev.target.value); setPage(1); }} className={inputCls}><option value="">공정: 전체</option>{procOptsForGroup(fGroup).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fLevel} onChange={(ev) => { setFLevel(ev.target.value); setPage(1); }} className={inputCls}><option value="">기준단계: 전체</option>{levelOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fCore} onChange={(ev) => { setFCore(ev.target.value); setPage(1); }} className={inputCls}><option value="">주력: 전체</option><option value="core">주력설비</option><option value="normal">일반</option></select>
        <select value={fActive} onChange={(ev) => { setFActive(ev.target.value); setPage(1); }} className={inputCls}><option value="">사용: 전체</option><option value="on">사용</option><option value="off">미사용</option></select>
        <input value={search} onChange={(ev) => { setSearch(ev.target.value); setPage(1); }} placeholder="검색(설비/공정/그룹)" className={`${inputCls} min-w-[160px]`} />
        <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={includeDeleted} onChange={(ev) => setIncludeDeleted(ev.target.checked)} />삭제 항목 포함</label>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{["그룹", "제품군", "공정", "설비코드", "설비명", "기준단계", "주력", "시작일", "종료일", "사용", "수정일", "작업"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={String(r.id)} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"} ${r.deleted_at ? "opacity-50" : ""}`}>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(groupById, r.group_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(catById, r.category_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(procById, r.process_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{code(equipById, r.equipment_id) || "-"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(equipById, r.equipment_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(levelById, r.level_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{r.is_core_equipment === true ? "주력" : "-"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.effective_from)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.effective_to)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{r.deleted_at ? "삭제" : r.is_active === false ? "미사용" : "사용"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.updated_at)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">
                  {!r.deleted_at && canEdit && <button className="text-blue-600 hover:underline" onClick={() => setEditRow({ ...r })}>수정</button>}
                  {!r.deleted_at && isAdmin && <><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={() => setConfirmDel(r)}>삭제</button></>}
                  {!!r.deleted_at && isAdmin && <button className="text-emerald-600 hover:underline" onClick={() => void doRestore(r)}>복구</button>}
                  {!!r.deleted_at && !isAdmin && <span className="text-slate-400">-</span>}
                </td>
              </tr>
            ))}
            {!loading && paged.length === 0 && <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {e && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setEditRow(null)}>
          <div className={`my-10 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">{e.id ? "설비별 인증단계 수정" : "설비별 인증단계 등록"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">그룹 <span className="text-rose-500">*</span></label>
                <select className={`${inputCls} w-full`} value={eGroup} onChange={(ev) => { setEditRow((f) => ({ ...(f || {}), group_id: ev.target.value || null, category_id: null, process_id: null, equipment_id: null })); }}><option value="">선택</option>{groupOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">제품군 <span className="text-rose-500">*</span></label>
                <select className={`${inputCls} w-full`} value={eCat} disabled={!eGroup} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), category_id: ev.target.value || null, process_id: null, equipment_id: null }))}><option value="">{eGroup ? "선택" : "그룹 먼저"}</option>{catOptsFor(eGroup).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">공정 <span className="text-rose-500">*</span></label>
                <select className={`${inputCls} w-full`} value={eProc} disabled={!eCat} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), process_id: ev.target.value || null, equipment_id: null }))}><option value="">{eCat ? "선택" : "제품군 먼저"}</option>{procOptsForCat(eCat, eGroup).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">설비 <span className="text-rose-500">*</span></label>
                <select className={`${inputCls} w-full`} value={String(e.equipment_id ?? "")} disabled={!eProc} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), equipment_id: ev.target.value || null }))}><option value="">{eProc ? "선택" : "공정 먼저"}</option>{equipOptsFor(eProc).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">기준단계 <span className="text-rose-500">*</span></label>
                <select className={`${inputCls} w-full`} value={String(e.level_id ?? "")} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), level_id: ev.target.value || null }))}><option value="">선택</option>{formLevelOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.is_core_equipment === true} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), is_core_equipment: ev.target.checked }))} />주력설비</label></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">적용 시작일</label><input type="date" className={`${inputCls} w-full`} value={String(e.effective_from ?? "").slice(0, 10)} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), effective_from: ev.target.value || null }))} /></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">적용 종료일</label><input type="date" className={`${inputCls} w-full`} value={String(e.effective_to ?? "").slice(0, 10)} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), effective_to: ev.target.value || null }))} /></div>
              <div><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">정렬순서</label><input inputMode="numeric" className={`${inputCls} w-full`} value={String(e.sort_order ?? "")} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), sort_order: ev.target.value === "" ? null : Number(ev.target.value.replace(/[^0-9-]/g, "")) || 0 }))} /></div>
              <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.is_active !== false} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), is_active: ev.target.checked }))} />사용</label></div>
              <div className="col-span-2"><label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">비고</label><textarea rows={2} className={`${inputCls} w-full`} value={String(e.notes ?? "")} onChange={(ev) => setEditRow((f) => ({ ...(f || {}), notes: ev.target.value || null }))} /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className={btn} onClick={() => setEditRow(null)}>취소</button>
              <button disabled={saving} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`} onClick={() => void save()}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDel(null)}>
          <div className={`w-full max-w-sm rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold">기준 삭제</h3>
            <p className="mb-4 text-sm text-slate-500">{nm(equipById, confirmDel.equipment_id)} · {nm(levelById, confirmDel.level_id)} 기준을 삭제하시겠습니까? (복구 가능)</p>
            <div className="flex justify-end gap-2"><button className={btn} onClick={() => setConfirmDel(null)}>취소</button><button className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500" onClick={() => void doDelete(confirmDel)}>삭제</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
