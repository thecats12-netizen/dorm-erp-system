import { useEffect, useMemo, useState } from "react";
import { listContractFiles, getContractFileSignedUrl, type ContractFile } from "../services/contractFileService";
import type { FilePreviewTarget } from "./FilePreviewModal";
import type { DormContract } from "../types/domain";

// 기숙사 상세보기 > 계약서(읽기 전용). 기존 계약 관리 데이터(dorm_contracts) + 첨부(dorm_contract_files)를
//  중복 저장 없이 조회만 한다. 등록/수정/삭제/업로드 없음. 미리보기/다운로드는 기존 서비스·모달 재사용.

const won = (v?: string) => {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const digits = s.replace(/[^0-9]/g, "");
  return digits ? `${Number(digits).toLocaleString()}원` : s;
};
const ymd = (v?: string) => { const s = String(v ?? "").slice(0, 10); return s ? s.replace(/-/g, ".") : "-"; };
const fmtSize = (n?: number) => { const b = Number(n) || 0; if (b <= 0) return ""; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; return `${(b / 1048576).toFixed(1)} MB`; };
const fmtDateTime = (s?: string) => (s ? String(s).slice(0, 16).replace("T", " ") : "");

// 현재 계약 > 만료예정 > 그 외, 그다음 종료일 최신순. 상태 문자열은 프로젝트 정의(한글) 그대로 사용.
const rank = (status?: string) => {
  const s = String(status ?? "");
  if (["진행중", "계약중"].includes(s)) return 0;
  if (["만료예정", "연장"].includes(s)) return 1;
  return 2;
};

export default function DormitoryContractsTab({
  contracts, tenantId, darkMode, canEdit, onPreview, onOpenContractMenu,
}: {
  contracts: DormContract[];      // 이미 이 기숙사로 필터된 계약 목록(부모에서 getDormKey 매칭)
  tenantId: string;
  darkMode?: boolean;
  canEdit?: boolean;
  onPreview: (t: FilePreviewTarget) => void;
  onOpenContractMenu: () => void;  // "계약 관리에서 열기/이동"
}) {
  const [filesByContract, setFilesByContract] = useState<Record<string, ContractFile[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...contracts].sort((a, b) => (rank(a.contractStatus) - rank(b.contractStatus)) || String(b.contractEnd || "").localeCompare(String(a.contractEnd || ""))),
    [contracts],
  );
  const current = sorted.find((c) => rank(c.contractStatus) === 0) || null;

  // 이 기숙사의 계약들에 연결된 첨부만 병렬 조회(N+1 최소화). 탭이 열린 동안 결과 재사용.
  const idsKey = useMemo(() => sorted.map((c) => c.id).join(","), [sorted]);
  useEffect(() => {
    if (sorted.length === 0) { setFilesByContract({}); return; }
    let alive = true;
    setLoading(true); setError(null);
    Promise.all(sorted.map(async (c) => [c.id, await listContractFiles(tenantId, String(c.id))] as const))
      .then((pairs) => { if (alive) setFilesByContract(Object.fromEntries(pairs)); })
      .catch(() => { if (alive) setError("첨부파일 목록을 불러오지 못했습니다."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, tenantId]);

  const preview = async (f: ContractFile) => {
    const url = await getContractFileSignedUrl(f.storage_path);
    if (!url) { setMsg("계약서 미리보기를 열 수 없습니다. 잠시 후 다시 시도해주세요."); return; }
    onPreview({ url, fileName: f.file_name, mime: f.mime });
  };
  const download = async (f: ContractFile) => {
    const url = await getContractFileSignedUrl(f.storage_path, 600, f.file_name || undefined);
    if (!url) { setMsg("파일을 다운로드할 수 없습니다. 잠시 후 다시 시도해주세요."); return; }
    const a = document.createElement("a"); a.href = url; a.download = f.file_name || ""; a.target = "_blank"; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  };

  const rowBtn = darkMode ? "min-h-[40px] rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800" : "min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100";
  const chip = darkMode ? "rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300" : "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600";

  const FileList = ({ contractId }: { contractId: string }) => {
    const files = filesByContract[contractId] || [];
    if (loading && !filesByContract[contractId]) return <p className="text-xs text-slate-400">첨부파일을 불러오는 중…</p>;
    if (files.length === 0) return <p className="text-xs text-slate-500">첨부된 계약서 파일이 없습니다.</p>;
    return (
      <ul className="space-y-1.5">
        {files.map((f) => (
          <li key={f.id} className={`flex flex-col gap-2 rounded-xl px-3 py-2 text-sm sm:flex-row sm:items-center ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className="min-w-0 sm:mr-auto">
              <div className="truncate font-medium" title={f.file_name}>{f.file_name || "(이름 없음)"}</div>
              <div className="mt-0.5 text-xs text-slate-400">{[(f.mime || "").split("/").pop()?.toUpperCase(), fmtSize(f.size_bytes), fmtDateTime(f.created_at)].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={rowBtn} onClick={() => void preview(f)}>미리보기</button>
              <button type="button" className={rowBtn} onClick={() => void download(f)}>다운로드</button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const box = darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4 text-slate-100" : "rounded-3xl border border-slate-200 bg-white p-4 text-slate-900";

  if (sorted.length === 0) {
    return (
      <div className={box}>
        <h4 className="mb-2 text-base font-semibold">계약서</h4>
        <p className="text-sm text-slate-500">등록된 계약이 없습니다.</p>
        <p className="mt-1 text-xs text-slate-400">계약 관리에서 이 기숙사의 임대차 계약을 등록할 수 있습니다.</p>
        {canEdit && <button type="button" className={`mt-3 ${rowBtn}`} onClick={onOpenContractMenu}>계약 관리로 이동</button>}
      </div>
    );
  }

  const contractLine = (c: DormContract) => (
    <div className="grid gap-1.5 text-sm sm:grid-cols-2">
      <div><span className="font-medium text-slate-500">계약구분</span> {c.contractType || "-"}</div>
      <div><span className="font-medium text-slate-500">임대인</span> {c.landlordName || "-"}</div>
      <div className="sm:col-span-2"><span className="font-medium text-slate-500">계약기간</span> {ymd(c.contractStart)} ~ {ymd(c.contractEnd)}</div>
      <div><span className="font-medium text-slate-500">보증금</span> {won(c.deposit)}</div>
      <div><span className="font-medium text-slate-500">월 임대료/관리비</span> {won(c.monthlyRentOrMaintenance)}</div>
      <div><span className="font-medium text-slate-500">계약금액</span> {won(c.contractAmount)}</div>
      <div><span className="font-medium text-slate-500">상태</span> {c.contractStatus || "-"}</div>
      {String(c.notes ?? "").trim() && <div className="sm:col-span-2"><span className="font-medium text-slate-500">특약/비고</span> {String(c.notes).length > 60 ? `${String(c.notes).slice(0, 60)}…` : c.notes}</div>}
    </div>
  );

  return (
    <div className={box}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">계약서</h4>
        {canEdit && <button type="button" className={rowBtn} onClick={onOpenContractMenu}>계약 관리에서 열기</button>}
      </div>

      {/* 현재 계약 강조 */}
      {current && (
        <div className={`mb-4 rounded-2xl border p-3 ${darkMode ? "border-blue-800 bg-blue-950/30" : "border-blue-200 bg-blue-50"}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">현재 계약</span>
            <span className={chip}>{current.contractStatus || "-"}</span>
            <span className="ml-auto text-xs text-slate-500">첨부 {(filesByContract[String(current.id)] || []).length}개</span>
          </div>
          {contractLine(current)}
          <div className="mt-3">{<FileList contractId={String(current.id)} />}</div>
        </div>
      )}

      {/* 과거/기타 계약 이력 */}
      {sorted.filter((c) => c !== current).length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-slate-500">계약 이력</div>
          {sorted.filter((c) => c !== current).map((c) => (
            <div key={String(c.id)} className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={chip}>{c.contractStatus || "-"}</span>
                <span className="text-xs text-slate-400">{ymd(c.contractStart)} ~ {ymd(c.contractEnd)}</span>
                <span className="ml-auto text-xs text-slate-500">첨부 {(filesByContract[String(c.id)] || []).length}개</span>
              </div>
              {contractLine(c)}
              <div className="mt-3"><FileList contractId={String(c.id)} /></div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}
      {msg && <p className="mt-2 text-xs text-amber-600">{msg}</p>}
    </div>
  );
}
