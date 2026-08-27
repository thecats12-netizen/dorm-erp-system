import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listExamRows, listExamRefOptions, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { computeCertifiedFlagsByPerson } from "../utils/personnelCertSnapshot";
import { computeExamKpiSummary, type GroupRate } from "../services/examAnalyticsKpi";
import { computeCurrentLevelByPersonnel } from "../services/currentCertificationLevelService";
import { selectPmStageLevels } from "../utils/certificationLevel";
import { listEquipmentCertifications } from "../services/equipmentCertificationService";
import { listEquipmentStageRules } from "../services/equipmentStageRuleService";
import { listProcessCriteriaRules } from "../services/processCriteriaRuleService";
import { Donut } from "../components/ExamReportCharts";
import { buildRetestCandidates, summarizeCertExpiry, buildExamNotifications, runRecalculation, type ExamNotification, type RecalcResult, type RecalcScope } from "../services/examAutomationService";
import { listRetestCandidates, generateRetestCandidates, setRetestCandidateStatus, type RetestCandidateRow, type RetestStatus } from "../services/examRetestService";
import { writeAutomationLog, listAutomationLogs, type AutomationLogRow } from "../services/examAutomationLogService";
// [9단계] 라이선스 계획 기반 공통 분석(대시보드·보고서 정본). licensePlanService 재사용(중복 계산식 없음).
import { loadLicenseAnalytics, type LicenseAnalytics } from "../services/examAnalyticsService";
import ExamLicensePlanBoard from "./ExamLicensePlanBoard";
import ExamCandidatePoolBoard from "./ExamCandidatePoolBoard";
import { useRegisteredOverlay } from "../../../hooks/overlayA11y";

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

export default function ExamDashboardPage({ darkMode, canEdit, tenantId, userId, onToast, onNavigate, refreshKey }: { darkMode: boolean; canEdit?: boolean; tenantId: string; userId?: string; onToast?: (m: string) => void; onNavigate?: (tab: string) => void; refreshKey?: number; }) {
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [certs, setCerts] = useState<ExamRow[]>([]);
  const [targets, setTargets] = useState<ExamRow[]>([]);
  const [levels, setLevels] = useState<RefOpt[]>([]);
  const [levelsRaw, setLevelsRaw] = useState<ExamRow[]>([]); // [P2 SoT] code/name/rank_order 포함 원본(공용 인증 스냅샷용)
  const [pmCerts, setPmCerts] = useState<ExamRow[]>([]); // [KPI] 현재 Level 분포(computeCurrentLevelByPersonnel)용 PM 인증
  const [eqCerts, setEqCerts] = useState<ExamRow[]>([]); // [KPI 2차-B] 설비 인증(approved)
  const [eqStageRules, setEqStageRules] = useState<ExamRow[]>([]); // [KPI 2차-B] 설비별 인증단계 규칙(대상 설비)
  const [achieveRules, setAchieveRules] = useState<ExamRow[]>([]); // [KPI 2차-B] 공정별 달성기준(조기/정상/지연 criteria)
  const [rules, setRules] = useState<ExamRow[]>([]);
  const [retest, setRetest] = useState<RetestCandidateRow[]>([]);
  const [retestOpen, setRetestOpen] = useState(false);
  const [retestBusy, setRetestBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<{ year: string; month: string; group: string; product: string; part: string; process: string; level: string }>(
    { year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" }
  );
  const [detail, setDetail] = useState<{ title: string; kind: Kind; rows: ExamRow[] } | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [notiOpen, setNotiOpen] = useState(false);
  const [licAnalytics, setLicAnalytics] = useState<LicenseAnalytics | null>(null); // [9단계] 라이선스 계획 통계/자동화 오류
  const [issuesOpen, setIssuesOpen] = useState(false);
  // 상세 목록 모달을 앱 공통 닫기 시스템에 등록(ESC·뒤로가기로 닫기).
  useRegisteredOverlay(!!detail, () => setDetail(null));
  useRegisteredOverlay(retestOpen, () => setRetestOpen(false));
  useRegisteredOverlay(notiOpen, () => setNotiOpen(false));
  useRegisteredOverlay(issuesOpen, () => setIssuesOpen(false));

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, c, t, lv, ru, rc, lvRaw, pmc, eqc, esr, acr] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("dm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_annual_targets", tenantId).catch(() => [] as ExamRow[]),
        listExamRefOptions("exam_levels", tenantId).catch(() => [] as RefOpt[]),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
        listRetestCandidates(tenantId).catch(() => [] as RetestCandidateRow[]),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("pm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listEquipmentCertifications(tenantId).catch(() => [] as ExamRow[]),
        listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),
        listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPersonnel(p); setApps(a); setCerts(c); setTargets(t); setLevels(lv); setRules(ru); setRetest(rc); setLevelsRaw(lvRaw); setPmCerts(pmc);
      setEqCerts(eqc); setEqStageRules(esr); setAchieveRules(acr);
      // [9단계] 라이선스 계획 통계/자동화 오류(공통 정본). 계획 테이블 미적용 환경에서도 안전(빈 결과).
      try { setLicAnalytics(await loadLicenseAnalytics(tenantId, p)); } catch { /* 무시 */ }
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refreshKey]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  // 재시험 후보: 활성(후보/승인) 건수, 자동생성/상태 전환.
  const retestActive = useMemo(() => retest.filter((r) => ["후보", "승인"].includes(str(r.status))), [retest]);
  const reloadRetest = useCallback(async () => { try { setRetest(await listRetestCandidates(tenantId)); } catch { /* noop */ } }, [tenantId]);
  const generateRetest = useCallback(async () => {
    if (!canEdit) return;
    setRetestBusy(true);
    try {
      const specs = buildRetestCandidates(apps, certs, rules, (id) => levels.find((o) => o.id === id)?.label || id);
      const res = await generateRetestCandidates(tenantId, userId || "", specs);
      onToast?.(`재시험 후보 자동생성: 신규 ${res.created}건 · 중복 제외 ${res.skipped}건`);
      void writeAutomationLog(tenantId, userId || "", { runType: "재시험 후보 자동생성", module: "재시험", total: specs.length, success: res.created, failed: 0, needCheck: 0, reasons: [`신규 ${res.created} · 중복 제외 ${res.skipped}`] });
      await reloadRetest();
    } catch (e) { setError((e as { message?: string })?.message || "후보 생성 실패."); }
    finally { setRetestBusy(false); }
  }, [canEdit, apps, certs, rules, levels, tenantId, userId, onToast, reloadRetest]);
  const changeRetest = useCallback(async (id: string, status: RetestStatus) => {
    if (!canEdit) return;
    try { await setRetestCandidateStatus(id, status, userId || ""); onToast?.(`재시험 후보 상태: ${status}`); await reloadRetest(); }
    catch (e) { setError((e as { message?: string })?.message || "상태 변경 실패."); }
  }, [canEdit, userId, onToast, reloadRetest]);

  // 앱 내 알림(파생 · 중복 방지). 클릭 시 해당 시험관리 탭으로 이동.
  const notifications = useMemo<ExamNotification[]>(() => buildExamNotifications({
    applications: apps, dmCertifications: certs, annualTargets: targets, retestCandidates: retest, rules,
  }), [apps, certs, targets, retest, rules]);
  const openNotification = useCallback((n: ExamNotification) => {
    setNotiOpen(false);
    if (n.targetTab === "examDashboard") { setRetestOpen(true); return; } // 재시험 필요 → 본 대시보드의 재시험 후보 모달
    onNavigate?.(n.targetTab);
  }, [onNavigate]);

  // 관리자 재계산/검증(파생 계산 재실행). 화면 진입만으로 실행하지 않음(버튼 클릭 시에만).
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [rcEmp, setRcEmp] = useState("");
  const [rcPart, setRcPart] = useState("");
  const [rcYear, setRcYear] = useState(String(new Date().getFullYear()));
  const [rcMonth, setRcMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  useRegisteredOverlay(recalcOpen, () => setRecalcOpen(false));
  useRegisteredOverlay(confirmAll, () => setConfirmAll(false));

  const runRecalc = useCallback((scope: RecalcScope) => {
    if (!canEdit || recalcBusy) return; // 중복 실행 방지
    setRecalcBusy(true);
    try {
      const res = runRecalculation({ applications: apps, dmCertifications: certs, rules }, scope, { ranBy: userId || "관리자" });
      setRecalcResult(res);
      onToast?.(`${res.scopeLabel}: 대상 ${res.total} · 성공 ${res.success} · 실패 ${res.failed} · 확인 필요 ${res.needCheck}`);
      // 자동화 이력 저장(개인정보 제외 — 집계 건수 + 오류 메시지만).
      void writeAutomationLog(tenantId, userId || "", {
        runType: res.scopeLabel, module: scope.kind === "month" ? "월간실적" : "재계산/검증",
        total: res.total, success: res.success, failed: res.failed, needCheck: res.needCheck,
        errors: res.items.filter((i) => i.status === "실패").map((i) => i.detail),
      });
    } catch (e) { setError((e as { message?: string })?.message || "재계산 실패."); }
    finally { setRecalcBusy(false); }
  }, [canEdit, recalcBusy, apps, certs, rules, userId, onToast, tenantId]);
  const empOptions = useMemo(() => Array.from(new Set(apps.concat(certs).map((r) => str(r.employee_no)).filter(Boolean))).sort(), [apps, certs]);
  const partOptions = useMemo(() => Array.from(new Set(apps.map((r) => str(r.part_name) || str(r.process)).filter(Boolean))).sort(), [apps]);

  // 자동화 작업 이력(exam_audit_logs 재사용).
  const [histOpen, setHistOpen] = useState(false);
  const [histLogs, setHistLogs] = useState<AutomationLogRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [hf, setHf] = useState({ from: "", to: "", type: "전체", user: "전체", result: "전체", module: "전체" });
  useRegisteredOverlay(histOpen, () => setHistOpen(false));
  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try { setHistLogs(await listAutomationLogs(tenantId)); } catch (e) { setError((e as { message?: string })?.message || "이력 불러오기 실패."); }
    finally { setHistLoading(false); }
  }, [tenantId]);
  const openHistory = useCallback(() => { setHistOpen(true); void loadHistory(); }, [loadHistory]);
  const histOpts = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    return {
      types: uniq(histLogs.map((l) => str(l.action_type))),
      users: uniq(histLogs.map((l) => str(l.changed_by))),
      modules: uniq(histLogs.map((l) => str(l.target_id))),
    };
  }, [histLogs]);
  const histFiltered = useMemo(() => histLogs.filter((l) => {
    const d = str(l.created_at).slice(0, 10);
    if (hf.from && d < hf.from) return false;
    if (hf.to && d > hf.to) return false;
    if (hf.type !== "전체" && str(l.action_type) !== hf.type) return false;
    if (hf.user !== "전체" && str(l.changed_by) !== hf.user) return false;
    if (hf.module !== "전체" && str(l.target_id) !== hf.module) return false;
    if (hf.result !== "전체") {
      const failed = num((l.after_value as { failed?: number } | null)?.failed);
      if (hf.result === "실패" ? failed <= 0 : failed > 0) return false;
    }
    return true;
  }), [histLogs, hf]);

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
  // [P2 SoT] Single~M4/인증Level/D.M/Dual 을 보고서와 동일 공용 계산으로 통일(실제 취득 · 승인 dm_certifications). 표시/집계 전용.
  const personnelComputed = useMemo(
    () => computeCertifiedFlagsByPerson({ personnel, applications: apps, levels: levelsRaw, dmCertifications: certs }),
    [personnel, apps, levelsRaw, certs],
  );
  const fPersonnel = useMemo(() => personnelComputed.filter((r) =>
    (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) &&
    (f.part === "전체" || str(r.part_name) === f.part) &&
    (f.level === "전체" || str(r.cert_level) === f.level)
  ), [personnelComputed, f]);
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
  const byProduct = useMemo(() => groupBy(fPersonnel.filter((r) => truthy(r.cert_level) || truthy(r.dm) || truthy(r.single_job)), (r) => str(r.product_group), "personnel"), [fPersonnel]);
  const byPart = useMemo(() => groupBy(fPersonnel.filter((r) => truthy(r.cert_level) || truthy(r.dm) || truthy(r.single_job)), (r) => str(r.part_name), "personnel"), [fPersonnel]);

  // [KPI 1차] 공용 순수 집계(examAnalyticsKpi) — 현재 필터 인원 기준 canonical 지표. 페이지 내 계산식 중복 없음.
  const kpiSummary = useMemo(() => computeExamKpiSummary({
    personnel: fPersonnel, applications: apps, levels: levelsRaw,
    pmCertifications: pmCerts, dmCertifications: certs, retestCandidates: retest,
    monthlyApplications: fApps, // 월별 추세: 기간+scope 필터 적용된 응시
    equipmentCertifications: eqCerts, equipmentStageRules: eqStageRules, criteriaRules: achieveRules,
  }), [fPersonnel, apps, levelsRaw, pmCerts, certs, retest, fApps, eqCerts, eqStageRules, achieveRules]);
  // 월별 추세(응시/합격/취득 · 건수) — 기존 Columns 재사용(3개 미니 차트).
  const monthlyApplied = useMemo(() => kpiSummary.monthlyTrend.map((m) => ({ label: m.label, value: m.applied, rows: [] as ExamRow[], kind: "application" as Kind })), [kpiSummary]);
  const monthlyPassed = useMemo(() => kpiSummary.monthlyTrend.map((m) => ({ label: m.label, value: m.passed, rows: [] as ExamRow[], kind: "application" as Kind })), [kpiSummary]);
  const monthlyAcquired = useMemo(() => kpiSummary.monthlyTrend.map((m) => ({ label: m.label, value: m.acquired, rows: [] as ExamRow[], kind: "application" as Kind })), [kpiSummary]);
  // 현재 Level 배타 분포 drill-down 용(rows). 카운트는 위 kpiSummary 와 동일 정의.
  const levelByPerson = useMemo(() => computeCurrentLevelByPersonnel({
    personnel: fPersonnel, levels: levelsRaw, applications: apps, pmCertifications: pmCerts,
  }), [fPersonnel, levelsRaw, apps, pmCerts]);
  const levelSegments = useMemo((): Segment[] => {
    const stageNames = selectPmStageLevels(levelsRaw).map((l) => str(l.name) || str(l.code));
    const buckets: Array<{ label: string; rows: ExamRow[] }> = [{ label: "미취득", rows: [] }, ...stageNames.map((n) => ({ label: n, rows: [] as ExamRow[] }))];
    for (const p of fPersonnel) { const r = levelByPerson.get(str(p.id)); const idx = r ? r.currentLevelIndex : -1; const bi = idx < 0 ? 0 : Math.min(idx + 1, buckets.length - 1); buckets[bi].rows.push(p); }
    return buckets.map((b) => ({ label: b.label, value: b.rows.length, rows: b.rows, kind: "personnel" as Kind }));
  }, [fPersonnel, levelByPerson, levelsRaw]);
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
  // 인증 만료/갱신 자동판정 상태별 요약(취득일 + exam_rules 유효기간 기준).
  const certExpiry = useMemo(() => summarizeCertExpiry(fCerts, rules), [fCerts, rules]);
  const needRenewalCount = useMemo(() => (certExpiry["만료"] || 0) + (certExpiry["만료 30일 전"] || 0), [certExpiry]);

  // ── UI helpers ──
  const sectionCls = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const rateList = (rows: GroupRate[]) => rows.length === 0
    ? <p className="text-xs text-slate-400">데이터가 없습니다.</p>
    : (<ul className="space-y-1.5">{rows.map((g) => (
        <li key={g.key} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 truncate sm:w-28" title={g.label}>{g.label}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, g.rate)}%` }} /></span>
          <span className="w-20 shrink-0 text-right text-xs text-slate-500 sm:w-24">{g.acquired}/{g.headcount} · {g.rate}%</span>
        </li>))}</ul>);
  const selCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";

  const openDetail = (title: string, s: { rows: ExamRow[]; kind: Kind }) => { setDetailSearch(""); setDetail({ title, kind: s.kind, rows: s.rows }); };

  const DETAIL_COLS: Record<Kind, Array<[string, (r: ExamRow) => string]>> = {
    personnel: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["그룹", (r) => str(r.group_name)], ["파트", (r) => str(r.part_name)], ["인증Level", (r) => str(r.cert_level)]],
    application: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["공정", (r) => str(r.process)], ["인증단계", (r) => levelLabel(r.level_id)], ["응시상태", (r) => str(r.status) || "-"], ["취득", (r) => (isAcquired(r) ? "취득" : "미취득")]],
    cert: [["사번", (r) => str(r.employee_no)], ["성명", (r) => str(r.name)], ["D.M단계", (r) => str(r.dm_stage)], ["Level", (r) => str(r.dm_level)], ["취득일", (r) => ymd(r.acquired_date) || "-"], ["만료일", (r) => ymd(r.expiry_date) || "-"], ["상태", (r) => expiryState(r)]],
    target: [["연도", (r) => str(r.year)], ["그룹", (r) => str(r.group_name)], ["파트", (r) => str(r.part_name)], ["레벨", (r) => levelLabel(r.level_id)], ["목표", (r) => str(r.target_count)], ["현재", (r) => str(r.current_count)], ["달성률", (r) => `${pct(r.current_count, r.target_count)}%`]],
  };

  // 상세 목록: 검색어(전 컬럼 텍스트 · 대소문자·공백 무시)로 필터. 표시·다운로드 모두 이 결과를 사용(건수 정합).
  const filteredDetailRows = useMemo(() => {
    if (!detail) return [] as ExamRow[];
    const q = detailSearch.trim().toLowerCase();
    if (!q) return detail.rows;
    const cols = DETAIL_COLS[detail.kind];
    return detail.rows.filter((r) => cols.map(([, get]) => get(r)).join(" ").toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, detailSearch]);

  // 파일명 안전화(경로/특수문자 제거). 예: 시험대시보드_응시예정_2026-07-25
  const safeName = (title: string) => `시험대시보드_${String(title).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "").slice(0, 40)}_${new Date().toISOString().slice(0, 10)}`;
  const exportDetail = (format: "xlsx" | "csv") => {
    if (!detail) return;
    const cols = DETAIL_COLS[detail.kind];
    const rows = filteredDetailRows;
    const fname = safeName(detail.title);
    if (format === "csv") {
      const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [cols.map(([h]) => esc(h)).join(",")]
        .concat(rows.map((r) => cols.map(([, get]) => esc(get(r) || "")).join(",")))
        .join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${fname}.csv`; a.click(); URL.revokeObjectURL(url);
      return;
    }
    // 실제 .xlsx(SheetJS). 문자열 셀 유지 → 사번 앞자리 0 보존·지수표기 방지.
    const data = rows.map((r) => Object.fromEntries(cols.map(([h, get]) => [h, get(r) ?? ""])));
    const ws = XLSX.utils.json_to_sheet(data, { header: cols.map(([h]) => h) });
    ws["!cols"] = cols.map(([h]) => ({ wch: Math.max(10, Math.min(40, h.length * 2 + 4)) }));
    if (rows.length > 0) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: cols.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "상세");
    // 시트 2: 다운로드 조건(통계 기준·검색어·일시).
    const meta = [
      ["통계명", detail.title], ["기준일", new Date().toISOString().slice(0, 10)],
      ["전체 건수", String(detail.rows.length)], ["다운로드 건수", String(rows.length)],
      ["검색어", detailSearch.trim() || "(없음)"], ["다운로드 일시", new Date().toISOString().slice(0, 19).replace("T", " ")],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "다운로드 조건");
    XLSX.writeFile(wb, `${fname}.xlsx`);
  };

  const resetF = () => setF({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", level: "전체" });

  return (
    <div className="space-y-6">
      {/* 필터 */}
      <section className={sectionCls}>
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="text-lg font-semibold">시험 대시보드</h2><p className="text-sm text-slate-500">인증 현황·목표 대비 실적을 한눈에 확인합니다.</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setNotiOpen(true)} aria-label={`알림 ${notifications.length}건`} className={`relative rounded-xl border px-3 py-1.5 text-sm ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>
              🔔 알림
              {notifications.length > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[0.6rem] font-bold text-white">{notifications.length > 99 ? "99+" : notifications.length}</span>}
            </button>
            {canEdit && <button type="button" onClick={() => setRecalcOpen(true)} className={`rounded-xl border px-3 py-1.5 text-sm ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>🔄 재계산</button>}
            <button type="button" onClick={openHistory} className={`rounded-xl border px-3 py-1.5 text-sm ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>📜 자동화 이력</button>
            <button type="button" onClick={resetF} className={selCls}>필터 초기화</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ["year", "연도", opts.years], ["month", "월", Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))],
            // [Line 전환] 보고서 필터에서 제품/파트 드롭다운 제거(f.part 는 기본 "전체" 유지 → 집계/합계 불변, part_name 컬럼·데이터는 보존).
            ["group", "그룹", opts.groups], ["product", "제품군", opts.products], ["process", "공정", opts.processes], ["level", "레벨", opts.levels],
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

      {/* 재시험 후보(자동 후보 → 관리자 검토 → 승인 → 실제 재시험 신청) */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRetestOpen(true)} className={`rounded-3xl border bg-gradient-to-br p-3 text-left transition-shadow hover:shadow-lg ${GRAD.rose} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide opacity-80">재시험 후보</div>
          <div className="mt-1.5 text-2xl font-bold">{retestActive.length}</div>
        </button>
        <span className="text-xs text-slate-500">자동 후보 → 관리자 검토 → 승인 → 실제 재시험 신청 (승인 전 실제 신청 없음)</span>
      </div>

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

      {/* 단계별 인증 보유 현황(중복 집계 · 한 사람이 여러 단계 보유 가능) — 현재 Level 배타 분포와 구분 */}
      <div className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">단계별 인증 보유 현황 (중복 집계)</div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {([["Single", "single_job", "blue"], ["M1", "m1", "cyan"], ["M2", "m2", "cyan"], ["M3", "m3", "cyan"], ["M4", "m4", "cyan"], ["D.M", "dm", "amber"], ["Dual Multi", "dual_multi", "purple"], ["Master", "cert_level", "emerald"]] as Array<[string, string, string]>).map(([label, key, color]) => {
          const map: Record<string, number> = { Single: kpi.single, M1: kpi.m1, M2: kpi.m2, M3: kpi.m3, M4: kpi.m4, "D.M": kpi.dm, "Dual Multi": kpi.dual, Master: kpi.master };
          const rowsFor = () => key === "cert_level" ? fPersonnel.filter((r) => /master/i.test(str(r.cert_level))) : key === "dual_multi" ? fPersonnel.filter((r) => r.dual_multi === true || truthy(r.dual_multi)) : fPersonnel.filter((r) => truthy(r[key]));
          return <KpiCard key={label} darkMode={darkMode} label={label} value={String(map[label])} color={color} onClick={() => openDetail(`${label} 보유자`, { rows: rowsFor(), kind: "personnel" })} />;
        })}
      </div>

      {/* [KPI 1차] 인증 취득 요약 — 현재 필터 인원 기준 canonical(실제 취득 · 승인 D.M) */}
      <section className={sectionCls}>
        <div className="mb-3"><h3 className="text-base font-semibold">인증 취득 요약</h3><p className="text-sm text-slate-500">현재 필터 인원 기준 · 실제 취득(exam_applications) / 승인 D.M(dm_certifications).</p></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard darkMode={darkMode} label="전체 인원" value={`${kpiSummary.headcount}명`} color="slate" onClick={() => openDetail("전체 인원", { rows: fPersonnel, kind: "personnel" })} />
          <KpiCard darkMode={darkMode} label="응시 인원" value={`${kpiSummary.appliedCount}명 · ${kpiSummary.appliedRate}%`} color="indigo" />
          <KpiCard darkMode={darkMode} label="인증 취득" value={`${kpiSummary.acquiredCount}명 · ${kpiSummary.acquiredRate}%`} color="emerald" />
          <KpiCard darkMode={darkMode} label="재시험 대상" value={`${kpiSummary.retestCount}명`} color="amber" onClick={() => setRetestOpen(true)} />
          <KpiCard darkMode={darkMode} label="D.M 인증" value={`${kpiSummary.dmCount}명`} color="purple" />
          <KpiCard darkMode={darkMode} label="Dual" value={`${kpiSummary.dualCount}명`} color="purple" />
        </div>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold">현재 Level 분포 <span className="font-normal text-slate-400">(배타 · 인원당 1단계)</span></h4>
            <BarList darkMode={darkMode} data={levelSegments} onPick={(s) => openDetail(`현재 Level · ${s.label}`, s)} empty="인원 데이터가 없습니다." />
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">그룹별 인증률</h4>
            {kpiSummary.groupRates.length === 0 ? <p className="text-xs text-slate-400">데이터가 없습니다.</p> : (
              <ul className="space-y-1.5">
                {kpiSummary.groupRates.map((g) => (
                  <li key={g.key} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 truncate sm:w-28" title={g.label}>{g.label}</span>
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, g.rate)}%` }} /></span>
                    <span className="w-20 shrink-0 text-right text-xs text-slate-500 sm:w-24">{g.acquired}/{g.headcount} · {g.rate}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* [KPI 2차-A] 시험 성과 — 필기/실기 합격률(현재 필터 인원 기준 · 사번 distinct) */}
      <section className={sectionCls}>
        <div className="mb-3"><h3 className="text-base font-semibold">시험 성과</h3><p className="text-sm text-slate-500">필기/실기 합격률 · 응시(분모) 대비 합격(분자) · 사번 distinct.</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard darkMode={darkMode} label="필기 합격" value={`${kpiSummary.writtenPassCount}명 · ${kpiSummary.writtenPassRate}%`} color="cyan" />
          <KpiCard darkMode={darkMode} label="실기 합격" value={`${kpiSummary.practicalPassCount}명 · ${kpiSummary.practicalPassRate}%`} color="blue" />
        </div>
      </section>

      {/* [KPI 2차-A] 조직별 인증 현황 — 공정별(process_id)/제품군별(category_id) 인증률 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">공정별 인증률</h3>
          {rateList(kpiSummary.processRates)}
        </section>
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">제품군별 인증률</h3>
          {rateList(kpiSummary.categoryRates)}
        </section>
      </div>

      {/* [KPI 2차-A] 시험 추세 — 월별 응시/합격/취득(건수 · 기간+scope 필터) */}
      <section className={sectionCls}>
        <div className="mb-3"><h3 className="text-base font-semibold">시험 추세 (월별 · 건수)</h3><p className="text-sm text-slate-500">응시(필기시험일) / 합격(합격일) / 취득(취득일) · 이벤트 건수 기준.</p></div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="overflow-x-auto"><h4 className="mb-2 text-sm font-semibold text-indigo-500">응시</h4><Columns data={monthlyApplied} onPick={() => {}} /></div>
          <div className="overflow-x-auto"><h4 className="mb-2 text-sm font-semibold text-emerald-500">합격</h4><Columns data={monthlyPassed} onPick={() => {}} /></div>
          <div className="overflow-x-auto"><h4 className="mb-2 text-sm font-semibold text-amber-500">취득</h4><Columns data={monthlyAcquired} onPick={() => {}} /></div>
        </div>
      </section>

      {/* [KPI 2차-B] 설비 인증 / 취득 속도 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={sectionCls}>
          <div className="mb-3"><h3 className="text-base font-semibold">설비 인증 현황</h3><p className="text-sm text-slate-500">대상 설비 보유 인원 기준 · distinct 설비(직원별) 취득률.</p></div>
          <div className="flex flex-wrap items-center gap-6">
            <Donut darkMode={darkMode} items={[
              { label: "취득", value: kpiSummary.equipmentSummary.acquiredEquipmentCount, color: "#10b981" },
              { label: "미취득", value: Math.max(0, kpiSummary.equipmentSummary.targetEquipmentCount - kpiSummary.equipmentSummary.acquiredEquipmentCount), color: "#e2e8f0" },
            ]} />
            <div className="space-y-1 text-sm">
              <div><span className="text-slate-500">설비 인증률 </span><span className="text-lg font-semibold">{kpiSummary.equipmentSummary.rate == null ? "-" : `${kpiSummary.equipmentSummary.rate}%`}</span></div>
              <div className="text-slate-500">설비 미취득 <span className="font-semibold text-rose-500">{kpiSummary.equipmentSummary.missingPersons}명</span> / 대상 {kpiSummary.equipmentSummary.targetPersons}명</div>
              <div className="text-xs text-slate-400">취득 {kpiSummary.equipmentSummary.acquiredEquipmentCount} / 대상 {kpiSummary.equipmentSummary.targetEquipmentCount} 설비</div>
            </div>
          </div>
        </section>
        <section className={sectionCls}>
          <div className="mb-3"><h3 className="text-base font-semibold">취득 속도 분석</h3><p className="text-sm text-slate-500">공정별 달성기준 기준 조기/정상/지연 · 판정불가 제외한 평균 취득기간.</p></div>
          <div className="flex flex-wrap items-center gap-6">
            <Donut darkMode={darkMode} items={[
              { label: "조기", value: kpiSummary.timingDistribution.early, color: "#38bdf8" },
              { label: "정상", value: kpiSummary.timingDistribution.onTime, color: "#10b981" },
              { label: "지연", value: kpiSummary.timingDistribution.late, color: "#f59e0b" },
              { label: "판정불가", value: kpiSummary.timingDistribution.undetermined, color: "#e2e8f0" },
            ]} />
            <div className="space-y-1 text-sm">
              <div><span className="text-slate-500">평균 취득기간 </span><span className="text-lg font-semibold">{kpiSummary.avgAcquireMonths == null ? "-" : `${kpiSummary.avgAcquireMonths}개월`}</span></div>
              <div className="text-slate-500">조기 {kpiSummary.timingDistribution.early} · 정상 {kpiSummary.timingDistribution.onTime} · 지연 {kpiSummary.timingDistribution.late}</div>
              <div className="text-xs text-slate-400">판정불가 {kpiSummary.timingDistribution.undetermined}(정상/지연에 미포함)</div>
            </div>
          </div>
        </section>
      </div>

      {/* [9단계] 라이선스 자동화 현황 — employee_license_plan 기준(대시보드·보고서 공통 정본) */}
      {licAnalytics && (
        <section className={sectionCls}>
          <div className="mb-3 flex items-center justify-between">
            <div><h3 className="text-base font-semibold">라이선스 자동화 현황</h3><p className="text-sm text-slate-500">라이선스 계획(단계별 진행) 집계 · 자동화 오류/확인필요를 함께 표시합니다.</p></div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <KpiCard darkMode={darkMode} label="전체 계획" value={String(licAnalytics.total)} color="slate" />
            <KpiCard darkMode={darkMode} label="진행중" value={String(licAnalytics.summary.active)} color="blue" />
            <KpiCard darkMode={darkMode} label="대기" value={String(licAnalytics.summary.waiting)} color="slate" />
            <KpiCard darkMode={darkMode} label="완료" value={String(licAnalytics.summary.completed)} color="emerald" />
            <KpiCard darkMode={darkMode} label="1개월 이내" value={String(licAnalytics.summary.within1m)} color="amber" />
            <KpiCard darkMode={darkMode} label="기한 초과" value={String(licAnalytics.summary.overdue)} color="rose" />
            <KpiCard darkMode={darkMode} label="자동화 확인 필요" value={String(licAnalytics.issues.length)} color="rose" onClick={licAnalytics.issues.length ? () => setIssuesOpen(true) : undefined} />
          </div>
          {licAnalytics.total === 0 && <p className="mt-3 text-xs text-slate-400">라이선스 계획 데이터가 없습니다. (마이그레이션 적용 후 인력 등록 시 자동 생성됩니다.)</p>}
        </section>
      )}

      {/* 차트 그리드 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={sectionCls}>
          <h3 className="mb-3 text-base font-semibold">제품군별 인증 현황</h3>
          <BarList darkMode={darkMode} data={byProduct} onPick={(s) => openDetail(`제품군별 인증 · ${s.label}`, s)} empty="인증 보유 인원 데이터가 없습니다." />
        </section>
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
          {/* 인증 만료·갱신 자동판정 상태별 현황(취득일 + exam_rules 유효기간 기준) */}
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-slate-500">인증 만료 현황 <span className="font-normal text-slate-400">(갱신 필요 {needRenewalCount}건)</span></div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {([["정상", "bg-emerald-100 text-emerald-700"], ["만료 90일 전", "bg-yellow-100 text-yellow-700"], ["만료 30일 전", "bg-amber-100 text-amber-700"], ["만료", "bg-rose-100 text-rose-700"], ["갱신완료", "bg-blue-100 text-blue-700"]] as const).map(([k, tone]) => (
                <span key={k} className={`rounded-lg px-2 py-1 font-medium ${tone}`}>{k} {certExpiry[k] || 0}</span>
              ))}
            </div>
          </div>
        </section>

        {/* 라이선스 계획(직원별) — 신규 라우팅/메뉴 없이 대시보드 하위 섹션으로 임베드 */}
        <ExamLicensePlanBoard darkMode={darkMode} canEdit={!!canEdit} tenantId={tenantId} userId={userId} onToast={onToast} />
        {/* 응시 후보관리(Candidate Pool) — 라이선스 계획 기반 자동 선별 */}
        <ExamCandidatePoolBoard darkMode={darkMode} canEdit={!!canEdit} tenantId={tenantId} userId={userId} onToast={onToast} />
      </div>

      {/* 상세 목록 모달 */}
      {detail && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-dash-detail-title" tabIndex={-1} className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 id="exam-dash-detail-title" className="text-lg font-semibold">{detail.title}
                <span className="text-sm font-normal text-slate-500"> · {detailSearch.trim() ? `${filteredDetailRows.length} / ${detail.rows.length}` : detail.rows.length}건</span>
                <span className="ml-2 text-xs font-normal text-slate-400">기준일 {new Date().toISOString().slice(0, 10)}</span>
              </h3>
              <div className="flex items-center gap-1.5">
                {/* 실제 .xlsx(SheetJS) 다운로드 · CSV 는 별도 버튼. 화면과 동일한 검색/컬럼 기준(필터 결과 전체). */}
                <button type="button" disabled={filteredDetailRows.length === 0} onClick={() => exportDetail("xlsx")}
                  className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${filteredDetailRows.length === 0 ? "cursor-not-allowed bg-slate-300" : "bg-emerald-600 hover:bg-emerald-500"}`}>Excel</button>
                <button type="button" disabled={filteredDetailRows.length === 0} onClick={() => exportDetail("csv")}
                  className={`inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium ${filteredDetailRows.length === 0 ? "cursor-not-allowed text-slate-300 dark:border-slate-700" : "text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}>CSV</button>
                <button type="button" aria-label="닫기" onClick={() => setDetail(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
              </div>
            </div>
            <div className="mb-2">
              <input value={detailSearch} onChange={(e) => setDetailSearch(e.target.value)} placeholder="사번·성명·공정·상태 등 검색"
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${darkMode ? "border-slate-600 bg-slate-950 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`} />
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{DETAIL_COLS[detail.kind].map(([h]) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredDetailRows.map((r, i) => (
                    <tr key={str(r.id) || i} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      {DETAIL_COLS[detail.kind].map(([h, get]) => <td key={h} className="whitespace-nowrap px-2.5 py-2">{get(r) || "-"}</td>)}
                    </tr>
                  ))}
                  {filteredDetailRows.length === 0 && <tr><td colSpan={DETAIL_COLS[detail.kind].length} className="px-3 py-10 text-center text-slate-400">{detail.rows.length === 0 ? "해당 데이터가 없습니다." : "검색 조건에 맞는 데이터가 없습니다."}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* [9단계] 자동화 확인 필요 목록 모달 */}
      {issuesOpen && licAnalytics && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setIssuesOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="issues-title" tabIndex={-1} className={`my-8 w-full max-w-3xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><h3 id="issues-title" className="text-lg font-semibold">자동화 확인 필요 <span className="text-sm font-normal text-slate-500">· {licAnalytics.issues.length}건</span></h3><p className="text-sm text-slate-500">라이선스 계획 자동화 점검 결과입니다. 재처리는 인력/인증 화면에서 수정·재저장으로 반영됩니다.</p></div>
              <button type="button" aria-label="닫기" onClick={() => setIssuesOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{["사번", "성명", "유형", "단계", "원인"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {licAnalytics.issues.map((it, i) => (
                    <tr key={`${it.employeeId}-${it.type}-${i}`} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.employeeNo || "-"}</td>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.name || "-"}</td>
                      <td className="whitespace-nowrap px-2.5 py-2"><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{it.type}</span></td>
                      <td className="whitespace-nowrap px-2.5 py-2">{it.stage || "-"}</td>
                      <td className="px-2.5 py-2">{it.detail}</td>
                    </tr>
                  ))}
                  {licAnalytics.issues.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">확인이 필요한 항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 재시험 후보 목록 모달 */}
      {retestOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setRetestOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="retest-title" tabIndex={-1} className={`my-8 w-full max-w-4xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 id="retest-title" className="text-lg font-semibold">재시험 후보 <span className="text-sm font-normal text-slate-500">· 활성 {retestActive.length}건 / 전체 {retest.length}건</span></h3>
                <p className="text-sm text-slate-500">자동 후보 → 관리자 검토 → 승인 → 실제 재시험 신청. 승인 전에는 실제 시험회차에 등록되지 않습니다.</p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && <button type="button" disabled={retestBusy} onClick={() => void generateRetest()} className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${retestBusy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{retestBusy ? "생성 중…" : "후보 자동생성"}</button>}
                <button type="button" aria-label="닫기" onClick={() => setRetestOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{["직원", "인증단계", "사유", "발생일", "상태", "승인자", "작업"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {retest.map((r) => {
                    const st = str(r.status) || "후보";
                    const tone = st === "승인" ? "bg-emerald-100 text-emerald-700" : st === "반려" ? "bg-rose-100 text-rose-700" : st === "신청" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500";
                    return (
                      <tr key={str(r.id)} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(r.name) || "-"} <span className="text-slate-400">{str(r.employee_no)}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(r.level_label) || str(r.level_id) || "-"}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(r.reason) || "-"}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{ymd(r.occurred_date) || "-"}</td>
                        <td className="whitespace-nowrap px-2.5 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{st}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(r.approved_at) ? String(r.approved_at).slice(0, 10) : "-"}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">
                          {canEdit ? (
                            <>
                              {st === "후보" && <><button className="text-emerald-600 hover:underline" onClick={() => void changeRetest(str(r.id), "승인")}>승인</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={() => void changeRetest(str(r.id), "반려")}>반려</button></>}
                              {st === "승인" && <button className="text-blue-600 hover:underline" onClick={() => void changeRetest(str(r.id), "신청")}>실제 재시험 신청</button>}
                              {(st === "반려" || st === "신청") && <span className="text-slate-400">-</span>}
                            </>
                          ) : <span className="text-slate-400">조회</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {retest.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">재시험 후보가 없습니다. {canEdit ? "‘후보 자동생성’으로 생성하세요." : ""}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 알림 목록 모달 — 클릭 시 해당 시험관리 상세 화면으로 이동 */}
      {notiOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setNotiOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="noti-title" tabIndex={-1} className={`my-8 w-full max-w-lg rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 id="noti-title" className="text-lg font-semibold">알림 <span className="text-sm font-normal text-slate-500">· {notifications.length}건</span></h3>
              <button type="button" aria-label="닫기" onClick={() => setNotiOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <div className="max-h-[60vh] space-y-1.5 overflow-auto">
              {notifications.map((n) => {
                const tone = n.severity === "error" ? "bg-rose-100 text-rose-700" : n.severity === "warn" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700";
                return (
                  <button key={n.key} type="button" onClick={() => openNotification(n)} className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-medium ${tone}`}>{n.type}</span>
                    <span className="flex-1 truncate text-sm">{n.message}</span>
                    <span className="shrink-0 text-[0.65rem] text-slate-400">{n.occurredAt || ""} ›</span>
                  </button>
                );
              })}
              {notifications.length === 0 && <div className="py-10 text-center text-sm text-slate-400">새로운 알림이 없습니다.</div>}
            </div>
            <p className="mt-2 text-[0.7rem] text-slate-400">※ 앱 내 알림만 제공합니다(문자·이메일·카카오톡 미연동). 알림 클릭 시 해당 상세 화면으로 이동합니다.</p>
          </div>
        </div>
      )}

      {/* 관리자 재계산 모달 (admin) */}
      {recalcOpen && canEdit && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setRecalcOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="recalc-title" tabIndex={-1} className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><h3 id="recalc-title" className="text-lg font-semibold">관리자 재계산 / 검증</h3><p className="text-sm text-slate-500">파생 계산을 재실행해 검증합니다(DB 재저장 없음). 화면 진입만으로 실행되지 않습니다.</p></div>
              <button type="button" aria-label="닫기" onClick={() => setRecalcOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={rcEmp} onChange={(e) => setRcEmp(e.target.value)} className={selCls}><option value="">직원 선택</option>{empOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <button type="button" disabled={!rcEmp || recalcBusy} onClick={() => runRecalc({ kind: "employee", employeeNo: rcEmp })} className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${!rcEmp || recalcBusy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>선택 직원 재계산</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={rcPart} onChange={(e) => setRcPart(e.target.value)} className={selCls}><option value="">파트/공정 선택</option>{partOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                <button type="button" disabled={!rcPart || recalcBusy} onClick={() => runRecalc({ kind: "part", part: rcPart })} className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${!rcPart || recalcBusy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>선택 파트 재계산</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <input value={rcYear} onChange={(e) => setRcYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} className={`${selCls} w-20`} inputMode="numeric" placeholder="연도" />
                <select value={rcMonth} onChange={(e) => setRcMonth(e.target.value)} className={selCls}>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{Number(m)}월</option>)}</select>
                <button type="button" disabled={recalcBusy} onClick={() => runRecalc({ kind: "month", year: rcYear, month: rcMonth })} className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${recalcBusy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>선택 월 실적 재계산</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-2 dark:border-slate-700">
                <button type="button" disabled={recalcBusy} onClick={() => setConfirmAll(true)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold text-white ${recalcBusy ? "bg-slate-400" : "bg-slate-900 hover:bg-slate-800"}`}>전체 검증</button>
                <button type="button" disabled={recalcBusy || !recalcResult} onClick={() => runRecalc({ kind: "errorsOnly" })} className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>오류 항목만 재처리</button>
                {recalcBusy && <span className="text-xs text-slate-500">실행 중…</span>}
              </div>
            </div>

            {recalcResult && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{recalcResult.scopeLabel}</span>
                  <span className="text-xs text-slate-400">실행 {recalcResult.ranAt.slice(0, 19).replace("T", " ")} · 사용자 {recalcResult.ranBy}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[["대상", recalcResult.total, "text-slate-600"], ["성공", recalcResult.success, "text-emerald-600"], ["실패", recalcResult.failed, "text-rose-600"], ["확인 필요", recalcResult.needCheck, "text-amber-600"]].map(([l, v, tone]) => (
                    <div key={l as string} className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
                      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{l as string}</div>
                      <div className={`mt-0.5 text-xl font-bold ${tone as string}`}>{v as number}</div>
                    </div>
                  ))}
                </div>
                {recalcResult.items.filter((i) => i.status !== "성공").length > 0 && (
                  <div className={`mt-3 max-h-52 overflow-auto rounded-xl border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    {recalcResult.items.filter((i) => i.status !== "성공").slice(0, 100).map((i, k) => (
                      <div key={k} className="flex items-center gap-2 py-0.5">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${i.status === "실패" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{i.status}</span>
                        <span className="shrink-0 text-slate-400">[{i.kind}]</span>
                        <span className="truncate">{i.ref} — {i.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 전체 검증 확인 Dialog (브라우저 confirm 미사용) */}
      {confirmAll && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmAll(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="recalc-confirm-title" tabIndex={-1} className={`w-full max-w-sm rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="recalc-confirm-title" className="text-lg font-semibold">전체 검증 실행</h3>
            <p className="mt-2 text-sm text-slate-500">전체 응시·D.M 인증 데이터를 재계산해 검증합니다. 계속하시겠습니까? (DB는 재저장되지 않습니다)</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmAll(false)} className={`rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" onClick={() => { setConfirmAll(false); runRecalc({ kind: "all" }); }} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">전체 검증 실행</button>
            </div>
          </div>
        </div>
      )}

      {/* 자동화 작업 이력 모달 */}
      {histOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setHistOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="hist-title" tabIndex={-1} className={`my-8 w-full max-w-4xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div><h3 id="hist-title" className="text-lg font-semibold">자동화 작업 이력 <span className="text-sm font-normal text-slate-500">· {histFiltered.length}/{histLogs.length}건</span></h3><p className="text-sm text-slate-500">재계산·자동생성 등 자동화 실행 이력(개인정보 미저장).</p></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void loadHistory()} className={selCls}>새로고침</button>
                <button type="button" aria-label="닫기" onClick={() => setHistOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">기간</span>
              <input type="date" value={hf.from} onChange={(e) => setHf((p) => ({ ...p, from: e.target.value }))} className={selCls} />~
              <input type="date" value={hf.to} onChange={(e) => setHf((p) => ({ ...p, to: e.target.value }))} className={selCls} />
              <select value={hf.type} onChange={(e) => setHf((p) => ({ ...p, type: e.target.value }))} className={selCls}><option value="전체">실행 유형: 전체</option>{histOpts.types.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              <select value={hf.user} onChange={(e) => setHf((p) => ({ ...p, user: e.target.value }))} className={selCls}><option value="전체">사용자: 전체</option>{histOpts.users.map((o) => <option key={o} value={o}>{o.slice(0, 8)}</option>)}</select>
              <select value={hf.result} onChange={(e) => setHf((p) => ({ ...p, result: e.target.value }))} className={selCls}><option value="전체">성공/실패: 전체</option><option value="성공">성공(실패 0)</option><option value="실패">실패 포함</option></select>
              <select value={hf.module} onChange={(e) => setHf((p) => ({ ...p, module: e.target.value }))} className={selCls}><option value="전체">대상 모듈: 전체</option>{histOpts.modules.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            </div>

            {histLoading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}
            <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className={`sticky top-0 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{["실행 시각", "실행 유형", "대상 모듈", "사용자", "대상", "성공", "실패", "확인", "오류/근거"].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {histFiltered.map((l, k) => {
                    const av = (l.after_value as { total?: number; success?: number; failed?: number; needCheck?: number; errors?: string[]; reasons?: string[] } | null) || {};
                    const errText = (av.errors && av.errors.length ? av.errors : av.reasons || []).slice(0, 3).join(" / ");
                    return (
                      <tr key={str(l.id) || k} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(l.created_at).slice(0, 19).replace("T", " ")}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(l.action_type)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(l.target_id)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{str(l.changed_by).slice(0, 8) || "-"}</td>
                        <td className="px-2.5 py-2 text-center">{num(av.total)}</td>
                        <td className="px-2.5 py-2 text-center text-emerald-600">{num(av.success)}</td>
                        <td className="px-2.5 py-2 text-center text-rose-600">{num(av.failed)}</td>
                        <td className="px-2.5 py-2 text-center text-amber-600">{num(av.needCheck)}</td>
                        <td className="max-w-[220px] truncate px-2.5 py-2" title={errText}>{errText || "-"}</td>
                      </tr>
                    );
                  })}
                  {!histLoading && histFiltered.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">자동화 실행 이력이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
