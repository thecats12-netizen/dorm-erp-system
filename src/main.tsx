import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'
import PwaInstallPrompt from './components/PwaInstallPrompt.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaInstallPrompt />
  </StrictMode>,
)

// [2G Phase E] Preview 전용 보안 probe 로더 — VITE_ENABLE_MILITARY_SECURITY_PROBE === "true" 일 때만 동적 로드.
//   Production 환경에는 이 변수를 설정하지 않으므로 빌드 시 조건이 정적 false → dynamic import 가 dead-code 로 제거되어
//   Production 번들/UI 에 포함되지 않는다(import.meta.env.DEV 에 의존하지 않는 명시적 플래그 방식).
if (import.meta.env.VITE_ENABLE_MILITARY_SECURITY_PROBE === "true") {
  import("./features/military/dev/militaryRlsSecurityTest").catch(() => {});
}

// PWA Service Worker 등록 (프로덕션에서만, 인증/저장/실시간 로직과 무관)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
