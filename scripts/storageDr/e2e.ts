/* ============================================================================
 * Storage DR — LOCAL 실제 E2E 하네스 (Production 금지 · hts-dorm-local 전용).
 *  · 실제 Supabase Storage 업로드/다운로드 + 실제 파일시스템 아카이브 + 실제 checksum 검증.
 *  · synthetic prefix: storage-dr-e2e/ · tenant: STORAGE-DR-T1/T2 · 종료 시 전부 정리.
 *  · 비밀키는 env 로만 주입(파일/로그에 기록하지 않음).
 * 실행: node 로 CJS 컴파일본을 구동(스크립트 래퍼 참조).
 * ========================================================================== */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageArchiveAdapter, ArchiveStat } from "../../src/services/storageDr/archiveAdapter";
import { sha256Hex } from "../../src/services/storageDr/archiveAdapter";
import { buildStorageManifest, parseStorageRef, type RawStorageObject } from "../../src/services/storageDr/manifest";
import { runArchiveJob } from "../../src/services/storageDr/archiveJob";
import { planStorageRestore, executeStorageRestore } from "../../src/services/storageDr/restore";
import { reconcileStorage } from "../../src/services/storageDr/reconcile";
import type { DrBucket, StorageManifest } from "../../src/services/storageDr/types";

const URL = process.env.SB_URL || "http://127.0.0.1:55421";
const KEY = process.env.SB_SECRET || "";
const ANON = process.env.SB_ANON || "";
if (!KEY) { console.error("SB_SECRET env required"); process.exit(2); }
if (!URL.includes("127.0.0.1") && !URL.includes("localhost")) { console.error("REFUSE: non-local URL"); process.exit(2); }

const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon: SupabaseClient | null = ANON ? createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const PREFIX = "storage-dr-e2e";
const T1 = "STORAGE-DR-T1";
const ARCHIVE_DIR = path.join(process.env.SCRATCH || process.cwd(), "storage-dr-archive");

// ── 결과 집계 ────────────────────────────────────────────────────────────────
const results: Record<string, { status: "PASS" | "FAIL"; detail: string }> = {};
const ok = (id: string, cond: boolean, detail: string) => { results[id] = { status: cond ? "PASS" : "FAIL", detail }; console.log(`TEST ${id} ${cond ? "PASS" : "FAIL"} — ${detail}`); };

// ── LocalFsArchiveAdapter (node fs · 실제 byte + checksum sidecar) ─────────────
class LocalFsArchiveAdapter implements StorageArchiveAdapter {
  readonly name = "local-fs";
  constructor(private root: string) { fs.mkdirSync(root, { recursive: true }); }
  private bin(b: string, p: string) { return path.join(this.root, b, p); }
  private meta(b: string, p: string) { return this.bin(b, p) + ".meta.json"; }
  async put(bucket: string, objectPath: string, bytes: Uint8Array, meta: { checksum: string; mimeType?: string | null }) {
    const f = this.bin(bucket, objectPath); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(bytes));
    fs.writeFileSync(this.meta(bucket, objectPath), JSON.stringify({ checksum: meta.checksum, size: bytes.length, mimeType: meta.mimeType ?? null }));
  }
  async get(bucket: string, objectPath: string): Promise<Uint8Array | null> {
    const f = this.bin(bucket, objectPath); if (!fs.existsSync(f)) return null; return new Uint8Array(fs.readFileSync(f));
  }
  async exists(bucket: string, objectPath: string): Promise<boolean> { return fs.existsSync(this.bin(bucket, objectPath)); }
  async stat(bucket: string, objectPath: string): Promise<ArchiveStat> {
    const f = this.bin(bucket, objectPath); const m = this.meta(bucket, objectPath);
    if (!fs.existsSync(f)) return { exists: false, size: null, checksum: null };
    let checksum: string | null = null; let size: number | null = null;
    try { const j = JSON.parse(fs.readFileSync(m, "utf8")); checksum = j.checksum ?? null; size = j.size ?? null; } catch { /* no sidecar */ }
    return { exists: true, size, checksum };
  }
  async delete(bucket: string, objectPath: string) { for (const f of [this.bin(bucket, objectPath), this.meta(bucket, objectPath)]) if (fs.existsSync(f)) fs.rmSync(f); }
}

// ── Supabase Storage 헬퍼 ──────────────────────────────────────────────────────
const enc = new TextEncoder();
const up = async (bucket: string, p: string, body: Uint8Array, contentType: string, upsert = true) =>
  admin.storage.from(bucket).upload(p, Buffer.from(body), { contentType, upsert });
const dl = async (bucket: string, p: string): Promise<Uint8Array | null> => {
  const { data, error } = await admin.storage.from(bucket).download(p);
  if (error || !data) return null; return new Uint8Array(await data.arrayBuffer());
};
const rm = async (bucket: string, p: string) => { await admin.storage.from(bucket).remove([p]); };

async function listAll(bucket: DrBucket, prefix = ""): Promise<RawStorageObject[]> {
  const out: RawStorageObject[] = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const item of data) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    const meta = item.metadata as { size?: number; mimetype?: string; eTag?: string } | null;
    if (!meta) { out.push(...await listAll(bucket, full)); } // 폴더 → 재귀
    else out.push({ bucket, objectPath: full, size: meta.size ?? null, mimeType: meta.mimetype ?? null, etag: meta.eTag ?? null, createdAt: item.created_at ?? null, updatedAt: item.updated_at ?? null });
  }
  return out;
}

const publicUrl = (bucket: string, p: string) => admin.storage.from(bucket).getPublicUrl(p).data.publicUrl;

async function cleanup() {
  // 합성 object 는 PREFIX 루트 + 테넌트 루트(STORAGE-DR-T1/T2) 아래에만 존재한다.
  for (const b of ["cleaning-photos", "inventory-proof", "contract-files", "generated-pdfs"] as DrBucket[]) {
    const objs: RawStorageObject[] = [];
    for (const root of [PREFIX, "STORAGE-DR-T1", "STORAGE-DR-T2"]) objs.push(...await listAll(b, root));
    const paths = [...new Set(objs.map((o) => o.objectPath))];
    if (paths.length) await admin.storage.from(b).remove(paths);
  }
  // 메인 + resume 테스트가 만든 모든 아카이브 디렉터리(ARCHIVE_DIR*) 제거.
  try {
    const base = path.dirname(ARCHIVE_DIR); const leaf = path.basename(ARCHIVE_DIR);
    for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) if (d.startsWith(leaf)) fs.rmSync(path.join(base, d), { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  await cleanup(); // 이전 잔재 제거
  const adapter = new LocalFsArchiveAdapter(ARCHIVE_DIR);

  // 합성 object 업로드 (public/private)
  const bytesClean = enc.encode("CLEAN-PHOTO-BEFORE-" + "x".repeat(50));
  const bytesClean2 = enc.encode("CLEAN-PHOTO-AFTER-" + "y".repeat(80));
  const bytesInv = enc.encode("%PDF-1.4 INVENTORY-PROOF " + "z".repeat(30));
  const bytesContract = enc.encode("%PDF-1.4 CONTRACT-PRIVATE " + "c".repeat(120));
  const bytesPdf = enc.encode("%PDF-1.4 EPHEMERAL-GENERATED");

  const pClean = `${PREFIX}/2026/report-A/before/0.jpg`;
  const pClean2 = `${PREFIX}/2026/report-A/after/0.jpg`;
  const pInv = `${PREFIX}/2026/item-1/0.pdf`;
  const pContract = `${T1}/${PREFIX}-contract-9/doc.pdf`;
  const pPdf = `${T1}/pdf-temp/${PREFIX}-tmp.pdf`;

  for (const [b, p, by, ct] of [
    ["cleaning-photos", pClean, bytesClean, "image/jpeg"],
    ["cleaning-photos", pClean2, bytesClean2, "image/jpeg"],
    ["inventory-proof", pInv, bytesInv, "application/pdf"],
    ["contract-files", pContract, bytesContract, "application/pdf"],
    ["generated-pdfs", pPdf, bytesPdf, "application/pdf"],
  ] as Array<[DrBucket, string, Uint8Array, string]>) {
    const { error } = await up(b, p, by, ct); if (error) { console.error("upload failed", b, p, error.message); process.exit(3); }
  }

  // DB 참조(실제 Storage 공개 URL / storage_path 기반) — data: inline 1건 포함
  const db = {
    cleaningReports: [{ id: "report-A", before: [publicUrl("cleaning-photos", pClean)], after: [publicUrl("cleaning-photos", pClean2), "data:image/png;base64,QUJD"] }],
    inventoryItems: [{ id: "item-1", proofFile: JSON.stringify({ name: "proof.pdf", data: publicUrl("inventory-proof", pInv) }) }],
    contractFiles: [{ id: "cf-9", storage_path: pContract }],
  };

  // ── 실제 Storage object 목록(PREFIX 루트 + 테넌트 루트에서 재귀 수집) ──
  const allLive: RawStorageObject[] = [];
  for (const b of ["cleaning-photos", "inventory-proof", "contract-files", "generated-pdfs"] as DrBucket[]) {
    allLive.push(...(await listAll(b, PREFIX)));
    allLive.push(...(await listAll(b, T1)));
  }
  const live = dedupe(allLive);

  // ====== A. manifest 생성 ======
  const manifest: StorageManifest = buildStorageManifest({ tenantId: T1, objects: live, db, includeGeneratedPdfs: false });
  const hasClean = manifest.entries.find((e) => e.objectPath === pClean && e.sourceRefType === "cleaning_report_photo");
  const hasInv = manifest.entries.find((e) => e.objectPath === pInv && e.sourceRefType === "inventory_proof");
  const hasContract = manifest.entries.find((e) => e.objectPath === pContract && e.sourceRefType === "contract_file");
  const pdfExcluded = !manifest.entries.some((e) => e.bucket === "generated-pdfs");
  ok("A", !!hasClean && !!hasInv && !!hasContract && pdfExcluded && manifest.inlineOnly.length === 1,
    `entries=${manifest.entries.length} inlineOnly=${manifest.inlineOnly.length} pdfExcluded=${pdfExcluded}`);

  // ====== B. public object (URL 파싱) ======
  const parsed = parseStorageRef(publicUrl("cleaning-photos", pClean));
  ok("B", parsed.kind === "object" && parsed.bucket === "cleaning-photos" && parsed.objectPath === pClean, `parsed=${JSON.stringify(parsed)}`);

  // ====== C. private object ======
  const { data: signed } = await admin.storage.from("contract-files").createSignedUrl(pContract, 60);
  const cEntry = manifest.entries.find((e) => e.objectPath === pContract);
  ok("C", !!signed?.signedUrl && cEntry?.visibility === "private", `signedUrlCreated=${!!signed?.signedUrl} visibility=${cEntry?.visibility}`);

  // ====== D. binary archive ======
  const archiveRun = await runArchiveJob(manifest, { download: dl, adapter }, { batchSize: 2, maxRetries: 2 });
  ok("D", archiveRun.archived === manifest.entries.length && archiveRun.failed === 0, `archived=${archiveRun.archived}/${archiveRun.total} failed=${archiveRun.failed}`);

  // ====== E. archive checksum == source sha256 ======
  const srcClean = await dl("cleaning-photos", pClean);
  const srcSum = srcClean ? await sha256Hex(srcClean) : "";
  const aStat = await adapter.stat("cleaning-photos", pClean);
  ok("E", !!srcSum && aStat.checksum === srcSum, `source=${srcSum.slice(0, 12)} archive=${(aStat.checksum || "").slice(0, 12)}`);

  const readTarget = dl;
  const writeTarget = async (b: string, p: string, by: Uint8Array, ct: string | null) => { const { error } = await up(b, p, by, ct || "application/octet-stream", true); if (error) throw new Error(error.message); };
  const restoreDeps = { adapter, readTarget, writeTarget };

  // ====== F. missing object restore ======
  await rm("inventory-proof", pInv);
  let plan = await planStorageRestore(manifest, restoreDeps);
  const invPlan = plan.find((x) => x.objectPath === pInv);
  const execF = await executeStorageRestore(plan, manifest, restoreDeps);
  const invExec = execF.find((x) => x.item.objectPath === pInv);
  const invBack = await dl("inventory-proof", pInv);
  const invBackSum = invBack ? await sha256Hex(invBack) : "";
  ok("F", invPlan?.decision === "RESTORE" && !!invExec?.applied && invBackSum === (await adapter.stat("inventory-proof", pInv)).checksum,
    `plan=${invPlan?.decision} applied=${invExec?.applied} checksumMatch=${invBackSum === (await adapter.stat("inventory-proof", pInv)).checksum}`);

  // ====== R. restore 후 checksum 동일(verifyOk) ======
  ok("R", invExec?.verifyOk === true && invExec?.verifiedChecksum === invPlan?.archiveChecksum, `verifyOk=${invExec?.verifyOk}`);

  // ====== G. identical SKIP (archive 재실행 + restore plan) ======
  const archiveRun2 = await runArchiveJob(manifest, { download: dl, adapter }, { batchSize: 2 });
  plan = await planStorageRestore(manifest, restoreDeps);
  const skipAll = plan.filter((x) => x.objectPath !== pPdf).every((x) => x.decision === "SKIP");
  ok("G", archiveRun2.skipped === manifest.entries.length && skipAll, `rerunSkipped=${archiveRun2.skipped}/${archiveRun2.total} restorePlanAllSkip=${skipAll}`);

  // ====== H. conflict detection (대상 내용 변경) ======
  await up("cleaning-photos", pClean, enc.encode("DIFFERENT-CONTENT-NOW"), "image/jpeg", true);
  plan = await planStorageRestore(manifest, restoreDeps);
  const confItem = plan.find((x) => x.objectPath === pClean);
  const execH = await executeStorageRestore(plan, manifest, restoreDeps); // 기본 overwrite 금지
  const hExec = execH.find((x) => x.item.objectPath === pClean);
  ok("H", confItem?.decision === "CONFLICT" && hExec?.applied === false, `decision=${confItem?.decision} appliedWithoutConsent=${hExec?.applied}`);
  // 복구: 올바른 내용으로 되돌림(명시적 overwrite)
  await executeStorageRestore([confItem!], manifest, restoreDeps, { allowOverwriteConflicts: true });

  // ====== I. interrupted backup resume ======
  const signal = { aborted: false };
  const r1 = await runArchiveJob(manifest, { download: dl, adapter: freshAdapter() }, { batchSize: 1, signal, onProgress: (p) => { if (p.done >= 1) signal.aborted = true; } });
  const processed1 = r1.archived + r1.skipped;
  const r2 = await runArchiveJob({ ...manifest, entries: r1.failedEntries }, { download: dl, adapter: resumeAdapterRef! }, { batchSize: 2 });
  ok("I", processed1 >= 1 && r1.failedEntries.length === manifest.entries.length - processed1 && (r2.archived + r2.skipped) === r1.failedEntries.length,
    `firstPass=${processed1} pending=${r1.failedEntries.length} resumeDone=${r2.archived + r2.skipped}`);

  // ====== J. retry (일시 실패 후 성공) ======
  let flaky = 0;
  const flakyDownload = async (b: string, p: string) => { if (p === pContract && flaky < 1) { flaky++; throw new Error("transient network"); } return dl(b, p); };
  const singleContract: StorageManifest = { ...manifest, entries: manifest.entries.filter((e) => e.objectPath === pContract) };
  const rJ = await runArchiveJob(singleContract, { download: flakyDownload, adapter: freshAdapter() }, { batchSize: 1, maxRetries: 2, retryDelayMs: 10 });
  ok("J", rJ.archived === 1 && rJ.results[0].attempts >= 2, `attempts=${rJ.results[0]?.attempts} archived=${rJ.archived}`);

  // ====== reconcile 공통 입력(실제 live + archive 상태) ======
  const liveForRecon: Array<{ bucket: DrBucket; objectPath: string; checksum?: string | null }> = [];
  for (const o of live) { const by = await dl(o.bucket, o.objectPath); liveForRecon.push({ bucket: o.bucket, objectPath: o.objectPath, checksum: by ? await sha256Hex(by) : null }); }
  const archivePresent = new Map<string, { exists: boolean; checksum: string | null }>();
  for (const e of manifest.entries) { const s = await adapter.stat(e.bucket, e.objectPath); archivePresent.set(`${e.bucket}\u0000${e.objectPath}`, { exists: s.exists, checksum: s.checksum }); }

  // ====== K. dangling (DB 포인터 → object 없음) ======
  const dbDangling = { ...db, cleaningReports: [{ id: "ghost", before: [publicUrl("cleaning-photos", `${PREFIX}/ghost/none.jpg`)], after: [] }] };
  const recK = reconcileStorage({ tenantId: T1, db: dbDangling, liveObjects: liveForRecon, manifest, archivePresent });
  ok("K", recK.counts.DANGLING >= 1, `dangling=${recK.counts.DANGLING}`);

  // ====== L. orphan (object → DB 참조 없음) ======
  const pOrphan = `${PREFIX}/orphan/stray.jpg`;
  await up("cleaning-photos", pOrphan, enc.encode("ORPHAN"), "image/jpeg", true);
  const liveWithOrphan = [...liveForRecon, { bucket: "cleaning-photos" as DrBucket, objectPath: pOrphan, checksum: await sha256Hex(enc.encode("ORPHAN")) }];
  const recL = reconcileStorage({ tenantId: T1, db, liveObjects: liveWithOrphan, manifest, archivePresent });
  ok("L", recL.findings.some((f) => f.kind === "ORPHAN" && f.objectPath === pOrphan), `orphan=${recL.counts.ORPHAN}`);

  // ====== M. inline_only ======
  const recM = reconcileStorage({ tenantId: T1, db, liveObjects: liveForRecon, manifest, archivePresent });
  ok("M", recM.counts.INLINE_ONLY >= 1 && manifest.inlineOnly.length >= 1, `inlineOnly=${recM.counts.INLINE_ONLY}`);

  // ====== Q. archive missing ======
  const apMissing = new Map(archivePresent);
  apMissing.set(`contract-files\u0000${pContract}`, { exists: false, checksum: null });
  const recQ = reconcileStorage({ tenantId: T1, db, liveObjects: liveForRecon, manifest, archivePresent: apMissing });
  ok("Q", recQ.findings.some((f) => f.kind === "ARCHIVE_MISSING" && f.objectPath === pContract), `archiveMissing=${recQ.counts.ARCHIVE_MISSING}`);

  // ====== N. private contract 보안 — manifest 에 signed url/token/secret 미포함 ======
  const mstr = JSON.stringify(manifest);
  const leak = /token=|signedurl|sign\?|jwt|service_role|sb_secret|secret/i.test(mstr) || mstr.includes("://");
  ok("N", !leak && manifest.entries.every((e) => !("url" in e) && !("signedUrl" in (e as object))), `leak=${leak}`);

  // ====== O. non-admin 차단 (anon) ======
  if (anon) {
    const { error: privErr } = await anon.storage.from("contract-files").download(pContract);
    const { data: pubData } = await anon.storage.from("cleaning-photos").download(pClean);
    ok("O", !!privErr && !!pubData, `privateBlocked=${!!privErr} publicAllowed=${!!pubData}`);
  } else { results["O"] = { status: "FAIL", detail: "anon key not provided" }; console.log("TEST O FAIL — anon key not provided"); }

  // ====== P. cross-tenant (데이터 계층 scoping) ======
  // T2 object 를 올리고 T1 manifest/db 로 빌드 → T2 는 T1 참조로 섞이지 않고 ORPHAN 으로만 보임.
  const pT2 = `STORAGE-DR-T2/${PREFIX}-c/doc.pdf`;
  await up("contract-files", pT2, enc.encode("T2-PRIVATE"), "application/pdf", true);
  const liveP = [...liveForRecon, { bucket: "contract-files" as DrBucket, objectPath: pT2, checksum: await sha256Hex(enc.encode("T2-PRIVATE")) }];
  const recP = reconcileStorage({ tenantId: T1, db, liveObjects: liveP, manifest, archivePresent });
  const t2NotReferenced = !manifest.entries.some((e) => e.objectPath === pT2) && recP.findings.some((f) => f.kind === "ORPHAN" && f.objectPath === pT2);
  ok("P", manifest.tenantId === T1 && t2NotReferenced, `t1Scoped=${manifest.tenantId === T1} t2Orphan=${t2NotReferenced} (주의: Storage RLS 는 테넌트 경로 미강제 — 데이터계층 scoping)`);

  await cleanup();

  // ── 요약 ──
  const fails = Object.entries(results).filter(([, v]) => v.status === "FAIL");
  console.log("\n==== SUMMARY ====");
  for (const [id, v] of Object.entries(results)) console.log(`${id}: ${v.status}`);
  console.log(`TOTAL ${Object.keys(results).length} PASS ${Object.keys(results).length - fails.length} FAIL ${fails.length}`);
  process.exit(fails.length ? 1 : 0);
}

function dedupe(list: RawStorageObject[]): RawStorageObject[] {
  const m = new Map<string, RawStorageObject>(); for (const o of list) m.set(`${o.bucket}\u0000${o.objectPath}`, o); return [...m.values()];
}
// resume 테스트용: 동일 adapter 인스턴스를 1·2차에서 공유해야 resume 가 의미있다.
let resumeAdapterRef: StorageArchiveAdapter | null = null;
function freshAdapter(): StorageArchiveAdapter { const a = new LocalFsArchiveAdapter(ARCHIVE_DIR + "-" + Math.random().toString(36).slice(2, 7)); if (!resumeAdapterRef) resumeAdapterRef = a; return a; }

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(4); });
