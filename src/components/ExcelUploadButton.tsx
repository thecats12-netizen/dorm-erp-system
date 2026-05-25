
export type ExcelUploadButtonProps = {
  label?: string;
  onChange: (files: FileList | null) => void;
};

export default function ExcelUploadButton({ label = "Excel 업로드", onChange }: ExcelUploadButtonProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
      {label}
      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => onChange(event.target.files)} />
    </label>
  );
}
