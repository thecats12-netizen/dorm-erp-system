import { isMobileOrTablet } from "./isMobileOrTablet";

// PDF Blob 을 기기에 맞게 안전 저장.
// - 모바일/태블릿 + Web Share(파일) 지원 → navigator.share 로 "파일/메모/노트 앱 저장" (iOS/Android 공용).
// - 지원 안 하면 새 탭에서 PDF 열기(사용자가 브라우저 저장).
// - PC → 기존 <a download> 다운로드.
// - Blob URL 은 즉시 해제하지 않고 120초 후 revoke (모바일 "파일에 액세스할 수 없음" 방지).
export async function savePdfSafely(fileName: string, blob: Blob): Promise<boolean> {
  if (!blob || blob.size === 0) {
    throw new Error("PDF Blob is empty");
  }

  const safeName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  const file = new File([blob], safeName, { type: "application/pdf" });
  const mobile = isMobileOrTablet();

  // 1) 모바일 + Web Share(파일 공유) 지원 → 공유 시트로 저장(파일 앱/메모/드라이브 등)
  if (
    mobile &&
    typeof navigator !== "undefined" &&
    (navigator as any).share &&
    (navigator as any).canShare &&
    (navigator as any).canShare({ files: [file] })
  ) {
    try {
      await (navigator as any).share({ title: safeName, text: "PDF 저장", files: [file] });
      return true;
    } catch (err) {
      // 사용자가 공유를 취소(AbortError)하면 조용히 종료. 그 외엔 아래 새 탭 열기로 진행.
      if ((err as { name?: string })?.name === "AbortError") return false;
    }
  }

  const url = URL.createObjectURL(blob);

  // 2) 모바일(공유 미지원) → 새 탭에서 PDF 열기. blob URL 로의 location 이동은 하지 않는다.
  if (mobile) {
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 120000);
    return true;
  }

  // 3) PC → 기존 다운로드 방식 유지
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 120000);
  return true;
}
