import { useCallback, useEffect, useMemo, useState } from "react";
import { listExamRows, listExamRefOptions, examSupabaseReady, type ExamRow } from "../services/examMasterService";

type RefOpt = { id: string; label: string };
type Kind = "personnel" | "application" | "cert" | "target";
type Segment = { label: string; value: number; rows: ExamRow[]; kind: Kind };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const truthy = (v: unknown) => { if (typeof v === "boolean") return v; const s = str(v).trim().toLowerCase(); return !!s && !["0", "false", "n", "no", "x", "-", "없음"].includes(s); };
// 달성률 = 실적/목표×100. 목표 0 → 0%. NaN/Infinity 금지.
const pct = (a: unknown, t: unknown): number => { const tt = num(t); if (!(tt > 0)) return 0; const v = Math.round((num(a) / tt) * 1000) / 10; return Number.isFinite(v) ? v : 0; };
const ymd = (v: unknown) => { if (v == null || v === "") return ""; if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10); const s = String(v).trim(); const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10); };

const isFail = (a: ExamRow) => /불합격/.test(str(a.status));
const isTaken = (a: ExamRow) => !["예정", "취소", ""].includes(str(a.status));
const isAcquired = (a: ExamRow) => !!a.practical_pass_date || str(a.status) === "인증 취득";
const isPass = (a: ExamRow) => !isFail(a) && (isAcquired(a) || /합격/.test(str(a.status)));
const passMonth = (a: ExamRow) => ymd(a.practical_pass_date || a.written_pass_date).slice(0, 7);
const expiryState = (r: ExamRow) => { const s = ymd(r.expiry_date); if (!s) return "-"; const d = Math.floor((new Date(s).getTime() - Date.now()) / 86400000); return d < 0 ? "만료" : d <= 30 ? "만료예정" : "유효"; };

const GRAD: Record<string, string> = { blue: "from-blue-50 to-blue-100 text-blue-700", emerald: "from-emerald-50 to-emerald-100 text-emerald-700", amber: "from-amber-50 to-amber-100 text-amber-700", rose: "from-rose-50 to-rose-100 text-rose-700", purple: "from-purple-50 to-purple-100 text-purple-700", cyan: "from-cyan-50 to-cyan-100 text-cyan-700", indigo: "from-indigo-50 to-indigo-100 text-indigo-700", slate: "from-slate-50 to-slate-100 text-slate-700" };
const barColor = (i: number) => ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#6366f1", "#ec4899"][i % 8];

function KpiCard({ label, value, color, onClick, darkMode }: { label: string; value: string; color: string; onClick?: () => void; darkMode: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`rounded-3xl border bg-gradient-to-br p-3 text-left transition-shadow ${GRAD[color]} ${darkMode ? "border-slate-700" : "border-slate-200"} ${onClick ? "hover:shadow-lg" : "cursor-default"}`}>
      <div className="text-[0.62rem] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1.5 text-2xl font-bold">{value}</div>
    </button>
  );
}
function BarList({ data, onPick, empty, darkMode }: { data: Segment[]; onPick: (s: Segment) => void; empty: string; darkMode: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length || data.every((d) => d.value === 0)) return <div className="py-8 text-center text-sm text-slate-400">{empty}</div>;
  return (
    <div className="space-y-2">
      {data.slice(0, 12).map((d, i) => (
        <button key={d.label} type="button" onClick={() => onPick(d)} className="block w-full text-left" title="클릭 시 상세 목록">
          <div className="mb-0.5 flex justify-between text-xs"><span className="truncate pr-2">{d.label}</span><span className="font-semibold">{d.value}</span></div>
          <div className={`h-2.5 rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}><div className="h-2.5 rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%`, background: barColor(i) }} /></div>
        </button>
      ))}
    </div>
  );
}
function Columns({ data, onPick }: { data: Segment[]; onPick: (s: Segment) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height: 160 }}>
      {data.map((d) => (
        <button key={d.label} type="button" onClick={() => onPick(d)} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${d.value}`}>
          <span className="text-[0.6rem] font-semibold">{d.value || ""}</span>
          <div className="w-full rounded-t bg-blue-500 transition-all hover:bg-blue-400" style={{ height: `${(d.value / max) * 120}px`, minHeight: d.value ? 3 : 0 }} />
          <span className="text-[0.6rem] text-slate-400">{d.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function ExamDashboardPage({ darkMode, tenantId }: { darkMode: boolean; canEdit?: boolean; tenantId: string; userId?: string; onToast?: (m: string) => void; }) {
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [certs, setCerts] = useState<ExamRow[]>([]);
  const [targets, setTargets] = useState<ExamRow[]>([]);
  const [levels, setLevels] = useState<RefOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<{ year: string; month: string; group: string; product: string; part: string; process: string; level: string }>(
    { year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" }
  );
  const [detail, setDetail] = useState<{ title: string; kind: Kind; rows: ExamRow[] } | null>(null);

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, c, t, lv] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("dm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_annual_targets", tenantId).catch(() => [] as ExamRow[]),
        listExamRefOptions("exam_levels", tenantId).catch(() => [] as RefOpt[]),
      ]);
      setPersonnel(p); setApps(a); setCerts(c); setTargets(t); setLevels(lv);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const levelLabel = useCallback((id: unknown) => (!id ? "-" : (levels.find((o) => o.id === str(id))?.label || "-")), [levels]);

  // 필터 옵션(데이터 합집합).
  const opts = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    const yearOf = (a: ExamRow) => passMonth(a).slice(0, 4) || ymd(a.written_exam_date).slice(0, 4);
    return {
      years: uniq([...apps.map(yearOf), ...targets.map((t) => str(t.year))]),
      groups: uniq([...personnel.map((r) => str(r.group_name)), ...apps.map((r) => str(r.group_name)), ...targets.map((r) => str(r.group_name))]),
      products: uniq([...personnel.map((r) => str(r.product_group)), ...apps.map((r) => str(r.product)), ...targets.map((r) => str(r.product_group))]),
      parts: uniq([...personnel.map((r) => str(r.part_name)), ...targets.map((r) => str(r.part_name))]),
      processes: uniq([...apps.map((r) => str(r.process))]),
      levels: uniq(levels.map((l) => l.label)),
    };
  }, [personnel, apps, targets, levels]);

  // 데이터셋별 필터 적용(해당 필드가 있는 항목만).
  const fPersonnel = useMemo(() => personnel.filter((r) =>
    (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) &&
    (f.part === "전체" || str(r.part_name) === f.part) &&
    (f.level === "전체" || str(r.cert_level) === f.level)
  ), [personnel, f]);
  const fApps = useMemo(() => apps.filter((r) => {
    const ym = passMonth(r) || ymd(r.written_exam_date).slice(0, 7);
    return (f.year === "전체" || ym.slice(0, 4) === f.year) &&
      (f.month === "전체" || ym.slice(5, 7) === f.month) &&
      (f.group === "전체" || str(r.group_name) === f.group) &&
      (f.product === "전체" || str(r.product) === f.product) &&
      (f.process === "전체" || str(r.process) === f.process) &&
      (f.level === "전체" || levelLabel(r.level_id) === f.level);
  }), [apps, f, levelLabel]);
  const fCerts = useMemo(() => certs.filter((r) => {
    const ym = ymd(r.acquired_date).slice(0, 7);
    return (f.year === "전체" || !ym || ym.slice(0, 4) === f.year) && (f.month === "전체" || !ym || ym.slice(5, 7) === f.month);
  }), [certs, f]);
  const fTargets = useMemo(() => targets.filter((r) =>
    (f.year === "전체" || str(r.year) === f.year) &&
    (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) &&
    (f.part === "전체" || str(r.part_name) === f.part) &&
    (f.level === "전체" || levelLabel(r.level_id) === f.level)
  ), [targets, f, levelLabel]);

  const kpi = useMemo(() => {
    const taken = fApps.filter(isTaken);
    const pass = fApps.filter(isPass);
    const fail = fApps.filter(isFail);
    const applicants = new Set(taken.map((a) => str(a.employee_no))).size;
    const flag = (fn: (r: ExamRow) => boolean) => fPersonnel.filter(fn).length;
    const tgt = fTargets.reduce((s, r) => s + num(r.target_count), 0);
    const cur = fTargets.reduce((s, r) => s + num(r.current_count), 0);
    return {
      total: fPersonnel.length,
      active: flag((r) => str(r.employment_status) === "재직" || truthy(r.employment_status) && !/퇴사|퇴직/.test(str(r.employment_status))),
      applicants, pass: pass.length, fail: fail.length,
      passRate: pct(pass.length, taken.length),
      single: flag((r) => truthy(r.single_job)), m1: flag((r) => truthy(r.m1)), m2: flag((r) => truthy(r.m2)),
      m3: flag((r) => truthy(r.m3)), m4: flag((r) => truthy(r.m4)),
      dm: flag((r) => truthy(r.dm)), dual: flag((r) => r.dual_multi === true || truthy(r.dual_multi)),
      master: flag((r) => /master/i.test(str(r.cert_level))),
      annualRate: pct(cur, tgt),
    };
  }, [fApps, fPersonnel, fTargets]);

  // 차트 세그먼트 빌더.
  const groupBy = (rows: ExamRow[], keyFn: (r: ExamRow) => string, kind: Kind): Segment[] => {
    const m = new Map<string, ExamRow[]>();
    rows.forEach((r) => { const k = keyFn(r) || "(미지정)"; (m.get(k) || m.set(k, []).get(k)!).push(r); });
    return Array.from(m.entries()).map(([label, rs]) => ({ label, value: rs.length, rows: rs, kind })).sort((a, b) => b.value - a.value);
  };
  const acquiredApps = useMemo(() => fApps.filter(isAcquired), [fApps]);
  const byPart = useMemo(() => groupBy(fPersonnel.filter((r) => truthy(r.cert_level) || truthy(r.dm) || truthy(r.single_job)), (r) => str(r.part_name), "personnel"), [fPersonnel]);
  const byProcess = useMemo(() => groupBy(acquiredApps, (r) => str(r.process), "application"), [acquiredApps]);
  const byLevel = useMemo(() => groupBy(acquiredApps, (r) => levelLabel(r.level_id), "application"), [acquiredApps, levelLabel]);
  const monthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ m: String(i + 1).padStart(2, "0"), rows: [] as ExamRow[] }));
    fApps.filter(isPass).forEach((a) => { const mm = passMonth(a).slice(5, 7); const slot = arr.find((x) => x.m === mm); if (slot) slot.rows.push(a); });
    return arr.map((x) => ({ label: `${Number(x.m)}월`, value: x.rows.length, rows: x.rows, kind: "application" as Kind }));
  }, [fApps]);
  const targetVsActual = useMemo(() => fTargets.map((t) => ({
    label: [str(t.group_name), str(t.part_name), levelLabel(t.level_id)].filter((s) => s && s !== "-").join("·") || `${str(t.year)}`,
    target: num(t.target_count), actual: num(t.current_count), rate: pct(t.current_count, t.target_count), row: t,
  })).sort((a, b) => a.rate - b.rate).slice(0, 12), [fTargets, levelLabel]);
  const notAcquired = useMemo(() => fApps.filter((a) => isTaken(a) && !isAcquired(a) && !isFail(a)), [fApps]);
  const expiringSoon = useMemo(() => fCerts.filter((r) => { const s = expiryState(r); return s === "만료예정" || s === "만료"; }), [fCerts]);

  // ── UI helpers ──
  const sectionCls = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const selCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";

  const openDetail = (title: string, s: { rows: ExamRow[]; kind: Kind }) => setDetail({ title, kind: s.kind, rows: s.rows });

  const DETAIL_COLS: Record<Kind, Array<[string, (r: ExamRow) => string]>> = {
    personnel: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["그룹", (r) => str(r.group_name)], ["파트", (r) => str(r.part_name)], ["인증Level", (r) => str(r.cert_level)]],
    application: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["공정", (r) => str(r.process)], ["인증단계", (r) => levelLabel(r.level_id)], ["응시상태", (r) => str(r.status) || "-"], ["취득", (r) => (isAcquired(r) ? "취득" : "미취득")]],
    cert: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["D.M단계", (r) => str(r.dm_stage)], ["Level", (r) => str(r.dm_level)], ["취득일", (r) => ymd(r.acquired_date) || "-"], ["만료일", (r) => ymd(r.expiry_date) || "-"], ["상태", (r) => expiryState(r)]],
    target: [["연도", (r) => str(r.year)], ["그룹", (r) => str(r.group_name)], ["파트", (r) => str(r.part_name)], ["레벨", (r) => levelLabel(r.level_id)], ["목표", (r) => str(r.target_count)], ["현재", (r) => str(r.current_count)], ["달성률", (r) => `${pct(r.current_count, r.target_count)}%`]],
  };

  const resetF = () => setF({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" });

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <section className={sectionCls}>
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-lg font-semibold">시험 대시보드</h2><p className="text-sm text-slate-500">인증 현황·목표 대비 실적을 한눈에 확인합니다.</p></div>
          <button type="button" onClick={resetF} className={selCls}>필터 초기화</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ["year", "연도", opts.years], ["month", "월", Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))],
            ["group", "그룹", opts.groups], ["product", "제품군", opts.products], ["part", "파트", opts.parts], ["process", "공정", opts.processes], ["level", "레벨", opts.levels],
          ] as Array<[keyof typeof f, string, string[]]>).map(([key, label, list]) => (
            <select key={key} value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} className={selCls}>
              <option value="전체">{label}: 전체</option>
              {list.map((o) => <option key={o} value={o}>{key === "month" ? `${Number(o)}월` : o}</option>)}
            </select>
          ))}
        </div>
      </section>

      {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="text-xs text-slate-500">불러오는 중…</div>}

      {/* KPI — 응시/합격 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiCard darkMode={darkMode} label="전체 대상자" value={String(kpi.total)} color="slate" onClick={() => openDetail("전체 대상자", { rows: fPersonnel, kind: "personnel" })} />
        <KpiCard darkMode={darkMode} label="재직자" value={String(kpi.active)} color="blue" onClick={() => openDetail("재직자", { rows: fPersonnel.filter((r) => str(r.employment_status) === "재직" || (truthy(r.employment_status) && !/퇴사|퇴직/.test(str(r.employment_status)))), kind: "personnel" })} />
        <KpiCard darkMode={darkMode} label="응시자" value={String(kpi.applicants)} color="indigo" onClick={() => openDetail("응시자", { rows: fApps.filter(isTaken), kind: "application" })} />
        <KpiCard darkMode={darkMode} label="합격자" value={String(kpi.pass)} color="emerald" onClick={() => openDetail("합격자", { rows: fApps.filter(isPass), kind: "application" })} />
        <KpiCard darkMode={darkMode} label="불합격자" value={String(kpi.fail)} color="rose" onClick={() => openDetail("불합격자", { rows: fApps.filter(isFail), kind: "application" })} />
        <KpiCard darkMode={darkMode} label="합격률" value={`${kpi.passRate}%`} color="cyan" />
        <KpiCard darkMode={darkMode} label="연간 목표 달성률" value={`${kpi.annualRate}%`} color="purple" onClick={() => openDetail("연간 목표", { rows: fTargets, kind: "target" })} />
      </div>

      {/* KPI — 레벨 분포 */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {([["Single", "single_job", "blue"], ["M1", "m1", "cyan"], ["M2", "m2", "cyan"], ["M3", "m3", "cyan"], ["M4", "m4", "cyan"], ["D.M", "dm", "amber"], ["Dual Multi", "dual_multi", "purple"], ["Master", "cert_level", "emerald"]] as Array<[string, string, string]>).map(([label, key, color]) => {
          const map: Record<string, number> = { Single: kpi.single, M1: kpi.m1, M2: kpi.m2, M3: kpi.m3, M4: kpi.m4, "D.M": kpi.dm, "Dual Multi": kpi.dual, Master: kpi.master };
          const rowsFor = () => key === "cert_level" ? fPersonnel.filter((r) => /master/i.test(str(r.cert_level))) : key === "dual_multi" ? fPersonnel.filter((r) => r.dual_multi === true || truthy(r.dual_multi)) : fPersonnel.filter((r) => truthy(r[key]));
          return <KpiCard key={label} darkMode={darkMode} label={label} value={String(map[label])} color={color} onClick={() => openDetail(`${label} 보유자`, { rows: rowsFor(), kind: "personnel" })} />;
        })}
      </div>

      {/* 차트 그리드 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">파트별 인증 현황</h3>
          <BarList darkMode={darkMode} data={byPart} onPick={(s) => openDetail(`파트별 인증 · ${s.label}`, s)} empty="인증 보유 인원 데이터가 없습니다." />
        </section>
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">공정별 인증 현황</h3>
          <BarList darkMode={darkMode} data={byProcess} onPick={(s) => openDetail(`공정별 인증 · ${s.label}`, s)} empty="취득 응시 데이터가 없습니다." />
        </section>
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">레벨별 인증 현황</h3>
          <BarList darkMode={darkMode} data={byLevel} onPick={(s) => openDetail(`레벨별 인증 · ${s.label}`, s)} empty="취득 응시 데이터가 없습니다." />
        </section>
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">월별 합격 추이</h3>
          <Columns data={monthly} onPick={(s) => openDetail(`${s.label} 합격자`, s)} />
        </section>
        <section className={sectionCls}>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-semibold">연간 목표 대비 실적</h3><span className="text-xs text-slate-400">달성률 낮은순 · 클릭 시 상세</span></div>
          {targetVsActual.length ? (
            <div className="space-y-2.5">
              {targetVsActual.map((t) => (
                <button key={t.label + t.rate} type="button" onClick={() => openDetail(`연간 목표 · ${t.label}`, { rows: [t.row], kind: "target" })} className="block w-full text-left">
                  <div className="mb-0.5 flex justify-between text-xs"><span className="truncate pr-2">{t.label}</span><span className={`font-semibold ${t.rate >= 100 ? "text-emerald-600" : t.rate >= 80 ? "text-amber-600" : "text-rose-600"}`}>{t.actual}/{t.target} · {t.rate}%</span></div>
                  <div className={`h-2.5 overflow-hidden rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}><div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, t.rate)}%`, background: t.rate >= 100 ? "#10b981" : t.rate >= 80 ? "#f59e0b" : "#ef4444" }} /></div>
                </button>
              ))}
            </div>
          ) : <div className="py-8 text-center text-sm text-slate-400">연간 목표 데이터가 없습니다.</div>}
        </section>
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">미취득 / 만료예정 현황</h3>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => openDetail("미취득 응시자", { rows: notAcquired, kind: "application" })} className={`rounded-2xl border bg-gradient-to-br p-4 text-left hover:shadow-lg ${GRAD.amber} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-80">미취득</div>
              <div className="mt-2 text-3xl font-bold">{notAcquired.length}</div>
              <div className="mt-1 text-xs opacity-70">건 진행 중/대기</div>
            </button>
            <button type="button" onClick={() => openDetail("만료/만료예정 인증", { rows: expiringSoon, kind: "cert" })} className={`rounded-2xl border bg-gradient-to-br p-4 text-left hover:shadow-lg ${GRAD.rose} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-80">만료 / 만료예정</div>
              <div className="mt-2 text-3xl font-bold">{expiringSoon.length}</div>
              <div className="mt-1 text-xs opacity-70">건 (30일 이내 포함)</div>
            </button>
          </div>
        </section>
      </div>

      {/* 상세 목록 모달 */}
      {detail && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetail(null)}>
          <div className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{detail.title} <span className="text-sm font-normal text-slate-500">· {detail.rows.length}건</span></h3>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{DETAIL_COLS[detail.kind].map(([h]) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {detail.rows.map((r, i) => (
                    <tr key={str(r.id) || i} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      {DETAIL_COLS[detail.kind].map(([h, get]) => <td key={h} className="whitespace-nowrap px-2.5 py-2">{get(r) || "-"}</td>)}
                    </tr>
                  ))}
                  {detail.rows.length === 0 && <tr><td colSpan={DETAIL_COLS[detail.kind].length} className="px-3 py-10 text-center text-slate-400">해당 데이터가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
