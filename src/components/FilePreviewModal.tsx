import { useEffect, useState } from "react";

// 첨부파일 미리보기 모달 — 다운로드 없이 브라우저에서 바로 확인.
//  · PDF: fetch → Blob(objectURL)로 변환 후 <iframe>/<object> 렌더. base64 data: URL 이나
//    content-type 이 어긋난 URL 도 안정적으로 표시(브라우저 iframe 이 data:PDF 를 못 여는 문제 해결).
//  · 이미지(JPG/PNG/WEBP): 확대/축소/원본 + 인쇄.
//  · 외부 라이브러리 없이 구현. 계약 첨부/비품 증빙 등 어디서나 재사용.
export type FilePreviewTarget = { url: string; fileName?: string; mime?: string } | null;

const isImage = (mime?: string, name?: string) =>
  (!!mime && /^image\//i.test(mime)) || /\.(jpe?g|png|gif|webp)$/i.test(name || "");
const isPdf = (mime?: string, name?: string) =>
  (!!mime && /pdf/i.test(mime)) || /\.pdf$/i.test(name || "");

export default function FilePreviewModal({
  target, darkMode, onClose,
}: {
  target: FilePreviewTarget;
  darkMode?: boolean;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const url = target?.url ?? "";
  const fileName = target?.fileName;
  const mime = target?.mime;
  const image = isImage(mime, fileName);
  const pdf = isPdf(mime, fileName);

  useEffect(() => { setZoom(1); }, [url]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  // PDF 는 fetch → Blob(objectURL)로 변환해 iframe 에서 확실히 렌더. 실패 시 error(다운로드 안내).
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    if (!target || !pdf || !url) { setPdfBlobUrl(null); setPdfState("idle"); return; }
    setPdfState("loading"); setPdfBlobUrl(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw Object.assign(new Error("fetch failed"), { status: res.status });
        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], { type: "application/pdf" });
        created = URL.createObjectURL(blob);
        if (!alive) { URL.revokeObjectURL(created); return; }
        setPdfBlobUrl(created); setPdfState("ready");
      } catch (e) {
        const err = e as { name?: string; message?: string; status?: unknown };
        console.error("[filePreview] pdf preview failed", { fileName, urlType: url.startsWith("data:") ? "data" : url.startsWith("blob:") ? "blob" : "http", errorName: err?.name, errorMessage: err?.message, status: err?.status });
        if (alive) { setPdfState("error"); }
      }
    })();
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pdf]);

  if (!target) return null;

  const printImage = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${fileName || "print"}</title><body style="margin:0;display:flex;align-items:center;justify-content:center"><img src="${url}" style="max-width:100%" onload="window.print()"></body>`);
    w.document.close();
  };

  const btn = `inline-flex items-center justify-center min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-medium ${darkMode ? "border border-slate-600 text-slate-200 hover:bg-slate-800" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div className={`mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        {/* 툴바 */}
        <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <span className="mr-auto truncate text-sm font-medium" title={fileName}>{fileName || "미리보기"}</span>
          {image && (
            <>
              <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}>축소 −</button>
              <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))}>확대 +</button>
              <button type="button" className={btn} onClick={() => setZoom(1)}>원본</button>
              <button type="button" className={btn} onClick={printImage}>인쇄</button>
            </>
          )}
          {/* 새 탭: PDF 는 Blob URL(있으면) 우선 → data:PDF 도 새 탭에서 열림 */}
          <a className={btn} href={pdf && pdfBlobUrl ? pdfBlobUrl : url} target="_blank" rel="noopener noreferrer">새 탭</a>
          <a className={btn} href={url} download={fileName || true}>다운로드</a>
          <button type="button" className={`${btn} !border-rose-300 !text-rose-600`} onClick={onClose}>닫기</button>
        </div>
        {/* 본문 */}
        <div className={`flex-1 overflow-auto ${darkMode ? "bg-slate-950" : "bg-slate-100"}`}>
          {image ? (
            <div className="flex min-h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={fileName || ""} style={{ transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 0.1s" }} className="max-w-full select-none" />
            </div>
          ) : pdf ? (
            pdfState === "ready" && pdfBlobUrl ? (
              <object data={pdfBlobUrl} type="application/pdf" title={fileName || "pdf"} className="h-full w-full" style={{ minHeight: "70vh" }}>
                <iframe title={fileName || "pdf"} src={pdfBlobUrl} className="h-full w-full" style={{ minHeight: "70vh", border: "none" }} />
              </object>
            ) : pdfState === "loading" ? (
              <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">미리보기를 불러오는 중입니다…</div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-500">
                <p>PDF를 미리볼 수 없습니다. 다운로드해 확인해주세요.</p>
                <a className={btn} href={url} download={fileName || true}>다운로드</a>
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-500">
              <p>이미지를 불러오지 못했거나 브라우저 미리보기를 지원하지 않는 형식입니다.</p>
              <a className={btn} href={url} download={fileName || true}>다운로드</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
