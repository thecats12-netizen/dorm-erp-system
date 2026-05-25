
export type ExcelDownloadButtonProps = {
  label?: string;
  onClick: () => void;
};

export default function ExcelDownloadButton({ label = "Excel 다운로드", onClick }: ExcelDownloadButtonProps) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
      {label}
    </button>
  );
}
