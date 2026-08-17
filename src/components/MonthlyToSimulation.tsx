// 운영관리 > 운영시뮬레이션 > 월별 TO 시뮬레이션 (1차)
//  · 기존 운영 데이터(지역/성별별 정원=TO, 현재 거주자)를 base 로 받아 1~12월을 한 화면에 표시.
//  · 사용자가 특정 연도/월에 증감 가정을 입력하면 이후 월에 누적 반영 → 실시간 재계산(useMemo · 행별 DB 호출 없음).
//  · 원본 DB/운영 데이터는 변경하지 않음(가정값은 이 컴포넌트 local state). 저장(Supabase)·차트·Excel/PDF 는 2·3차.
import { useMemo, useState } from "react";
import { buildBaseForecast, scenarioDeltaAtMonth, calcMonthly, type SimOccupant, type ScenarioAdj } from "./monthlySimulationEngine";

export type SimBaseStat = { site: string; gender: "남" | "여"; capacity: number; currentResidents: number };
export type { SimOccupant } from "./monthlySimulationEngine";
type RegionSel = "전체" | string;
type GenderSel = "전체" | "남" | "여";

// 시나리오 유형 → 인원(거주자)/TO 증감 방향. 부호는 quantity(양수 입력) × 방향.
const ADJ_TYPES = [
  "직접 인원 증감", "신규입주 증가", "신규입주 감소", "퇴거 증가", "퇴거 감소",
  "천안이동 증가", "천안이동 감소", "해지 증가", "추가입차", "TO 추가", "TO 감소",
] as const;
type AdjType = typeof ADJ_TYPES[number];
type Adjustment = {
  id: string; month: number; region: RegionSel; gender: GenderSel;
  type: AdjType; quantity: number; repeatUntil?: number | null; notes?: string;
};
// 유형별 (거주자 델타, TO 델타) — quantity 는 항상 양수 입력, 방향은 아래 부호.
const applyDelta = (t: AdjType, q: number): { res: number; to: number } => {
  switch (t) {
    case "직접 인원 증감": return { res: q, to: 0 };      // q 는 +/- 직접(입력에서 부호 허용)
    case "신규입주 증가": return { res: q, to: 0 };
    case "신규입주 감소": return { res: -q, to: 0 };
    case "퇴거 증가": return { res: -q, to: 0 };
    case "퇴거 감소": return { res: q, to: 0 };
    case "천안이동 증가": return { res: -q, to: 0 };
    case "천안이동 감소": return { res: q, to: 0 };
    case "해지 증가": return { res: 0, to: -q };
    case "추가입차": return { res: 0, to: q };
    case "TO 추가": return { res: 0, to: q };
    case "TO 감소": return { res: 0, to: -q };
    default: return { res: 0, to: 0 };
  }
};

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MonthlyToSimulation({ base, occupants = [], darkMode, defaultVacancyCost = 0 }: { base: SimBaseStat[]; occupants?: SimOccupant[]; darkMode: boolean; defaultVacancyCost?: number }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [region, setRegion] = useState<RegionSel>("전체");
  const [gender, setGender] = useState<GenderSel>("전체");
  const [vacancyCost, setVacancyCost] = useState<number>(defaultVacancyCost);
  const [scenarios, setScenarios] = useState<Adjustment[]>([]);
  const [modal, setModal] = useState(false);
  const [draft, setDraft] = useState<Partial<Adjustment>>({ month: now.getMonth() + 1, region: "전체", gender: "전체", type: "직접 인원 증감", quantity: 0 });

  const sites = useMemo(() => Array.from(new Set(base.map((b) => b.site))), [base]);

  // 선택 scope(지역/성별) base 집계.
  const baseAgg = useMemo(() => {
    const rows = base.filter((b) => (region === "전체" || b.site === region) && (gender === "전체" || b.gender === gender));
    return { capacity: rows.reduce((s, r) => s + (r.capacity || 0), 0), residents: rows.reduce((s, r) => s + (r.currentResidents || 0), 0) };
  }, [base, region, gender]);

  // 현재 scope 에 적용되는 시나리오(지역/성별 일치 또는 전체).
  const scopedAdj = useMemo(() => scenarios.filter((a) =>
    (a.region === "전체" || region === "전체" || a.region === region) &&
    (a.gender === "전체" || gender === "전체" || a.gender === gender)
  ), [scenarios, region, gender]);

  // 앵커 표기: 현재연도=현재월, 그 외=1월(과거는 추정 flat / 미래는 현재월부터 연속 투영). 엔진이 연도별 anchor 를 내부 계산.
  const anchorMonth = Number(year) === now.getFullYear() ? now.getMonth() + 1 : 1;
  const futureYear = Number(year) > now.getFullYear();

  // base forecast(DB 등록 입주/만료/중도/이동 날짜 → 월별 기준 거주자) + scenario(사용자 가정) 분리 결합.
  const forecast = useMemo(() => {
    const cells = buildBaseForecast({ occupants, year: Number(year), region, gender, capacity: baseAgg.capacity, currentResidents: baseAgg.residents, nowYear: now.getFullYear(), nowMonth: now.getMonth() + 1 });
    const adjs: ScenarioAdj[] = scopedAdj.map((a) => { const d = applyDelta(a.type, a.quantity); return { month: a.month, resDeltaEach: d.res, toDeltaEach: d.to, repeatUntil: a.repeatUntil }; });
    return cells.map((c) => {
      const sc = scenarioDeltaAtMonth(adjs, c.month);
      const to = Math.max(0, c.planTo + sc.to);
      const finalResidents = Math.max(0, c.baseResidents + sc.res);
      const mm = calcMonthly(to, finalResidents, vacancyCost);
      return { ...c, to, scenarioRes: sc.res, finalResidents, ...mm };
    });
  }, [occupants, year, region, gender, baseAgg, scopedAdj, vacancyCost, anchorMonth]);
  const hasOccupants = occupants.length > 0;

  const kpi = useMemo(() => {
    const s = forecast;
    return {
      startTo: s[0].to, endTo: s[11].to, curRes: baseAgg.residents, endRes: s[11].finalResidents,
      minRemain: Math.min(...s.map((r) => r.remain)), maxShortage: Math.max(...s.map((r) => r.shortage)),
      occAvg: Math.round((s.reduce((a, r) => a + r.occ, 0) / 12) * 10) / 10, loss: s.reduce((a, r) => a + r.loss, 0),
    };
  }, [forecast, baseAgg]);

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
  const ROWS: Array<{ label: string; get: (r: FCell) => string; tone?: (r: FCell) => string; muted?: boolean }> = [
    { label: "계획 TO", get: (r) => String(r.planTo), muted: true },
    { label: "기준 거주자(현황)", get: (r) => String(r.anchorResidents), muted: true },
    { label: "신규입주 예정", get: (r) => dash(r.newMoveIn, true) },
    { label: "만료 예정", get: (r) => r.expiry ? `-${r.expiry}` : "-" },
    { label: "기타 확정 증감", get: (r) => dash(r.otherDelta, true) },
    { label: "기준 예상 거주자", get: (r) => String(r.baseResidents), tone: (r) => r.isEstimatePast ? "text-slate-400 italic" : "" },
    { label: "시나리오 증감", get: (r) => dash(r.scenarioRes, true), tone: (r) => r.scenarioRes ? "text-blue-600" : "" },
    { label: "최종 예상 거주자", get: (r) => String(r.finalResidents) },
    { label: "예상 TO", get: (r) => String(r.to) },
    { label: "예상 잔여TO", get: (r) => String(r.remain), tone: (r) => remainTone(r.remain) },
    { label: "예상 입주율", get: (r) => `${r.occ}%` },
    { label: "예상 공실손실", get: (r) => won(r.loss) },
  ];

  return (
    <div>
      <div className="mb-1"><h2 className="text-lg font-semibold">월별 TO 시뮬레이션</h2><p className="text-sm text-slate-500">기존 운영 데이터를 기준으로 1~12월 TO·거주자·잔여TO·입주율·공실손실을 가정값으로 시뮬레이션합니다. (원본 데이터 불변)</p></div>

      {/* 툴바 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>{Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - 1 + i)).map((y) => <option key={y} value={y}>{y}년</option>)}</select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}><option value="전체">지역: 전체</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={gender} onChange={(e) => setGender(e.target.value as GenderSel)} className={inputCls}><option value="전체">성별: 전체</option><option value="남">남</option><option value="여">여</option></select>
        <label className="flex items-center gap-1 text-xs text-slate-500">공실 1실 월비용<input type="text" inputMode="numeric" value={String(vacancyCost)} onChange={(e) => setVacancyCost(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} className={`${inputCls} w-28`} /></label>
        <span className="ml-auto flex gap-1.5">
          <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setModal(true)}>시나리오 추가</button>
          <button className={btn} onClick={() => setScenarios([])}>초기화</button>
        </span>
      </div>

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {([["연초 TO", String(kpi.startTo)], ["연말 예상 TO", String(kpi.endTo)], ["현재 거주자", String(kpi.curRes)], ["연말 예상 거주자", String(kpi.endRes)], ["최저 잔여TO", String(kpi.minRemain)], ["최대 부족인원", String(kpi.maxShortage)], ["평균 입주율", `${kpi.occAvg}%`], ["예상 공실손실(연)", won(kpi.loss)]] as Array<[string, string]>).map(([l, v]) => (
          <div key={l} className={`rounded-2xl border p-3 ${card}`}><div className="text-[0.6rem] uppercase tracking-wide text-slate-400">{l}</div><div className="mt-0.5 text-base font-semibold">{v}</div></div>
        ))}
      </div>

      {/* 12개월 표 (모바일 가로 스크롤) */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className={darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}>
            <tr><th className="sticky left-0 z-[1] bg-inherit px-2.5 py-2">구분</th>{MONTHS.map((m) => <th key={m} className="px-2.5 py-2 text-right">{m}월</th>)}</tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"} ${row.label === "최종 예상 거주자" ? (darkMode ? "bg-slate-800/40" : "bg-slate-50") : ""}`}>
                <td className={`sticky left-0 z-[1] whitespace-nowrap bg-inherit px-2.5 py-2 font-medium ${row.muted ? "text-slate-400" : ""}`}>{row.label}</td>
                {forecast.map((r) => (
                  <td key={r.month} className={`px-2.5 py-2 text-right ${row.tone ? row.tone(r) : ""}`}
                    title={row.label === "최종 예상 거주자" ? `${r.isEstimatePast ? "과거월 역산 추정 · " : ""}기준 예상 ${r.baseResidents} · 시나리오 ${r.scenarioRes >= 0 ? "+" : ""}${r.scenarioRes} = ${r.finalResidents}` : undefined}>
                    {row.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {/* 기준안 대비(거주자): base forecast 대비 시나리오 순증감 */}
            <tr className={`border-t ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
              <td className="sticky left-0 z-[1] whitespace-nowrap bg-inherit px-2.5 py-2 font-medium text-slate-500">기준안 대비</td>
              {forecast.map((r) => { const d = r.finalResidents - r.baseResidents; return <td key={r.month} className={`px-2.5 py-2 text-right ${d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-slate-400"}`}>{d > 0 ? `+${d}` : d}</td>; })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-1 text-[0.65rem] text-slate-400">
        ※ 계획 TO는 현재 등록 정원 기준(정원 이력 미보관). 신규입주/만료/기타 증감은 등록된 (예정)일자 기반 base forecast이며 시나리오와 분리 계산됩니다. {futureYear ? "선택연도는 현재월부터 미래 이벤트를 연속 투영합니다." : Number(year) < now.getFullYear() ? "과거연도는 월말 스냅샷 부재로 추정(전월 유지)." : `${anchorMonth}월(앵커) 이전은 역산 추정(기울임 표시).`} {hasOccupants ? "" : "입주자 데이터 미연동 → base는 현황 유지."}
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
              <label className="text-sm">성별<select value={draft.gender} onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value as GenderSel }))} className={`${inputCls} mt-1 w-full`}><option value="전체">전체</option><option value="남">남</option><option value="여">여</option></select></label>
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
