// 시험 보고서 차트 모음(외부 라이브러리 없음 · inline SVG · 반응형). 데이터 source 동일 · 표현만 변경.
//  ExamReportsPage 가 커지지 않도록 차트 렌더러만 분리(App.tsx/라우팅 무관).
import type { ReactNode } from "react";
import { RC } from "./examReportColors";

// 월별 계획/실적 추이(2 series, 12개월). type 에 따라 표현만 바뀐다.
export function TrendChart({ type, plan, actual, darkMode }: { type: string; plan: number[]; actual: number[]; darkMode: boolean }) {
  const W = 760, H = 240, padL = 34, padR = 14, padT = 14, padB = 26, n = 12;
  const grid = darkMode ? "#334155" : "#e2e8f0";
  const axis = darkMode ? "#64748b" : "#94a3b8";
  const planT = plan.reduce((s, v) => s + v, 0), actualT = actual.reduce((s, v) => s + v, 0);

  // 도넛: 계획 총합 vs 실적 총합(달성 비교).
  if (type === "도넛") return <Donut darkMode={darkMode} items={[{ label: "계획", value: Math.round(planT), color: RC.plan }, { label: "실적", value: Math.round(actualT), color: RC.actual }]} />;

  // 가로 막대: 월별 계획/실적을 가로 그룹 막대.
  if (type === "가로 막대") {
    const max = Math.max(1, ...plan, ...actual);
    return (
      <div className="space-y-1">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="flex items-center gap-2 text-[0.65rem]">
            <span className="w-6 shrink-0 text-right text-slate-400">{i + 1}월</span>
            <div className="flex-1 space-y-0.5">
              <div className="h-2.5 rounded" style={{ width: `${(plan[i] / max) * 100}%`, background: RC.plan, minWidth: plan[i] ? 2 : 0 }} />
              <div className="h-2.5 rounded" style={{ width: `${(actual[i] / max) * 100}%`, background: RC.actual, minWidth: actual[i] ? 2 : 0 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const stacked = type === "누적 막대";
  const max = Math.max(1, ...(stacked ? plan.map((v, i) => v + actual[i]) : [...plan, ...actual]));
  const gx = (i: number) => padL + (i * (W - padL - padR)) / (n - 1);
  const gy = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const bw = (W - padL - padR) / n / 2.6;
  const poly = (arr: number[], color: string, fill: boolean) => {
    const pts = arr.map((v, i) => `${gx(i)},${gy(v)}`).join(" ");
    return fill
      ? <polygon points={`${gx(0)},${gy(0)} ${pts} ${gx(n - 1)},${gy(0)}`} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="2" />
      : <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 240 }} role="img" aria-label="월별 계획 실적 차트">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => { const y = padT + t * (H - padT - padB); return <line key={t} x1={padL} y1={y} x2={W - padR} y2={y} stroke={grid} strokeWidth="1" />; })}
      {Array.from({ length: n }, (_, i) => <text key={i} x={gx(i)} y={H - 8} fontSize="10" fill={axis} textAnchor="middle">{i + 1}</text>)}
      <text x={padL} y={padT + 2} fontSize="10" fill={axis} textAnchor="end">{Math.round(max)}</text>
      {type === "세로 막대" ? (
        Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <rect x={gx(i) - bw - 1} y={gy(plan[i])} width={bw} height={Math.max(0, H - padB - gy(plan[i]))} fill={RC.plan} rx="1" />
            <rect x={gx(i) + 1} y={gy(actual[i])} width={bw} height={Math.max(0, H - padB - gy(actual[i]))} fill={RC.actual} rx="1" />
          </g>
        ))
      ) : stacked ? (
        Array.from({ length: n }, (_, i) => {
          const yA = gy(actual[i]); const yP = gy(actual[i] + plan[i]);
          return (
            <g key={i}>
              <rect x={gx(i) - bw} y={yA} width={bw * 2} height={Math.max(0, H - padB - yA)} fill={RC.actual} rx="1" />
              <rect x={gx(i) - bw} y={yP} width={bw * 2} height={Math.max(0, yA - yP)} fill={RC.plan} rx="1" />
            </g>
          );
        })
      ) : type === "영역" ? (
        <>{poly(plan, RC.plan, true)}{poly(actual, RC.actual, true)}</>
      ) : type === "혼합" ? (
        <>{Array.from({ length: n }, (_, i) => <rect key={i} x={gx(i) - bw} y={gy(actual[i])} width={bw * 2} height={Math.max(0, H - padB - gy(actual[i]))} fill={RC.actual} rx="1" />)}
          {poly(plan, RC.plan, false)}{plan.map((v, i) => <circle key={i} cx={gx(i)} cy={gy(v)} r="2.5" fill={RC.plan} />)}</>
      ) : (
        <>{poly(plan, RC.plan, false)}{poly(actual, RC.actual, false)}
          {plan.map((v, i) => <circle key={`p${i}`} cx={gx(i)} cy={gy(v)} r="2.5" fill={RC.plan} />)}
          {actual.map((v, i) => <circle key={`a${i}`} cx={gx(i)} cy={gy(v)} r="2.5" fill={RC.actual} />)}
        </>
      )}
    </svg>
  );
}

// 가로 막대 분포(그룹별/제품군별/공정별/응시상태 등).
export function BarDistribution({ items, color, darkMode }: { items: Array<{ label: string; value: number }>; color: string; darkMode: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <div className="py-6 text-center text-xs text-slate-400">데이터 없음</div>;
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-slate-500" title={it.label}>{it.label}</span>
          <div className={`h-3 flex-1 rounded ${darkMode ? "bg-slate-700/60" : "bg-slate-200/70"}`}><div className="h-3 rounded" style={{ width: `${(it.value / max) * 100}%`, background: color, minWidth: it.value ? 2 : 0 }} /></div>
          <span className="w-8 shrink-0 text-right font-medium">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// 도넛(다중 슬라이스: 조기/정상/지연, 계획/실적 등).
export function Donut({ items, darkMode, size = 150 }: { items: Array<{ label: string; value: number; color: string }>; darkMode: boolean; size?: number }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = size / 2, r = R * 0.62, cx = R, cy = R;
  let a0 = -Math.PI / 2;
  const arc = (v: number): string => {
    const frac = total > 0 ? v / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (ang: number, rad: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M ${pt(a0, R)} A ${R} ${R} 0 ${large} 1 ${pt(a1, R)} L ${pt(a1, r)} A ${r} ${r} 0 ${large} 0 ${pt(a0, r)} Z`;
    a0 = a1;
    return d;
  };
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} role="img" aria-label="비율 도넛">
        {total === 0 ? <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={darkMode ? "#334155" : "#e2e8f0"} strokeWidth={R - r} />
          : items.map((it, i) => <path key={i} d={arc(it.value)} fill={it.color} />)}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="600" fill={darkMode ? "#e2e8f0" : "#334155"}>{total}</text>
      </svg>
      <div className="space-y-1 text-xs">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
            <span className="text-slate-500">{it.label}</span>
            <span className="font-medium">{it.value}</span>
            <span className="text-slate-400">({total > 0 ? Math.round((it.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 접기/펼치기 카드 래퍼.
export function Collapsible({ title, open, onToggle, darkMode, children }: { title: string; open: boolean; onToggle: () => void; darkMode: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
        <span>{title}</span><span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
