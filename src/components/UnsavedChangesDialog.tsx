import { useRef } from "react";
import { useRegisteredOverlay, useFocusTrap } from "../hooks/overlayA11y";

// 미저장 변경 확인 Dialog(브라우저 confirm 금지, 기존 디자인 언어 유지).
export function UnsavedChangesDialog({
  open, darkMode, onKeepEditing, onDiscard, onSave,
}: {
  open: boolean; darkMode: boolean; onKeepEditing: () => void; onDiscard: () => void; onSave?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisteredOverlay(open, onKeepEditing);
  useFocusTrap(open, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onKeepEditing}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" tabIndex={-1}
        className={`w-full max-w-sm rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <h3 id="unsaved-title" className="text-lg font-semibold">작성 중인 내용이 있습니다</h3>
        <p className="mt-2 text-sm text-slate-500">저장하지 않은 변경사항이 있습니다. 화면을 닫으시겠습니까?</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onKeepEditing} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>계속 작성</button>
          {onSave && <button type="button" onClick={onSave} className="min-h-[44px] rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">저장 후 닫기</button>}
          <button type="button" onClick={onDiscard} className="min-h-[44px] rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">저장하지 않고 닫기</button>
        </div>
      </div>
    </div>
  );
}
