// 군대관리 v2 일정관리 v1.5 — 실무형 SaaS 일정관리(읽기 전용 · 기존 데이터 파생 · 신규 저장/PII 없음).
//  월/주/목록 · KPI drill-down · 유형/상태/부서 필터 · 검색 · 상세/날짜 Drawer · 다가오는 일정 · Excel.
//  ⚠ localStorage cache 생성 금지 · viewer sanitized state 필드만 사용 · PII console 출력 금지.
import { useMemo, useState, useCallback } from "react";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice, MilitaryReport } from "../../types/domain";
import { localYmd } from "./militaryDerive";
import { exportMilitaryXlsx } from "./militaryExport";
import {
  buildMilitaryCalendarEventsV2, groupEventsByDate, calcCalendarKpi, deriveDeptOptions,
  dDayLabel, CAL_KIND_META, CAL_STATUS_META,
} from "./militaryCalendarDerive";
import type { MilitaryCalendarEvent, MilitaryCalEventKind } from "./militaryCalendarTypes";

type QuickFilter = "전체" | "today" | "week" | "7d" | "30d" | "action" | "overdue" | "completed" | "incomplete";
type ViewMode = "month" | "week" | "list";

type Props = {
  darkMode: boolean;
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
  reports: MilitaryReport[];
  deptOf: (p: MilitaryPersonnel) => string;
  onOpenPerson?: (personId: string) => void;
  onNavigateSource?: (kind: MilitaryCalEventKind) => void;
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const KIND_ORDER: MilitaryCalEventKind[] = ["training", "notice", "report", "personnel"];
const QUICK_META: Array<{ key: QuickFilter; label: string }> = [
  { key: "전체", label: "전체" }, { key: "today", label: "오늘" }, { key: "week", label: "이번 주" },
  { key: "7d", label: "7일 이내" }, { key: "30d", label: "30일 이내" },
  { key: "action", label: "조치 필요" }, { key: "overdue", label: "지연" }, { key: "completed", label: "완료" }, { key: "incomplete", label: "미완료" },
];

function inThisWeek(dateStr: string, today: Date): boolean {
  const dow = (today.getDay() + 6) % 7;
  const mon = localYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow));
  const sun = localYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + 6));
  return dateStr >= mon && dateStr <= sun;
}

export default function MilitaryCalendarPanel({
  darkMode, personnel, training, notices, reports, deptOf, onOpenPerson, onNavigateSource,
}: Props) {
  const now = useMemo(() => new Date(), []);
  const todayStr = localYmd(now);
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [view, setView] = useState<ViewMode>("month");
  const [kindF, setKindF] = useState<MilitaryCalEventKind | "전체">("전체");
  const [quickF, setQuickF] = useState<QuickFilter>("전체");
  const [deptF, setDeptF] = useState<string>("전체");
  const [q, setQ] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<MilitaryCalendarEvent | null>(null);

  const allEvents = useMemo(
    () => buildMilitaryCalendarEventsV2({ personnel, training, notices, reports, deptOf, today: now }),
    [personnel, training, notices, reports, deptOf, now],
  );
  const kpi = useMemo(() => calcCalendarKpi(allEvents, now), [allEvents, now]);
  const deptOptions = useMemo(() => deriveDeptOptions(allEvents), [allEvents]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allEvents.filter((e) => {
      if (kindF !== "전체" && e.kind !== kindF) return false;
      if (deptF !== "전체" && (e.dept ?? "") !== deptF) return false;
      switch (quickF) {
        case "today": if (e.date !== todayStr) return false; break;
        case "week": if (!inThisWeek(e.date, now)) return false; break;
        case "7d": if (e.dDay === null || e.dDay < 0 || e.dDay > 7) return false; break;
        case "30d": if (e.dDay === null || e.dDay < 0 || e.dDay > 30) return false; break;
        case "action": if (!e.actionNeeded) return false; break;
        case "overdue": if (e.status !== "overdue") return false; break;
        case "completed": if (e.status !== "completed") return false; break;
        case "incomplete": if (e.status === "completed") return false; break;
        default: break;
      }
      if (needle) {
        const hay = [e.title, e.personnelName, e.dept, CAL_KIND_META[e.kind].label, e.subtype, CAL_STATUS_META[e.status].label]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [allEvents, kindF, deptF, quickF, q, todayStr, now]);

  const byDate = useMemo(() => groupEventsByDate(filtered), [filtered]);
  const upcoming = useMemo(
    () => allEvents.filter((e) => e.dDay !== null && e.dDay >= 0).sort((a, b) => (a.dDay! - b.dDay!) || (a.date < b.date ? -1 : 1)).slice(0, 8),
    [allEvents],
  );

  const moveMonth = useCallback((delta: number) => setCursor((p) => new Date(p.getFullYear(), p.getMonth() + delta, 1)), []);
  const moveWeek = useCallback((delta: number) => setCursor((p) => new Date(p.getFullYear(), p.getMonth(), p.getDate() + delta * 7)), []);
  const goToday = useCallback(() => setCursor(new Date(now.getFullYear(), now.getMonth(), now.getDate())), [now]);
  const onKpiClick = useCallback((qf: QuickFilter) => { setQuickF(qf); setView("list"); }, []);

  const exportXlsx = useCallback(() => {
    const rows = filtered.map((e) => ({
      "날짜": e.date, "D-Day": dDayLabel(e.dDay), "일정유형": CAL_KIND_META[e.kind].label,
      "세부": e.subtype, "제목": e.title, "부서": e.dept ?? "", "상태": CAL_STATUS_META[e.status].label,
      "관련대상": e.personnelName ?? "", "원본메뉴": CAL_KIND_META[e.sourceKind].label,
    }));
    exportMilitaryXlsx(rows, "일정관리", `군대관리_일정관리_${localYmd(new Date())}.xlsx`);
  }, [filtered]);

  // ── 스타일 토큰(기존 군대관리 디자인 재사용) ──
  const card = `rounded-3xl p-4 sm:p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  // 터치 타깃: 모바일 44px 이상(접근성), 데스크톱은 기존 콤팩트 유지(sm: 축소).
  const btn = `inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-medium min-h-[44px] sm:min-h-[40px] transition-colors ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`;
  const input = `rounded-xl border px-3 py-2 text-sm outline-none min-h-[44px] sm:min-h-[40px] ${darkMode ? "border-slate-600 bg-slate-950" : "border-slate-300 bg-white"}`;
  const chip = (active: boolean) => `inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium min-h-[44px] sm:min-h-[36px] transition-colors ${active ? "bg-blue-600 text-white" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;

  const monthTitle = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button className={btn} onClick={goToday}>오늘</button>
            <button className={btn} aria-label="이전" onClick={() => (view === "week" ? moveWeek(-1) : moveMonth(-1))}>◀</button>
            <button className={btn} aria-label="다음" onClick={() => (view === "week" ? moveWeek(1) : moveMonth(1))}>▶</button>
            <h3 className="ml-1 text-base font-semibold">{monthTitle}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {(["month", "week", "list"] as ViewMode[]).map((v) => (
              <button key={v} className={chip(view === v)} onClick={() => setView(v)}>{v === "month" ? "월" : v === "week" ? "주" : "목록"}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·이름·부서 검색" className={`${input} w-40 sm:w-56`} />
            <button className={btn} onClick={exportXlsx}>Excel</button>
          </div>
        </div>

        {/* 유형 필터 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button className={chip(kindF === "전체")} onClick={() => setKindF("전체")}>전체 일정</button>
          {KIND_ORDER.map((k) => (
            <button key={k} className={chip(kindF === k)} onClick={() => setKindF(k)}>
              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${CAL_KIND_META[k].dot}`} />{CAL_KIND_META[k].label}
            </button>
          ))}
          {deptOptions.length > 0 && (
            <select value={deptF} onChange={(e) => setDeptF(e.target.value)} className={`${input} ml-1`}>
              <option value="전체">부서: 전체</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
        {/* 빠른 필터 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {QUICK_META.map((f) => <button key={f.key} className={chip(quickF === f.key)} onClick={() => setQuickF(f.key)}>{f.label}</button>)}
        </div>
      </section>

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          { label: "오늘 일정", value: kpi.today, qf: "today" as QuickFilter, color: "text-blue-600" },
          { label: "이번 주 일정", value: kpi.thisWeek, qf: "week" as QuickFilter, color: "text-indigo-600" },
          { label: "7일 이내", value: kpi.within7, qf: "7d" as QuickFilter, color: "text-amber-600" },
          { label: "조치 필요", value: kpi.actionNeeded, qf: "action" as QuickFilter, color: "text-rose-600" },
        ]).map((k) => (
          <button key={k.label} onClick={() => onKpiClick(k.qf)}
            className={`rounded-2xl border p-4 text-left transition-shadow hover:shadow-md ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k.label}</div>
            <div className={`mt-2 text-3xl font-bold ${k.color}`}>{k.value}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {view === "month" && <MonthView darkMode={darkMode} cursor={cursor} byDate={byDate} todayStr={todayStr} onPickDate={setSelectedDate} onPickEvent={setSelectedEvent} />}
          {view === "week" && <WeekView darkMode={darkMode} cursor={cursor} byDate={byDate} todayStr={todayStr} onPickEvent={setSelectedEvent} card={card} />}
          {view === "list" && <AgendaView darkMode={darkMode} events={filtered} todayStr={todayStr} onPickEvent={setSelectedEvent} card={card} />}
        </div>
        {/* 다가오는 일정 */}
        <UpcomingPanel darkMode={darkMode} events={upcoming} card={card} onPickEvent={setSelectedEvent} onSeeAll={() => setView("list")} />
      </div>

      {/* ── Drawers ── */}
      {selectedEvent && (
        <EventDrawer darkMode={darkMode} event={selectedEvent} onClose={() => setSelectedEvent(null)}
          onOpenPerson={onOpenPerson} onNavigateSource={onNavigateSource} />
      )}
      {selectedDate && (
        <DateDrawer darkMode={darkMode} date={selectedDate} events={byDate.get(selectedDate) ?? []}
          onClose={() => setSelectedDate(null)} onPickEvent={(e) => { setSelectedDate(null); setSelectedEvent(e); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function StatusBadge({ e }: { e: MilitaryCalendarEvent }) {
  const m = CAL_STATUS_META[e.status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium ring-1 ${m.badge}`}>{m.label}</span>;
}

function EventRow({ e, onClick }: { e: MilitaryCalendarEvent; onClick: () => void }) {
  const meta = CAL_KIND_META[e.kind];
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-500/10">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {e.personnelName && e.kind !== "notice" ? <span className="text-slate-500">{e.personnelName} · </span> : null}{e.title}
      </span>
      {e.dDay !== null && (e.dDay <= 7) && <span className="shrink-0 text-[0.65rem] text-slate-400">{dDayLabel(e.dDay)}</span>}
      <StatusBadge e={e} />
    </button>
  );
}

function MonthView({ darkMode, cursor, byDate, todayStr, onPickDate, onPickEvent }: {
  darkMode: boolean; cursor: Date; byDate: Map<string, MilitaryCalendarEvent[]>; todayStr: string;
  onPickDate: (d: string) => void; onPickEvent: (e: MilitaryCalendarEvent) => void;
}) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, date: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  while (cells.length % 7 !== 0) cells.push(null);
  const total = Array.from(byDate.keys()).filter((k) => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).reduce((s, k) => s + (byDate.get(k)?.length ?? 0), 0);

  return (
    <section className={`rounded-3xl p-3 sm:p-4 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-7">
            {WEEK.map((w, i) => <div key={w} className={`px-2 py-1.5 text-center text-xs font-semibold ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{w}</div>)}
          </div>
          <div className={`grid grid-cols-7 gap-px rounded-2xl p-px ${darkMode ? "bg-slate-700" : "bg-slate-200"}`}>
            {cells.map((c, i) => {
              const evs = c ? (byDate.get(c.date) ?? []) : [];
              const isToday = c?.date === todayStr;
              const dense = evs.length >= 5;
              return (
                <div key={i} className={`min-h-[96px] p-1.5 ${darkMode ? "bg-slate-900" : "bg-white"} ${!c ? "opacity-40" : ""}`}>
                  {c && (
                    <>
                      <div className="mb-1 flex items-center justify-between">
                        <button onClick={() => onPickDate(c.date)}
                          className={`text-xs font-medium ${isToday ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-white ring-1 ring-blue-400" : (i % 7 === 0 ? "text-rose-500" : i % 7 === 6 ? "text-blue-500" : "text-slate-500")}`}>
                          {c.day}
                        </button>
                        {dense && <span className="rounded-full bg-rose-100 px-1.5 text-[0.55rem] font-semibold text-rose-600">집중 {evs.length}</span>}
                      </div>
                      <div className="space-y-0.5">
                        {evs.slice(0, 3).map((e) => (
                          <button key={e.id} onClick={() => onPickEvent(e)} title={`${e.title}${e.personnelName ? ` · ${e.personnelName}` : ""}`}
                            className={`flex w-full items-center gap-1 truncate rounded px-1 text-left text-[0.65rem] hover:bg-slate-500/10 ${CAL_KIND_META[e.kind].text} ${e.status === "overdue" ? "font-semibold" : ""}`}>
                            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${CAL_KIND_META[e.kind].dot}`} />
                            <span className="truncate">{e.title}</span>
                          </button>
                        ))}
                        {evs.length > 3 && <button onClick={() => onPickDate(c.date)} className="px-1 text-[0.6rem] text-slate-400 hover:text-slate-600">+{evs.length - 3}건 더보기</button>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {total === 0 && <EmptyState />}
    </section>
  );
}

function WeekView({ darkMode, cursor, byDate, todayStr, onPickEvent, card }: {
  darkMode: boolean; cursor: Date; byDate: Map<string, MilitaryCalendarEvent[]>; todayStr: string;
  onPickEvent: (e: MilitaryCalendarEvent) => void; card: string;
}) {
  const dow = (cursor.getDay() + 6) % 7;
  const monday = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - dow);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { date: localYmd(d), dow: d.getDay(), label: `${d.getMonth() + 1}.${d.getDate()}` };
  });
  const total = days.reduce((s, d) => s + (byDate.get(d.date)?.length ?? 0), 0);
  return (
    <section className={card}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {days.map((d) => {
          const evs = byDate.get(d.date) ?? [];
          const isToday = d.date === todayStr;
          return (
            <div key={d.date} className={`rounded-2xl border p-3 ${isToday ? "border-blue-400 ring-1 ring-blue-200" : darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`text-sm font-semibold ${d.dow === 0 ? "text-rose-500" : d.dow === 6 ? "text-blue-500" : ""}`}>{WEEK[d.dow]} {d.label}</span>
                {isToday && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[0.6rem] text-white">오늘</span>}
                <span className="ml-auto text-xs text-slate-400">{evs.length}건</span>
              </div>
              {evs.length ? <div className="space-y-0.5">{evs.map((e) => <EventRow key={e.id} e={e} onClick={() => onPickEvent(e)} />)}</div>
                : <div className="px-2 py-1 text-xs text-slate-400">일정 없음</div>}
            </div>
          );
        })}
      </div>
      {total === 0 && <EmptyState />}
    </section>
  );
}

function AgendaView({ darkMode, events, todayStr, onPickEvent, card }: {
  darkMode: boolean; events: MilitaryCalendarEvent[]; todayStr: string;
  onPickEvent: (e: MilitaryCalendarEvent) => void; card: string;
}) {
  const groups = useMemo(() => {
    const m = groupEventsByDate(events);
    return Array.from(m.keys()).sort().map((date) => ({ date, items: m.get(date)! }));
  }, [events]);
  if (!events.length) return <section className={card}><EmptyState /></section>;
  const fmt = (date: string) => {
    const d = new Date(date + "T00:00:00");
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
  };
  return (
    <section className={card}>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.date}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`text-sm font-semibold ${g.date === todayStr ? "text-blue-600" : ""}`}>{fmt(g.date)}</span>
              {g.date === todayStr && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[0.6rem] text-white">오늘</span>}
              <span className="text-xs text-slate-400">{g.items.length}건</span>
            </div>
            <div className={`space-y-0.5 rounded-2xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {g.items.map((e) => <EventRow key={e.id} e={e} onClick={() => onPickEvent(e)} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UpcomingPanel({ darkMode, events, card, onPickEvent, onSeeAll }: {
  darkMode: boolean; events: MilitaryCalendarEvent[]; card: string;
  onPickEvent: (e: MilitaryCalendarEvent) => void; onSeeAll: () => void;
}) {
  return (
    <section className={`${card} h-fit`}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">다가오는 일정</h4>
        <button onClick={onSeeAll} className="text-xs text-blue-600 hover:underline">전체 보기</button>
      </div>
      {events.length ? (
        <div className="space-y-1">
          {events.map((e) => (
            <button key={e.id} onClick={() => onPickEvent(e)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-500/10">
              <span className={`w-10 shrink-0 text-center text-xs font-semibold ${e.dDay === 0 ? "text-blue-600" : "text-slate-400"}`}>{dDayLabel(e.dDay)}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${CAL_KIND_META[e.kind].dot}`} />
              <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
            </button>
          ))}
        </div>
      ) : <div className="py-4 text-center text-xs text-slate-400">예정된 일정이 없습니다.</div>}
      {!darkMode && null}
    </section>
  );
}

function DrawerShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900 sm:w-[420px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="닫기" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function EventDrawer({ darkMode, event, onClose, onOpenPerson, onNavigateSource }: {
  darkMode: boolean; event: MilitaryCalendarEvent; onClose: () => void;
  onOpenPerson?: (id: string) => void; onNavigateSource?: (kind: MilitaryCalEventKind) => void;
}) {
  const meta = CAL_KIND_META[event.kind];
  const navLabel: Record<MilitaryCalEventKind, string> = { training: "훈련기록에서 보기", notice: "공지사항에서 보기", report: "보고서에서 보기", personnel: "인사관리에서 보기" };
  const row = (k: string, v?: string) => v ? (
    <div className="flex gap-3 py-1.5 text-sm"><span className="w-20 shrink-0 text-slate-400">{k}</span><span className="min-w-0 flex-1 break-words">{v}</span></div>
  ) : null;
  return (
    <DrawerShell title="일정 상세" onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? "bg-slate-800" : "bg-slate-100"} ${meta.text}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}
        </span>
        <StatusBadge e={event} />
        {event.dDay !== null && <span className="text-xs text-slate-400">{dDayLabel(event.dDay)}</span>}
      </div>
      <div className="mb-3 text-lg font-semibold">{event.title}</div>
      <div className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
        {row("구분", event.subtype)}
        {row("날짜", event.date)}
        {row("부서", event.dept)}
        {row("관련 대상", event.personnelName)}
        {row("요약", event.description)}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {event.kind === "personnel" && event.personnelId && onOpenPerson && (
          <button onClick={() => { onClose(); onOpenPerson(event.personnelId!); }}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">인사 상세 보기</button>
        )}
        {onNavigateSource && (
          <button onClick={() => { onClose(); onNavigateSource(event.sourceKind); }}
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-600 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-100"}`}>
            {navLabel[event.sourceKind]}
          </button>
        )}
      </div>
    </DrawerShell>
  );
}

function DateDrawer({ darkMode, date, events, onClose, onPickEvent }: {
  darkMode: boolean; date: string; events: MilitaryCalendarEvent[];
  onClose: () => void; onPickEvent: (e: MilitaryCalendarEvent) => void;
}) {
  const d = new Date(date + "T00:00:00");
  const title = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 일정`;
  const grouped = KIND_ORDER.map((k) => ({ kind: k, items: events.filter((e) => e.kind === k) })).filter((g) => g.items.length);
  return (
    <DrawerShell title={title} onClose={onClose}>
      {events.length ? grouped.map((g) => (
        <div key={g.kind} className="mb-4">
          <div className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${CAL_KIND_META[g.kind].text}`}>
            <span className={`h-2 w-2 rounded-full ${CAL_KIND_META[g.kind].dot}`} />{CAL_KIND_META[g.kind].label} · {g.items.length}건
          </div>
          <div className={`space-y-0.5 rounded-2xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            {g.items.map((e) => <EventRow key={e.id} e={e} onClick={() => onPickEvent(e)} />)}
          </div>
        </div>
      )) : <div className="py-8 text-center text-sm text-slate-400">이 날짜에 등록된 일정이 없습니다.</div>}
    </DrawerShell>
  );
}

function EmptyState() {
  return (
    <div className="py-12 text-center">
      <div className="text-sm font-medium text-slate-500">등록된 일정이 없습니다.</div>
      <div className="mt-1 text-xs text-slate-400">훈련·공지·보고 일정이 등록되면 자동으로 일정에 표시됩니다.</div>
    </div>
  );
}
