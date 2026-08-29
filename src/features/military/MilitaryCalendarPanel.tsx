// 군대관리 v2 1A — 일정/캘린더(읽기 전용). 기존 훈련일/이수일/통보 만료일 파생 · 신규 저장 없음 · 외부 라이브러리 없음(CSS Grid).
import { useMemo, useState } from "react";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice } from "../../types/domain";
import { buildMilitaryCalendarEvents, localYmd, type MilitaryCalEvent, type MilitaryCalEventType } from "./militaryDerive";

type Props = {
  darkMode: boolean;
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
};

const TYPE_META: Record<MilitaryCalEventType, { label: string; dot: string; text: string }> = {
  training: { label: "훈련", dot: "bg-blue-500", text: "text-blue-700" },
  completion: { label: "훈련 완료", dot: "bg-emerald-500", text: "text-emerald-700" },
  noticeDue: { label: "통보 마감", dot: "bg-purple-500", text: "text-purple-700" },
};
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export default function MilitaryCalendarPanel({ darkMode, personnel, training, notices }: Props) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() }); // m: 0-11
  const [typeF, setTypeF] = useState<MilitaryCalEventType | "전체">("전체");

  const events = useMemo(() => buildMilitaryCalendarEvents({ personnel, training, notices }), [personnel, training, notices]);
  const byDate = useMemo(() => {
    const m = new Map<string, MilitaryCalEvent[]>();
    const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
    events.forEach((e) => {
      if (!e.date.startsWith(prefix)) return;
      if (typeF !== "전체" && e.type !== typeF) return;
      (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    });
    return m;
  }, [events, ym, typeF]);
  const monthCount = useMemo(() => Array.from(byDate.values()).reduce((s, a) => s + a.length, 0), [byDate]);

  const first = new Date(ym.y, ym.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  while (cells.length % 7 !== 0) cells.push(null);
  const todayStr = localYmd(now);

  const move = (delta: number) => setYm((p) => { const d = new Date(p.y, p.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">일정관리 <span className="text-xs font-normal text-slate-400">(읽기 전용 · 훈련·통보 일정)</span></h3>
          <p className="text-sm text-slate-500">{ym.y}년 {ym.m + 1}월 · 일정 {monthCount}건</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={btn} onClick={() => move(-1)}>◀ 이전달</button>
          <button className={btn} onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>이번달</button>
          <button className={btn} onClick={() => move(1)}>다음달 ▶</button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={typeF} onChange={(e) => setTypeF(e.target.value as MilitaryCalEventType | "전체")} className={inputCls}>
          <option value="전체">유형: 전체</option>
          {(Object.keys(TYPE_META) as MilitaryCalEventType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-slate-500">
          {(Object.keys(TYPE_META) as MilitaryCalEventType[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${TYPE_META[t].dot}`} />{TYPE_META[t].label}</span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7">
            {WEEK.map((w, i) => <div key={w} className={`px-2 py-1.5 text-center text-xs font-semibold ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px rounded-xl bg-slate-200 p-px dark:bg-slate-700">
            {cells.map((c, i) => {
              const evs = c ? (byDate.get(c.date) ?? []) : [];
              const isToday = c?.date === todayStr;
              return (
                <div key={i} className={`min-h-[84px] p-1.5 ${darkMode ? "bg-slate-900" : "bg-white"} ${!c ? "opacity-40" : ""}`}>
                  {c && (
                    <>
                      <div className={`mb-1 text-xs font-medium ${isToday ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white" : (i % 7 === 0 ? "text-rose-500" : i % 7 === 6 ? "text-blue-500" : "text-slate-500")}`}>{c.day}</div>
                      <div className="space-y-0.5">
                        {evs.slice(0, 3).map((e) => (
                          <div key={e.id} className={`flex items-center gap-1 truncate text-[0.65rem] ${TYPE_META[e.type].text}`} title={`${e.label}${e.personName ? ` · ${e.personName}` : ""}`}>
                            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_META[e.type].dot}`} />
                            <span className="truncate">{e.personName ? `${e.personName} ` : ""}{e.label}</span>
                          </div>
                        ))}
                        {evs.length > 3 && <div className="text-[0.6rem] text-slate-400">+{evs.length - 3}건</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {monthCount === 0 && <div className="mt-3 text-center text-xs text-slate-500">이 달에 등록된 일정이 없습니다.</div>}
    </section>
  );
}
