import { useCallback, useEffect, useState } from "react";
import {
  listContractFiles, uploadContractFiles, getContractFileSignedUrl, softDeleteContractFile,
  isAllowedContractFile, type ContractFile,
} from "../services/contractFileService";
import type { FilePreviewTarget } from "./FilePreviewModal";

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
  const remove = async (f: ContractFile) => {
    if (!(await softDeleteContractFile(f.id))) { setMsg("삭제에 실패했습니다."); return; }
    await refresh();
  };

  const box = darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4";
  const btn = darkMode ? "rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800" : "rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100";

  return (
    <div className={box}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className={darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-700"}>계약 첨부파일 <span className="ml-1 text-xs font-normal text-slate-400">PDF · JPG · PNG</span></h4>
        {canEdit && contractId && (
          <label className={`${btn} cursor-pointer`}>
            {busy ? "업로드 중…" : "파일 첨부"}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden" disabled={busy} onChange={(e) => { void onPick(e.target.files); e.currentTarget.value = ""; }} />
          </label>
        )}
      </div>
      {!contractId ? (
        <p className="text-xs text-slate-500">계약을 먼저 저장한 뒤 파일을 첨부할 수 있습니다.</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-slate-500">첨부된 파일이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${darkMode ? "bg-slate-900" : "bg-white"}`}>
              <span className="mr-auto truncate" title={f.file_name}>{f.file_name || "(이름 없음)"}</span>
              <button type="button" className={btn} onClick={() => void preview(f)}>미리보기</button>
              {canEdit && <button type="button" className={`${btn} !border-rose-300 !text-rose-600`} onClick={() => void remove(f)}>삭제</button>}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-xs text-amber-600">{msg}</p>}
    </div>
  );
}
