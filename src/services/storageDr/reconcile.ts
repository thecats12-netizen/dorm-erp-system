// ============================================================================
// Storage DR — 재조정(reconciliation). 순수 함수 · 자동 삭제 없음 · 리포트 전용.
//   DANGLING / ORPHAN / INLINE_ONLY / ARCHIVE_MISSING / CONTENT_MISMATCH 를 탐지한다.
// ============================================================================
import type { DrBucket, ReconcileKind, ReconcileFinding, ReconcileReport, StorageManifest } from "./types";
import { buildDbRefIndex, type DbReferenceInput } from "./manifest";

export type ReconcileInput = {
  tenantId: string;
  db: DbReferenceInput;
  // 현재 대상 Storage 에 실제 존재하는 object 목록 + (가능하면) checksum.
  liveObjects: Array<{ bucket: DrBucket; objectPath: string; checksum?: string | null }>;
  // 아카이브 manifest(엔트리별 contentChecksum 포함 가능).
  manifest: StorageManifest;
  // 아카이브에 실제 바이너리가 있는 키 집합("bucket\u0000path"). + checksum.
  archivePresent: Map<string, { exists: boolean; checksum: string | null }>;
  now?: string;
};

const K = (b: string, p: string) => `${b}\u0000${p}`;

export function reconcileStorage(input: ReconcileInput): ReconcileReport {
  const now = input.now || new Date().toISOString();
  const findings: ReconcileFinding[] = [];

  const { index, inlineOnly } = buildDbRefIndex(input.db);
  const liveKeys = new Map(input.liveObjects.map((o) => [K(o.bucket, o.objectPath), o]));

  // DANGLING: DB 포인터가 가리키는 object 가 live Storage 에 없음.
  for (const [key, ref] of index) {
    const [bucket, objectPath] = key.split("\u0000");
    if (!liveKeys.has(key)) {
      findings.push({ kind: "DANGLING", bucket: bucket as DrBucket, objectPath, relatedTable: ref.relatedTable, relatedRowId: ref.relatedRowId, detail: "DB 참조가 가리키는 파일이 저장소에 없습니다." });
    }
  }

  // ORPHAN: live Storage object 인데 DB 참조가 없음(generated-pdfs 는 일시 산출물 → 제외).
  for (const [key, o] of liveKeys) {
    if (o.bucket === "generated-pdfs") continue;
    if (!index.has(key)) {
      findings.push({ kind: "ORPHAN", bucket: o.bucket, objectPath: o.objectPath, relatedTable: null, relatedRowId: null, detail: "저장소에만 있고 DB에서 참조되지 않는 파일입니다." });
    }
  }

  // INLINE_ONLY: DB base64 fallback(Storage object 아님).
  for (const inl of inlineOnly) {
    findings.push({ kind: "INLINE_ONLY", bucket: null, objectPath: null, relatedTable: inl.relatedTable, relatedRowId: inl.relatedRowId, detail: `DB에 파일 원본(base64)으로만 저장됨(${inl.field}) — 저장소/아카이브 대상 아님.` });
  }

  // ARCHIVE_MISSING: manifest 에 있는데 아카이브에 바이너리 없음.
  for (const e of input.manifest.entries) {
    const key = K(e.bucket, e.objectPath);
    const a = input.archivePresent.get(key);
    if (!a || !a.exists) {
      findings.push({ kind: "ARCHIVE_MISSING", bucket: e.bucket, objectPath: e.objectPath, relatedTable: e.relatedTable, relatedRowId: e.relatedRowId, detail: "백업 목록엔 있으나 아카이브에 실제 파일이 없습니다." });
    }
  }

  // CONTENT_MISMATCH: 같은 경로가 live/아카이브 양쪽에 있는데 checksum 불일치.
  for (const [key, a] of input.archivePresent) {
    if (!a.exists || !a.checksum) continue;
    const live = liveKeys.get(key);
    if (live && live.checksum && live.checksum !== a.checksum) {
      const [bucket, objectPath] = key.split("\u0000");
      findings.push({ kind: "CONTENT_MISMATCH", bucket: bucket as DrBucket, objectPath, relatedTable: null, relatedRowId: null, detail: "저장소 파일과 아카이브 파일의 내용(checksum)이 다릅니다." });
    }
  }

  const counts = { DANGLING: 0, ORPHAN: 0, INLINE_ONLY: 0, ARCHIVE_MISSING: 0, CONTENT_MISMATCH: 0 } as Record<ReconcileKind, number>;
  for (const f of findings) counts[f.kind]++;
  return { generatedAt: now, tenantId: input.tenantId, findings, counts };
}
