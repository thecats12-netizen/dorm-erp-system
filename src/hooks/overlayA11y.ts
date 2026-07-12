// 자체(로컬 상태) 오버레이를 앱 공통 키보드/닫기 시스템(closeTopOverlay·hasOpenOverlay·popstate·ESC)에
// 연결하기 위한 최소 레지스트리 + 재사용 훅. 기존 App 오버레이 동작/디자인을 변경하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";

type OverlayEntry = { id: number; close: () => void };
const registry: OverlayEntry[] = [];
const subscribers = new Set<() => void>();
let seq = 0;
const emit = () => subscribers.forEach((cb) => cb());

// active 인 동안 레지스트리에 등록(마지막 등록 = 최상위). close 는 항상 최신 참조 사용.
export function useRegisteredOverlay(active: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!active) return;
    const entry: OverlayEntry = { id: ++seq, close: () => closeRef.current() };
    registry.push(entry);
    emit();
    return () => {
      const i = registry.indexOf(entry);
      if (i >= 0) registry.splice(i, 1);
      emit();
    };
  }, [active]);
}

// App 의 closeTopOverlay 가 자기 상태보다 "먼저" 호출: 등록된 최상위 오버레이가 있으면 닫고 true.
export function closeTopRegisteredOverlay(): boolean {
  if (!registry.length) return false;
  registry[registry.length - 1].close();
  return true;
}

// App 의 hasOpenOverlay 계산에 반영(등록 변화 시 리렌더). 등록된 오버레이 개수.
export function useRegisteredOverlayCount(): number {
  const [n, setN] = useState(registry.length);
  useEffect(() => {
    const cb = () => setN(registry.length);
    subscribers.add(cb);
    cb();
    return () => { subscribers.delete(cb); };
  }, []);
  return n;
}

// 테이블 행 키보드 이동(위/아래/Home/End/PageUp·Down/Enter/Space). 텍스트 입력 중에는 방해하지 않는다.
// 반환값을 스크롤 컨테이너 onKeyDown 에 연결하고 tabIndex={0} 부여. 선택 상태만 바꾸며 API 호출 없음.
export function useTableKeyboardNav(opts: {
  count: number;
  active: number;
  setActive: (i: number) => void;
  pageSize?: number;
  onEnter?: (i: number) => void;
  onSpace?: (i: number) => void;
  enabled?: boolean;
}) {
  const { count, active, setActive, pageSize = 10, onEnter, onSpace, enabled = true } = opts;
  return useCallback((e: React.KeyboardEvent) => {
    if (!enabled || count === 0) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing) return; // 입력 중 커서/값 이동 보호
    const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
    const cur = active < 0 ? 0 : active;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive(active < 0 ? 0 : clamp(active + 1)); break;
      case "ArrowUp": e.preventDefault(); setActive(active < 0 ? 0 : clamp(active - 1)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(count - 1); break;
      case "PageDown": e.preventDefault(); setActive(clamp(cur + pageSize)); break;
      case "PageUp": e.preventDefault(); setActive(clamp(cur - pageSize)); break;
      case "Enter": if (active >= 0 && onEnter) { e.preventDefault(); onEnter(active); } break;
      case " ": case "Spacebar": if (active >= 0 && onSpace) { e.preventDefault(); onSpace(active); } break;
    }
  }, [count, active, setActive, pageSize, onEnter, onSpace, enabled]);
}

// 모달 열릴 때 첫 입력/제목 포커스 + Tab 포커스 트랩(모달 밖으로 이탈 방지). 포커스 표시는 유지.
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const sel = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null);
    const id = window.setTimeout(() => { const fbs = focusables(); (fbs[0] || container).focus?.({ preventScroll: true } as FocusOptions); }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const fbs = focusables();
      if (!fbs.length) return;
      const first = fbs[0], last = fbs[fbs.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(id); container.removeEventListener("keydown", onKey); };
  }, [active, ref]);
}
