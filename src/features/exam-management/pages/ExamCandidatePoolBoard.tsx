import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamRows, upsertExamRow, writeExamAudit, isDuplicateApplication, type ExamRow } from "../services/examMasterService";
import { getNextExamSequence } from "../services/examSequenceService";
import { loadAllPlans, decoratePlans, todayYmd, toYmd, type EmployeeLicensePlan } from "../services/licensePlanService";
import { loadEmployeeLicenseSummaries } from "../services/employeeAutofillService";
import type { EmployeeAutofill } from "../types/employeeLookup";

// 시험관리 · 응시 후보관리(Candidate Pool). 라이선스 계획(active·목표 임박·미접수) → 이번 달 응시 대상 자동 선별.
//  · 기존 employee_license_plan / exam_applications 만 사용. 신규 마이그레이션/라우팅 없음. 대시보드 하위 섹션 임베드.
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const daysBetween = (from: string, to: string) => {
  const a = toYmd(from), b = toYmd(to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
};

type Candidate = {
  key: string; empId: string; empNo: string; name: string;
  level: string; targetDate: string; remaining: number | null; days: number | null; overdue: boolean; priority: number;
  process: string; productGroup: string; group: string; isPM: boolean; isDM: boolean; reason: string;
  emp: ExamRow;
};

export default function ExamCandidatePoolBoard({
  darkMode, canEdit, tenantId, userId, onToast,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId?: string; onToast?: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [plans, setPlans] = useState<EmployeeLicensePlan[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [selKey, setSelKey] = useState("");
  const [search, setSearch] = useState("");
  const [kindF, setKindF] = useState<"" | "thisMonth" | "urgent" | "delay" | "pm" | "dm">("");
  const [processF, setProcessF] = useState("");
  const [groupF, setGroupF] = useState("");
  const [categoryF, setCategoryF] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Map<string, EmployeeAutofill["licenseSummary"]>>(new Map());

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ppl, pl, ap] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        loadAllPlans(tenantId),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPersonnel(ppl); setPlans(pl); setApps(ap); setChecked(new Set());
      // 공통 요약 배치(N+1 없음) — 후보 상세에서 취득/진행/추천을 공통 서비스 기준으로 표시.
      loadEmployeeLicenseSummaries(tenantId, ppl.map((p) => str(p.id))).then(setSummaries).catch(() => setSummaries(new Map()));
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { if (open) void reload(); }, [open, reload]);

  const candidates = useMemo(() => {
    const today = todayYmd();
    // 이미 접수(응시신청)된 (사번|단계) — 중복 방지(조건 6). category_code 또는 pm_level 로 단계 매칭.
    const taken = new Set<string>();
    apps.forEach((a) => { if (a.deleted_at) return; const e = str(a.employee_no); if (!e) return; const c = str(a.category_code) || str(a.pm_level); if (c) taken.add(`${e}|${c}`); });
    const byEmp = new Map(personnel.map((p) => [str(p.id), p]));
    const out: Candidate[] = [];
    for (const p of decoratePlans(plans, today)) {
      if (p.status !== "active") continue;                 // 조건 1·2·7 (active = 현재 미완료 단계 · 취소 아님)
      const emp = byEmp.get(str(p.employee_id)); if (!emp) continue;
      if (/퇴사|퇴직|비활성|중지|해지/.test(str(emp.employment_status))) continue;
      const empNo = str(emp.employee_no);
      if (taken.has(`${empNo}|${p.license_level}`)) continue;  // 조건 6
      const target = toYmd(p.target_date);
      const days = target ? daysBetween(today, target) : null;
      const within = p.overdue || (days !== null && days <= 30);
      if (!within) continue;                               // 조건 3 (30일 이내/지연)
      const isPM = /pm/i.test(p.license_level); const isDM = /d\.?m/i.test(p.license_level);
      out.push({
        key: `${empNo}|${p.license_level}`, empId: str(p.employee_id), empNo, name: str(emp.name),
        level: p.license_level, targetDate: target || "-", remaining: p.remaining_months, days, overdue: p.overdue,
        priority: p.overdue ? -1 : (days ?? 999),
        process: str(emp.process ?? emp.part_name), productGroup: str(emp.product_group), group: str(emp.group_name),
        isPM, isDM, reason: p.overdue ? "목표취득일 초과(지연)" : `목표취득일 ${days}일 이내`, emp,
      });
    }
    return out.sort((a, b) => a.priority - b.priority || a.empNo.localeCompare(b.empNo));
  }, [plans, personnel, apps]);

  const distinct = (get: (c: Candidate) => string) => Array.from(new Set(candidates.map(get).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  const processOpts = useMemo(() => distinct((c) => c.process), [candidates]);
  const groupOpts = useMemo(() => distinct((c) => c.group), [candidates]);
  const categoryOpts = useMemo(() => distinct((c) => c.productGroup), [candidates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ym = todayYmd().slice(0, 7);
    return candidates.filter((c) => {
      if (q && !`${c.empNo} ${c.name} ${c.process} ${c.group} ${c.productGroup}`.toLowerCase().includes(q)) return false;
      if (processF && c.process !== processF) return false;
      if (groupF && c.group !== groupF) return false;
      if (categoryF && c.productGroup !== categoryF) return false;
      if (kindF === "thisMonth" && toYmd(c.targetDate).slice(0, 7) !== ym) return false;
      if (kindF === "urgent" && !(c.overdue || (c.days !== null && c.days <= 7))) return false;
      if (kindF === "delay" && !c.overdue) return false;
      if (kindF === "pm" && !c.isPM) return false;
      if (kindF === "dm" && !c.isDM) return false;
      return true;
    });
  }, [candidates, search, processF, groupF, categoryF, kindF]);

  const sel = candidates.find((c) => c.key === selKey) || null;
  const allChecked = filtered.length > 0 && filtered.every((c) => checked.has(c.key));
  const toggleAll = () => setChecked((prev) => { const n = new Set(prev); if (filtered.every((c) => n.has(c.key))) filtered.forEach((c) => n.delete(c.key)); else filtered.forEach((c) => n.add(c.key)); return n; });
  const toggle = (k: string) => setChecked((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // 후보 승인 등록 → exam_applications(승인대기). 일반 신규 등록과 동일 정책:
  //  ① 저장 직전 DB 중복 검증(tenant+사번+구분코드) ② 중복 아님 확인 후에만 연번 RPC 발급(번호 낭비 방지)
  //  ③ 순차 처리(무제한 동시요청 금지). 성공/중복/실패/연번미발급 분리 집계 + 프론트 캐시 refetch(reload).
  const registerChecked = async () => {
    const chosen = filtered.filter((c) => checked.has(c.key));
    if (busy || chosen.length === 0) return;
    if (!tenantId) { setError("회사 정보가 확인되지 않았습니다."); return; }
    setBusy(true); setError(null);
    const year = new Date().getFullYear();
    let created = 0, duplicate = 0, seqFailed = 0; const fails: Array<{ ref: string; reason: string }> = [];
    for (const c of chosen) {
      const ref = `${c.empNo} ${c.name}`.trim();
      try {
        if (!c.empNo) { fails.push({ ref, reason: "사번 없음" }); continue; }
        // 저장 직전 DB 기준 중복 검증(후보 목록에 없다는 이유만으로 판단하지 않음). 중복이면 RPC·insert 안 함.
        if (await isDuplicateApplication(tenantId, c.empNo, c.level)) { duplicate++; continue; }
        const payload: ExamRow = {
          employee_no: c.empNo, name: c.name, group_name: c.group, product: c.productGroup,
          process: c.process, pm_level: c.level, category_code: c.level, status: "승인대기",
        };
        // 연번 자동 발급(중복 아님이 확인된 뒤에만 · 실패해도 등록은 진행). 프론트 배열길이/ max+1 금지.
        const nextSeq = await getNextExamSequence(tenantId, year);
        if (nextSeq != null) payload.seq_no = nextSeq; else seqFailed++;
        const saved = await upsertExamRow("exam_applications", payload, tenantId, userId || "");
        await writeExamAudit(tenantId, userId || "", "exam_applications", String(saved.id), "create", null, saved, `응시 후보 승인 등록(${c.level})`);
        created++;
      } catch (e) {
        const msg = (e as { message?: string })?.message || "";
        // DB 유니크(동시 승인 등)로 인한 중복은 "이미 등록"으로 집계(개발용 코드 미노출).
        if (/이미|중복|duplicate|23505/.test(msg)) duplicate++;
        else fails.push({ ref, reason: msg || "저장 실패" });
      }
    }
    setBusy(false);
    // 사용자 안내: 성공/중복/실패 분리 집계(자연스러운 한글). 연번 미발급은 별도 부기.
    const parts: string[] = [];
    if (created > 0) parts.push(`${created}명 등록`);
    if (duplicate > 0) parts.push(`${duplicate}명은 이미 등록되어 제외`);
    if (fails.length > 0) parts.push(`${fails.length}명은 저장에 실패`);
    const summary = `총 ${chosen.length}명 중 ${parts.join(", ")}.`;
    if (created > 0 && fails.length === 0) onToast?.(summary + (seqFailed > 0 ? ` (이 중 ${seqFailed}명은 연번 미지정 상태)` : ""));
    else if (created > 0) { onToast?.(summary); setError(`저장 실패(${fails.length}):\n` + fails.map((f) => `· ${f.ref}: ${f.reason}`).join("\n")); }
    else if (fails.length === 0) onToast?.(summary); // 전부 중복 제외 등
    else setError(`등록 실패(${fails.length}):\n` + fails.map((f) => `· ${f.ref}: ${f.reason}`).join("\n"));
    await reload(); // apps refetch → 후보 재계산(taken 제외)으로 등록 완료 후보 즉시 제거
  };

  const card = darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white";
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm";
  const chosenCount = filtered.filter((c) => checked.has(c.key)).length;

  return (
    <section className={`mt-5 rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <h3 className="text-lg font-semibold">응시 후보관리</h3>
          <p className="text-sm text-slate-500">라이선스 계획(진행중·목표 임박·미접수)에서 이번 달 응시 대상을 자동 선별합니다.</p>
        </div>
        <span className="text-slate-400">{open ? "▲ 접기" : "▼ 펼치기"}</span>
      </button>

      {open && (
        <div className="mt-4">
          {error && <div className="mb-2 whitespace-pre-line rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
            {/* 좌: 후보 목록 */}
            <div className={`rounded-2xl border p-3 ${card}`}>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사번/이름/공정 검색" className={`${inputCls} min-w-[130px] flex-1`} />
                <select value={kindF} onChange={(e) => setKindF(e.target.value as typeof kindF)} className={inputCls}>
                  <option value="">전체</option><option value="thisMonth">이번달</option><option value="urgent">긴급</option><option value="delay">지연</option><option value="pm">PM 후보</option><option value="dm">DM 후보</option>
                </select>
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <select value={processF} onChange={(e) => setProcessF(e.target.value)} className={`${inputCls} flex-1`}><option value="">공정: 전체</option>{processOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <select value={categoryF} onChange={(e) => setCategoryF(e.target.value)} className={`${inputCls} flex-1`}><option value="">제품군: 전체</option>{categoryOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <select value={groupF} onChange={(e) => setGroupF(e.target.value)} className={`${inputCls} flex-1`}><option value="">그룹: 전체</option>{groupOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </div>
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <label className="flex items-center gap-1"><input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={filtered.length === 0} /> 전체선택</label>
                <span>후보 {filtered.length}건 · 선택 {chosenCount}건</span>
              </div>
              <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                {loading && <div className="px-3 py-6 text-center text-xs text-slate-500">불러오는 중…</div>}
                {!loading && filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">응시 후보가 없습니다.</div>}
                {filtered.map((c) => {
                  const s = c.key === selKey;
                  return (
                    <div key={c.key} className={`flex items-center gap-2 border-t px-3 py-2 text-sm first:border-t-0 ${s ? (darkMode ? "bg-blue-950/50" : "bg-blue-50") : ""} ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                      <input type="checkbox" checked={checked.has(c.key)} onChange={() => toggle(c.key)} onClick={(e) => e.stopPropagation()} />
                      <button type="button" onClick={() => setSelKey(c.key)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                        <span className="min-w-0">
                          <span className="font-medium">{c.name || "-"}</span><span className="ml-1 text-xs text-slate-400">{c.empNo}</span>
                          <span className="block truncate text-[0.7rem] text-slate-400">{c.process || "-"} · {c.level}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {c.overdue ? <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-rose-700">지연</span>
                            : (c.days !== null && c.days <= 7) ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-700">긴급</span> : null}
                          <span className="text-xs text-slate-500">{c.overdue ? "초과" : c.days !== null ? `${c.days}일` : "-"}</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {canEdit && (
                <button type="button" disabled={busy || chosenCount === 0} onClick={() => void registerChecked()}
                  className={`mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold ${busy || chosenCount === 0 ? "bg-slate-300 text-slate-500" : "bg-blue-600 text-white hover:bg-blue-500"}`}>
                  {busy ? "등록 중…" : `시험 응시관리로 일괄 등록 (${chosenCount}건)`}
                </button>
              )}
            </div>

            {/* 우: 선택 후보 상세 */}
            <div className={`rounded-2xl border p-3 ${card}`}>
              {!sel ? (
                <div className="px-3 py-12 text-center text-sm text-slate-400">좌측에서 후보를 선택하세요.</div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-base font-semibold">{sel.name} <span className="text-xs font-normal text-slate-400">{sel.empNo}</span></div>
                    <div className="text-xs text-slate-500">{[sel.productGroup, sel.group, sel.process].filter(Boolean).join(" · ") || "-"}</div>
                  </div>
                  {/* 공통 요약(취득/진행/추천) — 후보 선정 기준과 별개로 공통 서비스 값 표시. */}
                  {(() => {
                    const s = summaries.get(sel.empId); if (!s) return null;
                    const stage = (c: string | null, n: string | null) => c ? (n && n !== c ? `${c} · ${n}` : c) : "없음";
                    const cell = (label: string, val: string, tone?: string) => (
                      <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-0.5 ${tone ?? ""}`}>{val}</div></div>
                    );
                    return (
                      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                        {cell("현재 취득 단계", stage(s.acquiredStageCode, s.acquiredStageName), "font-medium text-emerald-600")}
                        {cell("진행 중 단계", stage(s.activeStageCode, s.activeStageName), "text-blue-600")}
                        {cell("다음 추천 단계", stage(s.nextRecommendedStageCode, s.nextRecommendedStageName))}
                      </div>
                    );
                  })()}
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    {[["현재/응시 단계", sel.level], ["목표취득일", sel.targetDate],
                      ["남은 기간", sel.overdue ? "초과" : sel.remaining != null ? `${sel.remaining}개월` : (sel.days != null ? `${sel.days}일` : "-")],
                      ["지연 여부", sel.overdue ? "지연" : "정상"], ["추천 시험일", sel.targetDate], ["추천 시험 종류", sel.level]].map(([l, v]) => (
                      <div key={l} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{l}</div><div className={`mt-0.5 ${l === "지연 여부" && sel.overdue ? "font-semibold text-rose-600" : ""}`}>{v}</div>
                      </div>
                    ))}
                  </dl>
                  <div className={`mt-3 rounded-lg border p-2 text-sm ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">추천 이유</div>
                    <div className="mt-0.5">{sel.reason}{sel.isPM ? " · PM 단계" : sel.isDM ? " · DM 단계" : ""}</div>
                  </div>
                  {canEdit && (
                    <button type="button" disabled={busy} onClick={() => { setChecked((n) => new Set(n).add(sel.key)); }}
                      className={`mt-3 rounded-xl border px-3 py-1.5 text-xs ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>이 후보 선택에 추가</button>
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
