import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pwa-install-dismissed";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  // iOS Safari
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const isIOSDevice = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(window.navigator.userAgent);

/**
 * 홈 화면 설치 안내 배너.
 * - Android/Chrome: beforeinstallprompt 감지 → "설치" 버튼으로 네이티브 설치
 * - iOS/Safari: 공유 → 홈 화면에 추가 안내
 * - "다시 보지 않기" 선택 시 localStorage 에 저장하여 더 이상 표시하지 않음
 * App.tsx 와 독립적으로 동작 (인증/저장/실시간 로직과 무관)
 */
export default function PwaInstallPrompt() {
  const suppressed = () =>
    typeof window === "undefined" || localStorage.getItem(DISMISS_KEY) === "1" || isStandalone();
  // iOS 는 beforeinstallprompt 가 없으므로 초기 렌더에서 바로 안내 노출 여부 결정
  const [ios] = useState(() => !suppressed() && isIOSDevice() && isMobile());
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(() => !suppressed() && isIOSDevice() && isMobile());

  useEffect(() => {
    if (suppressed()) return;

    // Android/Chrome: 설치 가능 시점 이벤트 (이벤트 콜백 내 setState → 동기 effect 아님)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = (remember: boolean) => {
    if (remember) localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setVisible(false);
  };

  return (
    <div
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="fixed inset-x-0 bottom-0 z-[1000] flex justify-center px-3 pb-3"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-100 shadow-2xl">
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="기숙사 ERP" className="h-10 w-10 rounded-xl" />
          <div className="flex-1">
            <div className="text-sm font-semibold">홈 화면에 추가하면 앱처럼 사용할 수 있습니다</div>
            {ios ? (
              <div className="mt-1 text-xs text-slate-300">
                Safari 하단 <span className="font-semibold">공유</span> 버튼 → <span className="font-semibold">홈 화면에 추가</span> 를 선택하세요.
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-300">설치하면 전체화면으로 더 빠르게 실행됩니다.</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!ios && deferred && (
                <button
                  type="button"
                  onClick={install}
                  className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  설치
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(false)}
                className="rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                나중에
              </button>
              <button
                type="button"
                onClick={() => dismiss(true)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                다시 보지 않기
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => dismiss(false)}
            className="rounded-lg px-2 text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
