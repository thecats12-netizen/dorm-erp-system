// 공정별 달성기준 CRUD — exam_rules(rule_type="달성 기준"). criteria(jsonb) 기반 목록/필터/폼.
//  그룹·제품군은 공정에서 파생(스키마 컬럼 없음). 서비스/엔진/폼 재사용 · DB 미적용 안전.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listExamRows, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { loadMyExamPermissions } from "../services/examPermissionService";
import { normalizeCriteria, describeCriteria, isCriteriaEffective } from "../engines/criteriaEvaluator";
import { listProcessCriteriaRules, upsertProcessCriteriaRule, softDeleteProcessCriteriaRule, restoreProcessCriteriaRule } from "../services/processCriteriaRuleService";
import ProcessCriteriaRuleForm, { type ProcCriteriaMaster } from "../components/ProcessCriteriaRuleForm";

const PAGE_SIZE = 20;
const LEVEL_CODES = new Set(["SINGLE", "M1", "M2", "M3", "M4"]);
const dash = (v: unknown) => { const s = String(v ?? "").trim(); return s || "-"; };
type Props = { darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void };

export default function ProcessCriteriaRulesPage({ darkMode, canEdit, tenantId, userId, onToast }: Props) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [m, setM] = useState<{ groups: ExamRow[]; categories: ExamRow[]; processes: ExamRow[]; equipment: ExamRow[]; levels: ExamRow[] }>({ groups: [], categories: [], processes: [], equipment: [], levels: [] });
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(""); const [debounced, setDebounced] = useState("");
  const [fGroup, setFGroup] = useState(""); const [fCat, setFCat] = useState(""); const [fProc, setFProc] = useState(""); const [fLevel, setFLevel] = useState(""); const [fOp, setFOp] = useState(""); const [fActive, setFActive] = useState(""); const [fPeriod, setFPeriod] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [detail, setDetail] = useState<ExamRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<ExamRow | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => { setSearch(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { setDebounced(v); setPage(1); }, 200); };

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [r, g, c, p, e, lv] = await Promise.all([
        listProcessCriteriaRules(tenantId),
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setRows(r); setM({ groups: g, categories: c, processes: p, equipment: e, levels: lv });
    } catch (err) { setError((err as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { let alive = true; loadMyExamPermissions(tenantId).then((pm) => { if (alive) setIsAdmin(!!pm.isAdmin); }).catch(() => {}); return () => { alive = false; }; }, [tenantId]);

  const asMap = (arr: ExamRow[]) => new Map(arr.map((r) => [String(r.id), r]));
  const groupById = useMemo(() => asMap(m.groups), [m.groups]);
  const catById = useMemo(() => asMap(m.categories), [m.categories]);
  const procById = useMemo(() => asMap(m.processes), [m.processes]);
  const equipById = useMemo(() => asMap(m.equipment), [m.equipment]);
  const levelById = useMemo(() => asMap(m.levels), [m.levels]);
  const nm = (map: Map<string, ExamRow>, id: unknown) => { const r = map.get(String(id ?? "")); return r ? (String(r.name ?? "").trim() || String(r.code ?? "").trim() || "-") : "-"; };

  const levelOpts = useMemo(() => m.levels.filter((r) => r.is_active !== false && LEVEL_CODES.has(String(r.code ?? "").toUpperCase()))
    .map((r) => ({ id: String(r.id), name: String(r.name ?? "").trim() || String(r.code ?? ""), code: String(r.code ?? ""), rank: Number(r.rank_order ?? 0) }))
    .sort((a, b) => a.rank - b.rank), [m.levels]);
  const groupOpts = useMemo(() => m.groups.filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })), [m.groups]);
  const catOpts = useMemo(() => m.categories.filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })), [m.categories]);
  const procOpts = useMemo(() => m.processes.filter((r) => r.is_active !== false && (!fGroup || String(r.group_id ?? "") === fGroup)).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })), [m.processes, fGroup]);
  const formMaster: ProcCriteriaMaster = useMemo(() => ({ groups: m.groups, processes: m.processes, equipment: m.equipment, groupById, catById, procById, equipById, levelOpts }), [m.groups, m.processes, m.equipment, groupById, catById, procById, equipById, levelOpts]);

  // 행 파생: criteria 정규화 + 공정→그룹/제품군.
  const enriched = useMemo(() => rows.map((r) => {
    const c = normalizeCriteria(r.criteria);
    const proc = procById.get(String(r.process_id ?? ""));
    const gid = String(proc?.group_id ?? "");
    const cid = String(proc?.category_id ?? groupById.get(gid)?.category_id ?? "");
    return { r, c, gid, cid };
  }), [rows, procById, groupById]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const today = new Date();
    return enriched.filter(({ r, c, gid, cid }) => {
      if (!includeDeleted && r.deleted_at) return false;
      if (fGroup && gid !== fGroup) return false;
      if (fCat && cid !== fCat) return false;
      if (fProc && String(r.process_id ?? "") !== fProc) return false;
      if (fLevel && String(r.level_id ?? "") !== fLevel) return false;
      if (fOp && (c.operator === "OR" ? "OR" : "AND") !== fOp) return false;
      if (fActive === "on" && r.is_active === false) return false;
      if (fActive === "off" && r.is_active !== false) return false;
      if (fPeriod === "valid" && !isCriteriaEffective(c, today)) return false;
      if (fPeriod === "invalid" && isCriteriaEffective(c, today)) return false;
      if (q) { const t = `${nm(procById, r.process_id)} ${nm(groupById, gid)} ${nm(levelById, r.level_id)} ${describeCriteria(c)} ${c.label_ko ?? ""}`.toLowerCase(); if (!t.includes(q)) return false; }
      return true;
    });
  }, [enriched, includeDeleted, fGroup, fCat, fProc, fLevel, fOp, fActive, fPeriod, debounced, procById, groupById, levelById]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const period = (c: ReturnType<typeof normalizeCriteria>) => { const f = c.effective_from ? String(c.effective_from).slice(0, 10) : ""; const t = c.effective_to ? String(c.effective_to).slice(0, 10) : ""; return f || t ? `${f || "…"} ~ ${t || "…"}` : "상시"; };
  const desc = (c: ReturnType<typeof normalizeCriteria>) => (c.label_ko?.trim() ? c.label_ko.trim() : describeCriteria(c));

  const onSubmit = async (payload: ExamRow, reason: string) => {
    await upsertProcessCriteriaRule(payload, tenantId, userId, { reason });
    setEditRow(null); onToast?.("공정별 달성기준을 저장했습니다."); await reload();
  };
  const doDelete = async (r: ExamRow) => { try { await softDeleteProcessCriteriaRule(String(r.id), tenantId, userId); onToast?.("삭제했습니다."); setConfirmDel(null); await reload(); } catch (err) { setError((err as { message?: string })?.message || "삭제하지 못했습니다."); } };
  const doRestore = async (r: ExamRow) => { try { await restoreProcessCriteriaRule(String(r.id), tenantId, userId); onToast?.("복구했습니다."); await reload(); } catch (err) { setError((err as { message?: string })?.message || "복구하지 못했습니다."); } };

  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">공정별 Single/M1~M4 달성기준(criteria). 설비 취득·주력·취득률·선행단계 등을 조합해 단계 충족 조건을 정의합니다.</p>
        {canEdit && <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ is_active: true })}>기준 추가</button>}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <select value={fGroup} onChange={(ev) => { setFGroup(ev.target.value); setFProc(""); setPage(1); }} className={inp}><option value="">그룹: 전체</option>{groupOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fCat} onChange={(ev) => { setFCat(ev.target.value); setPage(1); }} className={inp}><option value="">제품군: 전체</option>{catOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fProc} onChange={(ev) => { setFProc(ev.target.value); setPage(1); }} className={inp}><option value="">공정: 전체</option>{procOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fLevel} onChange={(ev) => { setFLevel(ev.target.value); setPage(1); }} className={inp}><option value="">단계: 전체</option>{levelOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fOp} onChange={(ev) => { setFOp(ev.target.value); setPage(1); }} className={inp}><option value="">방식: 전체</option><option value="AND">AND</option><option value="OR">OR</option></select>
        <select value={fActive} onChange={(ev) => { setFActive(ev.target.value); setPage(1); }} className={inp}><option value="">사용: 전체</option><option value="on">사용</option><option value="off">미사용</option></select>
        <select value={fPeriod} onChange={(ev) => { setFPeriod(ev.target.value); setPage(1); }} className={inp}><option value="">기간: 전체</option><option value="valid">현재 유효</option><option value="invalid">만료/예정</option></select>
        <input value={search} onChange={(ev) => onSearch(ev.target.value)} placeholder="검색(공정/단계/조건)" className={`${inp} min-w-[160px]`} />
        <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={includeDeleted} onChange={(ev) => setIncludeDeleted(ev.target.checked)} />삭제 항목 포함</label>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{["그룹", "제품군", "공정", "단계", "방식", "설비", "주력", "취득률", "선행", "필수설비", "적용기간", "조건 설명", "사용", "수정일", "작업"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {paged.map(({ r, c, gid, cid }) => (
              <tr key={String(r.id)} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"} ${r.deleted_at ? "opacity-50" : ""}`}>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(groupById, gid)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(catById, cid)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(procById, r.process_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{nm(levelById, r.level_id)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.operator === "OR" ? "OR" : "AND"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.min_equipment_count ?? "-"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.min_core_equipment_count ?? "-"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.min_completion_rate != null ? `${c.min_completion_rate}%` : "-"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.prerequisite_level_ids?.length ?? 0}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{c.required_equipment_ids?.length ?? 0}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{period(c)}</td>
                <td className="max-w-[220px] truncate px-2.5 py-2" title={desc(c)}>{desc(c)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{r.deleted_at ? "삭제" : r.is_active === false ? "미사용" : "사용"}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{dash(String(r.updated_at ?? "").slice(0, 10))}</td>
                <td className="whitespace-nowrap px-2.5 py-2">
                  <button className="text-slate-500 hover:underline" onClick={() => setDetail(r)}>상세</button>
                  {!r.deleted_at && canEdit && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={() => setEditRow({ ...r })}>수정</button></>}
                  {!r.deleted_at && isAdmin && <><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={() => setConfirmDel(r)}>삭제</button></>}
                  {!!r.deleted_at && isAdmin && <><span className="mx-1 text-slate-300">·</span><button className="text-emerald-600 hover:underline" onClick={() => void doRestore(r)}>복구</button></>}
                </td>
              </tr>
            ))}
            {!loading && paged.length === 0 && <tr><td colSpan={15} className="px-3 py-10 text-center text-slate-500">등록된 달성기준이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {editRow && <ProcessCriteriaRuleForm darkMode={darkMode} master={formMaster} row={editRow} onClose={() => setEditRow(null)} onSubmit={onSubmit} />}

      {detail && (() => { const c = normalizeCriteria(detail.criteria); const json = JSON.stringify(c, null, 2); return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className={`my-10 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">달성기준 상세</h3>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-slate-500">공정</dt><dd className="col-span-2">{nm(procById, detail.process_id)}</dd>
              <dt className="text-slate-500">인증단계</dt><dd className="col-span-2">{nm(levelById, detail.level_id)}</dd>
              <dt className="text-slate-500">조건 방식</dt><dd className="col-span-2">{c.operator === "OR" ? "OR · 하나 이상 충족" : "AND · 모든 조건 충족"}</dd>
              <dt className="text-slate-500">필수 설비</dt><dd className="col-span-2">{(c.required_equipment_ids ?? []).map((id) => nm(equipById, id)).join(", ") || "-"}</dd>
              <dt className="text-slate-500">선행단계</dt><dd className="col-span-2">{(c.prerequisite_level_ids ?? []).map((id) => nm(levelById, id)).join(", ") || "-"}</dd>
              <dt className="text-slate-500">적용기간</dt><dd className="col-span-2">{period(c)}</dd>
              <dt className="text-slate-500">조건 설명</dt><dd className="col-span-2">{desc(c)}</dd>
              <dt className="text-slate-500">관리자 메모</dt><dd className="col-span-2 whitespace-pre-wrap">{dash(detail.notes)}</dd>
            </dl>
            <details className="mt-4"><summary className="cursor-pointer text-xs text-slate-500">저장 데이터 미리보기</summary>
              <pre className={`mt-1 max-h-48 overflow-auto rounded-xl border p-3 text-[0.7rem] ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>{json}</pre></details>
            <div className="mt-5 flex justify-end"><button className={btn} onClick={() => setDetail(null)}>닫기</button></div>
          </div>
        </div>
      ); })()}

      {confirmDel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDel(null)}>
          <div className={`w-full max-w-sm rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold">달성기준 삭제</h3>
            <p className="mb-4 text-sm text-slate-500">{nm(procById, confirmDel.process_id)} · {nm(levelById, confirmDel.level_id)} 기준을 삭제하시겠습니까? (복구 가능)</p>
            <div className="flex justify-end gap-2"><button className={btn} onClick={() => setConfirmDel(null)}>취소</button><button className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500" onClick={() => void doDelete(confirmDel)}>삭제</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
