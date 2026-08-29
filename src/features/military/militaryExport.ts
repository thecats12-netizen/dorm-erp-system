// 군대관리 v2 1A — Excel 내보내기 공용 헬퍼(기존 xlsx 재사용 · 신규 라이브러리 없음).
//  · 행은 호출부에서 이미 문자열/마스킹 적용된 {한글헤더: 값} 으로 만들어 전달한다.
//  · UUID/null/undefined/boolean 은 호출부에서 문자열로 정규화(여기서 방어적 재정규화).
import * as XLSX from "xlsx";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  return String(v);
};

export const militaryTodayStamp = (): string => new Date().toISOString().slice(0, 10);

// rows: [{헤더: 값}] · 빈 배열이어도 헤더만이라도 안전 출력.
export function exportMilitaryXlsx(rows: Array<Record<string, unknown>>, sheetName: string, fileName: string): void {
  const safe = (rows.length ? rows : [{}]).map((r) => {
    const o: Record<string, string> = {};
    Object.keys(r).forEach((k) => { o[k] = cell(r[k]); });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(safe);
  ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}
