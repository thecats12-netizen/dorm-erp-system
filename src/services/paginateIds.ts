// ============================================================================
// DR 롤백 전용 "완전 id 수집기"(keyset pagination, 순수 함수 → 테스트 가능).
//  · PostgREST max_rows(기본 1000) 단일 응답 상한에 기대지 않고, id 오름차순 keyset 으로 끝까지 수집.
//  · 중간 페이지 실패는 그대로 throw(fail-closed) → 부분 결과를 "완전 목록"으로 쓰지 않는다.
//  · 중복 id 감지 시 throw, cap 초과 시 throw(조용한 truncate 금지), 빈 테이블은 정상 [].
// ============================================================================
export async function collectIdsKeyset(opts: {
  pageSize: number;
  cap: number;
  // afterId 이후(초과) id 를 id asc 로 최대 limit 개 반환. 오류 시 throw.
  fetchAfter: (afterId: string | null, limit: number) => Promise<string[]>;
}): Promise<string[]> {
  const { pageSize, cap, fetchAfter } = opts;
  if (!(pageSize > 0)) throw new Error("collectIdsKeyset: pageSize 는 1 이상이어야 합니다.");
  if (!(cap > 0)) throw new Error("collectIdsKeyset: cap 은 1 이상이어야 합니다.");
  const seen = new Set<string>();
  const all: string[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await fetchAfter(after, pageSize); // 실패는 그대로 전파(fail-closed)
    if (!Array.isArray(page)) throw new Error("collectIdsKeyset: fetchAfter 결과가 배열이 아닙니다.");
    if (page.length === 0) break;
    for (const id of page) {
      if (typeof id !== "string" || id.length === 0) throw new Error("collectIdsKeyset: 유효하지 않은 id");
      if (seen.has(id)) throw new Error(`collectIdsKeyset: 중복 id 감지(${id}) — 불안정한 페이지네이션, 중단`);
      seen.add(id);
      all.push(id);
    }
    if (all.length > cap) throw new Error(`collectIdsKeyset: id 수가 상한(${cap}) 초과 — 안전상 중단`);
    if (page.length < pageSize) break; // 마지막 페이지
    after = page[page.length - 1];     // keyset 전진(id asc)
  }
  return all;
}
