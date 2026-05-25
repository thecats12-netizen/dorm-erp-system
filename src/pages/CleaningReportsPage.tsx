import type { PageProps } from "./DashboardPage";

export default function CleaningReportsPage({ title, children }: PageProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      </div>
      {children}
    </div>
  );
}
