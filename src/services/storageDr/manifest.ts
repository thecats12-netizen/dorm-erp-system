// ============================================================================
// Storage DR — manifest 생성 + DB 역참조 추출(순수 함수, DI).
//  · Storage object 목록 + DB 참조행을 받아 manifest 를 만든다.
//  · 공개/서명 URL 에서 bucket/path 를 안전 추출(토큰은 버린다 → signed URL 미저장).
//  · data: fallback(base64)은 Storage object 가 아니므로 inlineOnly 로 분리(아카이브 대상 아님).
// ============================================================================
import {
  type DrBucket, type StorageManifest, type StorageManifestEntry, type Visibility,
  type SourceRefType, type InlineOnlyRef, STORAGE_MANIFEST_VERSION,
} from "./types";

export const BUCKET_VISIBILITY: Record<DrBucket, Visibility> = {
  "cleaning-photos": "public",
  "inventory-proof": "public",
  "contract-files": "private",
  "generated-pdfs": "private",
};

// Storage object 목록 1건(어댑터/서버가 제공하는 최소 정보).
export type RawStorageObject = {
  bucket: DrBucket;
  objectPath: string;
  size?: number | null;
  mimeType?: string | null;
  etag?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

// DB 역참조 입력(각 모듈 리더가 채운다).
export type DbReferenceInput = {
  // cleaning_reports: { id, before:[url...], after:[url...] }
  cleaningReports?: Array<{ id: string; before?: unknown; after?: unknown }>;
  // inventory_items: { id, proofFile: string(JSON {name,data:url} | url | data:) }
  inventoryItems?: Array<{ id: string; proofFile?: unknown }>;
  // dorm_contract_files: { id, storage_path }
  contractFiles?: Array<{ id: string; storage_path?: unknown }>;
};

// 공개 URL:  {base}/storage/v1/object/public/{bucket}/{path}
// 서명 URL:  {base}/storage/v1/object/sign/{bucket}/{path}?token=...(토큰 버림)
// authenticated: {base}/storage/v1/object/authenticated/{bucket}/{path}
const URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/i;

export type ParsedRef =
  | { kind: "object"; bucket: string; objectPath: string }
  | { kind: "inline"; approxBytes: number | null; mimeHint: string | null }
  | { kind: "none" };

// 문자열 1개(URL 또는 data: 또는 빈값)를 분류. 토큰/쿼리는 보존하지 않는다.
export function parseStorageRef(value: unknown): ParsedRef {
  if (typeof value !== "string" || value.length === 0) return { kind: "none" };
  const v = value.trim();
  if (/^data:/i.test(v)) {
    const mime = /^data:([^;,]+)/i.exec(v)?.[1] || null;
    // base64 근사 바이트(길이*3/4). 정확치 아님.
    const comma = v.indexOf(",");
    const body = comma >= 0 ? v.slice(comma + 1) : "";
    const approx = /;base64/i.test(v) ? Math.floor(body.length * 0.75) : body.length;
    return { kind: "inline", approxBytes: approx || null, mimeHint: mime };
  }
  const m = URL_RE.exec(v);
  if (m) {
    const bucket = decodeURIComponent(m[1]);
    const objectPath = decodeURIComponent(m[2]);
    return { kind: "object", bucket, objectPath };
  }
  return { kind: "none" };
}

// inventory proof_file 은 JSON {name,data:url} 또는 과거 문자열. 내부 url/값만 추출.
function extractProofValue(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return "";
  const s = raw.trim();
  if (s.startsWith("{")) {
    try { const p = JSON.parse(s) as { data?: unknown }; return p.data ?? ""; } catch { return ""; }
  }
  return s;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return v == null || v === "" ? [] : [v];
}

// DB 참조로부터 (bucket|objectPath) → {refType, table, rowId} 역색인을 만든다.
export type RefIndexValue = { sourceRefType: SourceRefType; relatedTable: string; relatedRowId: string };
export function buildDbRefIndex(db: DbReferenceInput): {
  index: Map<string, RefIndexValue>;
  inlineOnly: InlineOnlyRef[];
} {
  const index = new Map<string, RefIndexValue>();
  const inlineOnly: InlineOnlyRef[] = [];
  const keyOf = (bucket: string, path: string) => `${bucket}\u0000${path}`;

  const addObjectRefs = (
    values: unknown[], table: string, rowId: string, refType: SourceRefType, fieldBase: string,
  ) => {
    values.forEach((val, i) => {
      const parsed = parseStorageRef(val);
      if (parsed.kind === "object") {
        index.set(keyOf(parsed.bucket, parsed.objectPath), { sourceRefType: refType, relatedTable: table, relatedRowId: rowId });
      } else if (parsed.kind === "inline") {
        inlineOnly.push({ relatedTable: table, relatedRowId: rowId, field: `${fieldBase}[${i}]`, approxBytes: parsed.approxBytes, mimeHint: parsed.mimeHint });
      }
    });
  };

  for (const r of db.cleaningReports || []) {
    addObjectRefs(asArray(r.before), "cleaning_reports", r.id, "cleaning_report_photo", "before_photo_data_urls");
    addObjectRefs(asArray(r.after), "cleaning_reports", r.id, "cleaning_report_photo", "after_photo_data_urls");
  }
  for (const it of db.inventoryItems || []) {
    addObjectRefs([extractProofValue(it.proofFile)], "inventory_items", it.id, "inventory_proof", "proof_file");
  }
  for (const cf of db.contractFiles || []) {
    const p = typeof cf.storage_path === "string" ? cf.storage_path.trim() : "";
    if (p) index.set(keyOf("contract-files", p), { sourceRefType: "contract_file", relatedTable: "dorm_contract_files", relatedRowId: cf.id });
  }
  return { index, inlineOnly };
}

// INLINE_ONLY(base64 data: 전용) 요약 — 백업 전 관리자 경고/리포트용. silent loss 방지.
export type InlineOnlyReport = {
  count: number;
  approxBytesTotal: number;
  byTable: Record<string, number>;
  samples: Array<{ relatedTable: string; relatedRowId: string; field: string }>;
};
export function summarizeInlineOnly(manifest: StorageManifest): InlineOnlyReport {
  const byTable: Record<string, number> = {};
  let approx = 0;
  for (const i of manifest.inlineOnly) { byTable[i.relatedTable] = (byTable[i.relatedTable] || 0) + 1; approx += i.approxBytes || 0; }
  return { count: manifest.inlineOnly.length, approxBytesTotal: approx, byTable, samples: manifest.inlineOnly.slice(0, 20).map((i) => ({ relatedTable: i.relatedTable, relatedRowId: i.relatedRowId, field: i.field })) };
}

// Storage object 목록 + DB 참조 → manifest. generated-pdfs 는 기본 제외(일시 산출물).
export function buildStorageManifest(args: {
  tenantId: string;
  objects: RawStorageObject[];
  db: DbReferenceInput;
  now?: string;
  includeGeneratedPdfs?: boolean; // 기본 false(EPHEMERAL_EXCLUDED)
}): StorageManifest {
  const now = args.now || new Date().toISOString();
  const { index, inlineOnly } = buildDbRefIndex(args.db);
  const keyOf = (bucket: string, path: string) => `${bucket}\u0000${path}`;

  const entries: StorageManifestEntry[] = [];
  for (const o of args.objects) {
    if (o.bucket === "generated-pdfs" && !args.includeGeneratedPdfs) continue;
    const ref = index.get(keyOf(o.bucket, o.objectPath));
    entries.push({
      bucket: o.bucket,
      objectPath: o.objectPath,
      visibility: BUCKET_VISIBILITY[o.bucket],
      size: o.size ?? null,
      mimeType: o.mimeType ?? null,
      fingerprint: o.etag ?? null,
      contentChecksum: null, // 아카이브 시점에 실제 바이트로 채움
      createdAt: o.createdAt ?? null,
      updatedAt: o.updatedAt ?? null,
      sourceRefType: ref?.sourceRefType ?? "unreferenced",
      relatedTable: ref?.relatedTable ?? null,
      relatedRowId: ref?.relatedRowId ?? null,
      archiveStatus: "pending",
    });
  }
  return { manifestVersion: STORAGE_MANIFEST_VERSION, generatedAt: now, tenantId: args.tenantId, entries, inlineOnly };
}
