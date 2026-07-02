// 모바일/태블릿 기기 판별 (공통 util). PDF 저장 방식 분기 등에서 사용.
export function isMobileOrTablet(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
}
