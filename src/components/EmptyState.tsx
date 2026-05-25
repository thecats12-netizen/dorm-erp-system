
export type EmptyStateProps = {
  title: string;
  description?: string;
};

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <div className="text-lg font-semibold text-slate-900">{title}</div>
      {description ? <div className="mt-2 text-sm text-slate-500">{description}</div> : null}
    </div>
  );
}
