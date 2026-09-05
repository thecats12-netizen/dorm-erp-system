// 운영관리 > 운영시뮬레이션 > 월별 TO 시뮬레이션 (1차)
//  · 기존 운영 데이터(지역/성별별 정원=TO, 현재 거주자)를 base 로 받아 1~12월을 한 화면에 표시.
//  · 사용자가 특정 연도/월에 증감 가정을 입력하면 이후 월에 누적 반영 → 실시간 재계산(useMemo · 행별 DB 호출 없음).
//  · 원본 DB/운영 데이터는 변경하지 않음(가정값은 이 컴포넌트 local state). 저장(Supabase)·차트·Excel/PDF 는 2·3차.
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildBaseForecast, scenarioDeltaAtMonth, calcMonthly, type SimOccupant, type SimContract, type ScenarioAdj } from "./monthlySimulationEngine";
import { listScenarios, createScenario, renameScenario, deleteScenario, setDefaultScenario, listAdjustments, replaceAdjustments, duplicateScenario, type OpSimScenario, type OpSimAdjustment } from "../services/operationSimulationService";
import { exportSimulationExcel, printSimulation, type SimExportModel } from "./monthlySimulationExport";

export type SimBaseStat = { site: string; gender: "남" | "여"; capacity: number; currentResidents: number; dormCount: number };
export type { SimOccupant, SimContract } from "./monthlySimulationEngine";
type RegionSel = "전체" | string;
type GenderSel = "전체" | "남" | "여";

// 시나리오 유형 → 인원(거주자)/TO/기숙사(채) 증감 방향. 부호는 quantity(양수 입력) × 방향.
//  ※ 기숙사 추가/해지는 "채수"만 변경(TO 자동 변경 없음 — 1채당 TO 상이). TO 는 TO 추가/감소·추가입차·해지 증가로 별도 조정.
const ADJ_TYPES = [
  "직접 인원 증감", "신규입주 증가", "신규입주 감소", "퇴거 증가", "퇴거 감소",
  "천안이동 증가", "천안이동 감소", "해지 증가", "추가입차", "TO 추가", "TO 감소",
  "기숙사 추가", "기숙사 해지",
] as const;
type AdjType = typeof ADJ_TYPES[number];
type Adjustment = {
  id: string; month: number; region: RegionSel; gender: GenderSel;
  type: AdjType; quantity: number; repeatUntil?: number | null; notes?: string;
};
// 유형별 (거주자 델타, TO 델타, 기숙사 채수 델타) — quantity 는 항상 양수 입력, 방향은 아래 부호.
const applyDelta = (t: AdjType, q: number): { res: number; to: number; dorm: number } => {
  switch (t) {
    case "직접 인원 증감": return { res: q, to: 0, dorm: 0 };  // q 는 +/- 직접(입력에서 부호 허용)
    case "신규입주 증가": return { res: q, to: 0, dorm: 0 };
    case "신규입주 감소": return { res: -q, to: 0, dorm: 0 };
    case "퇴거 증가": return { res: -q, to: 0, dorm: 0 };
    case "퇴거 감소": return { res: q, to: 0, dorm: 0 };
    case "천안이동 증가": return { res: -q, to: 0, dorm: 0 };
    case "천안이동 감소": return { res: q, to: 0, dorm: 0 };
    case "해지 증가": return { res: 0, to: -q, dorm: 0 };
    case "추가입차": return { res: 0, to: q, dorm: 0 };
    case "TO 추가": return { res: 0, to: q, dorm: 0 };
    case "TO 감소": return { res: 0, to: -q, dorm: 0 };
    case "기숙사 추가": return { res: 0, to: 0, dorm: q };
    case "기숙사 해지": return { res: 0, to: 0, dorm: -q };
    default: return { res: 0, to: 0, dorm: 0 };
  }
};

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MonthlyToSimulation({ base, occupants = [], contracts = [], darkMode, defaultVacancyCost = 0, tenantId = "", userId = "", canEdit = false }: { base: SimBaseStat[]; occupants?: SimOccupant[]; contracts?: SimContract[]; darkMode: boolean; defaultVacancyCost?: number; tenantId?: string; userId?: string; canEdit?: boolean }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [region, setRegion] = useState<RegionSel>("전체");
  const [gender, setGender] = useState<GenderSel>("전체");
  const [vacancyCost, setVacancyCost] = useState<number>(defaultVacancyCost);
  // [예상 기숙사(채)] 시뮬레이션 기숙사 채수 증감(가정값 · 양수/음수/0). 빈값·NaN → 0. local state(원본 불변 · DB 저장 없음).
  const [expectedDormRaw, setExpectedDormRaw] = useState("");
  const expectedDorm = useMemo(() => { const n = parseInt(expectedDormRaw, 10); return Number.isFinite(n) ? n : 0; }, [expectedDormRaw]);
  const [scenarios, setScenarios] = useState<Adjustment[]>([]);
  const [modal, setModal] = useState(false);
  const [draft, setDraft] = useState<Partial<Adjustment>>({ month: now.getMonth() + 1, region: "전체", gender: "전체", type: "직접 인원 증감", quantity: 0 });

  const sites = useMemo(() => Array.from(new Set(base.map((b) => b.site))), [base]);
  // 데이터 범위: 성별 옵션도 base(scoped)에서 파생 → 범위 밖 성별(예: 평택+남 scope 의 "여") 미표시.
  const genders = useMemo(() => Array.from(new Set(base.map((b) => b.gender))), [base]);

  // 선택 scope(지역/성별) base 집계.
  const baseAgg = useMemo(() => {
    const rows = base.filter((b) => (region === "전체" || b.site === region) && (gender === "전체" || b.gender === gender));
    return { capacity: rows.reduce((s, r) => s + (r.capacity || 0), 0), residents: rows.reduce((s, r) => s + (r.currentResidents || 0), 0), dormCount: rows.reduce((s, r) => s + (r.dormCount || 0), 0) };
  }, [base, region, gender]);

  const hasOccupants = occupants.length > 0;

  // base forecast(DB 등록 이벤트만) — 시나리오 무관 · 한 번만 계산(비교에서도 동일 base 재사용).
  const baseCells = useMemo(() => buildBaseForecast({ occupants, contracts, dormCount: baseAgg.dormCount, year: Number(year), region, gender, capacity: baseAgg.capacity, currentResidents: baseAgg.residents, nowYear: now.getFullYear(), nowMonth: now.getMonth() + 1 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occupants, contracts, year, region, gender, baseAgg]);

  // base + 주어진 시나리오 조정(현재 scope 필터) 결합 → 월별 셀. 메인/비교 공용. 채수(dorm)와 TO 는 별개 계산.
  const buildCells = useCallback((adjs: Adjustment[]) => {
    const scoped = adjs.filter((a) => (a.region === "전체" || region === "전체" || a.region === region) && (a.gender === "전체" || gender === "전체" || a.gender === gender));
    const sadj: ScenarioAdj[] = scoped.map((a) => { const d = applyDelta(a.type, a.quantity); return { month: a.month, resDeltaEach: d.res, toDeltaEach: d.to, dormDeltaEach: d.dorm, repeatUntil: a.repeatUntil }; });
    return baseCells.map((c) => {
      // 과거(history) 월은 실적 재구성 → 시나리오/해지예정 미적용(§10). 현재/미래만 가정 반영.
      const sc = c.sourceType === "history" ? { res: 0, to: 0, dorm: 0 } : scenarioDeltaAtMonth(sadj, c.month);
      // 예상 TO = 계획 TO(해지 예정분 가산된 물리적 현재) − 누적 임차 해지예정 TO + 시나리오 TO 델타.
      const to = Math.max(0, c.planTo - c.terminationCumulative + sc.to);
      const finalResidents = Math.max(0, c.baseResidents + sc.res);
      // 예상 기숙사(채) = 기준 채수 + 시나리오 채수(누적) + 예상 기숙사 증감(과거월 미적용 · 1회만 가산). 채수는 TO/거주자에 영향 없음.
      const dormCount = Math.max(0, c.dormBase + sc.dorm + (c.sourceType === "history" ? 0 : expectedDorm));
      // [표시 전용] 해당 월에 적용된 시나리오 기숙사 증감(비누적). 반복은 각 월마다 dd, 단발은 시작월에만. 과거월 0. (dormCount 계산 무관)
      const scenarioDormMonthly = c.sourceType === "history" ? 0 : sadj.reduce((s, a) => {
        const dd = a.dormDeltaEach ?? 0; const rep = a.repeatUntil != null && a.repeatUntil >= a.month;
        return s + (rep ? (c.month >= a.month && c.month <= (a.repeatUntil as number) ? dd : 0) : (c.month === a.month ? dd : 0));
      }, 0);
      return { ...c, to, scenarioRes: sc.res, scenarioDormMonthly, finalResidents, dormCount, ...calcMonthly(to, finalResidents, vacancyCost) };
    });
  }, [baseCells, region, gender, vacancyCost, expectedDorm]);
  const kpiOf = (cells: ReturnType<typeof buildCells>) => ({
    endRes: cells[11].finalResidents, minRemain: Math.min(...cells.map((r) => r.remain)),
    maxShortage: Math.max(...cells.map((r) => r.shortage)), occAvg: Math.round((cells.reduce((a, r) => a + r.occ, 0) / 12) * 10) / 10,
    loss: cells.reduce((a, r) => a + r.loss, 0),
  });

  const forecast = useMemo(() => buildCells(scenarios), [buildCells, scenarios]);
  const kpi = useMemo(() => ({ ...kpiOf(forecast), startTo: forecast[0].to, endTo: forecast[11].to, curRes: baseAgg.residents, dormNow: baseAgg.dormCount, dormEnd: forecast[11].dormCount, leaseTotal: forecast.reduce((a, r) => a + r.leaseExpiry, 0), addTotal: forecast.reduce((a, r) => a + r.leaseAdd, 0),
    termTotal: forecast.reduce((a, r) => a + r.terminationTO, 0), termDrop: forecast[11].terminationCumulative }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forecast, baseAgg]);

  // 임차 해지예정 상세(현재 scope · distinct 계약) — 화면/Excel/PDF/인쇄 공용 source. 원본 재조회 없음.
  const terminationDetails = useMemo(() => {
    const seen = new Set<string>(); const rows: Array<{ site: string; gender: string; dormId: string; month: number; capacity: number; status: string }> = [];
    for (const c of contracts) {
      if (!((region === "전체" || c.site === region) && (gender === "전체" || c.gender === gender))) continue;
      const m = /^(\d{4})-(\d{1,2})/.exec(String(c.contractEnd ?? "").trim());
      if (!m || Number(m[1]) !== Number(year) || String(c.contractStatus ?? "") !== "해지") continue;
      const key = c.id ? `id:${c.id}` : `${c.dormId}|${c.contractEnd}`;
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ site: c.site, gender: c.gender, dormId: c.dormId, month: Number(m[2]), capacity: Math.max(0, Number(c.capacity) || 0), status: String(c.contractStatus ?? "") });
    }
    return rows.sort((a, b) => a.month - b.month);
  }, [contracts, region, gender, year]);

  // ── 저장 시나리오(Supabase · adjustments 만 저장 · RLS tenant/소유) ──
  const [savedList, setSavedList] = useState<OpSimScenario[]>([]);
  const [savedId, setSavedId] = useState("");
  const [dbReady, setDbReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareRows, setCompareRows] = useState<Array<{ id: string; name: string; endRes: number; minRemain: number; maxShortage: number; occAvg: number; loss: number }>>([]);
  const toDb = (a: Adjustment): OpSimAdjustment => ({ target_year: Number(year), target_month: a.month, region: a.region, gender: a.gender, dormitory_id: null, adjustment_type: a.type, quantity: a.quantity, repeat_until_year: a.repeatUntil ? Number(year) : null, repeat_until_month: a.repeatUntil ?? null, notes: a.notes ?? null });
  const fromDb = (a: OpSimAdjustment): Adjustment => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, month: a.target_month, region: (a.region as RegionSel) ?? "전체", gender: (a.gender as GenderSel) ?? "전체", type: a.adjustment_type as AdjType, quantity: a.quantity, repeatUntil: a.repeat_until_month ?? null, notes: a.notes ?? undefined });
  const refreshSaved = useCallback(async () => {
    if (!tenantId) { setDbReady(false); return; }
    const list = await listScenarios(tenantId, Number(year)); setSavedList(list); setDbReady(true);
  }, [tenantId, year]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);
  const loadScenario = async (id: string) => { setSavedId(id); if (!id) return; setScenarios((await listAdjustments(id)).map(fromDb)); };
  const guard = () => canEdit && dbReady && !busy;
  const saveCurrent = async () => { if (!guard() || !savedId) return; setBusy(true); await replaceAdjustments(tenantId, userId, savedId, scenarios.map(toDb)); setBusy(false); };
  const newScenario = async () => { if (!guard()) return; const name = window.prompt("새 시나리오 이름", `시나리오 ${savedList.length + 1}`); if (!name) return; setBusy(true); const s = await createScenario(tenantId, userId, { name, baseYear: Number(year) }); if (s) { if (scenarios.length) await replaceAdjustments(tenantId, userId, s.id, scenarios.map(toDb)); await refreshSaved(); setSavedId(s.id); } setBusy(false); };
  const dupScenario = async () => { if (!guard() || !savedId) return; const name = window.prompt("복제본 이름", `${savedList.find((x) => x.id === savedId)?.name ?? "시나리오"} 복제`); if (!name) return; setBusy(true); const s = await duplicateScenario(tenantId, userId, savedId, name); if (s) { await refreshSaved(); await loadScenario(s.id); } setBusy(false); };
  const renameCur = async () => { if (!guard() || !savedId) return; const name = window.prompt("이름 변경", savedList.find((x) => x.id === savedId)?.name ?? ""); if (!name) return; setBusy(true); await renameScenario(savedId, name, userId); await refreshSaved(); setBusy(false); };
  const delCur = async () => { if (!guard() || !savedId) return; if (!window.confirm("이 시나리오를 삭제할까요?")) return; setBusy(true); await deleteScenario(savedId); setSavedId(""); setScenarios([]); await refreshSaved(); setBusy(false); };
  const setDefaultCur = async () => { if (!guard() || !savedId) return; setBusy(true); await setDefaultScenario(tenantId, Number(year), savedId, userId); await refreshSaved(); setBusy(false); };
  // 비교: 기준안 + 선택 시나리오(최대 3) KPI(현재 scope/연도 기준 재계산).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!compareOn) { setCompareRows([]); return; }
      const rows = [{ id: "__base__", name: "기준안(현황)", ...kpiOf(buildCells([])) }];
      for (const id of compareIds.slice(0, 3)) { const adjs = (await listAdjustments(id)).map(fromDb); rows.push({ id, name: savedList.find((x) => x.id === id)?.name ?? "시나리오", ...kpiOf(buildCells(adjs)) }); }
      if (alive) setCompareRows(rows);
    })();
    return () => { alive = false; };
  }, [compareOn, compareIds, buildCells, savedList]);

  const card = darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50";
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const remainTone = (v: number) => v < 0 ? "text-rose-600" : v <= 5 ? "text-amber-600" : "";

  const addScenario = () => {
    if (!draft.month || !draft.type) return;
    setScenarios((p) => [...p, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, month: Number(draft.month), region: draft.region ?? "전체", gender: (draft.gender as GenderSel) ?? "전체", type: draft.type as AdjType, quantity: Number(draft.quantity) || 0, repeatUntil: draft.repeatUntil ? Number(draft.repeatUntil) : null, notes: draft.notes }]);
    setModal(false); setDraft({ month: now.getMonth() + 1, region: "전체", gender: "전체", type: "직접 인원 증감", quantity: 0 });
  };

  type FCell = typeof forecast[number];
  const dash = (n: number, sign = false) => n === 0 ? "-" : sign && n > 0 ? `+${n}` : String(n);
  const ROWS: Array<{ label: string; get: (r: FCell) => string; tone?: (r: FCell) => string; muted?: boolean; numRight?: boolean }> = [
    { label: "기숙사(채)", get: (r) => String(r.dormCount), muted: true },
    { label: "계획 TO", get: (r) => String(r.planTo), muted: true },
    { label: "기준 거주자(현황)", get: (r) => String(r.anchorResidents), muted: true },
    { label: "임차 해지예정", get: (r) => r.terminationTO ? `-${r.terminationTO}` : "-", tone: (r) => r.terminationTO ? "text-rose-600" : "" },
    { label: "신규입주 예정", get: (r) => dash(r.newMoveIn, true) },
    { label: "만료 예정", get: (r) => r.expiry ? `-${r.expiry}` : "-" },
    { label: "기타 확정 증감", get: (r) => dash(r.otherDelta, true) },
    { label: "임차 만기(채)", get: (r) => r.leaseExpiry ? String(r.leaseExpiry) : "-", muted: true },
    { label: "추가임차(채)", get: (r) => r.leaseAdd ? String(r.leaseAdd) : "-", muted: true },
    // 예상 기숙사(채) = 해당 월 시나리오 기숙사 증감(비누적 · 추가+/해지-). 수동 예상 기숙사 입력값은 미표시(dormCount 계산에만 반영).
    { label: "예상 기숙사(채)", get: (r) => dash(r.scenarioDormMonthly, true), muted: true, tone: (r) => r.scenarioDormMonthly ? "text-blue-600" : "" },
    { label: "기준 예상 거주자", get: (r) => String(r.baseResidents), tone: (r) => r.isEstimatePast ? "text-slate-400 italic" : "" },
    { label: "시나리오 증감", get: (r) => dash(r.scenarioRes, true), tone: (r) => r.scenarioRes ? "text-blue-600" : "" },
    { label: "최종 예상 거주자", get: (r) => String(r.finalResidents) },
    { label: "예상 TO", get: (r) => String(r.to) },
    { label: "예상 잔여TO", get: (r) => String(r.remain), tone: (r) => remainTone(r.remain) },
    { label: "예상 입주율", get: (r) => `${r.occ}%` },
    { label: "예상 공실손실", get: (r) => won(r.loss), numRight: true }, // 금액 → 데이터 셀만 오른쪽 정렬
  ];

  // 화면/Excel/PDF/인쇄 공용 단일 모델(ROWS·forecast·kpi 재사용 → display == export). DB 재조회 없음.
  const buildExportModel = (): SimExportModel => {
    const scenarioName = (savedId && savedList.find((x) => x.id === savedId)?.name) || (scenarios.length ? "미저장 작업" : "기준안(현황)");
    const srcLabel = (r: FCell) => r.sourceType === "history" ? (r.isEstimatePast ? "추정" : "이력") : r.sourceType === "current" ? "현재" : "예상";
    const rows = [{ label: "출처", values: forecast.map(srcLabel) }, ...ROWS.map((row) => ({ label: row.label, values: forecast.map((r) => row.get(r)) }))];
    rows.push({ label: "기준안 대비", values: forecast.map((r) => { const d = r.finalResidents - r.baseResidents; return d > 0 ? `+${d}` : String(d); }) });
    return {
      meta: { year: Number(year), region, gender, scenarioName, vacancyCost, printedAt: new Date().toLocaleString("ko-KR"),
        basis: "계획 TO(현재 정원+미래 해지 예정분) − 누적 임차 해지예정 TO + 시나리오. 기숙사(채)는 현재 활성 채수 flat + 시나리오 채수. 임차만기/추가임차는 정보성." },
      kpis: [["현재 기숙사수", `${kpi.dormNow}채`], ["연말 예상 기숙사수", `${kpi.dormEnd}채`], ["연초 TO", String(kpi.startTo)], ["연말 예상 TO", String(kpi.endTo)], ["현재 거주자", String(kpi.curRes)], ["연말 예상 거주자", String(kpi.endRes)], ["연중 임차 해지예정 TO", `-${kpi.termTotal}`], ["연말 감소 예정 TO", `-${kpi.termDrop}`], ["최저 잔여TO", String(kpi.minRemain)], ["최대 부족인원", String(kpi.maxShortage)], ["평균 입주율", `${kpi.occAvg}%`], ["연중 임차만기(채)", `${kpi.leaseTotal}채`], ["연중 추가임차(채)", `${kpi.addTotal}채`], ["예상 공실손실(연)", won(kpi.loss)]].map(([label, value]) => ({ label, value })),
      months: MONTHS, rows,
      adjustments: scenarios.map((a) => ({ ym: `${year}-${String(a.month).padStart(2, "0")}${a.repeatUntil ? `~${String(a.repeatUntil).padStart(2, "0")}` : ""}`, region: a.region, gender: a.gender, type: a.type, quantity: a.quantity, repeatUntil: a.repeatUntil ? `${a.repeatUntil}월` : "-", notes: a.notes ?? "" })),
      terminations: terminationDetails,
    };
  };

  return (
    <div>
      <div className="mb-1"><h2 className="text-lg font-semibold">월별 TO 시뮬레이션</h2><p className="text-sm text-slate-500">기존 운영 데이터를 기준으로 1~12월 TO·거주자·잔여TO·입주율·공실손실을 가정값으로 시뮬레이션합니다. (원본 데이터 불변)</p></div>

      {/* 시나리오 저장/불러오기/복제/비교 (adjustments 만 저장 · base는 현재 운영데이터로 재계산) */}
      {tenantId && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <select value={savedId} onChange={(e) => void loadScenario(e.target.value)} className={inputCls} disabled={!dbReady}>
            <option value="">{dbReady ? "시나리오 선택(미저장 작업)" : "저장 기능 준비 안 됨(DB 미적용)"}</option>
            {savedList.map((s) => <option key={s.id} value={s.id}>{s.is_default ? "★ " : ""}{s.name}</option>)}
          </select>
          {canEdit && dbReady && (<>
            <button className={btn} onClick={() => void newScenario()} disabled={busy}>새 시나리오</button>
            <button className={btn} onClick={() => void saveCurrent()} disabled={busy || !savedId}>저장</button>
            <button className={btn} onClick={() => void dupScenario()} disabled={busy || !savedId}>복제</button>
            <button className={btn} onClick={() => void renameCur()} disabled={busy || !savedId}>이름 변경</button>
            <button className={btn} onClick={() => void delCur()} disabled={busy || !savedId}>삭제</button>
            <button className={btn} onClick={() => void setDefaultCur()} disabled={busy || !savedId}>기본안 설정</button>
          </>)}
          <button className={btn} onClick={() => setCompareOn((v) => !v)}>{compareOn ? "비교 닫기" : "비교"}</button>
          <span className="text-[0.65rem] text-slate-400">※ 현재 운영데이터 기준 재계산 {canEdit ? "" : "· 조회 전용"}</span>
        </div>
      )}
      {compareOn && (
        <div className={`mb-4 rounded-2xl border p-3 ${card}`}>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-500">시나리오 비교(최대 3)</span>
            {savedList.map((s) => { const on = compareIds.includes(s.id); return (
              <button key={s.id} onClick={() => setCompareIds((p) => on ? p.filter((x) => x !== s.id) : (p.length < 3 ? [...p, s.id] : p))} className={`rounded-lg px-2 py-1 ${on ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600" : "border border-slate-300")}`}>{s.name}</button>
            ); })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={darkMode ? "text-slate-400" : "text-slate-500"}><tr>{["시나리오", "연말 예상거주자", "최저 잔여TO", "최대 부족인원", "평균 입주율", "예상 공실손실"].map((h, i) => <th key={h} className={`px-2 py-1 ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{compareRows.map((r) => (
                <tr key={r.id} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <td className="px-2 py-1 font-medium">{r.name}</td><td className="px-2 py-1 text-right">{r.endRes}</td>
                  <td className={`px-2 py-1 text-right ${remainTone(r.minRemain)}`}>{r.minRemain}</td><td className="px-2 py-1 text-right">{r.maxShortage}</td>
                  <td className="px-2 py-1 text-right">{r.occAvg}%</td><td className="px-2 py-1 text-right">{won(r.loss)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* 툴바 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>{Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - 1 + i)).map((y) => <option key={y} value={y}>{y}년</option>)}</select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}><option value="전체">지역: 전체</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={gender} onChange={(e) => setGender(e.target.value as GenderSel)} className={inputCls}><option value="전체">성별: 전체</option>{genders.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <label className="flex items-center gap-1 text-xs text-slate-500">공실 1실 월비용<input type="text" inputMode="numeric" value={String(vacancyCost)} onChange={(e) => setVacancyCost(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} className={`${inputCls} w-28`} /></label>
        <label className="flex items-center gap-1 text-xs text-slate-500">예상 기숙사(채)<input type="text" inputMode="numeric" value={expectedDormRaw} onChange={(e) => setExpectedDormRaw(e.target.value.replace(/[^0-9-]/g, ""))} placeholder="0" className={`${inputCls} w-20`} title="시뮬레이션 기숙사 채수 증감(양수/음수)" /></label>
        <span className="ml-auto flex gap-1.5">
          <button className={btn} onClick={() => exportSimulationExcel(buildExportModel())}>Excel</button>
          <button className={btn} onClick={() => printSimulation(buildExportModel())}>PDF</button>
          <button className={btn} onClick={() => printSimulation(buildExportModel())}>인쇄</button>
          <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setModal(true)}>시나리오 추가</button>
          <button className={btn} onClick={() => { setScenarios([]); setExpectedDormRaw(""); }}>초기화</button>
        </span>
      </div>

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {([["현재 기숙사수", `${kpi.dormNow}채`], ["연말 예상 기숙사수", `${kpi.dormEnd}채`], ["연초 TO", String(kpi.startTo)], ["연말 예상 TO", String(kpi.endTo)], ["현재 거주자", String(kpi.curRes)], ["연말 예상 거주자", String(kpi.endRes)], ["연중 임차 해지예정 TO", `-${kpi.termTotal}`], ["연말 감소 예정 TO", `-${kpi.termDrop}`], ["최저 잔여TO", String(kpi.minRemain)], ["최대 부족인원", String(kpi.maxShortage)], ["평균 입주율", `${kpi.occAvg}%`], ["연중 임차만기(채)", `${kpi.leaseTotal}채`], ["연중 추가임차(채)", `${kpi.addTotal}채`], ["예상 공실손실(연)", won(kpi.loss)]] as Array<[string, string]>).map(([l, v]) => (
          <div key={l} className={`rounded-2xl border p-3 ${card}`}><div className="text-[0.6rem] uppercase tracking-wide text-slate-400">{l}</div><div className="mt-0.5 text-base font-semibold">{v}</div></div>
        ))}
      </div>

      {/* 12개월 표 (모바일 가로 스크롤) */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[900px] text-center text-xs tabular-nums [&_th]:align-middle [&_td]:align-middle">
          <thead className={darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}>
            <tr><th className="sticky left-0 z-[1] bg-inherit px-2.5 py-2 text-center">구분</th>{MONTHS.map((m) => <th key={m} className="px-2.5 py-2 text-center">{m}월</th>)}</tr>
          </thead>
          <tbody>
            {/* 값 출처(§8): 과거=이력 재구성 · 현재월=현재 현황(파랑) · 미래=예상(연함) */}
            <tr className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <td className="sticky left-0 z-[1] whitespace-nowrap bg-inherit px-2.5 py-1 text-[0.6rem] font-medium text-slate-400">출처</td>
              {forecast.map((r) => (
                <td key={r.month} className={`px-2.5 py-1 text-[0.6rem] ${r.sourceType === "current" ? "font-semibold text-blue-600" : r.sourceType === "future" ? "text-slate-400" : "text-slate-500"}`}
                  title={r.sourceType === "history" ? (r.isEstimatePast ? "데이터 부족 → 추정" : "과거 이력 재구성(계약/입주 날짜 기준)") : r.sourceType === "current" ? "현재 현황(운영 source of truth)" : "미래 예상(forecast)"}>
                  {r.sourceType === "history" ? (r.isEstimatePast ? "추정" : "이력") : r.sourceType === "current" ? "현재" : "예상"}
                </td>
              ))}
            </tr>
            {ROWS.map((row) => (
              <tr key={row.label} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"} ${row.label === "최종 예상 거주자" ? (darkMode ? "bg-slate-800/40" : "bg-slate-50") : ""}`}>
                <td className={`sticky left-0 z-[1] whitespace-nowrap bg-inherit px-2.5 py-2 font-medium ${row.muted ? "text-slate-400" : ""}`}>{row.label}</td>
                {forecast.map((r) => (
                  <td key={r.month} className={`px-2.5 py-2 ${row.numRight ? "text-right pr-4" : ""} ${row.tone ? row.tone(r) : ""}`}
                    title={row.label === "최종 예상 거주자" ? `${r.isEstimatePast ? "과거월 역산 추정 · " : ""}기준 예상 ${r.baseResidents} · 시나리오 ${r.scenarioRes >= 0 ? "+" : ""}${r.scenarioRes} = ${r.finalResidents}`
                      : row.label === "예상 TO" ? `계획 TO ${r.planTo} · 임차 해지예정 -${r.terminationCumulative}(누적) · 시나리오 TO ${r.to - (r.planTo - r.terminationCumulative) >= 0 ? "+" : ""}${r.to - (r.planTo - r.terminationCumulative)} = ${r.to}`
                      : row.label === "임차 해지예정" ? (r.terminationTO ? `${r.month}월 해지 확정 계약 capacity 합 -${r.terminationTO} TO(누적 -${r.terminationCumulative})` : "해지 예정 없음")
                      : row.label === "기숙사(채)" ? `현재 활성 ${r.dormBase}채 · 시나리오 채수 ${r.dormCount - r.dormBase >= 0 ? "+" : ""}${r.dormCount - r.dormBase} · (임차만기 ${r.leaseExpiry}채/추가임차 ${r.leaseAdd}채는 정보성)` : undefined}>
                    {row.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {/* 기준안 대비(거주자): base forecast 대비 시나리오 순증감 */}
            <tr className={`border-t ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
              <td className="sticky left-0 z-[1] whitespace-nowrap bg-inherit px-2.5 py-2 font-medium text-slate-500">기준안 대비</td>
              {forecast.map((r) => { const d = r.finalResidents - r.baseResidents; return <td key={r.month} className={`px-2.5 py-2 ${d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-slate-400"}`}>{d > 0 ? `+${d}` : d}</td>; })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-1 text-[0.65rem] text-slate-400">
        ※ 과거월(현재월 이전)은 계약/입주 날짜 이력으로 재구성(현재 status로 과거를 지우지 않음 · 데이터 없는 월만 "추정"). 현재월은 운영 현황(source of truth), 미래월은 forecast. 기숙사(채)는 과거=이력 재구성 채수, 현재/미래=현재 활성 채수 flat + 시나리오 채수. 계획 TO는 과거=이력 재구성 정원, 현재/미래=현재 정원 + 미래 해지 예정분 가산이며, 임차 해지예정(계약상태=해지)은 해당 월부터 실제 capacity 만큼 예상 TO에서 누적 차감(임차 만기와 별개 · 해지는 만기에서 제외 · 1채=1명 아님). 시나리오/해지예정은 과거월에 적용하지 않습니다. {(() => { const c = forecast.find((r) => r.sourceType === "current"); return c && c.planToHistDiff !== 0 ? `⚠ 현재월 계약이력 TO(${c.planTo + c.planToHistDiff})와 운영현황 TO(${c.planTo}) 차이 ${c.planToHistDiff > 0 ? "+" : ""}${c.planToHistDiff}(운영현황 값 표시).` : ""; })()} {hasOccupants ? "" : "입주자 데이터 미연동 → 과거 거주자 재구성 불가(추정)."}
      </div>

      {/* 시나리오 목록 */}
      <div className="mt-3">
        <div className="mb-1 text-xs font-semibold text-slate-500">적용 시나리오 ({scenarios.length})</div>
        {scenarios.length === 0 ? <p className="text-xs text-slate-400">시나리오가 없습니다. ‘시나리오 추가’로 특정 월의 증감 가정을 입력하세요.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {scenarios.map((a) => (
              <span key={a.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[0.7rem] ${card}`}>
                {year}-{String(a.month).padStart(2, "0")}{a.repeatUntil ? `~${String(a.repeatUntil).padStart(2, "0")}` : ""} · {a.region}/{a.gender} · {a.type} {a.quantity > 0 ? `+${a.quantity}` : a.quantity}
                <button className="ml-1 text-rose-500 hover:text-rose-700" onClick={() => setScenarios((p) => p.filter((x) => x.id !== a.id))}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 시나리오 추가 모달 */}
      {modal && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setModal(false)}>
          <div className={`my-8 w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">시나리오 조건 추가</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">적용월 *<select value={draft.month} onChange={(e) => setDraft((d) => ({ ...d, month: Number(e.target.value) }))} className={`${inputCls} mt-1 w-full`}>{MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}</select></label>
              <label className="text-sm">종료월(반복)<select value={draft.repeatUntil ?? ""} onChange={(e) => setDraft((d) => ({ ...d, repeatUntil: e.target.value ? Number(e.target.value) : null }))} className={`${inputCls} mt-1 w-full`}><option value="">없음</option>{MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}</select></label>
              <label className="text-sm">지역 *<select value={draft.region} onChange={(e) => setDraft((d) => ({ ...d, region: e.target.value }))} className={`${inputCls} mt-1 w-full`}><option value="전체">전체</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="text-sm">성별<select value={draft.gender} onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value as GenderSel }))} className={`${inputCls} mt-1 w-full`}><option value="전체">전체</option>{genders.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
              <label className="col-span-2 text-sm">유형 *<select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as AdjType }))} className={`${inputCls} mt-1 w-full`}>{ADJ_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="col-span-2 text-sm">증감수 * <span className="text-slate-400">(직접 인원 증감은 음수 허용)</span><input type="text" inputMode="numeric" value={String(draft.quantity ?? "")} onChange={(e) => setDraft((d) => ({ ...d, quantity: Number(e.target.value.replace(/[^0-9-]/g, "")) || 0 }))} className={`${inputCls} mt-1 w-full`} /></label>
              <label className="col-span-2 text-sm">비고<input type="text" value={draft.notes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} className={`${inputCls} mt-1 w-full`} /></label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className={btn} onClick={() => setModal(false)}>취소</button>
              <button className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500" onClick={addScenario}>추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
