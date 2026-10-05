// ============================================================================
// Storage DR — 바이너리 아카이브 작업(orchestrator, DI).
//  · 거대 메모리 금지: object 단위 batch 로 다운로드→체크섬→아카이브. 전체를 한 번에 메모리에 올리지 않는다.
//  · idempotency/resume: 아카이브에 동일 checksum 이 이미 있으면 SKIP. 실패분만 재시도 가능.
//  · retry/partial-failure: object 별 성공/실패를 개별 기록. 하나 실패해도 전체 중단하지 않는다.
//  · service_role 등 비밀은 이 모듈이 알지 못한다 — downloadObject(DI)가 접근을 캡슐화한다.
// ============================================================================
import type { StorageArchiveAdapter } from "./archiveAdapter";
import { sha256Hex } from "./archiveAdapter";
import type { StorageManifest, StorageManifestEntry, ArchiveObjectResult, ArchiveRunResult, ArchiveStatus } from "./types";

export type DownloadObject = (bucket: string, objectPath: string) => Promise<Uint8Array | null>;

export type ArchiveJobDeps = {
  download: DownloadObject;
  adapter: StorageArchiveAdapter;
};

export type ArchiveJobOptions = {
  batchSize?: number;    // 동시 처리 수(메모리 보호). 기본 4.
  maxRetries?: number;   // object 당 재시도 횟수. 기본 2.
  retryDelayMs?: number; // 재시도 간격. 기본 300.
  onProgress?: (p: { done: number; total: number; current?: StorageManifestEntry; lastStatus?: ArchiveStatus }) => void;
  signal?: { aborted: boolean }; // 중단 신호(협조적). resume 로 이어받음.
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function archiveOne(entry: StorageManifestEntry, deps: ArchiveJobDeps, maxRetries: number, retryDelayMs: number): Promise<ArchiveObjectResult> {
  let attempts = 0;
  let lastErr = "";
  while (attempts <= maxRetries) {
    attempts++;
    try {
      const bytes = await deps.download(entry.bucket, entry.objectPath);
      if (!bytes) { lastErr = "source object not found"; }
      else {
        const checksum = await sha256Hex(bytes);
        // resume/idempotency: 아카이브에 동일 checksum 이 이미 있으면 재업로드하지 않음.
        const stat = await deps.adapter.stat(entry.bucket, entry.objectPath);
        if (stat.exists && stat.checksum && stat.checksum === checksum) {
          return { bucket: entry.bucket, objectPath: entry.objectPath, status: "skipped", contentChecksum: checksum, size: bytes.length, attempts };
        }
        await deps.adapter.put(entry.bucket, entry.objectPath, bytes, { checksum, mimeType: entry.mimeType });
        return { bucket: entry.bucket, objectPath: entry.objectPath, status: "archived", contentChecksum: checksum, size: bytes.length, attempts };
      }
    } catch (e) {
      lastErr = summarizeErr(e);
    }
    if (attempts <= maxRetries) await sleep(retryDelayMs);
  }
  return { bucket: entry.bucket, objectPath: entry.objectPath, status: "failed", contentChecksum: null, size: entry.size, attempts, error: lastErr || "unknown error" };
}

// 민감정보(토큰/URL/키)를 로그/결과에 남기지 않도록 메시지만 간추린다.
function summarizeErr(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e);
  return m.replace(/(token|key|secret|jwt|authorization)=[^&\s]+/gi, "$1=<redacted>").slice(0, 200);
}

// manifest 의 모든(또는 주어진) entry 를 아카이브한다. batch 로 나눠 메모리를 보호한다.
export async function runArchiveJob(
  manifest: StorageManifest,
  deps: ArchiveJobDeps,
  options: ArchiveJobOptions = {},
): Promise<ArchiveRunResult> {
  const batchSize = Math.max(1, options.batchSize ?? 4);
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 300);
  const startedAt = new Date().toISOString();
  const results: ArchiveObjectResult[] = [];
  const entries = manifest.entries;
  let done = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    if (options.signal?.aborted) break; // 협조적 중단 → 나머지는 실패가 아니라 "미처리"(resume 대상)
    const chunk = entries.slice(i, i + batchSize);
    const settled = await Promise.all(chunk.map((e) => archiveOne(e, deps, maxRetries, retryDelayMs)));
    for (let j = 0; j < settled.length; j++) {
      results.push(settled[j]);
      done++;
      options.onProgress?.({ done, total: entries.length, current: chunk[j], lastStatus: settled[j].status });
    }
  }

  const archived = results.filter((r) => r.status === "archived").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const byBucket: ArchiveRunResult["byBucket"] = {};
  for (const r of results) {
    const b = (byBucket[r.bucket] ||= { total: 0, archived: 0, skipped: 0, failed: 0 });
    b.total++;
    if (r.status === "archived") b.archived++;
    else if (r.status === "skipped") b.skipped++;
    else if (r.status === "failed") b.failed++;
  }
  const failedKeys = new Set(results.filter((r) => r.status === "failed").map((r) => `${r.bucket}\u0000${r.objectPath}`));
  const processedKeys = new Set(results.map((r) => `${r.bucket}\u0000${r.objectPath}`));
  // 실패 + 중단으로 미처리된 entry 를 재시도 입력으로 모은다(resume).
  const failedEntries = entries.filter((e) => {
    const k = `${e.bucket}\u0000${e.objectPath}`;
    return failedKeys.has(k) || !processedKeys.has(k);
  });

  return {
    startedAt, finishedAt: new Date().toISOString(),
    total: entries.length, archived, skipped, failed,
    byBucket, results, failedEntries,
  };
}
