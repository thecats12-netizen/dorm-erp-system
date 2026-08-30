// 군대관리 v2 일정관리 v1.5 — 캘린더 파생 계산(순수 함수 · DB 조회 0 · 신규 저장 없음 · PII 미출력).
//  기존 데이터(인사/훈련/통보/보고)에서만 파생. 존재하는 날짜 필드만 사용(임의 필드 생성 금지).
//  날짜 계산은 localYmd 재사용(toISOString UTC 밀림 방지).
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice, MilitaryReport } from "../../types/domain";
import { localYmd } from "./militaryDerive";
import type {
  MilitaryCalendarEvent, MilitaryCalEventStatus, MilitaryCalEventKind, MilitaryCalKpi,
} from "./militaryCalendarTypes";

const ymd = (v: unknown) => String(v ?? "").slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const alive = (o: { isDeleted?: boolean; isPermanentDeleted?: boolean }) => !o.isDeleted && !o.isPermanentDeleted;
const isDone = (status: unknown) => /(완료|이수|승인|제출완료|발송완료)/.test(String(status ?? ""));

// 오늘(로컬 자정) 기준 일수. 양수=미래, 0=오늘, 음수=과거. 무효=null.
export function dDayFrom(dateStr: unknown, today: Date): number | null {
  const s = ymd(dateStr);
  if (!isYmd(s)) return null;
  const t0 = new Date(localYmd(today) + "T00:00:00").getTime();
  return Math.round((new Date(s + "T00:00:00").getTime() - t0) / 86400000);
}

// D-Day 라벨: 미래 D-n / 오늘 D-0(오늘) / 과거 지연 n일. 무효=빈 문자열.
export function dDayLabel(d: number | null): string {
  if (d === null) return "";
  if (d > 0) return `D-${d}`;
  if (d === 0) return "D-0";
  return `지연 ${Math.abs(d)}일`;
}

// 상태 계산: completed(정보성 완료) 우선, 그다음 조치성(overdue/dueSoon/upcoming), 나머지 normal.
function calcStatus(input: { done: boolean; actionable: boolean; d: number | null }): MilitaryCalEventStatus {
  const { done, actionable, d } = input;
  if (done) return "completed";
  if (d === null) return "normal";
  if (actionable) {
    if (d < 0) return "overdue";
    if (d <= 7) return "dueSoon";
    return "upcoming";
  }
  // 정보성(입대/전역/게시 등): 미래는 upcoming, 과거/오늘은 normal
  return d > 0 ? "upcoming" : "normal";
}

// 캘린더 이벤트 파생. deptOf 는 App 의 militaryDeptOf 재사용(부서=unit).
export function buildMilitaryCalendarEventsV2(input: {
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
  reports: MilitaryReport[];
  deptOf: (p: MilitaryPersonnel) => string;
  today?: Date;
}): MilitaryCalendarEvent[] {
  const { personnel, training, notices, reports, deptOf } = input;
  const today = input.today ?? new Date();
  const pById = new Map(personnel.map((p) => [p.id, p]));
  const out: MilitaryCalendarEvent[] = [];

  // TRAINING — 훈련예정일 + 이수일
  training.filter(alive).forEach((r) => {
    const p = pById.get(r.personnelId);
    const dept = p ? deptOf(p) : "미지정";
    const nm = p?.name ?? "-";
    const subj = r.subject || r.trainingType || "훈련";
    const st = String(r.status ?? "");
    if (isYmd(ymd(r.trainingDate))) {
      const done = isDone(st);
      const d = dDayFrom(r.trainingDate, today);
      // 조치성: 미이수 이거나(완료 아님 & 예정) — 조치대상(buildMilitaryActionItems)과 동일 개념
      const actionable = !done;
      out.push({
        id: `train-${r.id}`, sourceId: r.id, kind: "training", sourceKind: "training",
        subtype: /미이수/.test(st) ? "훈련 미이수" : "훈련 예정",
        title: subj, date: ymd(r.trainingDate), status: calcStatus({ done, actionable, d }),
        dept, personnelId: r.personnelId, personnelName: nm,
        description: [r.trainingType, r.location].filter(Boolean).join(" · ") || undefined,
        actionNeeded: actionable && (d === null ? /미이수/.test(st) : d <= 7 || /미이수/.test(st)),
        dDay: d,
      });
    }
    if (isYmd(ymd(r.completionDate))) {
      const d = dDayFrom(r.completionDate, today);
      out.push({
        id: `train-done-${r.id}`, sourceId: r.id, kind: "training", sourceKind: "training",
        subtype: "훈련 이수", title: `이수: ${subj}`, date: ymd(r.completionDate),
        status: "completed", dept, personnelId: r.personnelId, personnelName: nm,
        actionNeeded: false, dDay: d,
      });
    }
  });

  // NOTICE — 게시일 + 마감일
  notices.forEach((n) => {
    const names = (n.personnelIds || []).map((id) => pById.get(id)?.name).filter(Boolean).join(", ");
    const firstPid = (n.personnelIds || [])[0];
    const firstDept = firstPid ? (pById.get(firstPid) ? deptOf(pById.get(firstPid)!) : "미지정") : "미지정";
    if (isYmd(ymd(n.publishedDate))) {
      const d = dDayFrom(n.publishedDate, today);
      out.push({
        id: `notice-pub-${n.id}`, sourceId: n.id, kind: "notice", sourceKind: "notice",
        subtype: "통보 게시", title: `게시: ${n.title || "통보서"}`, date: ymd(n.publishedDate),
        status: calcStatus({ done: false, actionable: false, d }),
        dept: firstDept, personnelName: names || undefined, description: n.category || undefined,
        actionNeeded: false, dDay: d,
      });
    }
    if (isYmd(ymd(n.expiresDate))) {
      const d = dDayFrom(n.expiresDate, today);
      const unpublished = !ymd(n.publishedDate);              // 미게시 = 조치 필요(대시보드 KPI 기준과 정합)
      out.push({
        id: `notice-due-${n.id}`, sourceId: n.id, kind: "notice", sourceKind: "notice",
        subtype: "통보 마감", title: `마감: ${n.title || "통보서"}`, date: ymd(n.expiresDate),
        status: calcStatus({ done: !unpublished && (d !== null && d < 0), actionable: unpublished, d }),
        dept: firstDept, personnelName: names || undefined, description: n.sentStatus || undefined,
        actionNeeded: unpublished, dDay: d,
      });
    }
  });

  // REPORT — 보고일
  reports.forEach((r) => {
    if (!isYmd(ymd(r.reportDate))) return;
    const done = isDone(r.status);
    const d = dDayFrom(r.reportDate, today);
    const actionable = !done;
    out.push({
      id: `report-${r.id}`, sourceId: r.id, kind: "report", sourceKind: "report",
      subtype: "보고", title: r.title || "보고서", date: ymd(r.reportDate),
      status: calcStatus({ done, actionable, d }),
      dept: r.type || undefined, personnelName: r.author || undefined, description: r.status || undefined,
      actionNeeded: actionable && d !== null && d <= 7,
      dDay: d,
    });
  });

  // PERSONNEL — 입대일 + 전역일(정보성)
  personnel.filter(alive).forEach((p) => {
    const dept = deptOf(p);
    if (isYmd(ymd(p.enlistmentDate))) {
      const d = dDayFrom(p.enlistmentDate, today);
      out.push({
        id: `person-enl-${p.id}`, sourceId: p.id, kind: "personnel", sourceKind: "personnel",
        subtype: "입대", title: `입대: ${p.name || "-"}`, date: ymd(p.enlistmentDate),
        status: calcStatus({ done: false, actionable: false, d }),
        dept, personnelId: p.id, personnelName: p.name || "-", description: p.rank || undefined,
        actionNeeded: false, dDay: d,
      });
    }
    if (isYmd(ymd(p.dischargeDate))) {
      const d = dDayFrom(p.dischargeDate, today);
      out.push({
        id: `person-dis-${p.id}`, sourceId: p.id, kind: "personnel", sourceKind: "personnel",
        subtype: "전역", title: `전역: ${p.name || "-"}`, date: ymd(p.dischargeDate),
        status: calcStatus({ done: false, actionable: false, d }),
        dept, personnelId: p.id, personnelName: p.name || "-", description: p.rank || undefined,
        actionNeeded: false, dDay: d,
      });
    }
  });

  // 정렬: 날짜 오름차순, 동일 날짜는 조치필요 우선
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (Number(b.actionNeeded) - Number(a.actionNeeded))));
  return out;
}

// 날짜별 그룹(Map<YYYY-MM-DD, events[]>) — render 시 반복 filter 회피용.
export function groupEventsByDate(events: MilitaryCalendarEvent[]): Map<string, MilitaryCalendarEvent[]> {
  const m = new Map<string, MilitaryCalendarEvent[]>();
  for (const e of events) {
    const arr = m.get(e.date);
    if (arr) arr.push(e); else m.set(e.date, [e]);
  }
  return m;
}

// KPI 계산(오늘/이번 주(월~일)/7일 이내/조치 필요).
export function calcCalendarKpi(events: MilitaryCalendarEvent[], today: Date = new Date()): MilitaryCalKpi {
  const todayStr = localYmd(today);
  // 이번 주 = 이번 주 월요일~일요일
  const dow = (today.getDay() + 6) % 7; // 월=0 … 일=6
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow);
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + 6);
  const wkStart = localYmd(monday), wkEnd = localYmd(sunday);
  let todayN = 0, weekN = 0, within7 = 0, action = 0;
  for (const e of events) {
    if (e.date === todayStr) todayN++;
    if (e.date >= wkStart && e.date <= wkEnd) weekN++;
    if (e.dDay !== null && e.dDay >= 0 && e.dDay <= 7) within7++;
    if (e.actionNeeded) action++;
  }
  return { today: todayN, thisWeek: weekN, within7, actionNeeded: action };
}

// 부서 옵션 derive(기존 인사/훈련 데이터에서 · 신규 기준정보 생성 없음).
export function deriveDeptOptions(events: MilitaryCalendarEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) if (e.dept && e.dept !== "-") set.add(e.dept);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

export const CAL_KIND_META: Record<MilitaryCalEventKind, { label: string; dot: string; text: string; ring: string }> = {
  training: { label: "훈련", dot: "bg-blue-500", text: "text-blue-700", ring: "ring-blue-200" },
  notice: { label: "공지", dot: "bg-purple-500", text: "text-purple-700", ring: "ring-purple-200" },
  report: { label: "보고", dot: "bg-cyan-600", text: "text-cyan-700", ring: "ring-cyan-200" },
  personnel: { label: "인사", dot: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200" },
};

export const CAL_STATUS_META: Record<MilitaryCalEventStatus, { label: string; badge: string }> = {
  normal: { label: "일반", badge: "bg-slate-100 text-slate-600 ring-slate-200" },
  upcoming: { label: "예정", badge: "bg-blue-50 text-blue-700 ring-blue-200" },
  dueSoon: { label: "임박", badge: "bg-amber-50 text-amber-700 ring-amber-200" },
  overdue: { label: "지연", badge: "bg-rose-50 text-rose-700 ring-rose-200" },
  completed: { label: "완료", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};
