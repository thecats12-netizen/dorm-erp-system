
export type ImageUploaderProps = {
  label?: string;
  onChange: (file: File | null) => void;
};

export default function ImageUploader({ label = "이미지 업로드", onChange }: ImageUploaderProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
      {label}
      <input type="file" accept="image/*" className="hidden" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  );
}
