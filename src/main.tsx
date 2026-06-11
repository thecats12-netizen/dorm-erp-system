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

// PWA Service Worker 등록 (프로덕션에서만, 인증/저장/실시간 로직과 무관)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
