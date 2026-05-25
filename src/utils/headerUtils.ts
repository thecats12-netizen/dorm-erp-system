export const normalizeHeaderName = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-zㄱ-ㅎㅏ-ㅣ가-힣]/g, "");
