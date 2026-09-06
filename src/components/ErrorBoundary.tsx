import { Component, type ErrorInfo, type ReactNode } from "react";

// 렌더링 예외로 앱/모듈이 흰 화면으로 죽는 것을 방지하는 재사용 ErrorBoundary.
//  - 최상위(App 전체) + 모듈 단위(기숙사/운영/시험/군대/시스템)에 중첩 적용한다.
//  - 사용자에게는 민감정보(스택/원본 오류/SQL/식별자 등)를 절대 노출하지 않는다.
//  - DEV 에서만 console.error 로 상세를 남긴다(외부 로깅 서비스 추가하지 않음).

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
  moduleName?: string;          // 로깅 식별용(화면에는 노출하지 않음)
  onReset?: () => void;         // "다시 시도" 시 부가 초기화(선택)
  onGoHome?: () => void;        // 제공 시 "대시보드로 이동" 버튼 표시
};

type State = { hasError: boolean; errorId: string };

// 민감정보 없는 간단 오류 ID: ERR-YYYYMMDD-XXXX
function makeErrorId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ERR-${ymd}-${rand}`;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorId: "" };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true, errorId: makeErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // DEV 에서만 상세 로그(운영 사용자 화면에는 노출하지 않음).
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(`[ErrorBoundary${this.props.moduleName ? `:${this.props.moduleName}` : ""}]`, error, info.componentStack);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorId: "" });
    this.props.onReset?.();
  };

  private handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.fallbackTitle ?? "화면을 불러오는 중 문제가 발생했습니다.";
    const description =
      this.props.fallbackDescription ?? "잠시 후 다시 시도하거나 이 화면을 새로고침해 주세요.";

    return (
      <div className="flex min-h-[240px] w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800" aria-hidden>
            ⚠️
          </div>
          <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          {this.state.errorId && (
            <p className="mb-5 text-xs text-slate-400 dark:text-slate-500">오류 코드: {this.state.errorId}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              새로고침
            </button>
            {this.props.onGoHome && (
              <button
                type="button"
                onClick={() => { this.setState({ hasError: false, errorId: "" }); this.props.onGoHome?.(); }}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                대시보드로 이동
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
