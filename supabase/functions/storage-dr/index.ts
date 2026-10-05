// ============================================================================
// Edge Function: storage-dr — 파일/첨부파일 재해복구의 "신뢰 서버 경계".
//  · 브라우저는 service_role 을 절대 갖지 않는다. 이 함수만 service_role 로 Storage 에 접근.
//  · 권한: Authorization(JWT) → auth.getUser → profiles(활성 + role='admin') → tenant 는 서버 결정.
//    client 가 보낸 tenantId 는 신뢰하지 않는다(서버 tenant 로 강제, 스푸핑 기록).
//  · provider 미설정 시 fail-closed(503, "파일 백업 저장소가 설정되지 않았습니다").
//  · idempotency: storage_dr_jobs.request_id UNIQUE. 동일 request 재호출은 기존 작업 반환.
//  · 감사: storage_dr_jobs 에 누가/언제/건수/바이트/실패 기록(URL·token 미기록).
//
//  권한 판정 로직은 src/services/storageDr/serverBoundary.ts 와 동일하게 유지(단일 진실).
//  ⚠ 로컬에 Deno 미설치 → HTTP serve E2E 는 미수행. 권한 경계는 순수 모듈 E2E 로 LOCAL DB 검증됨.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ARCHIVE_BUCKET = "dr-archive";
const SOURCE_BUCKETS = ["cleaning-photos", "inventory-proof", "contract-files"] as const; // generated-pdfs 제외(일시 산출물)

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    // provider 미설정 fail-closed: 아카이브 버킷/키가 없으면 작동하지 않는다.
    const providerEnabled = (Deno.env.get("STORAGE_DR_ARCHIVE_ENABLED") || "").toLowerCase() === "true";
    if (!url || !serviceKey) return json({ error: "서버 구성이 올바르지 않습니다." }, 500);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ── 권한 경계: JWT → profiles ──
    const authToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!authToken) return json({ error: "인증 정보가 없습니다.", code: "NO_AUTH" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(authToken);
    if (userErr || !userData?.user?.id) return json({ error: "로그인 상태를 확인할 수 없습니다.", code: "INVALID_TOKEN" }, 401);
    const { data: prof } = await admin.from("profiles").select("id,tenant_id,role,is_active,deleted_at").eq("id", userData.user.id).maybeSingle();
    if (!prof) return json({ error: "사용자 정보를 찾을 수 없습니다.", code: "INVALID_TOKEN" }, 401);
    if (prof.deleted_at || prof.is_active === false) return json({ error: "비활성 계정입니다.", code: "INACTIVE" }, 403);
    if (prof.role !== "admin") return json({ error: "이 작업은 관리자만 수행할 수 있습니다.", code: "FORBIDDEN" }, 403);
    const tenantId = String(prof.tenant_id || "").trim();
    if (!tenantId) return json({ error: "회사(테넌트) 정보를 확인할 수 없습니다.", code: "NO_TENANT" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const requestId = String(body.requestId || "").trim();
    const tenantSpoofIgnored = !!body.clientTenantId && String(body.clientTenantId).trim() !== tenantId;
    if (!["archive", "restore", "status"].includes(action)) return json({ error: "알 수 없는 작업입니다." }, 400);
    if (action !== "status" && !requestId) return json({ error: "요청 식별자(requestId)가 필요합니다." }, 400);

    if (action !== "status" && !providerEnabled) {
      return json({ error: "파일 백업 저장소가 설정되지 않았습니다. 관리자에게 문의하세요.", code: "PROVIDER_NOT_CONFIGURED" }, 503);
    }

    // ── status: 최근 작업 요약(같은 tenant) ──
    if (action === "status") {
      const { data } = await admin.from("storage_dr_jobs").select("*").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(5);
      return json({ ok: true, tenantId, providerEnabled, jobs: data || [] });
    }

    // ── idempotency: 동일 request_id 작업이 있으면 그대로 반환 ──
    const existing = await admin.from("storage_dr_jobs").select("*").eq("request_id", requestId).maybeSingle();
    if (existing.data) return json({ ok: true, idempotent: true, job: existing.data, tenantSpoofIgnored });

    const jobInsert = await admin.from("storage_dr_jobs").insert({
      request_id: requestId, tenant_id: tenantId, action, status: "running", started_by: prof.id, adapter: "supabase-dr-archive",
    }).select("*").single();
    if (jobInsert.error || !jobInsert.data) {
      // UNIQUE 경합 → 기존 작업 반환(idempotent)
      const again = await admin.from("storage_dr_jobs").select("*").eq("request_id", requestId).maybeSingle();
      if (again.data) return json({ ok: true, idempotent: true, job: again.data, tenantSpoofIgnored });
      return json({ error: "작업을 시작하지 못했습니다." }, 500);
    }
    const jobId = jobInsert.data.id as string;

    // ── 서버 tenant 범위 object 목록(권위: DB 참조) ──
    const objects = await collectTenantObjects(admin, tenantId);

    // ── archive: 다운로드 → checksum → dr-archive 업로드(bounded 동시성 + retry) ──
    let archived = 0, skipped = 0, failed = 0, totalBytes = 0, retries = 0;
    const failedObjects: Array<{ bucket: string; objectPath: string; error: string }> = [];
    const concurrency = 4;
    for (let i = 0; i < objects.length; i += concurrency) {
      const chunk = objects.slice(i, i + concurrency);
      const settled = await Promise.all(chunk.map((o) => archiveOne(admin, tenantId, o, action)));
      for (const r of settled) {
        retries += r.attempts - 1;
        if (r.status === "archived") { archived++; totalBytes += r.size; }
        else if (r.status === "skipped") skipped++;
        else { failed++; failedObjects.push({ bucket: r.bucket, objectPath: r.objectPath, error: r.error || "unknown" }); }
      }
    }
    const status = failed === 0 ? "completed" : (archived + skipped > 0 ? "partial" : "failed");
    await admin.from("storage_dr_jobs").update({
      status, finished_at: new Date().toISOString(), total: objects.length, archived, skipped, failed, total_bytes: totalBytes, retries,
      failed_objects: failedObjects.length ? failedObjects : null,
    }).eq("id", jobId);

    return json({ ok: status !== "failed", job: { id: jobId, status, total: objects.length, archived, skipped, failed, totalBytes }, tenantSpoofIgnored });
  } catch (e) {
    return json({ error: `서버 오류: ${(e as Error).message}`.slice(0, 200) }, 500);
  }
});

// contract-files: dorm_contract_files(tenant) → storage_path. public: cleaning_reports/inventory_items → URL 파싱.
async function collectTenantObjects(admin: any, tenantId: string): Promise<Array<{ bucket: string; path: string; mime: string | null }>> {
  const out: Array<{ bucket: string; path: string; mime: string | null }> = [];
  const { data: cf } = await admin.from("dorm_contract_files").select("storage_path,mime").eq("tenant_id", tenantId).is("deleted_at", null);
  for (const r of cf || []) if (r.storage_path) out.push({ bucket: "contract-files", path: r.storage_path, mime: r.mime ?? null });
  const parse = (v: unknown): { bucket: string; path: string } | null => {
    if (typeof v !== "string") return null;
    const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/i.exec(v);
    return m && SOURCE_BUCKETS.includes(m[1] as any) ? { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) } : null;
  };
  const { data: cr } = await admin.from("cleaning_reports").select("before_photo_data_urls,after_photo_data_urls").eq("tenant_id", tenantId);
  for (const r of cr || []) for (const arr of [r.before_photo_data_urls, r.after_photo_data_urls]) for (const v of Array.isArray(arr) ? arr : []) { const p = parse(v); if (p) out.push({ ...p, mime: null }); }
  const { data: inv } = await admin.from("inventory_items").select("proof_file").eq("tenant_id", tenantId);
  for (const r of inv || []) { let val = r.proof_file; if (typeof val === "string" && val.startsWith("{")) { try { val = JSON.parse(val).data; } catch { val = ""; } } const p = parse(val); if (p) out.push({ ...p, mime: null }); }
  // 중복 제거
  const seen = new Set<string>(); return out.filter((o) => { const k = o.bucket + "\u0000" + o.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function archiveOne(admin: any, tenantId: string, o: { bucket: string; path: string; mime: string | null }, action: string): Promise<{ bucket: string; objectPath: string; status: "archived" | "skipped" | "failed"; size: number; attempts: number; error?: string }> {
  const binPath = `${tenantId}/${o.bucket}/${o.path}`;
  const metaPath = `${binPath}.meta.json`;
  const maxAttempts = 3;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (action === "restore") {
        // 복원: 아카이브 → 원본 버킷. 대상 존재+동일 checksum 이면 skip, 내용 다르면 보존(overwrite 안 함).
        const arc = await admin.storage.from(ARCHIVE_BUCKET).download(binPath);
        if (arc.error || !arc.data) return { bucket: o.bucket, objectPath: o.path, status: "failed", size: 0, attempts: attempt, error: "archive missing" };
        const bytes = new Uint8Array(await arc.data.arrayBuffer());
        const cur = await admin.storage.from(o.bucket).download(o.path);
        if (cur.data) {
          const curSum = await sha256Hex(new Uint8Array(await cur.data.arrayBuffer()));
          const sum = await sha256Hex(bytes);
          if (curSum === sum) return { bucket: o.bucket, objectPath: o.path, status: "skipped", size: bytes.length, attempts: attempt };
          return { bucket: o.bucket, objectPath: o.path, status: "skipped", size: bytes.length, attempts: attempt, error: "conflict-preserved" };
        }
        const upe = await admin.storage.from(o.bucket).upload(o.path, bytes, { contentType: o.mime || "application/octet-stream", upsert: false });
        if (upe.error) throw new Error(upe.error.message);
        return { bucket: o.bucket, objectPath: o.path, status: "archived", size: bytes.length, attempts: attempt };
      }
      // archive
      const src = await admin.storage.from(o.bucket).download(o.path);
      if (src.error || !src.data) throw new Error("source download failed");
      const bytes = new Uint8Array(await src.data.arrayBuffer());
      const checksum = await sha256Hex(bytes);
      // idempotency/resume: 아카이브에 동일 checksum 이 있으면 skip.
      const existing = await admin.storage.from(ARCHIVE_BUCKET).download(metaPath);
      if (existing.data) { try { const j = JSON.parse(new TextDecoder().decode(new Uint8Array(await existing.data.arrayBuffer()))); if (j.checksum === checksum) return { bucket: o.bucket, objectPath: o.path, status: "skipped", size: bytes.length, attempts: attempt }; } catch { /* re-put */ } }
      const up1 = await admin.storage.from(ARCHIVE_BUCKET).upload(binPath, bytes, { contentType: o.mime || "application/octet-stream", upsert: true });
      if (up1.error) throw new Error(up1.error.message);
      const up2 = await admin.storage.from(ARCHIVE_BUCKET).upload(metaPath, new TextEncoder().encode(JSON.stringify({ checksum, size: bytes.length, mimeType: o.mime ?? null })), { contentType: "application/json", upsert: true });
      if (up2.error) throw new Error(up2.error.message);
      return { bucket: o.bucket, objectPath: o.path, status: "archived", size: bytes.length, attempts: attempt };
    } catch (e) {
      lastErr = (e as Error).message?.slice(0, 120) || "error";
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  return { bucket: o.bucket, objectPath: o.path, status: "failed", size: 0, attempts: maxAttempts, error: lastErr };
}
