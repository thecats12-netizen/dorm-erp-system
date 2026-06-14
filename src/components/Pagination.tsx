import { useEffect, useRef, useState } from "react";

// 공용 페이지네이션 훅 — 필터/검색이 적용된 결과(items)를 받아 20개씩 페이지로 나눈다.
// resetKey(필터/검색 값 문자열)가 바뀌면 1페이지로 초기화. 항목이 줄어 페이지 범위를 벗어나면 자동 보정.
export function usePagination<T>(items: T[], options?: { pageSize?: number; resetKey?: string }) {
  const pageSize = options?.pageSize ?? 20;
  const resetKey = options?.resetKey ?? "";
  const [page, setPage] = useState(1);

  // 필터/검색 변경 시 1페이지로 (resetKey 변화 감지)
  const prevKeyRef = useRef(resetKey);
  useEffect(() => {
    if (prevKeyRef.current !== resetKey) {
      prevKeyRef.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages); // 범위 벗어나면 보정(삭제 등)
  const start = (safePage - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);

  return {
    page: safePage,
    pageSize,
    totalCount,
    totalPages,
    pagedItems,
    goPrev: () => setPage((p) => Math.max(1, Math.min(p, totalPages) - 1)),
    goNext: () => setPage((p) => Math.min(totalPages, p + 1)),
    goPage: (p: number) => setPage(Math.min(totalPages, Math.max(1, p))),
    resetPage: () => setPage(1),
  };
}

// 공용 페이지바 — 전체 N건 / 현재·전체 페이지 / 이전·다음 / 페이지 번호(윈도우) / 모바일 반응형.
export function PaginationBar({
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
  onPage,
  darkMode = false,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  onPage: (p: number) => void;
  darkMode?: boolean;
}) {
  const win = 2;
  const startP = Math.max(1, page - win);
  const endP = Math.min(totalPages, page + win);
  const pages: number[] = [];
  for (let i = startP; i <= endP; i++) pages.push(i);

  const baseBtn = darkMode
    ? "rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
    : "rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-slate-500">전체 {totalCount.toLocaleString()}건 · {page}/{totalPages} 페이지</div>
      <div className="flex items-center gap-1">
        <button type="button" className={baseBtn} onClick={onPrev} disabled={page <= 1}>이전</button>
        {startP > 1 && <span className="px-1 text-xs text-slate-400">…</span>}
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={
              p === page
                ? "rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white"
                : baseBtn
            }
          >
            {p}
          </button>
        ))}
        {endP < totalPages && <span className="px-1 text-xs text-slate-400">…</span>}
        <button type="button" className={baseBtn} onClick={onNext} disabled={page >= totalPages}>다음</button>
      </div>
    </div>
  );
}
