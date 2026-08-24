// 인력현황 · 설비 인증현황(직원별 현재 Level + Single~Multi4 취득/대상 n/m) — 표시 전용.
//  · 현재 Level = 공용 currentCertificationLevelService(canonical) · 단계별 n/m = 공용 equipmentProgressService.
//  · 계산 로직 페이지 내 중복 없음. 상세 펼침은 PM 인증관리 > 설비 인증현황에서(여기선 요약만).
//  · 데이터는 batch 1회 로드(N+1 없음). personnel/levels/applications 는 인력현황에서 이미 로드한 값을 props 로 재사용.
import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamRows, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { listEquipmentStageRules } from "../services/equipmentStageRuleService";
import { loadApprovedEquipmentByPerson } from "../services/certificationPreviewService";
import { computeCurrentLevelByPersonnel } from "../services/currentCertificationLevelService";
import { computeEquipmentProgressByPersonnel, type PersonnelEquipmentProgress } from "../services/equipmentProgressService";

const S = (v: unknown) => String(v ?? "").trim();

type Props = { darkMode: boolean; tenantId: string; personnel: ExamRow[]; levels: ExamRow[]; applications: ExamRow[] };

export default function PersonnelEquipmentProgressSection({ darkMode, tenantId, personnel, levels, applications }: Props) {
  const [stageRules, setStageRules] = useState<ExamRow[]>([]);
  const [pmCerts, setPmCerts] = useState<ExamRow[]>([]);
  const [processes, setProcesses] = useState<ExamRow[]>([]);
  const [approvedByPerson, setApprovedByPerson] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [quick, setQuick] = useState<"all" | "incomplete" | "complete">("all");

  const load = useCallback(async () => {
    if (!examSupabaseReady()) return;
    setLoading(true);
    try {
      const [sr, pm, proc, approved] = await Promise.all([
        listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),            // 대상 설비(분모)
        listExamRows("pm_certifications", tenantId).catch(() => [] as ExamRow[]),  // 현재 Level canonical(승인 인증)
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),     // 공정명 표시
        loadApprovedEquipmentByPerson(tenantId).catch(() => new Map<string, Set<string>>()), // 취득 설비(분자) 재사용
      ]);
      setStageRules(sr); setPmCerts(pm); setProcesses(proc); setApprovedByPerson(approved);
    } finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const procName = useMemo(() => new Map(processes.map((r) => [S(r.id), S(r.name) || S(r.code)])), [processes]);

  // 현재 Level(canonical) · 단계별 progress(공용 서비스) — 페이지 내 재계산 없음.
  const currentLevelByPerson = useMemo(
    () => computeCurrentLevelByPersonnel({ personnel, levels, applications, pmCertifications: pmCerts }),
    [personnel, levels, applications, pmCerts],
  );
  const progressByPerson = useMemo(
    () => computeEquipmentProgressByPersonnel({ personnel, levels, stageRules, approvedByPerson }),
    [personnel, levels, stageRules, approvedByPerson],
  );
  const currentLevelOf = useCallback((p: ExamRow) => currentLevelByPerson.get(S(p.id))?.currentLevelName || "-", [currentLevelByPerson]);

  const stageLabels = useMemo(() => {
    const first = progressByPerson.values().next().value as PersonnelEquipmentProgress | undefined;
    const levelName = new Map(levels.map((r) => [S(r.id), S(r.name) || S(r.code)]));
    return (first?.stages ?? []).map((s) => levelName.get(s.levelId) || `단계${s.stageIndex + 1}`);
  }, [progressByPerson, levels]);

  // distinct 전체(설비 완료/미완료 판정용) — 단계 overlap 중복 없음.
  const totals = useMemo(() => {
    const m = new Map<string, { acq: number; tgt: number; complete: boolean }>();
    for (const [pid, prog] of progressByPerson) {
      const tgt = new Set<string>(), acq = new Set<string>();
      for (const s of prog.stages) { for (const id of s.targetEquipmentIds) tgt.add(id); for (const id of s.acquiredEquipmentIds) acq.add(id); }
      m.set(pid, { acq: acq.size, tgt: tgt.size, complete: tgt.size > 0 && acq.size === tgt.size });
    }
    return m;
  }, [progressByPerson]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personnel
      .filter((p) => p.is_active !== false && !p.deleted_at)
      .filter((p) => {
        const pid = S(p.id);
        if (fLevel && currentLevelOf(p) !== fLevel) return false;
        const total = totals.get(pid);
        if (quick === "complete" && !(total?.complete)) return false;                     // 설비 완료 = distinct target 전체 취득
        if (quick === "incomplete" && (total?.complete || !total || total.tgt === 0)) return false; // 설비 미완료 = 대상>0 && 미완
        if (q) { const t = `${S(p.employee_no)} ${S(p.name)}`.toLowerCase(); if (!t.includes(q)) return false; }
        return true;
      });
  }, [personnel, search, fLevel, quick, totals, currentLevelOf]);

  const levelFilterOpts = useMemo(() => Array.from(new Set(personnel.map(currentLevelOf).filter((v) => v && v !== "-"))).sort(), [personnel, currentLevelOf]);

  const cell = (s: PersonnelEquipmentProgress["stages"][number] | undefined) => {
    if (!s || s.targetCount === 0) return <span className="text-slate-400">- / -</span>;
    const pct = s.progressPercent ?? 0;
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="tabular-nums">{s.acquiredCount} / {s.targetCount}</span>
        <span className={`h-1 w-12 overflow-hidden rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-200"}`}>
          <span className={`block h-full ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${Math.round(pct)}%` }} />
        </span>
      </span>
    );
  };
  const qBtn = (k: typeof quick, label: string) => (
    <button onClick={() => setQuick(k)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${quick === k ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{label}</button>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {qBtn("all", "전체")}{qBtn("incomplete", "설비 미완료")}{qBtn("complete", "설비 완료")}
        <select value={fLevel} onChange={(e) => setFLevel(e.target.value)} className={inputCls}><option value="">현재 Level: 전체</option>{levelFilterOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(사번/이름)" className={`${inputCls} min-w-[160px]`} />
        {loading && <span className="text-xs text-slate-400">불러오는 중…</span>}
      </div>

      {/* PC: 5단계 컬럼 테이블(가로 스크롤) */}
      <div className="hidden max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 sm:block">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{["사번", "이름", "그룹", "제품군", "공정", "현재 Level", ...stageLabels, "설비 전체", "사용여부"].map((h, i) => <th key={`${h}-${i}`} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pid = S(p.id);
              const prog = progressByPerson.get(pid);
              const total = totals.get(pid);
              return (
                <tr key={pid} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.employee_no) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.name) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.group_name) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.product_group) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{procName.get(S(p.process_id)) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{currentLevelOf(p)}</td>
                  {(prog?.stages ?? stageLabels.map(() => undefined)).map((s, i) => <td key={i} className="whitespace-nowrap px-2.5 py-2">{cell(s)}</td>)}
                  <td className="whitespace-nowrap px-2.5 py-2">{total && total.tgt > 0 ? <span className="tabular-nums">{total.acq} / {total.tgt} · {Math.round((total.acq / total.tgt) * 100)}%</span> : <span className="text-slate-400">- / -</span>}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{p.is_active === false ? <span className="text-slate-400">미사용</span> : "사용"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8 + stageLabels.length} className="px-3 py-10 text-center text-slate-500">표시할 직원이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 모바일: 직원 카드 */}
      <div className="space-y-2 sm:hidden">
        {rows.map((p) => {
          const pid = S(p.id);
          const prog = progressByPerson.get(pid);
          return (
            <div key={pid} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{S(p.employee_no)} · {S(p.name)}</span>
                <span className="text-xs text-slate-500">{procName.get(S(p.process_id)) || "-"}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">현재 Level: <span className="font-medium text-slate-700 dark:text-slate-300">{currentLevelOf(p)}</span></div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(prog?.stages ?? []).map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
                    <span className="text-slate-500">{stageLabels[i]}</span>
                    <span>{cell(s)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="px-3 py-8 text-center text-xs text-slate-500">표시할 직원이 없습니다.</div>}
      </div>

      <div className="mt-2 text-xs text-slate-500">총 {rows.length}명 · 대상/취득 설비는 설비별 인증단계와 승인 설비취득 기준 · 설비 상세는 <span className="font-medium">PM 인증관리 &gt; 설비 인증현황</span>에서 확인.</div>
    </div>
  );
}
