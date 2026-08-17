// 월별 TO 시뮬레이션 계산 엔진(순수 함수 · DB 호출 없음). UI 와 분리.
//  계층 분리: actual(현황) → base forecast(DB 등록 미래 계약 이벤트 반영) → scenario(사용자 가정) → simulated(base+scenario).
//  ⚠ 원본 데이터 불변. 지역/성별은 dorm→site/gender FK 로 정규화된 SimOccupant 로만 판정(문자열 공정명 매칭 아님).
//  ⚠ 월말 거주자 스냅샷/정원(capacity) 이력이 없으므로: 앵커(현재월) 기준 전방 예측이 정확값, 과거월은 역산 "추정"으로 표기.

export type SimOccupant = {
  id?: string;                         // 사람 distinct 안정 identity(과거월 재구성용). 없으면 인덱스 대체.
  site: string; gender: string;  // "남"|"여"|"기타" 등 — scope 비교는 정확 일치(기타는 전체에만 포함)
  isResident: boolean;                 // 현재 거주자(거주중/만료예정 · 미삭제) 여부(앵커 기준점 집계에 이미 포함)
  status: string;                      // 신규입주/대기중/거주중/만료예정/천안이동/퇴실 등
  moveInDate?: string; expectedMoveInDate?: string;
  moveOutDueDate?: string; expectedMoveOutDate?: string; actualMoveOutDate?: string;
};

// 기숙사 임차 계약(채수 이벤트 + 임차 해지예정 TO 산정용). contractStatus/contractType 으로 실질 만기/신규/해지 구분.
export type SimContract = { id?: string; site: string; gender: string; dormId: string; capacity?: number; contractStart?: string; contractEnd?: string; contractStatus?: string; contractType?: string };

// 룸키 정규화(distinct 집계 안정화): trim + 연속공백 1칸 + null→"" · 영문 건물명 upper. 숫자/호수 의미·하이픈은 보존(fuzzy 금지).
export function normalizeRoomKey(building?: string, dong?: string, ho?: string): string {
  const n = (s?: string) => String(s ?? "").trim().replace(/\s+/g, " ");
  return `${n(building).toUpperCase()}|${n(dong)}|${n(ho)}`;
}

const isMidway = (o: SimOccupant): boolean => {
  const due = o.moveOutDueDate || o.expectedMoveOutDate;
  return !!o.actualMoveOutDate && (!due || o.actualMoveOutDate < due); // 실제퇴실 < 예정 → 중도퇴거
};

export type MonthCell = {
  month: number;
  planTo: number;              // 계획 TO(현재 operational 정원 + 미래 해지 예정분 가산 = 물리적 현재 TO · flat)
  anchorResidents: number;     // 기준 거주자(앵커 현황)
  newMoveIn: number;           // 신규입주 예정/실적
  expiry: number;              // 만료 예정/실적(계약만료 퇴거)
  otherDelta: number;          // 기타 확정 증감(중도퇴거 + 천안이동, 음수)
  baseResidents: number;       // 기준 예상 거주자(과거=이력 재구성 · 현재=현황 · 미래=forecast)
  isEstimatePast: boolean;     // 추정 여부(과거 재구성 불가 = 데이터 부족 시에만 true)
  sourceType: "history" | "current" | "future"; // 값 출처(과거 이력 재구성 / 현재 현황 / 미래 예상)
  planToHistDiff: number;      // 현재월 진단: (이력 재구성 계획 TO) − (현재 운영 TO). 0 이 아니면 계약이력↔운영현황 불일치.
  dormBase: number;            // 기숙사(채) 기준값(과거=이력 재구성 채수 · 현재/미래=현재 활성 채수 flat)
  leaseExpiry: number;         // 임차 만기(채) — 해당 월 계약종료 distinct dormId(정보성)
  leaseAdd: number;            // 추가임차(채) — 해당 월 신규 계약시작 distinct dormId(연장/재계약 제외 · 정보성)
  terminationTO: number;       // 임차 해지예정 — 해당 월 해지 계약의 실제 capacity 합(그 달 빠지는 TO)
  terminationCumulative: number; // 1~해당월 누적 해지 TO(예상 TO 차감분)
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

  // 월별 값 출처: 과거연도 전체=history / 현재연도는 현재월 이전=history·현재월=current·이후=future / 미래연도 전체=future.
  const sourceOf = (m: number): "history" | "current" | "future" =>
    year < nowYear ? "history" : year > nowYear ? "future" : (m < nowMonth ? "history" : m === nowMonth ? "current" : "future");

  // 과거(및 현재) 월별 실적 재구성(계약/입주 날짜 기준). 과거월 flat 복사 대신 이 값을 사용.
  const hist = buildMonthlyHistoricalSnapshot({ occupants: input.occupants || [], contracts: input.contracts || [], year, region, gender });

  // 임차 만기(채)/추가임차(채): 선택연도 월별 distinct dormId(정보성 · 기숙사수에 자동 netting 하지 않음).
  //  임차만기 = contractEnd 월 · 연장/공실/해지 제외(해지는 "임차 해지예정" 행으로 분리 · 중복 표시 금지). 추가임차 = contractStart 월 · 신규만(연장/재계약/해지후신규 제외).
  const leSet: Set<string>[] = Array.from({ length: 13 }, () => new Set<string>());
  const laSet: Set<string>[] = Array.from({ length: 13 }, () => new Set<string>());
  // 임차 해지예정 TO: contractStatus="해지" + contractEnd 월(선택연도) · distinct(계약 id, 없으면 룸키+종료일) · 실제 capacity 합.
  //  ⚠ base 계획 TO(operationalDorms/capacity)는 이미 "해지" 계약을 제외하므로, 해지 예정분을 계획 TO 에 다시 가산(물리적 현재 TO)한 뒤
  //     해지월부터 누적 차감한다 → 이중차감 방지 + "해지 전 TO 유지, 해지월 하락" 을 정확히 표현.
  const termTO: number[] = Array(13).fill(0);
  const seenTerm = new Set<string>();
  for (const c of input.contracts || []) {
    if (!scopeMatch(c.site, c.gender)) continue;
    const de = ymOf(c.contractEnd);
    if (de && de.y === year && !/연장|공실|해지/.test(String(c.contractStatus ?? "")) && c.dormId) leSet[de.m].add(String(c.dormId));
    const ds = ymOf(c.contractStart);
    if (ds && ds.y === year && !/연장|재계약|해지후신규/.test(String(c.contractType ?? "")) && c.dormId) laSet[ds.m].add(String(c.dormId));
    // 해지예정(TO 차감): 실제 해지 확정 + 종료(해지)월이 선택연도의 미래월. history 월은 이력 재구성에 반영, 현재월은 운영현황(capacity)에 이미 반영 → 미래월만 차감(이중차감 금지).
    if (de && de.y === year && sourceOf(de.m) === "future" && String(c.contractStatus ?? "") === "해지") {
      const key = c.id ? `id:${c.id}` : `${c.dormId}|${c.contractEnd}`;
      if (!seenTerm.has(key)) { seenTerm.add(key); termTO[de.m] += Math.max(0, Number(c.capacity) || 0); }
    }
  }
  const totalTermTO = termTO.reduce((a, b) => a + b, 0);
  const termCum: number[] = Array(13).fill(0);
  for (let m = 1; m <= 12; m++) termCum[m] = termCum[m - 1] + termTO[m];
  const planTO = capacity + totalTermTO; // 물리적 계획 TO(현재 operational + 미래 해지 예정분 가산)

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
    pastYear = true; // 과거연도: 아래에서 history(날짜 재구성)로 대체.
  }
  void pastYear;
  // 과거(history) 월은 forecast/역산 대신 날짜 이력 재구성 값으로 대체.
  for (let m = 1; m <= 12; m++) if (sourceOf(m) === "history") baseRes[m] = hist[m - 1].residentCount;

  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; const d = net(year, m); const st = sourceOf(m); const h = hist[m - 1];
    // 계획 TO: 과거=이력 재구성, 현재=운영 source of truth(capacity, 자동변경 금지), 미래=현재 정원+미래 해지 예정분 가산(예상 TO에서 누적 차감).
    const planToM = st === "history" ? h.planTo : st === "current" ? capacity : planTO;
    const dormBaseM = st === "history" ? h.dormCount : dormBase;
    // 기준 거주자(현황): 과거=이력, 현재=운영 현황, 미래=forecast(flat 복사 아님).
    const anchorM = st === "history" ? h.residentCount : st === "current" ? currentResidents : baseRes[m];
    return {
      month: m, planTo: planToM, anchorResidents: anchorM,
      newMoveIn: d.n, expiry: d.e, otherDelta: -d.o, baseResidents: baseRes[m],
      isEstimatePast: st === "history" && !h.hasData, // 재구성 불가(데이터 부족)일 때만 추정
      sourceType: st,
      planToHistDiff: st === "current" ? (h.planTo - capacity) : 0,
      dormBase: dormBaseM, leaseExpiry: leSet[m].size, leaseAdd: laSet[m].size,
      terminationTO: termTO[m], terminationCumulative: termCum[m],
    };
  });
}

// 과거(및 현재) 월별 실적 재구성: 계약/입주 이력의 날짜로 각 월에 유효했던 기숙사(채)/정원(TO)/거주자를 산출.
//  ⚠ 현재 status 로 과거를 지우지 않음 — contractStart/End·moveIn/actualMoveOut 날짜 우선. 데이터 없으면 생성하지 않음(hasData=false).
//  ⚠ 월 단위 판정(일자는 월로 절삭): 유효계약 = 시작월<=대상월 AND (종료월없음 OR 종료월>=대상월). 룸키별 최신 시작 1건 capacity(중복합산 금지).
//     거주자 = 입주(실제→예정)월<=대상월 AND (실제퇴실없음 OR 실제퇴실월>대상월). 사람 distinct.
export function buildMonthlyHistoricalSnapshot(input: {
  occupants: SimOccupant[]; contracts: SimContract[]; year: number; region: "전체" | string; gender: "전체" | "남" | "여";
}): Array<{ month: number; dormCount: number; planTo: number; residentCount: number; capacityMissing: number; hasData: boolean }> {
  const { year, region, gender } = input;
  const scopeMatch = (site: string, g: string) => (region === "전체" || site === region) && (gender === "전체" || g === gender);
  const ymNum = (r: { y: number; m: number }) => r.y * 100 + r.m;
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; const cur = year * 100 + m;
    // 유효 계약 → 룸키별 최신 contractStart 1건(capacity 중복합산 방지).
    const byRoom = new Map<string, { startNum: number; capacity: number | null }>();
    let hasContract = false;
    for (const c of input.contracts) {
      if (!scopeMatch(c.site, c.gender) || !c.dormId) continue;
      const ds = ymOf(c.contractStart); if (!ds) continue; // 시작일 없으면 배치 불가 → 생성 안 함
      const de = ymOf(c.contractEnd);
      if (ymNum(ds) <= cur && (!de || ymNum(de) >= cur)) {
        hasContract = true;
        const startNum = ymNum(ds);
        const cap = (c.capacity == null || Number.isNaN(Number(c.capacity))) ? null : Number(c.capacity);
        const prev = byRoom.get(c.dormId);
        if (!prev || startNum >= prev.startNum) byRoom.set(c.dormId, { startNum, capacity: cap });
      }
    }
    let planTo = 0, capacityMissing = 0;
    for (const v of byRoom.values()) { if (v.capacity == null) capacityMissing++; else planTo += v.capacity; }
    // 유효 거주자(사람 distinct).
    const persons = new Set<string>(); let hasOcc = false;
    input.occupants.forEach((o, idx) => {
      if (!scopeMatch(o.site, o.gender)) return;
      const mi = ymOf(o.moveInDate) ?? ymOf(o.expectedMoveInDate); if (!mi) return;
      hasOcc = true;
      const mo = ymOf(o.actualMoveOutDate);
      if (ymNum(mi) <= cur && (!mo || ymNum(mo) > cur)) persons.add(o.id ?? `#${idx}`);
    });
    return { month: m, dormCount: byRoom.size, planTo, residentCount: persons.size, capacityMissing, hasData: hasContract || hasOcc };
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
