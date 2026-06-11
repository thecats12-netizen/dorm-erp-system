/* 기숙사 ERP Service Worker
 * - 앱 셸(정적 자원) 캐시로 빠른 로딩 / 오프라인 진입 지원
 * - Supabase 등 외부(cross-origin) 요청 및 비 GET 요청은 절대 캐시하지 않음
 *   → 인증/실시간/저장 데이터는 항상 네트워크로 처리 (캐시 미개입)
 */
const CACHE = "dorm-erp-shell-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) GET 외 요청은 개입하지 않음 (POST/PATCH 등 저장 로직은 그대로 네트워크)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 2) 동일 출처가 아니면 개입하지 않음 (Supabase/CDN 등은 캐시하지 않음)
  if (url.origin !== self.location.origin) return;

  // 3) 페이지 이동(navigation): 네트워크 우선, 실패 시 캐시된 셸로 오프라인 진입
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((r) => r || new Response(
          "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;padding:40px;text-align:center;color:#334155'><h2>오프라인 상태입니다</h2><p>네트워크에 연결되면 자동으로 다시 시도됩니다.</p></body>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        ))
      )
    );
    return;
  }

  // 4) 동일 출처 정적 자원: stale-while-revalidate (캐시 우선 + 백그라운드 갱신)
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
