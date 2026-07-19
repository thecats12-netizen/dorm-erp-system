import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamRows, type ExamRow } from "../services/examMasterService";
import { loadEmployeeLicenseSummaries } from "../services/employeeAutofillService";
import type { EmployeeAutofill } from "../types/employeeLookup";
import {
  loadAllPlans, generatePlanForEmployee, completeStageAndActivateNext,
  updatePlanStatus, recomputeExpiredPlans, decoratePlans, summarizePlans,
  resolveEmployeeScope, buildLadderForScope,
  LICENSE_PLAN_STATUS_LABEL, type EmployeeLicensePlan, type PlanView,
} from "../services/licensePlanService";

// 시험관리 · 라이선스 계획(직원별). 좌: 직원 목록, 우: 선택 직원의 취득 계획.
//  · 기존 employee_license_plan 테이블/서비스만 사용. 신규 마이그레이션 없음. 상태값은 DB CHECK 5종만 사용.
//  · 시험 대시보드 하위 섹션으로 임베드(신규 라우팅/메뉴 없음).
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const STATUS_TONE: Record<string, string> = {
  waiting: "bg-slate-200 text-slate-600",
  active: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  expired: "bg-rose-100 text-rose-700",
  cancel: "bg-slate-200 text-slate-400 line-through",
};

export default function ExamLicensePlanBoard({
  darkMode, canEdit, tenantId, userId, onToast,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId?: string; onToast?: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [plans, setPlans] = useState<EmployeeLicensePlan[]>([]);
  // tenant 기준정보(마스터) — 직원 공정 범위 사다리 산출용. 직원 선택마다 재조회하지 않고 1회 로드 후 프론트 계산.
  const [master, setMaster] = useState<{ levels: ExamRow[]; rules: ExamRow[]; processes: ExamRow[]; parts: ExamRow[]; groups: ExamRow[] }>({ levels: [], rules: [], processes: [], parts: [], groups: [] });
  const [selId, setSelId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [empStatusF, setEmpStatusF] = useState("재직");   // 재직/전체
  const [processF, setProcessF] = useState("");
  const [planStatusF, setPlanStatusF] = useState<"" | "active" | "waiting" | "completed" | "expired" | "cancel">("");
  const [candF, setCandF] = useState<"" | "delay" | "unlinked" | "mismatch" | "pm" | "dm">("");
  const [summaries, setSummaries] = useState<Map<string, EmployeeAutofill["licenseSummary"]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ppl, all, levels, rules, processes, parts, groups] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        loadAllPlans(tenantId),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_parts", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPersonnel(ppl); setPlans(all); setMaster({ levels, rules, processes, parts, groups });
      // 공통 요약 배치 계산(N+1 없음): 계획 없어도 시험 취득 이력으로 현재 취득 단계를 확인.
      loadEmployeeLicenseSummaries(tenantId, ppl.map((p) => str(p.id))).then(setSummaries).catch(() => setSummaries(new Map()));
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { if (open) void reload(); }, [open, reload]);

  // 직원별 계획 집계(진행/완료/지연).
  const planByEmp = useMemo(() => {
    const m = new Map<string, PlanView[]>();
    for (const p of decoratePlans(plans)) { const k = str(p.employee_id); (m.get(k) || m.set(k, []).get(k)!).push(p); }
    return m;
  }, [plans]);

  // 직원별 공정 범위(scope) + 범위 사다리 — 마스터에서 프론트 계산(직원 선택마다 재조회 없음).
  const scopeOf = useCallback((emp: ExamRow) => resolveEmployeeScope(emp, master.processes, master.parts, master.groups), [master]);
  const ladderOf = useCallback((emp: ExamRow) => buildLadderForScope(master.levels, master.rules, scopeOf(emp)), [master, scopeOf]);

  const processOptions = useMemo(() => {
    const s = new Set<string>();
    personnel.forEach((r) => { const v = str(r.process ?? r.part_name).trim(); if (v) s.add(v); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [personnel]);

  const empList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personnel.filter((r) => {
      if (r.deleted_at) return false;
      const es = str(r.employment_status);
      if (empStatusF === "재직" && es && /퇴사|퇴직|비활성|중지|해지/.test(es)) return false;
      if (processF && str(r.process ?? r.part_name).trim() !== processF) return false;
      if (q) { const t = `${str(r.employee_no)} ${str(r.name)} ${str(r.group_name)} ${str(r.product_group)} ${str(r.part_name)}`.toLowerCase(); if (!t.includes(q)) return false; }
      if (planStatusF) { const ps = planByEmp.get(str(r.id)) || []; if (!ps.some((p) => (planStatusF === "expired" ? (p.overdue || p.status === "expired") : p.status === planStatusF))) return false; }
      if (candF) {
        const ps = planByEmp.get(str(r.id)) || [];
        const scope = scopeOf(r);
        if (candF === "unlinked" && scope.resolved) return false;
        if (candF === "delay" && !ps.some((p) => p.overdue || p.status === "expired")) return false;
        if (candF === "mismatch") { if (!scope.resolved) return false; const codes = new Set(ladderOf(r).map((s) => s.level_code)); if (!ps.some((p) => p.status !== "cancel" && !codes.has(p.license_level))) return false; }
        if (candF === "pm" && !ps.some((p) => /pm/i.test(p.license_level) && (p.status === "active" || p.status === "waiting"))) return false;
        if (candF === "dm" && !ps.some((p) => /d\.?m/i.test(p.license_level) && (p.status === "active" || p.status === "waiting"))) return false;
      }
      return true;
    }).sort((a, b) => str(a.employee_no).localeCompare(str(b.employee_no)));
  }, [personnel, search, empStatusF, processF, planStatusF, candF, planByEmp, scopeOf, ladderOf]);

  const selEmp = personnel.find((r) => str(r.id) === selId) || null;
  const selScope = useMemo(() => (selEmp ? scopeOf(selEmp) : null), [selEmp, scopeOf]);
  const scopedLadder = useMemo(() => (selEmp ? ladderOf(selEmp) : []), [selEmp, ladderOf]);
  const scopedCodes = useMemo(() => new Set(scopedLadder.map((s) => s.level_code)), [scopedLadder]);
  // legacy(공정 미연결): 텍스트 공정명이 마스터와 정확히 1건 매칭되면 추천만(자동 변환 없음).
  const legacyMatches = useMemo(() => {
    if (!selEmp || selScope?.resolved) return [] as ExamRow[];
    const nm = str(selEmp.process ?? selEmp.part_name).trim();
    return nm ? master.processes.filter((p) => p.is_active !== false && str(p.name).trim() === nm) : [];
  }, [selEmp, selScope, master.processes]);
  const selPlans = useMemo(() => (selId ? decoratePlans(plans.filter((p) => str(p.employee_id) === selId)).sort((a, b) => str(a.created_at).localeCompare(str(b.created_at))) : []), [plans, selId]);
  const summary = useMemo(() => summarizePlans(selId ? plans.filter((p) => str(p.employee_id) === selId) : plans), [plans, selId]);

  const genPlan = async () => {
    if (!selEmp || busy) return;
    // 계획 생성 검증(요구사항 5·6): 재직 + 공정 연결 + 공정 범위 규칙 존재.
    const es = str(selEmp.employment_status);
    if (es && /퇴사|퇴직|비활성|중지|해지/.test(es)) { setError("재직 중이 아닌 직원은 계획을 생성할 수 없습니다."); return; }
    if (!selScope?.resolved) { setError("해당 직원의 공정 기준정보가 연결되지 않아 라이선스 계획을 생성할 수 없습니다."); return; }
    if (scopedLadder.length === 0) { setError("해당 공정에 적용할 인증 규칙(취득 기한)이 없어 계획을 생성할 수 없습니다."); return; }
    setBusy(true); setError(null);
    try {
      // 공정 범위 사다리만 생성. 중복 단계는 서비스가 skip(멱등).
      const res = await generatePlanForEmployee(selId, tenantId, selEmp.hire_date, scopedLadder, userId);
      onToast?.(res.created > 0 ? `라이선스 계획 ${res.created}단계를 생성했습니다.` : "생성할 신규 단계가 없습니다(이미 존재).");
      await reload();
    } catch (e) { setError((e as { message?: string })?.message || "계획 생성 실패"); }
    finally { setBusy(false); }
  };
  const complete = async (level: string) => {
    if (!selEmp || busy) return;
    setBusy(true); setError(null);
    try { const r = await completeStageAndActivateNext(selId, tenantId, level, undefined, userId); if (r.error) setError(r.error); else onToast?.(`${level} 취득 완료${r.activatedNext ? ` · 다음 단계(${r.activatedNext}) 활성화` : ""}`); await reload(); }
    finally { setBusy(false); }
  };
  const setStatus = async (planId: string, status: "cancel" | "active" | "waiting") => {
    if (busy) return; setBusy(true); setError(null);
    try { const r = await updatePlanStatus(planId, tenantId, status, userId); if (r.error) setError(r.error); await reload(); }
    finally { setBusy(false); }
  };
  const recompute = async () => {
    if (busy) return; setBusy(true); setError(null);
    try { const r = await recomputeExpiredPlans(tenantId); onToast?.(`기한 초과 ${r.updated}건을 반영했습니다.`); await reload(); }
    finally { setBusy(false); }
  };

  const card = darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white";
  const chip = (label: string, n: number, tone = "bg-slate-100 text-slate-600") => (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label} {n}</span>
  );
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm";

  return (
    <section className={`mt-5 rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <h3 className="text-lg font-semibold">라이선스 계획</h3>
          <p className="text-sm text-slate-500">직원별 인증 취득 계획(예정·진행·완료·기한). 인증 기준관리의 레벨·규칙에서 자동 산출.</p>
        </div>
        <span className="text-slate-400">{open ? "▲ 접기" : "▼ 펼치기"}</span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {chip("전체", summary.total)}{chip("진행중", summary.active, "bg-blue-100 text-blue-700")}{chip("대기", summary.waiting)}
            {chip("완료", summary.completed, "bg-emerald-100 text-emerald-700")}{chip("기한초과", summary.overdue, "bg-rose-100 text-rose-700")}{chip("30일이내", summary.within30d, "bg-amber-100 text-amber-700")}
            {canEdit && <button type="button" disabled={busy} onClick={() => void recompute()} className={`ml-auto rounded-xl border px-2.5 py-1 text-xs ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>기한 재계산</button>}
          </div>
          {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
            {/* 좌: 직원 목록 */}
            <div className={`rounded-2xl border p-3 ${card}`}>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사번/이름/공정 검색" className={`${inputCls} min-w-[130px] flex-1`} />
                <select value={empStatusF} onChange={(e) => setEmpStatusF(e.target.value)} className={inputCls}><option value="재직">재직</option><option value="전체">전체</option></select>
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <select value={processF} onChange={(e) => setProcessF(e.target.value)} className={`${inputCls} flex-1`}><option value="">공정: 전체</option>{processOptions.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <select value={planStatusF} onChange={(e) => setPlanStatusF(e.target.value as typeof planStatusF)} className={inputCls}><option value="">상태: 전체</option><option value="active">진행중</option><option value="waiting">대기</option><option value="completed">완료</option><option value="expired">기한초과</option></select>
              </div>
              <div className="mb-2">
                <select value={candF} onChange={(e) => setCandF(e.target.value as typeof candF)} className={`${inputCls} w-full`}>
                  <option value="">후보/상태: 전체</option>
                  <option value="pm">PM 후보(진행중 PM 단계)</option>
                  <option value="dm">DM 후보(진행중 DM 단계)</option>
                  <option value="delay">계획 지연</option>
                  <option value="unlinked">기준정보 미연결</option>
                  <option value="mismatch">현재 공정 기준 불일치</option>
                </select>
              </div>
              <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {loading && <div className="px-3 py-6 text-center text-xs text-slate-500">불러오는 중…</div>}
                {!loading && empList.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">직원이 없습니다.</div>}
                {empList.map((r) => {
                  const ps = planByEmp.get(str(r.id)) || [];
                  const done = ps.filter((p) => p.status === "completed").length;
                  const over = ps.some((p) => p.overdue || p.status === "expired");
                  const sel = str(r.id) === selId;
                  return (
                    <button key={str(r.id)} type="button" onClick={() => setSelId(str(r.id))}
                      className={`flex w-full items-center justify-between gap-2 border-t px-3 py-2 text-left text-sm first:border-t-0 ${sel ? (darkMode ? "bg-blue-950/50" : "bg-blue-50") : (darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50")} ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      <span className="min-w-0">
                        <span className="font-medium">{str(r.name) || "-"}</span>
                        <span className="ml-1 text-xs text-slate-400">{str(r.employee_no)}</span>
                        <span className="block truncate text-[0.7rem] text-slate-400">{str(r.process ?? r.part_name) || "-"}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {over && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-rose-700">지연</span>}
                        <span className="text-xs text-slate-500">{ps.length ? `${done}/${ps.length}` : "-"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 우: 선택 직원 계획 */}
            <div className={`rounded-2xl border p-3 ${card}`}>
              {!selEmp ? (
                <div className="px-3 py-12 text-center text-sm text-slate-400">좌측에서 직원을 선택하세요.</div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-base font-semibold">{str(selEmp.name)} <span className="text-xs font-normal text-slate-400">{str(selEmp.employee_no)}</span></div>
                      <div className="text-xs text-slate-500">{[str(selEmp.product_group), str(selEmp.group_name), str(selEmp.part_name), str(selEmp.process)].filter(Boolean).join(" · ") || "-"}</div>
                    </div>
                    {canEdit && (
                      <button type="button" disabled={busy || !selScope?.resolved || scopedLadder.length === 0} onClick={() => void genPlan()}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${busy || !selScope?.resolved || scopedLadder.length === 0 ? "bg-slate-300 text-slate-500" : "bg-blue-600 text-white hover:bg-blue-500"}`}>
                        {selPlans.length === 0 ? "계획 생성" : "누락 단계 보충"}
                      </button>
                    )}
                  </div>
                  {/* 공통 요약: 계획이 없어도 시험 취득 이력 기준 현재 취득 단계를 표시(가짜 plan 생성 없음). */}
                  {(() => {
                    const s = summaries.get(selId); if (!s) return null;
                    const stage = (c: string | null, n: string | null) => c ? (n && n !== c ? `${c} · ${n}` : c) : "없음";
                    const srcLabel = s.source === "license_plan" ? "라이선스 계획" : s.source === "exam_application" ? "시험 응시 이력" : s.source === "mixed" ? "계획 및 시험 이력" : "확인 가능한 데이터 없음";
                    const cell = (label: string, val: string, tone?: string) => (
                      <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.6rem] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-0.5 ${tone ?? ""}`}>{val}</div></div>
                    );
                    return (
                      <div className="mb-3">
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                          {cell("현재 취득 단계", stage(s.acquiredStageCode, s.acquiredStageName), "font-medium text-emerald-600")}
                          {cell("진행 중 단계", stage(s.activeStageCode, s.activeStageName), "text-blue-600")}
                          {cell("다음 추천 단계", stage(s.nextRecommendedStageCode, s.nextRecommendedStageName))}
                          {cell("계획 상태", selPlans.length ? "계획 있음" : "라이선스 계획 미생성", selPlans.length ? "" : "text-slate-500")}
                          {cell("데이터 출처", srcLabel)}
                        </div>
                        {s.warnings?.length ? <div className="mt-1 text-xs text-amber-600">{s.warnings.join(" · ")}</div> : null}
                      </div>
                    );
                  })()}
                  {/* 공정 미연결(legacy) / 규칙 없음 안내 */}
                  {!selScope?.resolved && (
                    <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      해당 직원의 공정 기준정보가 연결되지 않아 라이선스 계획을 생성할 수 없습니다.
                      {legacyMatches.length === 1 && <> 추천 공정: <b>{str(legacyMatches[0].name)}</b> (인력현황에서 기준정보 연결 필요)</>}
                      {legacyMatches.length > 1 && <> 동일 이름 공정이 여러 건이라 자동 연결할 수 없습니다.</>}
                    </div>
                  )}
                  {selScope?.resolved && scopedLadder.length === 0 && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">해당 공정에 적용할 인증 규칙(취득 기한)이 없습니다. 인증 기준관리에서 공정 규칙을 등록하세요.</div>}
                  {selPlans.length === 0 ? (
                    <div className="px-3 py-10 text-center text-sm text-slate-400">계획이 없습니다. {canEdit && selScope?.resolved && scopedLadder.length > 0 && "‘계획 생성’으로 자동 생성하세요."}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className={`${darkMode ? "text-slate-400" : "text-slate-500"} text-xs`}>
                          <tr><th className="px-2 py-1.5">단계</th><th className="px-2 py-1.5">상태</th><th className="px-2 py-1.5">목표취득일</th><th className="px-2 py-1.5">남은</th><th className="px-2 py-1.5">취득일</th>{canEdit && <th className="px-2 py-1.5">작업</th>}</tr>
                        </thead>
                        <tbody>
                          {selPlans.map((p) => (
                            <tr key={p.id} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                              <td className="whitespace-nowrap px-2 py-2 font-medium">{p.license_level}
                                {selScope?.resolved && p.status !== "cancel" && !scopedCodes.has(p.license_level) && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-700" title="현재 공정 기준과 불일치 — 기존 생성 계획, 검토 필요(자동 취소 안 함)">공정 불일치</span>}
                              </td>
                              <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[p.status] || "bg-slate-200 text-slate-600"}`}>{LICENSE_PLAN_STATUS_LABEL[p.status] || p.status}</span></td>
                              <td className="whitespace-nowrap px-2 py-2">{p.target_date || "-"}</td>
                              <td className={`whitespace-nowrap px-2 py-2 ${p.overdue ? "font-semibold text-rose-600" : ""}`}>{p.status === "completed" ? "-" : p.remaining_months != null ? `${p.remaining_months}개월${p.overdue ? " 초과" : ""}` : "-"}</td>
                              <td className="whitespace-nowrap px-2 py-2">{p.completed_date || "-"}</td>
                              {canEdit && (
                                <td className="whitespace-nowrap px-2 py-2 text-xs">
                                  {(p.status === "active" || p.status === "waiting" || p.status === "expired") && <button type="button" disabled={busy} onClick={() => void complete(p.license_level)} className="text-emerald-600 hover:underline">취득완료</button>}
                                  {p.status !== "cancel" && p.status !== "completed" && <><span className="mx-1 text-slate-300">·</span><button type="button" disabled={busy} onClick={() => void setStatus(p.id, "cancel")} className="text-rose-600 hover:underline">취소</button></>}
                                  {p.status === "cancel" && <button type="button" disabled={busy} onClick={() => void setStatus(p.id, "waiting")} className="text-slate-500 hover:underline">복구</button>}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
