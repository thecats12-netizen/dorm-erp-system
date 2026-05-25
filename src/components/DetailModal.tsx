
export type DetailModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
};

export default function DetailModal({ title, children, onClose }: DetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-4xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-full border border-slate-200 p-2 hover:bg-slate-50">닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}
