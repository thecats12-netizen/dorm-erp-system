// 시험 응시 연번 표시용 포맷터(표시 전용 · DB 저장값은 숫자형 seq_no 그대로 유지).
//  seq_no(int) + year → "YYYY-NNNN". 값이 없으면 빈 문자열(호출부에서 상황별 안내: "자동 생성" / "미지정").
export function formatExamSequence(seqNo: unknown, year: unknown): string {
  const n = Number(seqNo);
  if (!Number.isFinite(n) || n <= 0) return "";
  const y = Number(year);
  const yy = Number.isFinite(y) && y > 0 ? String(Math.trunc(y)) : String(new Date().getFullYear());
  return `${yy}-${String(Math.trunc(n)).padStart(4, "0")}`;
}

// 응시 레코드에서 연번 표시용 기준 연도 도출: 등록일(created_at) 우선, 없으면 현재 연도.
export function examSequenceYear(row: Record<string, unknown> | null | undefined): number {
  const s = String((row?.["created_at"] as unknown) ?? "");
  const m = s.match(/^(\d{4})/);
  return m ? Number(m[1]) : new Date().getFullYear();
}
