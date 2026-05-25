
export type AuditTimelineItem = {
  title: string;
  description: string;
  date: string;
};

export type AuditTimelineProps = {
  items: AuditTimelineItem[];
};

export default function AuditTimeline({ items }: AuditTimelineProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.date} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-900">{item.title}</div>
            <div className="text-xs text-slate-500">{item.date}</div>
          </div>
          <p className="mt-2 text-sm text-slate-600">{item.description}</p>
        </div>
      ))}
    </div>
  );
}
