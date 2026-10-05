/* ============================================================================
 * Storage DR — Edge Function HTTP 실제 E2E (LOCAL hts-dorm-local 전용).
 *  실제 LOCAL JWT + 실제 HTTP endpoint(127.0.0.1:55421/functions/v1/storage-dr).
 *  두 단계: HTTP_PHASE=disabled(권한게이트 + 503) / enabled(archive 통과 + idempotency + byte path).
 *  synthetic prefix: STORAGE-DR-QA-* · 종료 시 정리. 비밀키는 env 로만.
 * ========================================================================== */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SB_URL || "http://127.0.0.1:55421";
const SECRET = process.env.SB_SECRET || "";
const ANON = process.env.SB_ANON || "";
const PHASE = (process.env.HTTP_PHASE || "disabled") as "disabled" | "enabled";
const FN = `${URL}/functions/v1/storage-dr`;
if (!SECRET || !ANON) { console.error("SB_SECRET + SB_ANON required"); process.exit(2); }
if (!URL.includes("127.0.0.1")) { console.error("REFUSE non-local"); process.exit(2); }

const admin: SupabaseClient = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const TA = "STORAGE-DR-QA-TA";
const PW = "Qa-" + Math.random().toString(36).slice(2, 10) + "!A1";
const enc = new TextEncoder();

const results: Record<string, { status: "PASS" | "FAIL"; detail: string }> = {};
const ok = (id: string, cond: boolean, detail: string) => { results[id] = { status: cond ? "PASS" : "FAIL", detail }; console.log(`TEST ${id} ${cond ? "PASS" : "FAIL"} — ${detail}`); };

const createdUsers: string[] = [];
async function makeUser(tag: string, role: string, tenant: string) {
  const email = `qa-${tag}-${Math.random().toString(36).slice(2, 7)}@storage-dr-qa.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error || !data.user) throw new Error("createUser: " + error?.message);
  createdUsers.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, email, display_name: tag, role, is_active: true, tenant_id: tenant });
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: se } = await c.auth.signInWithPassword({ email, password: PW });
  if (se || !s.session) throw new Error("signin: " + se?.message);
  return { id: data.user.id, token: s.session.access_token };
}

type HttpRes = { status: number; body: any; raw: string };
async function call(token: string | null, payload: unknown): Promise<HttpRes> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(FN, { method: "POST", headers, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
  const raw = await r.text();
  let body: any = null; try { body = JSON.parse(raw); } catch { /* non-json */ }
  return { status: r.status, body, raw };
}

async function removeTree(bucket: string, prefix: string) {
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!data) return; const files: string[] = [];
  for (const it of data) { const full = `${prefix}/${it.name}`; if ((it as any).id === null || !(it as any).metadata) await removeTree(bucket, full); else files.push(full); }
  if (files.length) await admin.storage.from(bucket).remove(files);
}
async function cleanup() {
  for (const b of ["contract-files", "dr-archive"]) { try { await removeTree(b, TA); } catch { /* */ } }
  try { await admin.from("dorm_contract_files").delete().eq("tenant_id", TA); } catch { /* */ }
  try { await admin.from("storage_dr_jobs").delete().eq("tenant_id", TA); } catch { /* */ }
  for (const uid of createdUsers) { try { await admin.from("profiles").delete().eq("id", uid); } catch { /* */ } try { await admin.auth.admin.deleteUser(uid); } catch { /* */ } }
}

const SECRET_LEAK = (s: string) => s.includes(SECRET) || /service_role|sb_secret_|eyJhbGciOi/i.test(s);

async function main() {
  await cleanup();
  const adminU = await makeUser("admin", "admin", TA);
  const viewerU = await makeUser("viewer", "viewer", TA);

  if (PHASE === "disabled") {
    // HTTP-4 unauthenticated → 401
    const r4 = await call(null, { action: "status" });
    ok("HTTP-4", r4.status === 401, `status=${r4.status} code=${r4.body?.code}`);
    // HTTP-1 admin status → 200 (+ providerEnabled=false)
    const r1 = await call(adminU.token, { action: "status" });
    ok("HTTP-1", r1.status === 200 && r1.body?.ok === true && r1.body?.providerEnabled === false, `status=${r1.status} providerEnabled=${r1.body?.providerEnabled}`);
    // HTTP-3 non-admin archive → 403
    const r3 = await call(viewerU.token, { action: "archive", requestId: "qa-" + crypto.randomUUID() });
    ok("HTTP-3", r3.status === 403 && r3.body?.code === "FORBIDDEN", `status=${r3.status} code=${r3.body?.code}`);
    // HTTP-6 provider disabled → 503 PROVIDER_NOT_CONFIGURED (admin archive)
    const r6 = await call(adminU.token, { action: "archive", requestId: "qa-" + crypto.randomUUID() });
    ok("HTTP-6", r6.status === 503 && r6.body?.code === "PROVIDER_NOT_CONFIGURED", `status=${r6.status} code=${r6.body?.code}`);
    // HTTP-7 malformed → 400 (bad action) + archive missing requestId → 400
    const r7a = await call(adminU.token, { action: "nonsense" });
    const r7b = await call(adminU.token, "{ not json");
    const r7c = await call(adminU.token, { action: "archive" }); // requestId 없음
    ok("HTTP-7", r7a.status === 400 && r7c.status === 400 && (r7b.status === 400 || r7b.status === 500 ? true : false), `badAction=${r7a.status} badJson=${r7b.status} noReqId=${r7c.status}`);
    // HTTP-10 restore admin gate: non-admin restore → 403
    const r10 = await call(viewerU.token, { action: "restore", requestId: "qa-" + crypto.randomUUID() });
    ok("HTTP-10", r10.status === 403 && r10.body?.code === "FORBIDDEN", `status=${r10.status} code=${r10.body?.code}`);
    // HTTP-9 secret exposure in responses = 0
    const allRaw = [r1, r3, r4, r6, r7a, r7b, r7c, r10].map((x) => x.raw).join("\n");
    ok("HTTP-9", !SECRET_LEAK(allRaw), `leak=${SECRET_LEAK(allRaw)}`);
  } else {
    // provider enabled: 소스 object + contract_files 행 1건(해당 tenant)
    const pContract = `${TA}/contract-QA-1/doc.pdf`;
    await admin.storage.from("contract-files").upload(pContract, Buffer.from(enc.encode("CONTRACT-QA-" + "a".repeat(60))), { contentType: "application/pdf", upsert: true });
    await admin.from("dorm_contract_files").insert({ id: crypto.randomUUID(), tenant_id: TA, contract_id: "contract-QA-1", storage_path: pContract, file_name: "qa.pdf", mime: "application/pdf", size_bytes: 72 });

    // HTTP-2 admin archive → 통과 + job archived>=1
    const reqId = "qa-" + crypto.randomUUID();
    const r2 = await call(adminU.token, { action: "archive", requestId: reqId });
    ok("HTTP-2", r2.status === 200 && r2.body?.ok === true && (r2.body?.job?.archived ?? 0) >= 1, `status=${r2.status} archived=${r2.body?.job?.archived} total=${r2.body?.job?.total}`);

    // byte path: dr-archive 에 실제 object + .meta.json 존재
    const { data: arcBin } = await admin.storage.from("dr-archive").download(`${TA}/contract-files/${pContract}`);
    const { data: arcMeta } = await admin.storage.from("dr-archive").download(`${TA}/contract-files/${pContract}.meta.json`);
    let metaChecksum = ""; if (arcMeta) { try { metaChecksum = JSON.parse(new TextDecoder().decode(new Uint8Array(await arcMeta.arrayBuffer()))).checksum; } catch { /* */ } }
    ok("HTTP-BYTE", !!arcBin && !!arcMeta && metaChecksum.length === 64, `binArchived=${!!arcBin} metaChecksumLen=${metaChecksum.length}`);

    // HTTP-8 duplicate requestId → idempotent (같은 job 반환, 중복 작업 안 함)
    const r8 = await call(adminU.token, { action: "archive", requestId: reqId });
    ok("HTTP-8", r8.status === 200 && r8.body?.idempotent === true && r8.body?.job?.request_id === reqId, `idempotent=${r8.body?.idempotent}`);

    // HTTP-5 tenant spoof → 서버 tenant 강제(job.tenant_id == 서버 TA)
    const reqId5 = "qa-" + crypto.randomUUID();
    const r5 = await call(adminU.token, { action: "archive", requestId: reqId5, clientTenantId: "EVIL-TENANT" });
    const { data: job5 } = await admin.from("storage_dr_jobs").select("tenant_id").eq("request_id", reqId5).maybeSingle();
    ok("HTTP-5", r5.status === 200 && r5.body?.tenantSpoofIgnored === true && job5?.tenant_id === TA, `spoofIgnored=${r5.body?.tenantSpoofIgnored} jobTenant=${job5?.tenant_id}`);

    // HTTP-9 (enabled) secret exposure = 0
    const allRaw = [r2, r8, r5].map((x) => x.raw).join("\n");
    ok("HTTP-9E", !SECRET_LEAK(allRaw), `leak=${SECRET_LEAK(allRaw)}`);

    // HTTP-RESTORE byte path: 원본 삭제 후 restore → 복원
    await admin.storage.from("contract-files").remove([pContract]);
    const r2b = await call(adminU.token, { action: "restore", requestId: "qa-" + crypto.randomUUID() });
    const { data: restored } = await admin.storage.from("contract-files").download(pContract);
    ok("HTTP-RESTORE", r2b.status === 200 && !!restored, `status=${r2b.status} restored=${!!restored}`);
  }

  await cleanup();
  const fails = Object.entries(results).filter(([, v]) => v.status === "FAIL");
  console.log(`\n==== HTTP(${PHASE}) SUMMARY ====`);
  for (const [id, v] of Object.entries(results)) console.log(`${id}: ${v.status} — ${v.detail}`);
  console.log(`TOTAL ${Object.keys(results).length} PASS ${Object.keys(results).length - fails.length} FAIL ${fails.length}`);
  process.exit(fails.length ? 1 : 0);
}
main().catch(async (e) => { console.error("HTTP HARNESS ERROR", e); try { await cleanup(); } catch { /* */ } process.exit(4); });
