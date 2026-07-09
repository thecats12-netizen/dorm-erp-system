import React, { useState, useRef, useEffect } from "react";
import { ChevronRight } from "lucide-react";

// 숫자 입력(음수 허용) — 자체 draft 문자열을 유지해 "-" 만 입력한 중간 상태도 보존.
// 모델에는 number 를 emit(빈 값/"-" 는 0). allowNegative=false 면 음수 차단.
export function NumberInput({
  label,
  value,
  onChange,
  readOnly = false,
  allowNegative = true,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  readOnly?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const lastEmitted = useRef<number>(value);
  // 외부 값이 사용자 입력 외의 이유로 바뀌면(폼 리셋/로드) draft 동기화.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setDraft(value == null ? "" : String(value));
      lastEmitted.current = value;
    }
  }, [value]);
  const handle = (raw: string) => {
    let cleaned = allowNegative ? raw.replace(/[^0-9-]/g, "") : raw.replace(/[^0-9]/g, "");
    // '-' 는 맨 앞 1개만 허용
    if (allowNegative) cleaned = cleaned.replace(/(?!^)-/g, "");
    setDraft(cleaned);
    const n = cleaned === "" || cleaned === "-" ? 0 : Number(cleaned);
    if (!Number.isNaN(n)) {
      lastEmitted.current = n;
      onChange(n);
    }
  };
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type="text"
        inputMode={allowNegative ? "text" : "numeric"}
        value={draft}
        onChange={(e) => handle(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none ${readOnly ? "bg-slate-50" : "focus:border-slate-400"}`}
      />
    </div>
  );
}

// App.tsx 에서 분리한 공용 프레젠테이션 컴포넌트 (순수 — props 기반).
// FilteredDormSelector 등 다른 컴포넌트와 공유하기 위해 모듈 레벨로 이동.

export function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>;
}

export function CompactField({ label, value, className = "", labelClassName = "", valueClassName = "" }: { label: string; value: string; className?: string; labelClassName?: string; valueClassName?: string }) {
  return <div className={`rounded-lg bg-slate-50 p-2 ${className}`}><div className={`font-semibold uppercase tracking-wide text-slate-400 text-[0.625rem] leading-4 whitespace-normal ${labelClassName}`}>{label}</div><div className={`mt-1 text-slate-700 text-[0.75rem] leading-5 whitespace-normal ${valueClassName}`}>{value}</div></div>;
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <div className="lg:col-span-2"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label><select translate="no" lang="en" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate">{options.map((option) => <option translate="no" className="notranslate" key={option} value={option}>{option || "미선택"}</option>)}</select></div>;
}

export function SearchableSelect({ label, value, onChange, options, displayOptions }: { label: string; value: string; onChange: (v: string) => void; options: string[]; displayOptions?: string[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredIndices = options
    .map((option, index) => ({ option, index }))
    .filter(({ option, index }) => {
      const displayText = displayOptions ? displayOptions[index] : option;
      return displayText.toLowerCase().includes(searchTerm.toLowerCase());
    });

  const selectedDisplay = displayOptions ? displayOptions[options.indexOf(value)] : value;

  return (
    <div className="relative notranslate" translate="no" lang="en">
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={selectedDisplay || ""}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate"
          translate="no"
          placeholder="검색해서 선택하세요"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2 notranslate"
          translate="no"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-slate-300 bg-white shadow-lg notranslate" translate="no">
          {filteredIndices.map(({ option, index }) => {
            const displayText = displayOptions ? displayOptions[index] : option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setSearchTerm("");
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-50 notranslate"
                translate="no"
              >
                {displayText}
              </button>
            );
          })}
          {filteredIndices.length === 0 && (
            <div className="px-3 py-2 text-slate-500">검색 결과가 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Input({ label, value, onChange, onBlur, onKeyDown, type = "text", readOnly = false, placeholder }: { label: string; value: string; onChange?: (v: string) => void; onBlur?: () => void; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; type?: string; readOnly?: boolean; placeholder?: string }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (type === "date-text") {
      // 숫자 자리 입력 시 YYYY-MM-DD로 변환
      if (/^\d{8}$/.test(v)) {
        v = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
      }
    }
    onChange?.(v);
  };
  // 날짜 입력(type=date)은 값이 YYYY-MM-DD 여야 표시됨. ISO 타임스탬프(예: 2024-03-01T12:00:00Z)나
  // 시간이 포함된 값은 앞 10자리만 사용해 표시(빈 값으로 보이는 "날짜 초기화" 현상 방지). 폼 상태/저장값은 변경하지 않음.
  const displayValue = type === "date-text" ? String(value || "").slice(0, 10) : value;
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><input type={type === "date-text" ? "date" : type} value={displayValue} onChange={handleChange} onBlur={onBlur} onKeyDown={onKeyDown} readOnly={readOnly} placeholder={type === "date-text" ? undefined : placeholder} className={`w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none ${readOnly ? 'bg-slate-50' : 'focus:border-slate-400'}`} /></div>;
}

export function SelectInput({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: string[]; disabled?: boolean }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><select translate="no" lang="en" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate ${disabled ? "bg-slate-100 text-slate-400" : ""}`}>{options.map((option) => <option translate="no" className="notranslate" key={option || "blank"} value={option}>{option || "미선택"}</option>)}</select></div>;
}
