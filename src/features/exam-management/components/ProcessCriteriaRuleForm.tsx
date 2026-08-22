// 공정별 달성기준 입력 폼(모달). 그룹→제품군→공정→인증단계 종속 선택 + criteria 폼.
//  criteria 폼↔jsonb 는 criteriaFormMapper 로 처리(미입력/0 구분·groups·unknown 필드 보존).
import { useCallback, useMemo, useState } from "react";
import type { ExamRow } from "../services/examMasterService";
import { normalizeCriteria, validateCriteria, describeCriteria } from "../engines/criteriaEvaluator";
import { canonicalPmStageName } from "../utils/certificationLevel";
import { criteriaToFormState, formStateToCriteria, hasAnyCondition, type ProcessCriteriaFormState } from "../utils/criteriaFormMapper";
import type { Criteria, CriteriaGroup } from "../types/certificationCriteria";

type LevelOpt = { id: string; name: string; code: string; rank: number };
export type ProcCriteriaMaster = {
  groups: ExamRow[]; processes: ExamRow[]; equipment: ExamRow[]; stageRules: ExamRow[];
  groupById: Map<string, ExamRow>; catById: Map<string, ExamRow>; procById: Map<string, ExamRow>; equipById: Map<string, ExamRow>;
  levelOpts: LevelOpt[];   // SINGLE/M1~M4 (rank 오름차순)
};
type Props = {
  darkMode: boolean; master: ProcCriteriaMaster; row: ExamRow;
  onClose: () => void; onSubmit: (payload: ExamRow, reason: string) => Promise<void>;
};

const numInput = (v: number | "") => (v === "" ? "" : String(v));
const parseNum = (s: string): number | "" => { const t = s.replace(/[^0-9.]/g, ""); if (t === "") return ""; const n = Number(t); return Number.isFinite(n) ? n : ""; };

export default function ProcessCriteriaRuleForm({ darkMode, master, row, onClose, onSubmit }: Props) {
  const isNew = !row.id;
  const original = useMemo(() => normalizeCriteria(row.criteria), [row.criteria]);
  const originalHasGroups = (original.groups?.length ?? 0) > 0;

  const [processId, setProcessId] = useState(String(row.process_id ?? ""));
  const initProc = master.procById.get(processId);
  const initCat = String(initProc?.category_id ?? "");
  const [groupId, setGroupId] = useState(String(initProc?.group_id ?? master.catById.get(initCat)?.group_id ?? ""));
  const [categoryId, setCategoryId] = useState(initCat);
  const [levelId, setLevelId] = useState(String(row.level_id ?? ""));
  const [notes, setNotes] = useState(String(row.notes ?? ""));
  const [isActive, setIsActive] = useState(row.is_active !== false);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<ProcessCriteriaFormState>(() => criteriaToFormState(row.criteria));
  const [equipSearch, setEquipSearch] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingNoCond, setPendingNoCond] = useState(false);

  const set = <K extends keyof ProcessCriteriaFormState>(k: K, v: ProcessCriteriaFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const groupOpts = useMemo(() => master.groups.filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [master.groups]);
  // [계층 역전] 제품군은 그룹 소속(category.group_id), 공정은 제품군 소속(process.category_id, 없으면 group_id fallback).
  const catOpts = useMemo(() => [...master.catById.values()].filter((r) => r.is_active !== false && (!groupId || String(r.group_id ?? "") === groupId)).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [master.catById, groupId]);
  const procOpts = useMemo(() => master.processes.filter((r) => r.is_active !== false && (categoryId ? (String(r.category_id ?? "") === categoryId || (!r.category_id && String(r.group_id ?? "") === groupId)) : false)).map((r) => ({ id: String(r.id), name: String(r.name ?? r.code ?? "") })), [master.processes, categoryId, groupId]);

  // 공정 소속 설비(선택된 필수설비는 비활성이어도 유지 표시). 검색: 코드+이름.
  const equipList = useMemo(() => {
    const q = equipSearch.trim().toLowerCase();
    const selected = new Set(form.requiredEquipmentIds);
    return master.equipment
      .filter((r) => String(r.process_id ?? "") === processId && (r.is_active !== false || selected.has(String(r.id))))
      .map((r) => ({ id: String(r.id), name: String(r.name ?? "").trim() || String(r.code ?? ""), code: String(r.code ?? "").trim(), inactive: r.is_active === false }))
      .filter((e) => !q || `${e.code} ${e.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [master.equipment, processId, equipSearch, form.requiredEquipmentIds]);

  const curRank = useMemo(() => master.levelOpts.find((l) => l.id === levelId)?.rank ?? null, [master.levelOpts, levelId]);
  // 선행단계 후보: 자기 자신 제외. 현재보다 rank 높은 단계는 선택 시 경고(차단은 저장 검증).
  const prereqOpts = master.levelOpts.filter((l) => l.id !== levelId);

  // ── Single 단계 전용: "아무거나 1개(OR groups)" 또는 "전부(required_equipment_ids)" ──
  //  단계 판별은 name/코드→canonical(Single). 설비 후보는 해당 process_id+level_id 의 exam_equipment_stage_rules 만.
  const isSingle = useMemo(() => { const lv = master.levelOpts.find((l) => l.id === levelId); return !!lv && (canonicalPmStageName(lv.name) === "Single" || canonicalPmStageName(lv.code) === "Single"); }, [master.levelOpts, levelId]);
  // 원본(수정 대상)의 단계가 Single 이었는지 — Single→Multi 로 단계 변경 시 Single 전용 OR groups 가 Multi criteria 에 잔존하지 않도록 제거 판단.
  const origLevelIsSingle = useMemo(() => { const lv = master.levelOpts.find((l) => l.id === String(row.level_id ?? "")); return !!lv && canonicalPmStageName(lv.name) === "Single"; }, [master.levelOpts, row.level_id]);
  const initSingle = useMemo(() => {
    const g = original.groups ?? [];
    if (g.length) {
      const ids = new Set<string>();
      const collect = (grp: CriteriaGroup) => { for (const cond of grp.conditions ?? []) for (const id of cond.required_equipment_ids ?? []) ids.add(String(id)); for (const sub of grp.groups ?? []) collect(sub); };
      for (const grp of g) collect(grp);
      return { mode: "any1" as const, equip: [...ids] };
    }
    const req = (original.required_equipment_ids ?? []).map(String);
    return { mode: (req.length >= 2 ? "all" : "any1") as "any1" | "all", equip: req };
  }, [original]);
  const [singleMode, setSingleMode] = useState<"any1" | "all">(initSingle.mode);
  const [singleEquip, setSingleEquip] = useState<string[]>(initSingle.equip);
  // 공정 내 PM 단계(Single~Multi 4) level_id 집합 — Single 후보 범위 산정용(코드 하드코딩 없이 canonical 로 판별).
  const pmLevelIdSet = useMemo(() => new Set(master.levelOpts.filter((l) => canonicalPmStageName(l.name) !== null || canonicalPmStageName(l.code) !== null).map((l) => l.id)), [master.levelOpts]);
  // Single 인정 대상 설비 = 동일 공정의 Single~Multi 4 stage rule 설비 전체(확정 정책). Multi = 현재 레벨 설비만(무변경).
  //  공정 scope·활성 stage rule·활성 equipment·동일 공정 검증·equipment_id distinct. 선택값은 목록 밖(비활성 등)이어도 유지 표시.
  const stageEquip = useMemo(() => {
    const ids: string[] = []; const seen = new Set<string>();
    for (const r of master.stageRules) {
      if (r.is_active === false || r.deleted_at) continue;
      if (String(r.process_id ?? "") !== processId) continue;
      const lvl = String(r.level_id ?? "");
      if (isSingle ? !pmLevelIdSet.has(lvl) : lvl !== levelId) continue;
      const eid = String(r.equipment_id ?? ""); if (!eid || seen.has(eid)) continue;
      const e = master.equipById.get(eid);
      if (!e || e.is_active === false || e.deleted_at || String(e.process_id ?? "") !== processId) continue;
      seen.add(eid); ids.push(eid);
    }
    for (const id of singleEquip) if (!seen.has(id)) { seen.add(id); ids.push(id); }
    return ids.map((id) => { const e = master.equipById.get(id); return { id, name: (e && (String(e.name ?? "").trim() || String(e.code ?? ""))) || id, code: String(e?.code ?? "").trim() }; });
  }, [master.stageRules, master.equipById, processId, levelId, isSingle, pmLevelIdSet, singleEquip]);
  const stageEquipIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of master.stageRules) {
      if (r.is_active === false || r.deleted_at) continue;
      if (String(r.process_id ?? "") !== processId) continue;
      const lvl = String(r.level_id ?? "");
      if (isSingle ? !pmLevelIdSet.has(lvl) : lvl !== levelId) continue;
      const e = master.equipById.get(String(r.equipment_id ?? ""));
      if (!e || e.is_active === false || e.deleted_at || String(e.process_id ?? "") !== processId) continue;
      s.add(String(r.equipment_id ?? ""));
    }
    return s;
  }, [master.stageRules, master.equipById, processId, levelId, isSingle, pmLevelIdSet]);
  const toggleSingle = (id: string) => setSingleEquip((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  // Single 최종 criteria: 전부/1개 → required_equipment_ids(AND) · 2개 이상 아무거나 → operator OR + groups. min_equipment_count 미사용.
  const buildSingleCriteria = useCallback((): Criteria => {
    const base = formStateToCriteria({ ...form, requiredEquipmentIds: [], operator: "AND", minEquipmentCount: "" }, original);
    const out: Criteria = { ...base };
    delete out.required_equipment_ids; delete out.groups; delete out.min_equipment_count;
    const ids = [...new Set(singleEquip)].filter(Boolean);
    if (singleMode === "all" || ids.length <= 1) { out.operator = "AND"; if (ids.length) out.required_equipment_ids = ids; }
    else { out.operator = "OR"; out.groups = ids.map((id) => ({ operator: "AND", conditions: [{ required_equipment_ids: [id] }] })); }
    return out;
  }, [form, original, singleMode, singleEquip]);

  // Multi(비 Single) 저장: 기존 방식(required_equipment_ids + prerequisite). Single→Multi 전환 시에만 Single 전용 groups 제거(그 외 원본 groups 는 보존).
  const buildNonSingle = useCallback((): Criteria => {
    const c = formStateToCriteria(form, original);
    if (origLevelIsSingle && c.groups?.length) delete c.groups;
    return c;
  }, [form, original, origLevelIsSingle]);

  const previewCriteria = useMemo(() => isSingle ? buildSingleCriteria() : buildNonSingle(), [isSingle, buildSingleCriteria, buildNonSingle]);
  const previewText = useMemo(() => describeCriteria(previewCriteria), [previewCriteria]);
  const jsonText = useMemo(() => JSON.stringify(previewCriteria, null, 2), [previewCriteria]);

  const toggleEquip = (id: string) => set("requiredEquipmentIds", form.requiredEquipmentIds.includes(id) ? form.requiredEquipmentIds.filter((x) => x !== id) : [...form.requiredEquipmentIds, id]);
  const togglePrereq = (id: string) => set("prerequisiteLevelIds", form.prerequisiteLevelIds.includes(id) ? form.prerequisiteLevelIds.filter((x) => x !== id) : [...form.prerequisiteLevelIds, id]);
  const higherPrereqSelected = form.prerequisiteLevelIds.some((id) => { const r = master.levelOpts.find((l) => l.id === id)?.rank; return curRank != null && r != null && r >= curRank; });

  const collectErrors = (): string[] => {
    const e: string[] = [];
    if (!groupId) e.push("그룹을 선택해 주세요.");
    if (!categoryId) e.push("제품군을 선택해 주세요.");
    if (!processId) e.push("공정을 선택해 주세요.");
    if (!levelId) e.push("인증단계를 선택해 주세요.");
    // 계층 일치: 선택 공정이 선택 제품군 소속인지(process.category_id === category, legacy 는 group_id fallback).
    if (processId && categoryId) {
      const proc = master.procById.get(processId);
      const pCat = String(proc?.category_id ?? "");
      if (proc && pCat && pCat !== categoryId) e.push("선택한 공정이 해당 제품군에 속하지 않습니다.");
    }
    const nums: [number | "", string][] = [[form.minEquipmentCount, "최소 설비 수"], [form.minCoreEquipmentCount, "최소 주력설비 수"], [form.minTenureMonths, "최소 근속개월"], [form.minElapsedMonths, "단계간 경과개월"], [form.cumulativeElapsedMonths, "누적 경과개월"]];
    for (const [v, label] of nums) if (v !== "" && v < 0) e.push(`${label}은(는) 음수가 될 수 없습니다.`);
    if (form.minCompletionRate !== "" && (form.minCompletionRate < 0 || form.minCompletionRate > 100)) e.push("최소 취득률은 0~100 사이여야 합니다.");
    if (form.effectiveFrom && form.effectiveTo && form.effectiveFrom > form.effectiveTo) e.push("적용 시작일이 종료일보다 늦을 수 없습니다.");
    if (form.prerequisiteLevelIds.includes(levelId)) e.push("현재 단계 자기 자신은 선행단계로 선택할 수 없습니다.");
    if (higherPrereqSelected) e.push("현재 단계보다 상위 단계는 선행단계로 선택할 수 없습니다.");
    // 필수 설비는 선택 공정 소속이어야 함(Single 은 아래 단계 설비 검증으로 대체).
    if (!isSingle) {
      const procEquip = new Set(master.equipment.filter((r) => String(r.process_id ?? "") === processId).map((r) => String(r.id)));
      if (form.requiredEquipmentIds.some((id) => !procEquip.has(id))) e.push("필수 설비 중 현재 공정에 속하지 않는 항목이 있습니다.");
    } else if (singleEquip.some((id) => !stageEquipIdSet.has(id))) {
      e.push("Single 설비 중 현재 단계(설비별 인증단계)에 없는 항목이 있습니다.");
    }
    const v = validateCriteria(previewCriteria);
    if (!v.ok) e.push(...v.errors);
    return e;
  };

  const buildPayload = (): ExamRow => ({ ...(row.id ? { id: row.id } : {}), process_id: processId, level_id: levelId, notes: notes.trim() || null, is_active: isActive, criteria: (isSingle ? buildSingleCriteria() : buildNonSingle()) as unknown as ExamRow[keyof ExamRow] });

  const doSave = async (skipNoCond = false) => {
    const e = collectErrors();
    setErrors(e);
    if (e.length) return;
    const hasCond = isSingle ? (singleEquip.length > 0 || hasAnyCondition(form, false)) : hasAnyCondition(form, originalHasGroups);
    if (!skipNoCond && !hasCond) { setPendingNoCond(true); return; }
    setPendingNoCond(false); setSaving(true);
    try { await onSubmit(buildPayload(), reason.trim()); }
    catch (err) { setErrors([(err as { message?: string })?.message || "저장하지 못했습니다."]); setSaving(false); }
  };

  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-2 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none";
  const lbl = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-2 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100";
  // 숫자 필드 렌더(컴포넌트가 아닌 함수 — 렌더 중 컴포넌트 생성 방지). 미입력("")과 0 을 구분.
  const numField = (label: string, k: keyof ProcessCriteriaFormState, suffix?: string) => (
    <div><label className={lbl}>{label}</label>
      <div className="flex items-center gap-1"><input inputMode="decimal" className={`${inp} w-full`} value={numInput(form[k] as number | "")} placeholder="미입력" onChange={(ev) => set(k, parseNum(ev.target.value) as never)} />{suffix && <span className="text-xs text-slate-400">{suffix}</span>}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-8 w-full max-w-2xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(ev) => ev.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">{isNew ? "공정별 달성기준 등록" : "공정별 달성기준 수정"}</h3>

        {originalHasGroups && !isSingle && !origLevelIsSingle && (
          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            고급 조건(중첩 그룹)이 포함되어 있습니다. 이 화면에서는 편집하지 않으며 저장 시 그대로 유지됩니다. — {describeCriteria(original)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>그룹 <span className="text-rose-500">*</span></label>
            <select className={`${inp} w-full`} value={groupId} onChange={(ev) => { setGroupId(ev.target.value); setCategoryId(""); setProcessId(""); set("requiredEquipmentIds", []); setSingleEquip([]); }}><option value="">선택</option>{groupOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className={lbl}>제품군 <span className="text-rose-500">*</span></label>
            <select className={`${inp} w-full`} value={categoryId} disabled={!groupId} onChange={(ev) => { setCategoryId(ev.target.value); setProcessId(""); set("requiredEquipmentIds", []); setSingleEquip([]); }}><option value="">{groupId ? "선택" : "그룹 먼저"}</option>{catOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className={lbl}>공정 <span className="text-rose-500">*</span></label>
            <select className={`${inp} w-full`} value={processId} disabled={!categoryId} onChange={(ev) => { setProcessId(ev.target.value); set("requiredEquipmentIds", []); setSingleEquip([]); }}><option value="">{categoryId ? "선택" : "제품군 먼저"}</option>{procOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className={lbl}>인증단계 <span className="text-rose-500">*</span></label>
            <select className={`${inp} w-full`} value={levelId} onChange={(ev) => { setLevelId(ev.target.value); setSingleEquip([]); setSingleMode("any1"); }}><option value="">선택</option>{master.levelOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>

          {!isSingle && (
          <div className="col-span-2"><label className={lbl}>조건 방식</label>
            <div className="flex gap-2">
              {(["AND", "OR"] as const).map((op) => (
                <button key={op} type="button" onClick={() => set("operator", op)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium ${form.operator === op ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600")}`}>{op === "AND" ? "AND · 모든 조건 충족" : "OR · 하나 이상 충족"}</button>
              ))}
            </div></div>
          )}

          {!isSingle && numField("최소 설비 수", "minEquipmentCount", "개")}
          {numField("최소 주력설비 수", "minCoreEquipmentCount", "개")}
          {numField("최소 취득률", "minCompletionRate", "%")}
          {numField("최소 근속개월", "minTenureMonths", "개월")}
          {numField("단계간 경과개월", "minElapsedMonths", "개월")}
          {numField("누적 경과개월", "cumulativeElapsedMonths", "개월")}

          {/* 선행단계 다중선택 */}
          <div className="col-span-2"><label className={lbl}>선행단계 (다중, 자기 자신·상위 단계 불가)</label>
            <div className="flex flex-wrap gap-1.5">
              {prereqOpts.length === 0 && <span className="text-xs text-slate-400">선택 가능한 단계가 없습니다.</span>}
              {prereqOpts.map((l) => { const on = form.prerequisiteLevelIds.includes(l.id); const higher = curRank != null && l.rank >= curRank; return (
                <button key={l.id} type="button" onClick={() => togglePrereq(l.id)} title={higher ? "현재 단계보다 상위 단계입니다" : ""} className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600")} ${higher && on ? "ring-2 ring-rose-400" : ""}`}>{l.name}{higher ? " ⚠" : ""}</button>
              ); })}
            </div></div>

          {/* Single 취득 방식(단계=Single) — 아무거나 1개(OR groups) / 전부(required_equipment_ids). 설비는 해당 공정+단계 설비별 인증단계만. */}
          {isSingle && (
          <div className="col-span-2"><label className={lbl}>Single 취득 방식</label>
            <div className="mb-2 flex gap-2">
              {([["any1", "지정 설비 중 아무거나 1개"], ["all", "지정 설비 전부"]] as const).map(([mo, label]) => (
                <button key={mo} type="button" onClick={() => setSingleMode(mo)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium ${singleMode === mo ? "bg-blue-600 text-white" : (darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600")}`}>{label}</button>
              ))}
            </div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">Single 인정 대상 설비 (현재 공정 Single~Multi 4) · {singleEquip.length}개 선택</span>
              <span className="flex gap-1.5">
                <button type="button" className={btn} disabled={!stageEquip.length} onClick={() => setSingleEquip(stageEquip.map((e) => e.id))}>전체 선택</button>
                <button type="button" className={btn} disabled={!singleEquip.length} onClick={() => setSingleEquip([])}>해제</button>
              </span>
            </div>
            <div className={`max-h-36 overflow-auto rounded-xl border p-1 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {(!processId || !levelId) ? <div className="px-2 py-3 text-center text-xs text-slate-400">공정·인증단계를 먼저 선택하세요.</div>
                : stageEquip.length === 0 ? <div className="px-2 py-3 text-center text-xs text-slate-400">이 공정의 Single~Multi 4 설비별 인증단계가 없습니다(설비별 인증단계에서 먼저 등록).</div>
                : stageEquip.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={singleEquip.includes(e.id)} onChange={() => toggleSingle(e.id)} />
                    <span className="font-mono text-[0.7rem] text-slate-400">{e.code || "-"}</span><span>{e.name}</span>
                  </label>
                ))}
            </div>
            <p className="mt-1 text-[0.65rem] text-slate-400">{singleMode === "any1" ? (singleEquip.length >= 2 ? "→ OR groups로 저장(선택 설비 중 아무거나 1개 취득 시 Single 통과)." : "→ 설비 1개는 단일 required_equipment_ids로 저장.") : "→ 선택 설비 전부 취득(required_equipment_ids · AND)."} min_equipment_count는 사용하지 않습니다.</p>
          </div>
          )}

          {/* 필수 설비 다중선택(Multi 등 · Single 은 위 섹션 사용) */}
          {!isSingle && (
          <div className="col-span-2"><label className={lbl}>필수 설비 (선택 공정 소속 · 다중)</label>
            <div className="mb-1 flex items-center gap-2">
              <input value={equipSearch} onChange={(ev) => setEquipSearch(ev.target.value)} placeholder="설비코드/설비명 검색" className={`${inp} flex-1`} disabled={!processId} />
              <button type="button" className={btn} disabled={!processId || !equipList.length} onClick={() => set("requiredEquipmentIds", [...new Set([...form.requiredEquipmentIds, ...equipList.map((e) => e.id)])])}>전체 선택</button>
              <button type="button" className={btn} disabled={!form.requiredEquipmentIds.length} onClick={() => set("requiredEquipmentIds", [])}>해제</button>
              <span className="text-xs text-slate-400">{form.requiredEquipmentIds.length}개</span>
            </div>
            <div className={`max-h-36 overflow-auto rounded-xl border p-1 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {!processId && <div className="px-2 py-3 text-center text-xs text-slate-400">공정을 먼저 선택하세요.</div>}
              {processId && equipList.length === 0 && <div className="px-2 py-3 text-center text-xs text-slate-400">해당 공정에 설비가 없습니다.</div>}
              {equipList.map((e) => (
                <label key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={form.requiredEquipmentIds.includes(e.id)} onChange={() => toggleEquip(e.id)} />
                  <span className="font-mono text-[0.7rem] text-slate-400">{e.code || "-"}</span><span>{e.name}</span>{e.inactive && <span className="rounded bg-slate-200 px-1 text-[0.6rem] text-slate-500 dark:bg-slate-700">사용중지</span>}
                </label>
              ))}
            </div></div>
          )}

          <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowException} onChange={(ev) => set("allowException", ev.target.checked)} />예외 허용</label></div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(ev) => setIsActive(ev.target.checked)} />사용</label></div>
          <div><label className={lbl}>적용 시작일</label><input type="date" className={`${inp} w-full`} value={form.effectiveFrom} onChange={(ev) => set("effectiveFrom", ev.target.value)} /></div>
          <div><label className={lbl}>적용 종료일</label><input type="date" className={`${inp} w-full`} value={form.effectiveTo} onChange={(ev) => set("effectiveTo", ev.target.value)} /></div>
          <div className="col-span-2"><label className={lbl}>사용자 표시 문구 (label_ko)</label><input className={`${inp} w-full`} value={form.labelKo} placeholder="예: 설비 3개 이상 · 주력 2개 이상" onChange={(ev) => set("labelKo", ev.target.value)} /></div>
          <div className="col-span-2"><label className={lbl}>관리자 메모</label><textarea rows={2} className={`${inp} w-full`} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></div>
          <div className="col-span-2"><label className={lbl}>변경 사유{!isNew && <span className="text-slate-400"> (감사로그 기록)</span>}</label><input className={`${inp} w-full`} value={reason} placeholder="변경/등록 사유" onChange={(ev) => setReason(ev.target.value)} /></div>
        </div>

        {/* 조건 설명 미리보기 */}
        <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}>
          <span className="font-medium text-slate-500">조건 설명: </span>{previewText}
        </div>

        {/* JSON 미리보기(기본 접힘·읽기전용) */}
        <div className="mt-2">
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setShowJson((s) => !s)}>{showJson ? "▾" : "▸"} 저장 데이터 미리보기</button>
          {showJson && (
            <div className="relative mt-1">
              <button type="button" className={`absolute right-2 top-2 ${btn}`} onClick={() => { void navigator.clipboard?.writeText(jsonText); }}>복사</button>
              <pre className={`max-h-48 overflow-auto rounded-xl border p-3 text-[0.7rem] ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>{jsonText}</pre>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 rounded-xl bg-rose-50 px-5 py-2 text-xs text-rose-600 dark:bg-rose-950/30">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        )}

        {pendingNoCond && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            설정된 조건이 없습니다. 이대로 저장하시겠습니까? <button type="button" className="ml-2 font-semibold underline" onClick={() => void doSave(true)}>예, 저장</button>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>취소</button>
          <button type="button" disabled={saving} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`} onClick={() => void doSave(false)}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
