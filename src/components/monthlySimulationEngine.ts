// 월별 TO 시뮬레이션 계산 엔진(순수 함수 · DB 호출 없음). UI 와 분리.
//  계층 분리: actual(현황) → base forecast(DB 등록 미래 계약 이벤트 반영) → scenario(사용자 가정) → simulated(base+scenario).
//  ⚠ 원본 데이터 불변. 지역/성별은 dorm→site/gender FK 로 정규화된 SimOccupant 로만 판정(문자열 공정명 매칭 아님).
//  ⚠ 월말 거주자 스냅샷/정원(capacity) 이력이 없으므로: 앵커(현재월) 기준 전방 예측이 정확값, 과거월은 역산 "추정"으로 표기.

export type SimOccupant = {
  site: string; gender: string;  // "남"|"여"|"기타" 등 — scope 비교는 정확 일치(기타는 전체에만 포함)
  isResident: boolean;                 // 현재 거주자(거주중/만료예정 · 미삭제) 여부(앵커 기준점 집계에 이미 포함)
  status: string;                      // 신규입주/대기중/거주중/만료예정/천안이동/퇴실 등
  moveInDate?: string; expectedMoveInDate?: string;
  moveOutDueDate?: string; expectedMoveOutDate?: string; actualMoveOutDate?: string;
};

// 기숙사 임차 계약(채수 이벤트 산정용). contractStatus/contractType 으로 실질 만기/신규 구분(연장·재계약 제외).
export type SimContract = { site: string; gender: string; dormId: string; contractStart?: string; contractEnd?: string; contractStatus?: string; contractType?: string };

const isMidway = (o: SimOccupant): boolean => {
  const due = o.moveOutDueDate || o.expectedMoveOutDate;
  return !!o.actualMoveOutDate && (!due || o.actualMoveOutDate < due); // 실제퇴실 < 예정 → 중도퇴거
};

export type MonthCell = {
  month: number;
  planTo: number;              // 계획 TO(현재 등록 정원 기준 · capacity 이력 없음)
  anchorResidents: number;     // 기준 거주자(앵커 현황)
  newMoveIn: number;           // 신규입주 예정/실적
  expiry: number;              // 만료 예정/실적(계약만료 퇴거)
  otherDelta: number;          // 기타 확정 증감(중도퇴거 + 천안이동, 음수)
  baseResidents: number;       // 기준 예상 거주자(base forecast · 시나리오 제외)
  isEstimatePast: boolean;     // 과거월 역산 추정 여부
  dormBase: number;            // 기숙사(채) 기준값(현재 활성 기숙사수 flat · 정원/채수 이력 없음)
  leaseExpiry: number;         // 임차 만기(채) — 해당 월 계약종료 distinct dormId(정보성)
  leaseAdd: number;            // 추가임차(채) — 해당 월 신규 계약시작 distinct dormId(연장/재계약 제외 · 정보성)
};

// "YYYY-MM..." → {y, m}. 형식오류 시 null(연도 무관 · 연/월 함께 반환 → 연도 경계 처리).
const ymOf = (s: string | undefined): { y: number; m: number } | null => {
  const r = /^(\d{4})-(\d{1,2})/.exec(String(s ?? "").trim());
  if (!r) return null; const mm = Number(r[2]);
  return mm >= 1 && mm <= 12 ? { y: Number(r[1]), m: mm } : null;
};

// base forecast: DB 에 등록된 (예정) 입주/만료/중도/이동 날짜만으로 월별 기준 거주자를 산출(시나리오 미포함).
//  · 앵커: 선택연도=현재연도 → 현재월(전/후방 투영). 선택연도>현재연도 → 현재월부터 (연도-1)12월까지 연속 투영해 선택연도 1월 anchor 산출(현재 거주자를 미래연도 1월로 그대로 복사하지 않음).
//  · 선택연도<현재연도 → 월말 스냅샷 부재로 전월 flat(전체 "추정" 표기).
export function buildBaseForecast(input: {
  occupants: SimOccupant[]; year: number; region: "전체" | string; gender: "전체" | "남" | "여";
  capacity: number; currentResidents: number; nowYear: number; nowMonth: number;
  dormCount?: number; contracts?: SimContract[];
}): MonthCell[] {
  const { year, region, gender, capacity, currentResidents, nowYear } = input;
  const nowMonth = Math.min(12, Math.max(1, input.nowMonth));
  const dormBase = input.dormCount ?? 0;
  const scopeMatch = (site: string, g: string) => (region === "전체" || site === region) && (gender === "전체" || g === gender);
  const scope = (input.occupants || []).filter((o) => scopeMatch(o.site, o.gender));

  // 임차 만기(채)/추가임차(채): 선택연도 월별 distinct dormId(정보성 · 기숙사수에 자동 netting 하지 않음).
  //  임차만기 = contractEnd 월 · 연장/공실 제외(진행중/종료/해지/만료예정). 추가임차 = contractStart 월 · 신규만(연장/재계약/해지후신규 제외).
  const leSet: Set<string>[] = Array.from({ length: 13 }, () => new Set<string>());
  const laSet: Set<string>[] = Array.from({ length: 13 }, () => new Set<string>());
  for (const c of input.contracts || []) {
    if (!scopeMatch(c.site, c.gender)) continue;
    const de = ymOf(c.contractEnd);
    if (de && de.y === year && !/연장|공실/.test(String(c.contractStatus ?? "")) && c.dormId) leSet[de.m].add(String(c.dormId));
    const ds = ymOf(c.contractStart);
    if (ds && ds.y === year && !/연장|재계약|해지후신규/.test(String(c.contractType ?? "")) && c.dormId) laSet[ds.m].add(String(c.dormId));
  }

  // (연도-월)별 이벤트 집계(연도 무관 — 연도 경계/미래연도 anchor 계산용). 중복 방지 가드 포함.
  const nMap = new Map<string, number>(), eMap = new Map<string, number>(), oMap = new Map<string, number>();
  const inc = (map: Map<string, number>, y: number, m: number) => map.set(`${y}-${m}`, (map.get(`${y}-${m}`) || 0) + 1);
  for (const o of scope) {
    // 신규입주: 아직 비거주(신규입주/대기중) + 실퇴실 없음 + 입주(예정)월. 이미 거주자/퇴실자면 제외(이중집계 금지).
    if (!o.isResident && !o.actualMoveOutDate && /신규입주|대기중/.test(o.status)) {
      const d = ymOf(o.expectedMoveInDate) ?? ymOf(o.moveInDate); if (d) inc(nMap, d.y, d.m);
    }
    // 만료 퇴거: 현재 거주자 + 실퇴실 없음(실퇴실 있으면 아래 기타에서 1회만) → 만료(예정)월.
    if (o.isResident && !o.actualMoveOutDate) {
      const d = ymOf(o.moveOutDueDate) ?? ymOf(o.expectedMoveOutDate); if (d) inc(eMap, d.y, d.m);
    }
    // 기타 확정 증감(중도퇴거/천안이동): 실제 퇴실월 1회. 천안이동 전용 일자 컬럼 없음 → actualMoveOutDate.
    const od = ymOf(o.actualMoveOutDate);
    if (od) { if (/천안이동/.test(o.status)) inc(oMap, od.y, od.m); else if (isMidway(o)) inc(oMap, od.y, od.m); }
  }
  const net = (y: number, m: number) => ({ n: nMap.get(`${y}-${m}`) || 0, e: eMap.get(`${y}-${m}`) || 0, o: oMap.get(`${y}-${m}`) || 0 });

  const baseRes = Array(13).fill(0) as number[];
  let anchor = 1, pastYear = false;
  if (year === nowYear) {
    anchor = nowMonth; baseRes[anchor] = currentResidents;
    for (let m = anchor + 1; m <= 12; m++) { const d = net(year, m); baseRes[m] = Math.max(0, baseRes[m - 1] + d.n - d.e - d.o); }
    for (let m = anchor - 1; m >= 1; m--) { const d = net(year, m + 1); baseRes[m] = Math.max(0, baseRes[m + 1] - d.n + d.e + d.o); }
  } else if (year > nowYear) {
    // 현재월+1 ~ (선택연도-1)12월 까지 연속 투영 → 선택연도 진입 직전 거주자(carry).
    let carry = currentResidents, cy = nowYear, cm = nowMonth + 1; if (cm > 12) { cm = 1; cy++; }
    while (cy < year) { const d = net(cy, cm); carry += d.n - d.e - d.o; carry = Math.max(0, carry); cm++; if (cm > 12) { cm = 1; cy++; } }
    let prev = carry;
    for (let m = 1; m <= 12; m++) { const d = net(year, m); baseRes[m] = Math.max(0, prev + d.n - d.e - d.o); prev = baseRes[m]; }
  } else {
    pastYear = true; for (let m = 1; m <= 12; m++) baseRes[m] = currentResidents; // 과거연도: 스냅샷 부재 → flat(추정)
  }

  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; const d = net(year, m);
    return {
      month: m, planTo: capacity, anchorResidents: currentResidents,
      newMoveIn: d.n, expiry: d.e, otherDelta: -d.o, baseResidents: baseRes[m],
      isEstimatePast: pastYear || (year === nowYear && m < anchor),
      dormBase, leaseExpiry: leSet[m].size, leaseAdd: laSet[m].size,
    };
  });
}

// 시나리오 조정 → 월별 (거주자 델타, TO 델타, 기숙사 채수 델타). base 와 분리(중복 금지). 반복(from~until) 누적.
//  ⚠ 채수(dorm) 변화와 TO 변화는 별개(1채당 TO 상이) — 기숙사 +N채가 TO 를 임의로 바꾸지 않는다.
export type ScenarioAdj = { month: number; resDeltaEach: number; toDeltaEach: number; dormDeltaEach?: number; repeatUntil?: number | null };
export function scenarioDeltaAtMonth(adjs: ScenarioAdj[], m: number): { res: number; to: number; dorm: number } {
  let res = 0, to = 0, dorm = 0;
  for (const a of adjs) {
    const from = a.month; const dd = a.dormDeltaEach ?? 0;
    if (a.repeatUntil && a.repeatUntil >= from) {
      if (m >= from) { const times = Math.min(m, a.repeatUntil) - from + 1; res += a.resDeltaEach * times; to += a.toDeltaEach * times; dorm += dd * times; }
    } else if (m >= from) { res += a.resDeltaEach; to += a.toDeltaEach; dorm += dd; }
  }
  return { res, to, dorm };
}

// 월별 입주율/공실/공실손실(순수).
export function calcMonthly(to: number, residents: number, vacancyCost: number) {
  const remain = to - residents;
  const vacancy = Math.max(remain, 0);
  return {
    remain, vacancy, shortage: Math.max(-remain, 0),
    occ: to > 0 ? Math.round((residents / to) * 1000) / 10 : 0,
    loss: Math.max(remain, 0) * (vacancyCost || 0),
  };
}
