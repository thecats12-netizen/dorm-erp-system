
export type SearchFilterBarProps = {
  children: React.ReactNode;
};

export default function SearchFilterBar({ children }: SearchFilterBarProps) {
  return <div className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">{children}</div>;
}
