import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listExamRows, listExamRefOptions, examSupabaseReady, type ExamRow } from "../services/examMasterService";
import { computeCertifiedFlagsByPerson } from "../utils/personnelCertSnapshot";
import { isApplicationAcquired } from "../utils/certificationLevel";
import { TrendChart, BarDistribution, Donut, Collapsible } from "../components/ExamReportCharts";
import { RC } from "../components/examReportColors";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const truthy = (v: unknown) => { if (typeof v === "boolean") return v; const s = str(v).trim().toLowerCase(); return !!s && !["0", "false", "n", "no", "x", "-", "없음"].includes(s); };
const pct = (a: unknown, t: unknown): number => { const tt = num(t); if (!(tt > 0)) return 0; const v = Math.round((num(a) / tt) * 1000) / 10; return Number.isFinite(v) ? v : 0; };
const ymd = (v: unknown) => { if (v == null || v === "") return ""; if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10); const s = String(v).trim(); const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10); };
const isFail = (a: ExamRow) => /불합격/.test(str(a.status));
const isTaken = (a: ExamRow) => !["예정", "취소", ""].includes(str(a.status));
// [P1 취득 SoT 통일] 최종 인증 취득 = 공용 canonical(isApplicationAcquired). 실기 합격(practical_pass_date)과는 별개 개념.
const isAcquired = (a: ExamRow) => isApplicationAcquired(a);
const isPass = (a: ExamRow) => !isFail(a) && (isAcquired(a) || /합격/.test(str(a.status)));
const expiryState = (r: ExamRow) => { const s = ymd(r.expiry_date); if (!s) return "-"; const d = Math.floor((new Date(s).getTime() - Date.now()) / 86400000); return d < 0 ? "만료" : d <= 30 ? "만료예정" : "유효"; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 분포(인증 인원 = 취득 사원 distinct) 집계 · 상위 12개.
const distinctAcquiredBy = (rows: ExamRow[], keyFn: (r: ExamRow) => string) => {
  const m = new Map<string, Set<string>>();
  rows.forEach((r) => { if (!isAcquired(r)) return; const k = keyFn(r) || "(미지정)"; (m.get(k) ?? m.set(k, new Set<string>()).get(k)!).add(str(r.employee_no)); });
  return Array.from(m.entries()).map(([label, s]) => ({ label, value: s.size })).sort((a, b) => b.value - a.value).slice(0, 12);
};

type Column = { label: string; get: (r: ExamRow) => string };
type Report = { columns: Column[]; rows: ExamRow[]; wide?: boolean };
const MONTHS = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);

// [단계 대시보드] 인증단계 선택형 보고. 기존 표 보고서는 유지하고 상단에 단계별 KPI·월별추이·상세를 추가(읽기/집계 전용).
const STAGES = ["전체", "Single", "M1", "M2", "M3", "M4", "Dual Multi", "육성 재보수"] as const;
type Stage = typeof STAGES[number];

// [출력 설정] 보고서 섹션 단일 정의(고정 출력 순서). ID 는 내부용 · 화면엔 label 만 노출.
type ReportSectionId = "monthly_plan_actual" | "group_certification" | "category_certification" | "process_certification" | "achievement_timing" | "exam_status_distribution" | "target_performance";
const EXPORT_SECTIONS: Array<{ id: ReportSectionId; label: string }> = [
  { id: "monthly_plan_actual", label: "월별 계획/실적" },
  { id: "group_certification", label: "그룹별 인증 인원" },
  { id: "category_certification", label: "제품군별 인증 인원" },
  { id: "process_certification", label: "공정별 인증 인원" },
  { id: "achievement_timing", label: "조기/정상/지연 비율" },
  { id: "exam_status_distribution", label: "응시상태 분포" },
  { id: "target_performance", label: "목표 대비 실적" },
];
// 출력 인증단계(전체=제외한 실제 단계). 화면 필터와 별개의 출력 전용 선택.
const EXPORT_LEVELS = ["Single", "M1", "M2", "M3", "M4", "Dual Multi", "육성 재보수"] as const;
type ExportLevel = typeof EXPORT_LEVELS[number];
// 2차: 꺾은선/세로 막대/가로 막대/누적 막대/영역/도넛/혼합(동일 data source, 표현만 변경). 렌더는 ExamReportCharts.
const CHART_TYPES = ["꺾은선", "세로 막대", "가로 막대", "누적 막대", "영역", "도넛", "혼합"] as const;
type ChartType = typeof CHART_TYPES[number];

// 단계 라벨 판정(인증단계 이름/코드 기준 · 문자열만으로 공정 판정 안 함). Dual Multi 는 D.M 계열 라벨.
const levelIsStage = (label: string, s: Stage): boolean => {
  const L = String(label ?? "").toLowerCase();
  if (s === "Single") return /(^|[^a-z0-9])single([^a-z0-9]|$)/.test(L);
  if (/^M[1-4]$/.test(s)) return new RegExp(`(^|[^a-z0-9])${s.toLowerCase()}([^a-z0-9]|$)`).test(L);
  if (s === "Dual Multi") return /dual|d\.?m|master/.test(L);
  return false;
};

const REPORT_TYPES = [
  "전체 인증 현황", "그룹별 인증 현황", "파트별 인증 현황", "공정별 인증 현황",
  "직원별 인증 이력", "시험 응시 결과", "합격/불합격 현황", "만료 예정 인증",
  "연간 목표 실적", "월간 실적", "D.M 인증 현황", "미취득자 현황",
] as const;
type ReportType = typeof REPORT_TYPES[number];

export default function ExamReportsPage({ darkMode, tenantId, author, refreshKey }: { darkMode: boolean; canEdit?: boolean; tenantId: string; userId?: string; author?: string; onToast?: (m: string) => void; refreshKey?: number; }) {
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);
  const [apps, setApps] = useState<ExamRow[]>([]);
  const [certs, setCerts] = useState<ExamRow[]>([]);
  const [targets, setTargets] = useState<ExamRow[]>([]);
  const [monthly, setMonthly] = useState<ExamRow[]>([]);
  const [levels, setLevels] = useState<Array<{ id: string; label: string }>>([]);
  const [levelsRaw, setLevelsRaw] = useState<ExamRow[]>([]); // [단계 정합화] code/name/rank_order 포함 원본(공용 resolver 용)
  // [장비] 기준정보(id→이름 매핑 · 필터 옵션용). 저장 구조/통계 무관. [라인 UI 제외]
  const [equipRows, setEquipRows] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportType>("전체 인증 현황");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<Stage>("전체");           // [단계 대시보드] 선택 인증단계
  const [chartType, setChartType] = useState<ChartType>("꺾은선"); // 월별추이 차트 유형
  // [출력 설정] 화면 필터와 별개의 "출력 전용" 선택(섹션·인증단계). 기본 전체선택.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSections, setExportSections] = useState<Set<ReportSectionId>>(() => new Set(EXPORT_SECTIONS.map((s) => s.id)));
  const [exportLevels, setExportLevels] = useState<Set<ExportLevel>>(() => new Set(EXPORT_LEVELS));
  // equipment 는 id 로 저장(표시는 이름 매핑). 기본 "전체" → 기존 집계/합계 불변. [라인 UI 제외]
  const [f, setF] = useState({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", equipment: "전체", level: "전체" });

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, c, t, m, lv, eq, lvRaw] = await Promise.all([
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_applications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("dm_certifications", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_annual_targets", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_monthly_results", tenantId).catch(() => [] as ExamRow[]),
        listExamRefOptions("exam_levels", tenantId).catch(() => []),
        listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
      ]);
      setPersonnel(p); setApps(a); setCerts(c); setTargets(t); setMonthly(m); setLevels(lv); setEquipRows(eq); setLevelsRaw(lvRaw);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refreshKey]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const levelLabel = useCallback((id: unknown) => (!id ? "-" : (levels.find((o) => o.id === str(id))?.label || "-")), [levels]);
  const appMonth = (a: ExamRow) => ymd(a.practical_pass_date || a.written_pass_date || a.written_exam_date).slice(0, 7);

  const opts = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    return {
      years: uniq([...apps.map((a) => appMonth(a).slice(0, 4)), ...targets.map((t) => str(t.year)), ...monthly.map((t) => str(t.year))]),
      groups: uniq([...personnel.map((r) => str(r.group_name)), ...apps.map((r) => str(r.group_name)), ...targets.map((r) => str(r.group_name))]),
      products: uniq([...personnel.map((r) => str(r.product_group)), ...apps.map((r) => str(r.product))]),
      parts: uniq([...personnel.map((r) => str(r.part_name)), ...targets.map((r) => str(r.part_name))]),
      processes: uniq(apps.map((r) => str(r.process))),
      levels: uniq(levels.map((l) => l.label)),
    };
  }, [personnel, apps, targets, monthly, levels]);

  // [장비] 기준정보 id→이름 옵션/맵(활성만 · 이름 정렬). 행마다 find 반복 없이 Map 조회. [라인 UI 제외]
  const equipOpts = useMemo(() => equipRows.filter((r) => r.is_active !== false)
    .map((r) => ({ id: str(r.id), name: str(r.name) || str(r.code) || str(r.id) }))
    .sort((x, y) => x.name.localeCompare(y.name, "ko")), [equipRows]);
  const equipMap = useMemo(() => new Map(equipOpts.map((o) => [o.id, o.name])), [equipOpts]);

  // [단계 정합화] 전체/그룹/파트/공정 인증 현황이 personnel flag(single_job 등) 대신 실제 취득 응시이력으로 단계를 반영하도록 보강.
  //  ExamPersonnelPage 와 동일 공용 로직(acquiredLevelIds + normalizeCertificationLevel). process_id 있는 인력만 재계산(동일 공정 취득만 인정),
  //  legacy(process_id 없음) 인력은 기존 flag 그대로 유지(무회귀). 표시/집계 전용 — 저장/원본 미변경.
  const personnelComputed = useMemo(
    () => computeCertifiedFlagsByPerson({ personnel, applications: apps, levels: levelsRaw, dmCertifications: certs }),
    [personnel, apps, levelsRaw, certs],
  );

  // 데이터셋별 필터. [라인 UI 제외] 라인 필터 없음 → 전체 집계 기본(line_id 유무로 데이터 누락 없음).
  const fPersonnel = useMemo(() => personnelComputed.filter((r) =>
    (f.group === "전체" || str(r.group_name) === f.group) && (f.product === "전체" || str(r.product_group) === f.product) &&
    (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || str(r.cert_level) === f.level)
  ), [personnelComputed, f]);
  const fApps = useMemo(() => apps.filter((r) => {
    const ym = appMonth(r);
    return (f.equipment === "전체" || str(r.equipment_id) === f.equipment) &&
      (f.year === "전체" || ym.slice(0, 4) === f.year) && (f.month === "전체" || ym.slice(5, 7) === f.month) &&
      (f.group === "전체" || str(r.group_name) === f.group) && (f.product === "전체" || str(r.product) === f.product) &&
      (f.process === "전체" || str(r.process) === f.process) && (f.level === "전체" || levelLabel(r.level_id) === f.level);
  }), [apps, f, levelLabel]);
  const fCerts = useMemo(() => certs.filter((r) => { const ym = ymd(r.acquired_date).slice(0, 7); return (f.year === "전체" || !ym || ym.slice(0, 4) === f.year) && (f.month === "전체" || !ym || ym.slice(5, 7) === f.month); }), [certs, f]);
  const fTargets = useMemo(() => targets.filter((r) =>
    (f.year === "전체" || str(r.year) === f.year) && (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) && (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || levelLabel(r.level_id) === f.level)
  ), [targets, f, levelLabel]);
  const fMonthly = useMemo(() => monthly.filter((r) =>
    (f.year === "전체" || str(r.year) === f.year) && (f.group === "전체" || str(r.group_name) === f.group) &&
    (f.product === "전체" || str(r.product_group) === f.product) && (f.part === "전체" || str(r.part_name) === f.part) && (f.level === "전체" || levelLabel(r.level_id) === f.level)
  ), [monthly, f, levelLabel]);

  // ── [단계 대시보드] 선택 단계 기준 집계(기존 필터 fApps/fCerts 재사용 · 추가 조회 없음) ──
  const timingOf = (a: ExamRow) => str(a.timing_status);
  // [육성 재보수 정의] 합집합: 인증 만료 예정/만료(dm_certifications) + 재시험/재응시 응시(exam_applications).
  //  전용 컬럼(유지교육) 부재 → 현재 데이터(만료일/유효기간/응시상태)로만 계산. 대상 사번 집합.
  const maintenanceEmpNos = useMemo(() => {
    const set = new Set<string>();
    fCerts.forEach((c) => { if (["만료예정", "만료"].includes(expiryState(c))) { const e = str(c.employee_no); if (e) set.add(e); } });
    fApps.forEach((a) => { if (/재응시|재시험/.test(str(a.status))) { const e = str(a.employee_no); if (e) set.add(e); } });
    return set;
  }, [fCerts, fApps]);
  // 선택 단계에 해당하는 응시행. Single/M1~M4/Dual Multi 는 인증단계 라벨, 육성 재보수는 위 합집합(만료+재응시).
  const stageApps = useMemo(() => {
    if (stage === "전체") return fApps;
    if (stage === "육성 재보수") return fApps.filter((a) => /재응시|재시험/.test(str(a.status)) || maintenanceEmpNos.has(str(a.employee_no)));
    return fApps.filter((a) => levelIsStage(levelLabel(a.level_id), stage) || (stage === "Dual Multi" ? (a.dual_multi === true || truthy(a.dual_multi)) : false));
  }, [fApps, stage, levelLabel, maintenanceEmpNos]);
  // 선택 단계 KPI. 대상=응시행(단계), 취득=인증취득, 미취득=대상-취득, 조기/정상/지연=timing_status.
  const stageKpi = useMemo(() => {
    const uniqEmp = new Set(stageApps.map((a) => str(a.employee_no)).filter(Boolean));
    const acquired = stageApps.filter(isAcquired).length;
    const target = stageApps.length;
    // 목표/실적(연간): 선택 단계 레벨의 연간목표 target_count 합 vs 월간실적 누계 합.
    const stageTargets = fTargets.filter((t) => stage === "전체" || levelIsStage(levelLabel(t.level_id), stage));
    const stageMonthly = fMonthly.filter((t) => stage === "전체" || levelIsStage(levelLabel(t.level_id), stage));
    const planTotal = stageTargets.reduce((s, t) => s + num(t.target_count), 0);
    const actualTotal = stageMonthly.reduce((s, t) => s + MONTHS.reduce((x, k) => x + num(t[k]), 0), 0);
    return {
      persons: uniqEmp.size, target, acquired, notAcquired: Math.max(0, target - acquired),
      early: stageApps.filter((a) => /조기/.test(timingOf(a))).length,
      normal: stageApps.filter((a) => /정상/.test(timingOf(a))).length,
      late: stageApps.filter((a) => /지연/.test(timingOf(a))).length,
      rate: pct(acquired, target), planTotal, actualTotal, planRate: pct(actualTotal, planTotal),
    };
  }, [stageApps, fTargets, fMonthly, stage, levelLabel]);
  // 월별 계획/실적 시리즈(12개월). 실적=월간실적 m1~m12 합, 계획=연간목표를 12개월 균등 분배(월별 계획 컬럼 부재 · 근사, 보고서에 명시).
  const monthlySeries = useMemo(() => {
    const stageMonthly = fMonthly.filter((t) => stage === "전체" || levelIsStage(levelLabel(t.level_id), stage));
    const stageTargets = fTargets.filter((t) => stage === "전체" || levelIsStage(levelLabel(t.level_id), stage));
    const actual = MONTHS.map((k) => stageMonthly.reduce((s, t) => s + num(t[k]), 0));
    const planAnnual = stageTargets.reduce((s, t) => s + num(t.target_count), 0);
    const plan = MONTHS.map(() => Math.round((planAnnual / 12) * 10) / 10); // 균등 분배 근사
    return { plan, actual };
  }, [fMonthly, fTargets, stage, levelLabel]);

  // 보조 차트 분포(선택 단계 기준).
  const groupDist = useMemo(() => distinctAcquiredBy(stageApps, (r) => str(r.group_name)), [stageApps]);
  const productDist = useMemo(() => distinctAcquiredBy(stageApps, (r) => str(r.product)), [stageApps]);
  const processDist = useMemo(() => distinctAcquiredBy(stageApps, (r) => str(r.process)), [stageApps]);
  const statusDist = useMemo(() => {
    const m = new Map<string, number>();
    stageApps.forEach((r) => { const k = str(r.status) || "(미지정)"; m.set(k, (m.get(k) ?? 0) + 1); });
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [stageApps]);
  const timingDonut = useMemo(() => [
    { label: "조기취득", value: stageKpi.early, color: RC.early },
    { label: "정상취득", value: stageKpi.normal, color: RC.normal },
    { label: "지연취득", value: stageKpi.late, color: RC.late },
  ], [stageKpi]);
  const targetVsActual = useMemo(() => [{ label: "목표(연간)", value: stageKpi.planTotal }, { label: "실적(누계)", value: stageKpi.actualTotal }], [stageKpi]);

  // 전월/전년 동월 대비(선택 연·월 + 단계 기준 · 월간실적). 값 없으면 "-".
  const kpiCompare = useMemo(() => {
    if (f.year === "전체" || f.month === "전체") return { mom: "-", yoy: "-" };
    const y = Number(f.year), mi = Number(f.month);
    const sumFor = (yr: number, monthIdx: number) => monthly.filter((t) =>
      str(t.year) === String(yr) && (stage === "전체" || levelIsStage(levelLabel(t.level_id), stage)) &&
      (f.group === "전체" || str(t.group_name) === f.group) && (f.product === "전체" || str(t.product_group) === f.product)
    ).reduce((s, t) => s + num(t[`m${monthIdx}`]), 0);
    const cur = sumFor(y, mi), prev = mi > 1 ? sumFor(y, mi - 1) : sumFor(y - 1, 12), lastY = sumFor(y - 1, mi);
    const sign = (d: number) => `${d >= 0 ? "+" : ""}${d}`;
    return { mom: sign(cur - prev), yoy: sign(cur - lastY) };
  }, [monthly, f, stage, levelLabel]);

  // 계단식 필터 옵션(그룹→제품군→공정): 상위 선택에 해당하는 하위만.
  const productOptsF = useMemo(() => Array.from(new Set([
    ...personnel.filter((r) => f.group === "전체" || str(r.group_name) === f.group).map((r) => str(r.product_group)),
    ...apps.filter((r) => f.group === "전체" || str(r.group_name) === f.group).map((r) => str(r.product)),
  ].filter(Boolean))).sort(), [personnel, apps, f.group]);
  const processOptsF = useMemo(() => Array.from(new Set(apps.filter((r) =>
    (f.group === "전체" || str(r.group_name) === f.group) && (f.product === "전체" || str(r.product) === f.product)
  ).map((r) => str(r.process)).filter(Boolean))).sort(), [apps, f.group, f.product]);

  // 보조 차트 접기/펼치기.
  const [openAux, setOpenAux] = useState<Record<string, boolean>>({ group: true, product: true, process: false, timing: true, status: false, target: false });
  const toggleAux = (k: string) => setOpenAux((p) => ({ ...p, [k]: !p[k] }));

  // 단계 상세 테이블: 검색/정렬/페이지네이션.
  const [dSearch, setDSearch] = useState("");
  const [dSort, setDSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [dPage, setDPage] = useState(1);
  const [dSize, setDSize] = useState(20);
  const detailCols: Array<{ key: string; label: string; get: (r: ExamRow) => string }> = [
    { key: "employee_no", label: "사번", get: (r) => str(r.employee_no) },
    { key: "name", label: "성명", get: (r) => str(r.name) },
    { key: "group_name", label: "그룹", get: (r) => str(r.group_name) },
    { key: "product", label: "제품군", get: (r) => str(r.product) },
    { key: "process", label: "공정", get: (r) => str(r.process) },
    { key: "level", label: "인증단계", get: (r) => levelLabel(r.level_id) },
    { key: "equipment", label: "인증설비", get: (r) => equipMap.get(str(r.equipment_id)) || "-" },
    { key: "status", label: "응시상태", get: (r) => str(r.status) },
    { key: "cert", label: "인증취득일", get: (r) => ymd(r.cert_acquired_date || r.practical_pass_date) },
    { key: "timing", label: "조기/지연", get: (r) => str(r.timing_status) },
    { key: "pm_level", label: "PM Level", get: (r) => str(r.pm_level) },
    { key: "dm", label: "D.M", get: (r) => str(r.dm_process) },
  ];
  const detailRows = useMemo(() => {
    const q = dSearch.trim().toLowerCase();
    let list = q ? stageApps.filter((r) => detailCols.some((c) => c.get(r).toLowerCase().includes(q))) : stageApps;
    if (dSort) {
      const col = detailCols.find((c) => c.key === dSort.key); const dir = dSort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => (col ? col.get(a).localeCompare(col.get(b), "ko") : 0) * dir);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageApps, dSearch, dSort, levelLabel, equipMap]);
  const dPageCount = Math.max(1, Math.ceil(detailRows.length / dSize));
  const dCur = Math.min(dPage, dPageCount);
  const detailPaged = detailRows.slice((dCur - 1) * dSize, dCur * dSize);
  const toggleDSort = (k: string) => setDSort((p) => p?.key === k ? (p.dir === "asc" ? { key: k, dir: "desc" } : null) : { key: k, dir: "asc" });

  // 집계 헬퍼.
  const aggFlags = (rows: ExamRow[], keyFn: (r: ExamRow) => string): ExamRow[] => {
    const m = new Map<string, ExamRow[]>();
    rows.forEach((r) => { const k = keyFn(r) || "(미지정)"; (m.get(k) || m.set(k, []).get(k)!).push(r); });
    return Array.from(m.entries()).map(([label, rs]) => ({
      label, total: rs.length,
      single: rs.filter((r) => truthy(r.single_job)).length, m1: rs.filter((r) => truthy(r.m1)).length, m2: rs.filter((r) => truthy(r.m2)).length,
      m3: rs.filter((r) => truthy(r.m3)).length, m4: rs.filter((r) => truthy(r.m4)).length,
      dm: rs.filter((r) => truthy(r.dm)).length, dual: rs.filter((r) => r.dual_multi === true || truthy(r.dual_multi)).length,
      master: rs.filter((r) => /master/i.test(str(r.cert_level))).length,
    })).sort((a, b) => num(b.total) - num(a.total));
  };

  const built: Report = useMemo(() => {
    const L = (label: string, get: (r: ExamRow) => string): Column => ({ label, get });
    switch (report) {
      case "전체 인증 현황": return { rows: fPersonnel, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("제품군", (r) => str(r.product_group)), L("파트", (r) => str(r.part_name)),
        L("Single", (r) => truthy(r.single_job) ? "○" : ""), L("M1", (r) => truthy(r.m1) ? "○" : ""), L("M2", (r) => truthy(r.m2) ? "○" : ""), L("M3", (r) => truthy(r.m3) ? "○" : ""), L("M4", (r) => truthy(r.m4) ? "○" : ""),
        L("D.M", (r) => truthy(r.dm) ? "○" : ""), L("Dual", (r) => (r.dual_multi === true || truthy(r.dual_multi)) ? "○" : ""), L("인증Level", (r) => str(r.cert_level)) ] };
      case "그룹별 인증 현황": case "파트별 인증 현황": {
        const rows = aggFlags(fPersonnel, (r) => str(report === "그룹별 인증 현황" ? r.group_name : r.part_name));
        return { rows, columns: [
          L(report === "그룹별 인증 현황" ? "그룹" : "파트", (r) => str(r.label)), L("대상자", (r) => str(r.total)),
          L("Single", (r) => str(r.single)), L("M1", (r) => str(r.m1)), L("M2", (r) => str(r.m2)), L("M3", (r) => str(r.m3)), L("M4", (r) => str(r.m4)),
          L("D.M", (r) => str(r.dm)), L("Dual", (r) => str(r.dual)), L("Master", (r) => str(r.master)) ] };
      }
      case "공정별 인증 현황": {
        const m = new Map<string, ExamRow[]>();
        fApps.forEach((r) => { const k = str(r.process) || "(미지정)"; (m.get(k) || m.set(k, []).get(k)!).push(r); });
        const rows = Array.from(m.entries()).map(([label, rs]) => { const taken = rs.filter(isTaken).length, acq = rs.filter(isAcquired).length; return { label, taken, pass: rs.filter(isPass).length, acq, rate: pct(acq, taken) } as ExamRow; }).sort((a, b) => num(b.taken) - num(a.taken));
        return { rows, columns: [ L("공정", (r) => str(r.label)), L("응시", (r) => str(r.taken)), L("합격", (r) => str(r.pass)), L("취득", (r) => str(r.acq)), L("취득률", (r) => `${r.rate}%`) ] };
      }
      case "직원별 인증 이력": return { rows: [...fApps].sort((a, b) => str(a.employee_no).localeCompare(str(b.employee_no))), wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("공정", (r) => str(r.process)), L("구분", (r) => str(r.category)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("응시상태", (r) => str(r.status) || "-"), L("필기합격", (r) => ymd(r.written_pass_date) || "-"), L("실기합격", (r) => ymd(r.practical_pass_date) || "-"), L("취득", (r) => isAcquired(r) ? "취득" : "미취득") ] };
      case "시험 응시 결과": return { rows: fApps, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("필기진행", (r) => ymd(r.written_exam_date) || "-"), L("필기합격", (r) => ymd(r.written_pass_date) || "-"), L("실기합격", (r) => ymd(r.practical_pass_date) || "-"), L("응시상태", (r) => str(r.status) || "-") ] };
      case "합격/불합격 현황": return { rows: fApps.filter(isTaken), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)),
        L("응시상태", (r) => str(r.status) || "-"), L("결과", (r) => isFail(r) ? "불합격" : isPass(r) ? "합격" : "진행중") ] };
      case "만료 예정 인증": return { rows: fCerts.filter((r) => ["만료예정", "만료"].includes(expiryState(r))).sort((a, b) => ymd(a.expiry_date).localeCompare(ymd(b.expiry_date))), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("D.M 단계", (r) => str(r.dm_stage)), L("Level", (r) => str(r.dm_level)),
        L("취득일", (r) => ymd(r.acquired_date) || "-"), L("만료일", (r) => ymd(r.expiry_date) || "-"), L("상태", (r) => expiryState(r)) ] };
      case "연간 목표 실적": return { rows: fTargets, columns: [
        L("연도", (r) => str(r.year)), L("그룹", (r) => str(r.group_name)), L("제품군", (r) => str(r.product_group)), L("파트", (r) => str(r.part_name)), L("레벨", (r) => levelLabel(r.level_id)),
        L("현재인원", (r) => str(r.current_count)), L("목표인원", (r) => str(r.target_count)), L("차이", (r) => str(num(r.target_count) - num(r.current_count))), L("달성률", (r) => `${pct(r.current_count, r.target_count)}%`) ] };
      case "월간 실적": return { rows: fMonthly, wide: true, columns: [
        L("연도", (r) => str(r.year)), L("그룹", (r) => str(r.group_name)), L("파트", (r) => str(r.part_name)), L("레벨", (r) => levelLabel(r.level_id)),
        ...MONTHS.map((k, i) => L(`${i + 1}월`, (r) => str(num(r[k]) || ""))),
        L("누계", (r) => str(MONTHS.reduce((s, k) => s + num(r[k]), 0))), L("목표", (r) => str(r.target_count)), L("달성률", (r) => `${pct(MONTHS.reduce((s, k) => s + num(r[k]), 0), r.target_count)}%`) ] };
      case "D.M 인증 현황": return { rows: fCerts, wide: true, columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("D.M 단계", (r) => str(r.dm_stage)), L("Level", (r) => str(r.dm_level)), L("공정수", (r) => str(r.process_count)), L("장비수", (r) => str(r.equipment_count)),
        L("취득일", (r) => ymd(r.acquired_date) || "-"), L("만료일", (r) => ymd(r.expiry_date) || "-"), L("상태", (r) => expiryState(r)), L("승인", (r) => str(r.approval_status) || "대기") ] };
      case "미취득자 현황": return { rows: fApps.filter((a) => isTaken(a) && !isAcquired(a) && !isFail(a)), columns: [
        L("사번", (r) => str(r.employee_no)), L("성명", (r) => str(r.name)), L("그룹", (r) => str(r.group_name)), L("공정", (r) => str(r.process)), L("인증단계", (r) => levelLabel(r.level_id)), L("응시상태", (r) => str(r.status) || "-") ] };
      default: return { rows: [], columns: [] };
    }
  }, [report, fPersonnel, fApps, fCerts, fTargets, fMonthly, levelLabel]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase(); if (!q) return built.rows;
    return built.rows.filter((r) => built.columns.some((c) => c.get(r).toLowerCase().includes(q)));
  }, [built, search]);

  const activeFilters = useMemo(() => {
    const parts: string[] = [];
    const labels: Record<string, string> = { year: "연도", month: "월", group: "그룹", product: "제품군", part: "파트", process: "공정", equipment: "장비", level: "레벨" };
    const shown = (k: keyof typeof f) => {
      const v = f[k];
      if (k === "month") return `${Number(v)}월`;
      if (k === "equipment") return equipMap.get(v) || v;   // id 대신 이름 표시(개발값 노출 금지)
      return v;
    };
    (Object.keys(f) as Array<keyof typeof f>).forEach((k) => { if (f[k] !== "전체") parts.push(`${labels[k]}=${shown(k)}`); });
    if (search.trim()) parts.push(`검색='${search.trim()}'`);
    return parts;
  }, [f, search, equipMap]);

  const today = new Date().toISOString().slice(0, 10);
  const authorName = author || "-";

  // ── 내보내기 ──
  const exportRows = () => rows.map((r) => { const o: Record<string, string> = {}; built.columns.forEach((c) => { o[c.label] = c.get(r); }); return o; });
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(exportRows()); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, report.slice(0, 28)); XLSX.writeFile(wb, `시험보고서_${report}.xlsx`); };
  const exportCsv = () => {
    const head = built.columns.map((c) => c.label);
    const lines = [head.join(",")].concat(rows.map((r) => built.columns.map((c) => `"${c.get(r).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `시험보고서_${report}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const openPrint = () => {
    const w = window.open("", "_blank", "width=1100,height=800"); if (!w) return;
    const wide = built.wide; const perPage = wide ? 18 : 26;
    const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
    const thead = `<tr>${built.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
    const metaHtml = `<div class="meta"><b>${esc(report)}</b><span>출력일 ${today} · 작성자 ${esc(authorName)}</span><span>필터: ${activeFilters.length ? esc(activeFilters.join(", ")) : "전체"} · 총 ${rows.length}건</span></div>`;
    let body = "";
    for (let p = 0; p < pageCount; p++) {
      const slice = rows.slice(p * perPage, (p + 1) * perPage);
      const trs = slice.map((r) => `<tr>${built.columns.map((c) => `<td>${esc(c.get(r))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${built.columns.length}" style="text-align:center;padding:20px;color:#94a3b8">데이터가 없습니다.</td></tr>`;
      body += `<div class="page">${metaHtml}<table><thead>${thead}</thead><tbody>${trs}</tbody></table><div class="foot">페이지 ${p + 1} / ${pageCount} · 출력일 ${today}</div></div>`;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report)}</title><style>
      @page{size:A4 ${wide ? "landscape" : "portrait"};margin:12mm}
      *{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#0f172a;margin:0}
      .page{page-break-after:always}.page:last-child{page-break-after:auto}
      .meta{display:flex;flex-direction:column;gap:2px;margin-bottom:8px;border-bottom:2px solid #334155;padding-bottom:6px}
      .meta b{font-size:15px}.meta span{color:#475569;font-size:10.5px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:center;word-break:break-all}
      thead{display:table-header-group}th{background:#f1f5f9;font-weight:600}
      .foot{margin-top:6px;text-align:right;color:#64748b;font-size:10px}
      @media print{.page{padding:0}}
    </style></head><body>${body}<scr`+`ipt>window.onload=function(){window.focus();window.print();}</scr`+`ipt></body></html>`);
    w.document.close();
  };

  // ── [출력 설정] 선택 섹션/인증단계만 PDF·인쇄 (기존 memo/함수 재사용 · 추가 DB 조회 없음) ──
  //  1차 화면필터(fApps/fCerts/fTargets/fMonthly) → 2차 출력 인증단계(exportLevels) → 3차 선택 섹션(exportSections).
  const openExportPrint = () => {
    if (exportSections.size === 0) { window.alert("출력할 보고서 항목을 1개 이상 선택해 주세요."); return; }
    if (exportLevels.size === 0) { window.alert("출력할 인증단계를 1개 이상 선택해 주세요."); return; }
    const w = window.open("", "_blank", "width=1100,height=800"); if (!w) return;
    const lv = Array.from(exportLevels);
    // 응시행이 선택 인증단계에 해당하는지(기존 stageApps 판정 재사용: levelIsStage / 육성 재보수 합집합 / Dual Multi).
    const appMatch = (a: ExamRow) => lv.some((s) =>
      s === "육성 재보수" ? (/재응시|재시험/.test(str(a.status)) || maintenanceEmpNos.has(str(a.employee_no)))
        : s === "Dual Multi" ? (a.dual_multi === true || truthy(a.dual_multi) || levelIsStage(levelLabel(a.level_id), "Dual Multi"))
          : levelIsStage(levelLabel(a.level_id), s as Stage));
    const tgtMatch = (t: ExamRow) => lv.some((s) => s !== "육성 재보수" && levelIsStage(levelLabel(t.level_id), (s === "Dual Multi" ? "Dual Multi" : s) as Stage));
    const exApps = fApps.filter(appMatch), exTargets = fTargets.filter(tgtMatch), exMonthly = fMonthly.filter(tgtMatch);
    const tbl = (title: string, heads: string[], rowsHtml: string, hasData: boolean) =>
      `<section class="rep"><h3>${esc(title)}</h3>${hasData ? `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table>` : `<p class="empty">해당 조건의 데이터가 없습니다.</p>`}</section>`;
    const dist = (items: Array<{ label: string; value: number }>, title: string, keyLabel: string) =>
      tbl(title, [keyLabel, "인증 인원"], items.map((it) => `<tr><td>${esc(it.label)}</td><td>${it.value}</td></tr>`).join(""), items.length > 0);
    const sectionHtml = (id: ReportSectionId): string => {
      if (id === "monthly_plan_actual") {
        const actual = MONTHS.map((k) => exMonthly.reduce((s, t) => s + num(t[k]), 0));
        const planAnnual = exTargets.reduce((s, t) => s + num(t.target_count), 0);
        const plan = MONTHS.map(() => Math.round((planAnnual / 12) * 10) / 10);
        const rows = MONTHS.map((_, i) => `<tr><td>${i + 1}월</td><td>${plan[i]}</td><td>${actual[i]}</td></tr>`).join("");
        return tbl("월별 계획/실적 (계획=연간목표 12개월 균등 분배 근사)", ["월", "계획", "실적"], rows, planAnnual > 0 || actual.some((v) => v > 0));
      }
      if (id === "group_certification") return dist(distinctAcquiredBy(exApps, (r) => str(r.group_name)), "그룹별 인증 인원", "그룹");
      if (id === "category_certification") return dist(distinctAcquiredBy(exApps, (r) => str(r.product)), "제품군별 인증 인원", "제품군");
      if (id === "process_certification") return dist(distinctAcquiredBy(exApps, (r) => str(r.process)), "공정별 인증 인원", "공정");
      if (id === "achievement_timing") {
        const early = exApps.filter((a) => /조기/.test(str(a.timing_status))).length;
        const normal = exApps.filter((a) => /정상/.test(str(a.timing_status))).length;
        const late = exApps.filter((a) => /지연/.test(str(a.timing_status))).length;
        const rows = [["조기취득", early], ["정상취득", normal], ["지연취득", late]].map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("");
        return tbl("조기/정상/지연 비율", ["구분", "인원"], rows, early + normal + late > 0);
      }
      if (id === "exam_status_distribution") {
        const m = new Map<string, number>();
        exApps.forEach((r) => { const k = str(r.status) || "(미지정)"; m.set(k, (m.get(k) ?? 0) + 1); });
        const items = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
        return tbl("응시상태 분포", ["상태", "건수"], items.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${v}</td></tr>`).join(""), items.length > 0);
      }
      // target_performance
      const planTotal = exTargets.reduce((s, t) => s + num(t.target_count), 0);
      const actualTotal = exMonthly.reduce((s, t) => s + MONTHS.reduce((x, k) => x + num(t[k]), 0), 0);
      return tbl("목표 대비 실적", ["구분", "값"], `<tr><td>목표(연간)</td><td>${planTotal}</td></tr><tr><td>실적(누계)</td><td>${actualTotal}</td></tr>`, planTotal > 0 || actualTotal > 0);
    };
    const bodySections = EXPORT_SECTIONS.filter((s) => exportSections.has(s.id)).map((s) => sectionHtml(s.id)).join("");
    const selLabels = (EXPORT_LEVELS as readonly string[]).filter((l) => exportLevels.has(l as ExportLevel)).join(", ");
    const metaHtml = `<div class="meta"><b>시험관리 보고서</b><span>출력일 ${today} · 작성자 ${esc(authorName)}</span><span>필터: ${activeFilters.length ? esc(activeFilters.join(", ")) : "전체"}</span><span>선택 인증단계: ${esc(selLabels)}</span></div>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>시험관리 보고서</title><style>
      @page{size:A4 portrait;margin:12mm}
      *{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#0f172a;margin:0}
      .meta{display:flex;flex-direction:column;gap:2px;margin-bottom:12px;border-bottom:2px solid #334155;padding-bottom:6px}
      .meta b{font-size:16px}.meta span{color:#475569;font-size:10.5px}
      .rep{page-break-inside:avoid;break-inside:avoid;margin-bottom:14px}
      .rep h3{font-size:13px;margin:0 0 6px;border-left:4px solid #2563eb;padding-left:8px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:3px 6px;text-align:center;word-break:break-all}
      thead{display:table-header-group}th{background:#f1f5f9;font-weight:600}
      .empty{color:#94a3b8;font-size:10.5px;padding:8px 0}
      @media print{body{padding:0}}
    </style></head><body>${metaHtml}${bodySections}<scr`+`ipt>window.onload=function(){window.focus();window.print();}</scr`+`ipt></body></html>`);
    w.document.close();
  };
  const toggleSet = <T,>(setFn: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) => setFn((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const section = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const selCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div className="space-y-5">
      <section className={section}>
        <div className="mb-4"><h2 className="text-lg font-semibold">시험 보고서</h2><p className="text-sm text-slate-500">보고서 종류를 선택하고 검색·필터 후 Excel·CSV·PDF·인쇄로 출력합니다. (A4 자동 분할·페이지 번호·출력일·작성자·필터조건 포함)</p></div>

        {/* 보고서 종류 */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {REPORT_TYPES.map((t) => (
            <button key={t} onClick={() => setReport(t)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${report === t ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{t}</button>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(모든 컬럼)" className={`${selCls} min-w-[200px]`} />
          {/* 순서: 연도·월 → 라인(독립) → 제품군·그룹·공정(종속) → 장비 → 레벨. 라인은 제품군의 부모가 아니므로 종속시키지 않음.
              [Line 전환] 제품/파트 필터 드롭다운 제거(f.part 기본 "전체" → 집계/합계·레거시 파트별 리포트 불변). */}
          {([["year", "연도", opts.years], ["month", "월", Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))]] as Array<[keyof typeof f, string, string[]]>).map(([key, label, list]) => (
            <select key={key} value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} className={selCls}>
              <option value="전체">{label}: 전체</option>
              {list.map((o) => <option key={o} value={o}>{key === "month" ? `${Number(o)}월` : o}</option>)}
            </select>
          ))}
          {/* [계단식] 그룹 → 제품군 → 공정. 상위 변경 시 하위 초기화(하위 옵션은 상위 선택에 해당하는 값만). */}
          <select value={f.group} onChange={(e) => setF((p) => ({ ...p, group: e.target.value, product: "전체", process: "전체" }))} className={selCls}>
            <option value="전체">그룹: 전체</option>{opts.groups.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={f.product} onChange={(e) => setF((p) => ({ ...p, product: e.target.value, process: "전체" }))} className={selCls}>
            <option value="전체">제품군: 전체</option>{productOptsF.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={f.process} onChange={(e) => setF((p) => ({ ...p, process: e.target.value }))} className={selCls}>
            <option value="전체">공정: 전체</option>{processOptsF.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {/* 장비(응시데이터 equipment_id 기준 · id 저장/이름 표시). */}
          <select value={f.equipment} onChange={(e) => setF((p) => ({ ...p, equipment: e.target.value }))} className={selCls}>
            <option value="전체">장비: 전체</option>
            {equipOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={f.level} onChange={(e) => setF((p) => ({ ...p, level: e.target.value }))} className={selCls}>
            <option value="전체">레벨: 전체</option>
            {opts.levels.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button className={btn} onClick={() => { setF({ year: "전체", month: "전체", group: "전체", product: "전체", part: "전체", process: "전체", equipment: "전체", level: "전체" }); setSearch(""); }}>초기화</button>
        </div>

        {/* 내보내기 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportCsv}>CSV</button>
          <button className={btn} onClick={openPrint}>PDF</button>
          <button className={btn} onClick={openPrint}>인쇄</button>
          <button className={`${btn} border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-300`} onClick={() => setExportOpen(true)}>보고서 출력 설정</button>
          <span className="ml-auto text-xs text-slate-500">출력일 {today} · 작성자 {authorName} · 총 {rows.length}건</span>
        </div>
      </section>

      {/* ── [단계 대시보드] 인증단계 선택형 KPI · 월별 계획/실적 · 상세(읽기/집계 전용) ── */}
      <section className={section}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button key={s} onClick={() => setStage(s)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${stage === s ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{s}</button>
            ))}
          </div>
          <span className="text-xs text-slate-500">단계 기준 집계 · 상단 필터(연도/그룹/제품군/공정/레벨) 함께 적용</span>
        </div>

        {/* KPI 카드 */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["인증 대상자", str(stageKpi.persons), ""],
            ["응시(대상) 건", str(stageKpi.target), ""],
            ["인증 취득", str(stageKpi.acquired), "text-emerald-600"],
            ["미취득", str(stageKpi.notAcquired), "text-rose-600"],
            ["취득률", `${stageKpi.rate}%`, ""],
            ["목표(연간)", str(stageKpi.planTotal), ""],
            ["실적(누계)", str(stageKpi.actualTotal), ""],
            ["목표 대비", (stageKpi.actualTotal - stageKpi.planTotal >= 0 ? "+" : "") + str(stageKpi.actualTotal - stageKpi.planTotal), ""],
            ["전월 대비", kpiCompare.mom, ""],
            ["전년 동월", kpiCompare.yoy, ""],
            ["조기/정상/지연", `${stageKpi.early}/${stageKpi.normal}/${stageKpi.late}`, ""],
            ["달성률", `${stageKpi.planRate}%`, ""],
          ] as Array<[string, string, string]>).map(([label, val, tone]) => (
            <div key={label} className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
              <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{label}</div>
              <div className={`mt-0.5 text-lg font-semibold ${tone}`}>{val}</div>
            </div>
          ))}
        </div>

        {/* 월별 계획/실적 메인 차트 + 유형 선택 */}
        <div className={`mb-4 rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">월별 계획/실적 <span className="text-xs font-normal text-slate-400">({stage})</span></div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-500"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: RC.plan }} />계획 <span className="ml-1 inline-block h-2 w-3 rounded-sm" style={{ background: RC.actual }} />실적</span>
              <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} className={selCls}>
                {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <TrendChart type={chartType} plan={monthlySeries.plan} actual={monthlySeries.actual} darkMode={darkMode} />
          <div className="mt-1 text-[0.65rem] text-slate-400">※ 월별 계획은 연간목표를 12개월 균등 분배한 근사값입니다(월별 계획 컬럼 부재). 실적은 월간실적 합계.</div>
        </div>

        {/* 보조 차트(접기/펼치기 · 2열) */}
        <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Collapsible title="그룹별 인증 인원" open={openAux.group} onToggle={() => toggleAux("group")} darkMode={darkMode}><BarDistribution items={groupDist} color={RC.bar} darkMode={darkMode} /></Collapsible>
          <Collapsible title="제품군별 인증 인원" open={openAux.product} onToggle={() => toggleAux("product")} darkMode={darkMode}><BarDistribution items={productDist} color={RC.plan} darkMode={darkMode} /></Collapsible>
          <Collapsible title="공정별 인증 인원" open={openAux.process} onToggle={() => toggleAux("process")} darkMode={darkMode}><BarDistribution items={processDist} color={RC.actual} darkMode={darkMode} /></Collapsible>
          <Collapsible title="조기/정상/지연 비율" open={openAux.timing} onToggle={() => toggleAux("timing")} darkMode={darkMode}><Donut items={timingDonut} darkMode={darkMode} /></Collapsible>
          <Collapsible title="응시상태 분포" open={openAux.status} onToggle={() => toggleAux("status")} darkMode={darkMode}><BarDistribution items={statusDist} color={RC.normal} darkMode={darkMode} /></Collapsible>
          <Collapsible title="목표 대비 실적" open={openAux.target} onToggle={() => toggleAux("target")} darkMode={darkMode}><BarDistribution items={targetVsActual} color={RC.late} darkMode={darkMode} /></Collapsible>
        </div>

        {/* 단계 상세 테이블(검색·정렬·페이지네이션) */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input value={dSearch} onChange={(e) => { setDSearch(e.target.value); setDPage(1); }} placeholder="상세 검색" className={`${selCls} min-w-[180px]`} />
          <select value={dSize} onChange={(e) => { setDSize(Number(e.target.value)); setDPage(1); }} className={selCls}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n}건씩</option>)}</select>
          <span className="ml-auto text-xs text-slate-500">단계: {stage} · 총 {detailRows.length}건{stage === "육성 재보수" ? " · (육성 재보수 = 만료/만료예정 + 재응시 · 업무 정의 확인 요망)" : ""}</span>
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
              <tr>{detailCols.map((c) => <th key={c.key} onClick={() => toggleDSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline">{c.label}{dSort?.key === c.key ? (dSort.dir === "asc" ? " ▲" : " ▼") : ""}</th>)}</tr>
            </thead>
            <tbody>
              {detailPaged.map((r, i) => (
                <tr key={str(r.id) || i} className={`border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                  {detailCols.map((c) => <td key={c.key} className="whitespace-nowrap px-2.5 py-2">{c.get(r) || "-"}</td>)}
                </tr>
              ))}
              {detailRows.length === 0 && <tr><td colSpan={detailCols.length} className="px-3 py-10 text-center text-slate-400">해당 단계 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>총 {detailRows.length}건</span>
          <span className="flex items-center gap-2">
            <button className={btn} disabled={dCur <= 1} onClick={() => setDPage(dCur - 1)}>이전</button>
            <span>{dCur} / {dPageCount}</span>
            <button className={btn} disabled={dCur >= dPageCount} onClick={() => setDPage(dCur + 1)}>다음</button>
          </span>
        </div>
      </section>

      <section className={section}>
        {/* 필터 조건 표시 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-500">{report}</span>
          {activeFilters.length ? activeFilters.map((c) => <span key={c} className={`rounded-lg px-2 py-0.5 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>{c}</span>) : <span className="text-slate-400">필터 없음(전체)</span>}
        </div>

        {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
        {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

        <div className="max-h-[58vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
              <tr>{built.columns.map((c) => <th key={c.label} className="whitespace-nowrap px-2.5 py-2">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={str(r.id) || i} className={`border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                  {built.columns.map((c) => <td key={c.label} className="whitespace-nowrap px-2.5 py-2">{c.get(r) || "-"}</td>)}
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={built.columns.length} className="px-3 py-10 text-center text-slate-400">조건에 맞는 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-500">총 {rows.length}건 · PDF/인쇄 시 A4 {built.wide ? "가로" : "세로"} 자동 분할</div>
      </section>

      {/* [출력 설정] 선택 섹션 + 인증단계만 PDF/인쇄. 화면 필터와 별개 · 기존 계산 결과 재사용 */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setExportOpen(false)}>
          <div className={`max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">보고서 출력 설정</h3>
              <span className="text-xs text-slate-500">보고서 {exportSections.size}개 · 인증단계 {exportLevels.size}개 선택</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">보고서 항목</span>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={exportSections.size === EXPORT_SECTIONS.length} onChange={(e) => setExportSections(e.target.checked ? new Set(EXPORT_SECTIONS.map((s) => s.id)) : new Set())} />전체 선택</label>
                </div>
                <div className="space-y-1.5">
                  {EXPORT_SECTIONS.map((s) => (
                    <label key={s.id} className="flex min-h-[36px] items-center gap-2 text-sm"><input type="checkbox" checked={exportSections.has(s.id)} onChange={() => toggleSet(setExportSections, s.id)} />{s.label}</label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">인증단계</span>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={exportLevels.size === EXPORT_LEVELS.length} onChange={(e) => setExportLevels(e.target.checked ? new Set(EXPORT_LEVELS) : new Set())} />전체 선택</label>
                </div>
                <div className="space-y-1.5">
                  {EXPORT_LEVELS.map((l) => (
                    <label key={l} className="flex min-h-[36px] items-center gap-2 text-sm"><input type="checkbox" checked={exportLevels.has(l)} onChange={() => toggleSet(setExportLevels, l)} />{l}</label>
                  ))}
                </div>
              </div>
            </div>
            {(exportSections.size === 0 || exportLevels.size === 0) && (
              <p className="mt-3 text-xs text-rose-500">{exportSections.size === 0 ? "출력할 보고서 항목을 1개 이상 선택해 주세요." : "출력할 인증단계를 1개 이상 선택해 주세요."}</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button className={btn} onClick={() => setExportOpen(false)}>취소</button>
              <button className={`${btn} ${exportSections.size === 0 || exportLevels.size === 0 ? "opacity-50" : ""}`} disabled={exportSections.size === 0 || exportLevels.size === 0} onClick={openExportPrint}>인쇄</button>
              <button className={`rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 ${exportSections.size === 0 || exportLevels.size === 0 ? "opacity-50" : ""}`} disabled={exportSections.size === 0 || exportLevels.size === 0} onClick={openExportPrint}>PDF 생성</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
