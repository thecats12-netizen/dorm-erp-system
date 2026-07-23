import { useCallback, useEffect, useState } from "react";
import {
  listContractFiles, uploadContractFiles, getContractFileSignedUrl, softDeleteContractFile,
  isAllowedContractFile, type ContractFile,
} from "../services/contractFileService";
import type { FilePreviewTarget } from "./FilePreviewModal";

const fmtSize = (n?: number) => {
  const b = Number(n) || 0;
  if (b <= 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fmtDate = (s?: string) => (s ? String(s).slice(0, 16).replace("T", " ") : "");

// 계약 첨부파일 섹션 — 계약 등록/수정 모달에 삽입. 기존 계약 저장과 완전 분리(별도 테이블/버킷).
//  · 백엔드(버킷/테이블) 미적용 시에도 throw 없이 "첨부 없음"으로 안전 표시(계약 저장 무영향).
export default function ContractFilesSection({
  contractId, tenantId, userId, darkMode, canEdit, onPreview,
}: {
  contractId: string;
  tenantId: string;
  userId: string;
  darkMode?: boolean;
  canEdit?: boolean;
  onPreview: (t: FilePreviewTarget) => void;
}) {
  const [files, setFiles] = useState<ContractFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null); // 삭제 전 확인(인라인 2단계)
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(async () => {
    if (!contractId) { setFiles([]); return; }
    setFiles(await listContractFiles(tenantId, contractId));
  }, [tenantId, contractId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onPick = async (fileList: FileList | null) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    const bad = arr.filter((f) => !isAllowedContractFile(f.name));
    if (bad.length) { setMsg("PDF, JPG, PNG 파일만 첨부할 수 있습니다."); return; }
    setBusy(true); setMsg(null);
    const res = await uploadContractFiles(tenantId, contractId, userId, arr);
    setBusy(false);
    setMsg(res.ok > 0 ? `${res.ok}개 첨부되었습니다.${res.failed ? ` (${res.failed}개 실패)` : ""}` : (res.message || "첨부에 실패했습니다."));
    await refresh();
  };

  const preview = async (f: ContractFile) => {
    const url = await getContractFileSignedUrl(f.storage_path);
    if (!url) { setMsg("미리보기 URL을 만들 수 없습니다. 첨부 저장소 설정을 확인해 주세요."); return; }
    onPreview({ url, fileName: f.file_name, mime: f.mime });
  };
  const download = async (f: ContractFile) => {
    // 서명 URL 에 원본 파일명(download 옵션)을 실어 Storage UUID 키가 아닌 원본명으로 저장되게 한다.
    const url = await getContractFileSignedUrl(f.storage_path, 600, f.file_name || undefined);
    if (!url) { setMsg("다운로드 URL을 만들 수 없습니다. 첨부 저장소 설정을 확인해 주세요."); return; }
    const a = document.createElement("a"); a.href = url; a.download = f.file_name || ""; a.target = "_blank"; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  };
  const remove = async (f: ContractFile) => {
    setPendingDelete(null);
    if (!(await softDeleteContractFile(f.id))) { setMsg("삭제에 실패했습니다."); return; }
    await refresh();
  };

  const box = darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4";
  const rowBtn = darkMode ? "rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800" : "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100";

  return (
    <div className={box}>
      {/* 상단: 제목 + 설명 */}
      <div className="mb-3">
        <h4 className={darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-700"}>계약 첨부파일</h4>
        <p className="mt-0.5 text-xs text-slate-500">임대차 계약서 또는 관련 이미지를 첨부할 수 있습니다.</p>
      </div>

      {/* 중간: 큰 첨부 버튼(+드래그앤드롭) · 권한 없거나 미저장 시 상태 안내 */}
      {!contractId ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-700">계약을 먼저 저장한 뒤 파일을 첨부할 수 있습니다.</p>
      ) : canEdit ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) void onPick(e.dataTransfer?.files || null); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition
            ${busy ? "cursor-wait opacity-70" : ""}
            ${dragOver ? "border-blue-400 bg-blue-50/60 dark:bg-blue-950/30" : (darkMode ? "border-slate-700 hover:border-slate-500 hover:bg-slate-900" : "border-slate-300 hover:border-slate-400 hover:bg-white")}`}
        >
          <span className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition ${busy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500 focus-within:ring-2 focus-within:ring-blue-300"}`}>
            {/* 업로드 아이콘 */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {busy ? "업로드 중…" : "계약서 파일 첨부"}
          </span>
          <span className="text-xs text-slate-500">PDF, JPG, PNG 파일을 여러 개 첨부할 수 있습니다. (드래그해서 놓아도 됩니다)</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden" disabled={busy} onChange={(e) => { void onPick(e.target.files); e.currentTarget.value = ""; }} />
        </label>
      ) : null}

      {/* 하단: 첨부 목록 */}
      {contractId && (
        <div className="mt-3">
          {files.length === 0 ? (
            <p className="text-xs text-slate-500">첨부된 계약서 파일이 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={f.id} className={`flex flex-col gap-2 rounded-xl px-3 py-2 text-sm sm:flex-row sm:items-center ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                  <div className="min-w-0 sm:mr-auto">
                    <div className="truncate font-medium" title={f.file_name}>{f.file_name || "(이름 없음)"}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{[fmtSize(f.size_bytes), fmtDate(f.created_at)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={rowBtn} onClick={() => void preview(f)}>미리보기</button>
                    <button type="button" className={rowBtn} onClick={() => void download(f)}>다운로드</button>
                    {canEdit && (pendingDelete === f.id ? (
                      <>
                        <button type="button" className={`${rowBtn} !border-rose-500 !bg-rose-600 !text-white`} onClick={() => void remove(f)}>삭제 확인</button>
                        <button type="button" className={rowBtn} onClick={() => setPendingDelete(null)}>취소</button>
                      </>
                    ) : (
                      <button type="button" className={`${rowBtn} !border-rose-300 !text-rose-600`} onClick={() => setPendingDelete(f.id)}>삭제</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-amber-600">{msg}</p>}
    </div>
  );
}
