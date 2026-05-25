
export type DataTableProps<T> = {
  columns: Array<{ label: string; key: string }>;
  data: T[];
  renderRow: (item: T) => React.ReactNode;
};

export default function DataTable<T>({ columns, data, renderRow }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-12 gap-0 border-b border-slate-200 bg-slate-50 p-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {columns.map((column) => (
          <div key={column.key} className="col-span-2">{column.label}</div>
        ))}
      </div>
      <div className="divide-y divide-slate-200">
        {data.map((item, index) => (
          <div key={index} className="grid grid-cols-12 gap-0 p-4 hover:bg-slate-50">
            {renderRow(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
