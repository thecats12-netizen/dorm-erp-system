// ============================================================================
// Storage DR — 복원(안전 우선, DI). 기본값은 "덮어쓰지 않음".
//  판정:  identical checksum → SKIP · 경로동일+내용다름 → CONFLICT(자동 overwrite 금지)
//         대상에 없음 → RESTORE · 아카이브에도 없음 → ARCHIVE_MISSING
//  복원 후 size/checksum 재검증.
// ============================================================================
import type { StorageArchiveAdapter } from "./archiveAdapter";
import { sha256Hex } from "./archiveAdapter";
import type { StorageManifest, StorageManifestEntry, RestorePlanItem, RestoreExecResult } from "./types";

export type RestoreDeps = {
  adapter: StorageArchiveAdapter;
  // 대상 Storage 에 현재 object 가 있으면 그 바이트를 돌려준다(없으면 null).
  readTarget: (bucket: string, objectPath: string) => Promise<Uint8Array | null>;
  // 대상 Storage 에 업로드(upsert 여부는 구현이 결정 · 기본 non-overwrite 는 호출부가 보장).
  writeTarget: (bucket: string, objectPath: string, bytes: Uint8Array, mimeType: string | null) => Promise<void>;
};

// 사전 검사(실제 쓰기 없음): 각 entry 를 RESTORE/SKIP/CONFLICT/ARCHIVE_MISSING 으로 분류.
export async function planStorageRestore(manifest: StorageManifest, deps: RestoreDeps): Promise<RestorePlanItem[]> {
  const plan: RestorePlanItem[] = [];
  for (const e of manifest.entries) {
    const aStat = await deps.adapter.stat(e.bucket, e.objectPath);
    if (!aStat.exists) {
      plan.push({ bucket: e.bucket, objectPath: e.objectPath, decision: "ARCHIVE_MISSING", archiveChecksum: null, targetChecksum: null });
      continue;
    }
    const target = await deps.readTarget(e.bucket, e.objectPath);
    if (!target) {
      plan.push({ bucket: e.bucket, objectPath: e.objectPath, decision: "RESTORE", archiveChecksum: aStat.checksum, targetChecksum: null });
      continue;
    }
    const targetChecksum = await sha256Hex(target);
    if (aStat.checksum && targetChecksum === aStat.checksum) {
      plan.push({ bucket: e.bucket, objectPath: e.objectPath, decision: "SKIP", archiveChecksum: aStat.checksum, targetChecksum });
    } else {
      plan.push({ bucket: e.bucket, objectPath: e.objectPath, decision: "CONFLICT", archiveChecksum: aStat.checksum, targetChecksum });
    }
  }
  return plan;
}

// 복원 실행. 기본은 RESTORE 만 적용(SKIP/CONFLICT/ARCHIVE_MISSING 은 쓰기 안 함).
//  · allowOverwriteConflicts=true 를 명시해야만 CONFLICT 를 덮어쓴다(관리자 확인 후).
export async function executeStorageRestore(
  plan: RestorePlanItem[],
  manifest: StorageManifest,
  deps: RestoreDeps,
  opts: { allowOverwriteConflicts?: boolean } = {},
): Promise<RestoreExecResult[]> {
  const byKey = new Map<string, StorageManifestEntry>();
  for (const e of manifest.entries) byKey.set(`${e.bucket}\u0000${e.objectPath}`, e);
  const out: RestoreExecResult[] = [];

  for (const item of plan) {
    const willApply = item.decision === "RESTORE" || (item.decision === "CONFLICT" && !!opts.allowOverwriteConflicts);
    if (!willApply) { out.push({ item, applied: false, verifiedChecksum: null, verifyOk: null }); continue; }
    try {
      const bytes = await deps.adapter.get(item.bucket, item.objectPath);
      if (!bytes) { out.push({ item, applied: false, verifiedChecksum: null, verifyOk: null, error: "archive binary missing at get()" }); continue; }
      const entry = byKey.get(`${item.bucket}\u0000${item.objectPath}`);
      await deps.writeTarget(item.bucket, item.objectPath, bytes, entry?.mimeType ?? null);
      // 복원 후 재검증.
      const after = await deps.readTarget(item.bucket, item.objectPath);
      const verifiedChecksum = after ? await sha256Hex(after) : null;
      const verifyOk = !!verifiedChecksum && (!item.archiveChecksum || verifiedChecksum === item.archiveChecksum);
      out.push({ item, applied: true, verifiedChecksum, verifyOk });
    } catch (e) {
      out.push({ item, applied: false, verifiedChecksum: null, verifyOk: false, error: ((e as { message?: string })?.message || "restore error").slice(0, 200) });
    }
  }
  return out;
}
