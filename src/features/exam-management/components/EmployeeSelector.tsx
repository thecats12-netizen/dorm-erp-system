// 시험관리 공통 사원 선택 컴포넌트(신규 · 조회 전용 기반).
//  - 사번/이름 검색, 자동완성, 키보드 이동(↑↓/Enter/ESC), 최근 선택, 로딩/빈결과/오류 상태, 재직/퇴사 표시.
//  - 기존 디자인 시스템(slate/dark) 유지. 아직 어떤 등록 화면에도 연결하지 않는다(기반만).
import { useEffect, useId, useRef, useState } from "react";
import { useEmployeeLookup } from "../hooks/useEmployeeLookup";
import type { EmployeeLite } from "../types/employeeLookup";

type Props = {
  value?: EmployeeLite | null;
  onChange: (employee: EmployeeLite | null) => void;
  tenantId: string;
  disabled?: boolean;
  placeholder?: string;
  includeInactive?: boolean;
  autoFocus?: boolean;
  error?: string;
  helperText?: string;
  darkMode?: boolean;
};

const statusBadge = (s?: string | null) => {
  const t = String(s ?? "");
  if (/퇴직|퇴사/.test(t)) return { label: "퇴사", cls: "bg-rose-100 text-rose-700" };
  if (/휴직/.test(t)) return { label: "휴직", cls: "bg-amber-100 text-amber-700" };
  return { label: "재직", cls: "bg-emerald-100 text-emerald-700" };
};

export default function EmployeeSelector({
  value, onChange, tenantId, disabled, placeholder, includeInactive, autoFocus, error, helperText, darkMode,
}: Props) {
  const { query, setQuery, results, isLoading, error: searchError, recentEmployees, selectEmployee } =
    useEmployeeLookup(tenantId, { includeInactive });
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const items = query.trim().length >= 2 ? results : [];
  const showRecent = open && query.trim().length < 2 && recentEmployees.length > 0;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => { setActiveIdx(-1); }, [results, query]);

  const pick = (e: EmployeeLite) => {
    onChange(e);
    selectEmployee({ id: e.id, employeeNo: e.employeeNo, name: e.name });
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (ev.key === "Escape") { setOpen(false); return; }
    if (!open && ev.key === "ArrowDown") { setOpen(true); return; }
    if (!open) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActiveIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (activeIdx >= 0 && items[activeIdx]) pick(items[activeIdx]); }
  };

  const inputCls = darkMode
    ? "w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-400"
    : "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400";
  const panelCls = darkMode ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-white text-slate-700";
  const rowHover = darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100";

  // 선택 완료 표시(칩)
  if (value) {
    const b = statusBadge(value.employmentStatus);
    return (
      <div>
        <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${panelCls}`}>
          <div className="min-w-0 truncate">
            <span className="font-semibold">{value.name}</span> <span className="text-slate-400">({value.employeeNo})</span>
            <span className="ml-2 text-xs text-slate-400">{[value.group, value.productFamily, value.part].filter(Boolean).join(" · ")}</span>
            <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${b.cls}`}>{b.label}</span>
          </div>
          {!disabled && (
            <button type="button" className="shrink-0 text-xs text-slate-500 hover:text-rose-600" onClick={() => onChange(null)}>변경</button>
          )}
        </div>
        {helperText && !error && <p className="mt-1 text-xs text-slate-400">{helperText}</p>}
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder || "사번 또는 이름 검색 (2글자 이상)"}
        className={`${inputCls} ${error ? "border-rose-400" : ""}`}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && (
        <div id={listId} role="listbox" className={`absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border shadow-lg ${panelCls}`}>
          {isLoading && <div className="px-3 py-3 text-sm text-slate-400">검색 중…</div>}
          {!isLoading && searchError && <div className="px-3 py-3 text-sm text-rose-600">{searchError}</div>}

          {!isLoading && !searchError && showRecent && (
            <>
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-slate-400">최근 선택</div>
              {recentEmployees.map((r) => (
                <button
                  key={`recent-${r.id}`} type="button"
                  className={`block w-full px-3 py-2 text-left text-sm ${rowHover}`}
                  onClick={() => pick({ id: r.id, employeeNo: r.employeeNo, name: r.name })}
                >
                  <span className="font-medium">{r.name}</span> <span className="text-slate-400">({r.employeeNo})</span>
                </button>
              ))}
            </>
          )}

          {!isLoading && !searchError && query.trim().length >= 2 && items.length === 0 && (
            <div className="px-3 py-3 text-sm text-slate-400">검색 결과가 없습니다.</div>
          )}

          {!isLoading && !searchError && items.map((e, i) => {
            const b = statusBadge(e.employmentStatus);
            return (
              <button
                key={e.id} type="button" role="option" aria-selected={i === activeIdx}
                className={`block w-full px-3 py-2 text-left text-sm ${i === activeIdx ? (darkMode ? "bg-slate-800" : "bg-slate-100") : ""} ${rowHover}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(e)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{e.name}</span> <span className="text-slate-400">({e.employeeNo})</span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${b.cls}`}>{b.label}</span>
                </div>
                <div className="truncate text-xs text-slate-400">
                  {[e.group, e.productFamily, e.part].filter(Boolean).join(" · ") || "-"}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {helperText && !error && <p className="mt-1 text-xs text-slate-400">{helperText}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
