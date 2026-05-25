
type DateFilterProps = {
  label: string;
  yearValue: string;
  monthValue: string;
  dayValue: string;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onDayChange: (value: string) => void;
};

const DateFilter = ({
  label,
  yearValue,
  monthValue,
  dayValue,
  onYearChange,
  onMonthChange,
  onDayChange,
}: DateFilterProps) => {
  const currentYear = new Date().getFullYear();
  const years = ["전체", ...Array.from({ length: 10 }, (_, i) => (currentYear - i).toString())];
  const months = ["전체", ...Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, "0"))];
  const days = ["전체", ...Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, "0"))];

  return (
    <div className="lg:col-span-4">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label>
      <div className="flex gap-2">
        <select
          value={yearValue}
          onChange={(e) => onYearChange(e.target.value)}
          className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="전체">연도 전체</option>
          {years.slice(1).map((year) => (
            <option key={year} value={year}>
              {year}년
            </option>
          ))}
        </select>
        <select
          value={monthValue}
          onChange={(e) => onMonthChange(e.target.value)}
          className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="전체">월 전체</option>
          {months.slice(1).map((month) => (
            <option key={month} value={month}>
              {month}월
            </option>
          ))}
        </select>
        <select
          value={dayValue}
          onChange={(e) => onDayChange(e.target.value)}
          className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"
        >
          <option value="전체">일 전체</option>
          {days.slice(1).map((day) => (
            <option key={day} value={day}>
              {day}일
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default DateFilter;
