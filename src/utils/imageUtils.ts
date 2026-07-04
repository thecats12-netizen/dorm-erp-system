// 이미지 업로드 공통 유틸 — HEIC/HEIF(아이폰 기본 포맷) 자동 JPG 변환.
// 브라우저 대부분이 HEIC 를 <img>/canvas 로 디코딩하지 못해 썸네일/미리보기/PDF 가 깨진다.
// 업로드 진입점에서 normalizeUploadImage() 를 거치면 HEIC 만 JPG(File)로 변환되고,
// JPG/PNG/WEBP 등은 그대로 반환되어 기존 업로드/압축/저장 로직을 그대로 탄다.

// 파일이 HEIC/HEIF 인지 판별 — MIME(type) 또는 확장자로 확인.
// (일부 브라우저/기기는 HEIC 의 file.type 을 빈 문자열로 주므로 확장자도 함께 검사)
export function isHeicFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    type === "image/heic-sequence" ||
    type === "image/heif-sequence" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

// HEIC/HEIF File → JPEG File 변환. heic2any 는 용량이 커서 필요할 때만 동적 import.
// 변환 실패 시 예외를 던진다(호출부에서 안내 문구 처리).
export async function convertHeicToJpeg(file: File): Promise<File> {
  const mod = await import("heic2any");
  const heic2any = (mod as { default: (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]> }).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
  // 다중 이미지(HEIC 시퀀스)면 첫 프레임 사용.
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const baseName = (file.name || "photo").replace(/\.(heic|heif)$/i, "");
  return new File([blob], `${baseName || "photo"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

// 업로드 직전 정규화: HEIC/HEIF 만 JPG 로 변환, 그 외(JPG/PNG/WEBP 등)는 원본 그대로.
export async function normalizeUploadImage(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  return convertHeicToJpeg(file);
}
