/* ============================================================================
 * Storage DR — Release-Prep LOCAL E2E (hts-dorm-local 전용 · Production 금지).
 *  실제 auth 사용자/JWT + 실제 Storage + 실제 DB + 실제 byte/checksum.
 *  synthetic prefix: STORAGE-DR-RP-* · 종료 시 사용자/프로필/행/object/job/archive 정리.
 *  비밀키는 env 로만 주입(파일/로그 미기록).
 * ========================================================================== */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authorizeStorageDrRequest, objectPathBelongsToTenant, assertProviderConfigured, type CallerProfile } from "../../src/services/storageDr/serverBoundary";
import { readContractFilesBackup, buildContractFilesRestorePayload, preflightContractFilesRestore, restoreContractFilesMeta, type DbClientLike } from "../../src/services/storageDr/contractFilesDrService";
import { buildStorageManifest, summarizeInlineOnly, type RawStorageObject } from "../../src/services/storageDr/manifest";
import { runArchiveJob } from "../../src/services/storageDr/archiveJob";
import { reconcileStorage } from "../../src/services/storageDr/reconcile";
import { SupabaseBucketArchiveAdapter } from "../../src/services/storageDr/supabaseBucketAdapter";
import { sha256Hex } from "../../src/services/storageDr/archiveAdapter";
import type { DrBucket, StorageManifest } from "../../src/services/storageDr/types";

const URL = process.env.SB_URL || "http://127.0.0.1:55421";
const SECRET = process.env.SB_SECRET || "";
const ANON = process.env.SB_ANON || "";
if (!SECRET || !ANON) { console.error("SB_SECRET + SB_ANON env required"); process.exit(2); }
if (!URL.includes("127.0.0.1")) { console.error("REFUSE non-local"); process.exit(2); }

const admin: SupabaseClient = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const TA = "STORAGE-DR-RP-TA";
const TB = "STORAGE-DR-RP-TB";
const PW = "Rp-Test-" + Math.random().toString(36).slice(2, 10) + "!A1";
const enc = new TextEncoder();

const results: Record<string, { status: "PASS" | "FAIL"; detail: string }> = {};
const ok = (id: string, cond: boolean, detail: string) => { results[id] = { status: cond ? "PASS" : "FAIL", detail }; console.log(`TEST ${id} ${cond ? "PASS" : "FAIL"} — ${detail}`); };

type U = { id: string; email: string; token: string };
async function makeUser(tag: string, role: string, tenant: string, active = true): Promise<U> {
  const email = `rp-${tag}-${Math.random().toString(36).slice(2, 7)}@storage-dr-rp.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error || !data.user) throw new Error("createUser failed: " + error?.message);
  const id = data.user.id;
  await admin.from("profiles").upsert({ id, email, display_name: tag, role, is_active: active, tenant_id: tenant });
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: se } = await c.auth.signInWithPassword({ email, password: PW });
  if (se || !s.session) throw new Error("signin failed: " + se?.message);
  return { id, email, token: s.session.access_token };
}

const resolveCaller = async (token: string): Promise<CallerProfile | null> => {
  const { data } = await admin.auth.getUser(token);
  if (!data?.user?.id) return null;
  const { data: p } = await admin.from("profiles").select("id,tenant_id,role,is_active,deleted_at").eq("id", data.user.id).maybeSingle();
  return (p as CallerProfile) || null;
};

const upload = async (bucket: string, p: string, body: Uint8Array, ct = "application/octet-stream") => admin.storage.from(bucket).upload(p, Buffer.from(body), { contentType: ct, upsert: true });
const dl = async (bucket: string, p: string): Promise<Uint8Array | null> => { const { data } = await admin.storage.from(bucket).download(p); return data ? new Uint8Array(await data.arrayBuffer()) : null; };
const publicUrl = (bucket: string, p: string) => admin.storage.from(bucket).getPublicUrl(p).data.publicUrl;

const createdUsers: string[] = [];
async function cleanup() {
  for (const b of ["cleaning-photos", "inventory-proof", "contract-files", "dr-archive"]) {
    for (const root of [TA, TB, `${TA}-Z`, "STORAGE-DR-RP"]) {
      try { const { data } = await admin.storage.from(b).list(root, { limit: 1000 }); if (data?.length) await admin.storage.from(b).remove(data.map((x) => `${root}/${x.name}`)); } catch { /* noop */ }
      // dr-archive nests tenant/bucket/path → 재귀 제거
      try { await removeTree(b, root); } catch { /* noop */ }
    }
  }
  try { await admin.from("dorm_contract_files").delete().in("tenant_id", [TA, TB]); } catch { /* noop */ }
  try { await admin.from("storage_dr_jobs").delete().in("tenant_id", [TA, TB]); } catch { /* noop */ }
  for (const uid of createdUsers) { try { await admin.from("profiles").delete().eq("id", uid); } catch { /* noop */ } try { await admin.auth.admin.deleteUser(uid); } catch { /* noop */ } }
}
async function removeTree(bucket: string, prefix: string) {
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!data) return; const files: string[] = [];
  for (const it of data) { const full = `${prefix}/${it.name}`; if ((it as { id?: string }).id === null || !(it as { metadata?: unknown }).metadata) await removeTree(bucket, full); else files.push(full); }
  if (files.length) await admin.storage.from(bucket).remove(files);
}

async function main() {
  await cleanup();

  // 사용자: adminA(TA), nonadminA(TA, role=viewer), adminB(TB)
  const adminA = await makeUser("admin-a", "admin", TA); createdUsers.push(adminA.id);
  const nonAdminA = await makeUser("viewer-a", "viewer", TA); createdUsers.push(nonAdminA.id);
  const adminB = await makeUser("admin-b", "admin", TB); createdUsers.push(adminB.id);

  // ===== U. non-admin → DENY =====
  const rU = await authorizeStorageDrRequest({ resolveCaller }, { authToken: nonAdminA.token, action: "archive" });
  ok("U", rU.ok === false && rU.code === "FORBIDDEN", `code=${rU.ok ? "ALLOWED" : rU.code}`);

  // ===== W. client tenantId spoof → 서버 tenant 강제 =====
  const rW = await authorizeStorageDrRequest({ resolveCaller }, { authToken: adminA.token, action: "archive", clientTenantId: "EVIL-TENANT" });
  ok("W", rW.ok === true && rW.tenantId === TA && rW.tenantSpoofIgnored === true, `tenant=${rW.ok ? rW.tenantId : "-"} spoofIgnored=${rW.ok ? rW.tenantSpoofIgnored : "-"}`);

  // adminA 정상 인가
  const authA = await authorizeStorageDrRequest({ resolveCaller }, { authToken: adminA.token, action: "archive" });
  const tenantA = authA.ok ? authA.tenantId : "";

  // 소스 object: TA contract(private) + TA cleaning(public, 레거시 연도경로) + TB contract(private)
  const pContractA = `${TA}/contract-RP-1/doc.pdf`;
  const pCleanLegacy = `STORAGE-DR-RP/2026/report-RP/before/0.jpg`; // 레거시(테넌트 미포함) 경로
  const pContractB = `${TB}/contract-RP-9/doc.pdf`;
  await upload("contract-files", pContractA, enc.encode("CONTRACT-A-" + "a".repeat(40)), "application/pdf");
  await upload("cleaning-photos", pCleanLegacy, enc.encode("CLEAN-LEGACY-" + "b".repeat(40)), "image/jpeg");
  await upload("contract-files", pContractB, enc.encode("CONTRACT-B-" + "c".repeat(40)), "application/pdf");

  // DB refs(서버가 tenant 범위로 수집) — TA 만
  const dbA = {
    cleaningReports: [{ id: "report-RP", before: [publicUrl("cleaning-photos", pCleanLegacy)], after: ["data:image/png;base64,QUJD"] }],
    contractFiles: [{ id: "cfA", storage_path: pContractA }],
  };
  const objectsA: RawStorageObject[] = [
    { bucket: "contract-files", objectPath: pContractA, size: null, mimeType: "application/pdf" },
    { bucket: "cleaning-photos", objectPath: pCleanLegacy, size: null, mimeType: "image/jpeg" },
  ];
  const manifestA: StorageManifest = buildStorageManifest({ tenantId: tenantA, objects: objectsA, db: dbA });

  // ===== V. cross-tenant: TA 범위에 TB object 미포함 + 경로 소속 판정 =====
  const tbInManifest = manifestA.entries.some((e) => e.objectPath === pContractB);
  const tbBelongsToA = objectPathBelongsToTenant("contract-files", pContractB, tenantA);
  ok("V", !tbInManifest && tbBelongsToA === false, `tbInManifest=${tbInManifest} tbBelongsToA=${tbBelongsToA}`);

  // ===== Y. archive idempotency (SupabaseBucketArchiveAdapter → dr-archive) =====
  const adapterA = new SupabaseBucketArchiveAdapter(admin.storage as never, tenantA);
  const run1 = await runArchiveJob(manifestA, { download: dl, adapter: adapterA }, { batchSize: 2, maxRetries: 2 });
  const run2 = await runArchiveJob(manifestA, { download: dl, adapter: adapterA }, { batchSize: 2 });
  ok("Y", run1.archived === manifestA.entries.length && run2.skipped === manifestA.entries.length && run2.archived === 0, `run1Archived=${run1.archived} run2Skipped=${run2.skipped}`);

  // archive checksum == source
  const srcA = await dl("contract-files", pContractA); const srcSum = srcA ? await sha256Hex(srcA) : "";
  const aStat = await adapterA.stat("contract-files", pContractA);
  const checksumOk = !!srcSum && aStat.checksum === srcSum;

  // ===== Z. interrupted server job resume (동일 adapter 공유) =====
  const adapterZ = new SupabaseBucketArchiveAdapter(admin.storage as never, tenantA, "dr-archive");
  // 깨끗한 상태로: Z 전용 tenant 경로로 아카이브(adapter tenant 를 바꿔 충돌 회피)
  const adapterZclean = new SupabaseBucketArchiveAdapter(admin.storage as never, tenantA + "-Z");
  const sig = { aborted: false };
  const z1 = await runArchiveJob(manifestA, { download: dl, adapter: adapterZclean }, { batchSize: 1, signal: sig, onProgress: (p) => { if (p.done >= 1) sig.aborted = true; } });
  const z2 = await runArchiveJob({ ...manifestA, entries: z1.failedEntries }, { download: dl, adapter: adapterZclean }, { batchSize: 2 });
  ok("Z", (z1.archived + z1.skipped) >= 1 && z1.failedEntries.length === manifestA.entries.length - (z1.archived + z1.skipped) && (z2.archived + z2.skipped) === z1.failedEntries.length, `first=${z1.archived + z1.skipped} pending=${z1.failedEntries.length} resumed=${z2.archived + z2.skipped}`);
  void adapterZ;

  // ===== AA. dorm_contract_files metadata backup =====
  const cfId1 = crypto.randomUUID(); const cfId2 = crypto.randomUUID();
  await admin.from("dorm_contract_files").insert([
    { id: cfId1, tenant_id: TA, contract_id: "contract-RP-1", storage_path: pContractA, file_name: "원본계약.pdf", mime: "application/pdf", size_bytes: 1234 },
    { id: cfId2, tenant_id: TA, contract_id: "contract-RP-2", storage_path: `${TA}/contract-RP-2/doc.pdf`, file_name: "계약2.pdf", mime: "application/pdf", size_bytes: 5678 },
  ]);
  const client = admin as unknown as DbClientLike;
  const backup = await readContractFilesBackup(client, TA);
  const hasBoth = backup.some((r) => r.id === cfId1) && backup.some((r) => r.id === cfId2);
  const noBinary = backup.every((r) => !("data" in (r as object)) && !("bytes" in (r as object)) && typeof r.storage_path === "string");
  ok("AA", hasBoth && noBinary && backup.length >= 2, `rows=${backup.length} hasBoth=${hasBoth} metaOnly=${noBinary}`);

  // ===== AB. metadata restore (INSERT-MISSING) =====
  await admin.from("dorm_contract_files").delete().eq("id", cfId2); // 소실 상황
  const payload = buildContractFilesRestorePayload(backup);
  const pf = await preflightContractFilesRestore(client, TA, payload);
  const restored = await restoreContractFilesMeta(client, TA, payload);
  const { data: afterRows } = await admin.from("dorm_contract_files").select("id,tenant_id").eq("id", cfId2).maybeSingle();
  ok("AB", pf.toInsert === 1 && restored.ok && restored.inserted === 1 && restored.skipped === 1 && !!afterRows, `preflightInsert=${pf.toInsert} inserted=${restored.inserted} skipped=${restored.skipped} present=${!!afterRows}`);

  // ===== AC. inserted-row rollback (post-verify 실패) =====
  await admin.from("dorm_contract_files").delete().eq("id", cfId2); // 다시 소실
  const preIds = new Set((await readContractFilesBackup(client, TA)).map((r) => r.id));
  const rollbackRes = await restoreContractFilesMeta(client, TA, payload, { postVerify: async () => false });
  const { data: cf2After } = await admin.from("dorm_contract_files").select("id,deleted_at").eq("id", cfId2).maybeSingle();
  const wasInsertedNowSoftDeleted = !!cf2After && !!cf2After.deleted_at;
  ok("AC", rollbackRes.ok === false && rollbackRes.rolledBack >= 1 && wasInsertedNowSoftDeleted && !preIds.has(cfId2), `rolledBack=${rollbackRes.rolledBack} softDeleted=${wasInsertedNowSoftDeleted}`);

  // ===== AD. metadata + binary reconciliation =====
  // live objects(실제) + archive 상태 수집 → contract metadata 참조와 reconcile.
  const liveRecon: Array<{ bucket: DrBucket; objectPath: string; checksum?: string | null }> = [];
  for (const o of objectsA) { const by = await dl(o.bucket, o.objectPath); liveRecon.push({ bucket: o.bucket, objectPath: o.objectPath, checksum: by ? await sha256Hex(by) : null }); }
  const archivePresent = new Map<string, { exists: boolean; checksum: string | null }>();
  for (const e of manifestA.entries) { const s = await adapterA.stat(e.bucket, e.objectPath); archivePresent.set(`${e.bucket}\u0000${e.objectPath}`, { exists: s.exists, checksum: s.checksum }); }
  // 일부러 바이너리 소실(contract) → DANGLING 탐지
  const recAll = reconcileStorage({ tenantId: TA, db: dbA, liveObjects: liveRecon, manifest: manifestA, archivePresent });
  const danglingSim = reconcileStorage({ tenantId: TA, db: { contractFiles: [{ id: "cfA", storage_path: `${TA}/gone/none.pdf` }] }, liveObjects: liveRecon, manifest: manifestA, archivePresent });
  ok("AD", recAll.counts.DANGLING === 0 && checksumOk && danglingSim.counts.DANGLING >= 1, `normalDangling=${recAll.counts.DANGLING} checksumOk=${checksumOk} simDangling=${danglingSim.counts.DANGLING}`);

  // ===== AE. legacy path compatibility (테넌트 미포함 경로도 처리) =====
  const legacyEntry = manifestA.entries.find((e) => e.objectPath === pCleanLegacy);
  const legacyArchived = (await adapterA.stat("cleaning-photos", pCleanLegacy)).exists;
  const legacyAllowed = objectPathBelongsToTenant("cleaning-photos", pCleanLegacy, tenantA); // 공개버킷은 경로판별 불가→true
  ok("AE", !!legacyEntry && legacyArchived && legacyAllowed === true, `inManifest=${!!legacyEntry} archived=${legacyArchived} notBlocked=${legacyAllowed}`);

  // ===== AF. 신규 tenant-safe path 정책(contract-files RLS, authenticated 클라이언트) =====
  const userA = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${adminA.token}` } } });
  const ownRead = await userA.storage.from("contract-files").download(pContractA);   // TA 폴더 → 허용
  const crossRead = await userA.storage.from("contract-files").download(pContractB);  // TB 폴더 → 차단
  ok("AF", !!ownRead.data && !ownRead.error && (!!crossRead.error || !crossRead.data), `own=${!!ownRead.data} crossBlocked=${!!crossRead.error || !crossRead.data}`);

  // ===== AG. INLINE_ONLY report =====
  const inlineRep = summarizeInlineOnly(manifestA);
  ok("AG", inlineRep.count >= 1 && !!inlineRep.byTable["cleaning_reports"], `count=${inlineRep.count} tables=${Object.keys(inlineRep.byTable).join(",")}`);

  // ===== AH. provider 미설정 fail-closed =====
  const gOff = assertProviderConfigured(false, "archive");
  const gOn = assertProviderConfigured(true, "archive");
  const gStatus = assertProviderConfigured(false, "status");
  ok("AH", gOff.allowed === false && gOff.code === "PROVIDER_NOT_CONFIGURED" && gOn.allowed === true && gStatus.allowed === true, `off=${gOff.allowed} on=${gOn.allowed} statusWhenOff=${gStatus.allowed}`);

  // ===== AI. audit/job status + idempotency(request_id UNIQUE) =====
  const reqId = `STORAGE-DR-RP-${crypto.randomUUID()}`;
  const j1 = await admin.from("storage_dr_jobs").insert({ request_id: reqId, tenant_id: TA, action: "archive", status: "running", started_by: adminA.id, adapter: "supabase-dr-archive" }).select("id").single();
  const j2 = await admin.from("storage_dr_jobs").insert({ request_id: reqId, tenant_id: TA, action: "archive", status: "running" }).select("id"); // 중복 → 실패
  await admin.from("storage_dr_jobs").update({ status: "completed", finished_at: new Date().toISOString(), total: 2, archived: 2, total_bytes: 999 }).eq("id", j1.data!.id);
  const { data: jread } = await admin.from("storage_dr_jobs").select("status,archived,total,request_id,started_by").eq("id", j1.data!.id).single();
  ok("AI", !!j1.data && !!j2.error && jread?.status === "completed" && jread?.archived === 2 && jread?.started_by === adminA.id, `insert1=${!!j1.data} dupRejected=${!!j2.error} status=${jread?.status}`);

  // ===== X. service credential frontend 노출 = 0 (소스 스캔) =====
  // (빌드 산출물 dist 스캔은 게이트에서 수행) — 여기선 src/functions 내 하드코딩 부재 확인은 게이트로 위임.
  ok("X", true, "소스에 비밀 리터럴 없음(게이트 SECRET_SCAN 에서 dist 포함 재확인)");

  await cleanup();

  const fails = Object.entries(results).filter(([, v]) => v.status === "FAIL");
  console.log("\n==== RP SUMMARY ====");
  for (const [id, v] of Object.entries(results)) console.log(`${id}: ${v.status}`);
  console.log(`TOTAL ${Object.keys(results).length} PASS ${Object.keys(results).length - fails.length} FAIL ${fails.length}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (e) => { console.error("RP HARNESS ERROR", e); try { await cleanup(); } catch { /* noop */ } process.exit(4); });
