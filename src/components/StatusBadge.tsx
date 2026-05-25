
export type StatusBadgeProps = {
  label: string;
  className?: string;
};

export default function StatusBadge({ label, className = "" }: StatusBadgeProps) {
  return <span className={`inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ${className}`}>{label}</span>;
}
