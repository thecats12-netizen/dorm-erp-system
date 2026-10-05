// ============================================================================
// Storage DR — 공용 타입(단일 소스). 브라우저/Node 양쪽에서 import 가능(여기엔 런타임 의존성 없음).
//  · 민감정보 금지: signed URL / service_role / token / JWT / API secret 를 타입/값에 담지 않는다.
//  · 바이너리는 기존 DB DR JSON 에 base64 로 넣지 않는다 → 별도 아카이브 어댑터로만 이동.
// ============================================================================

export const STORAGE_MANIFEST_VERSION = 1 as const;

// 버킷 분류(코드/스키마에서 확인된 실제 4종).
export type DrBucket = "cleaning-photos" | "inventory-proof" | "contract-files" | "generated-pdfs";
export type Visibility = "public" | "private";

// object 가 참조되는 출처(DB 역추적 결과).
export type SourceRefType =
  | "cleaning_report_photo"   // cleaning_reports.before/after_photo_data_urls
  | "inventory_proof"         // inventory_items.proof_file(JSON {name,data:url})
  | "contract_file"           // dorm_contract_files.storage_path
  | "generated_pdf"           // 일시 산출물(참조 DB 없음)
  | "unreferenced";           // Storage 엔 있으나 DB 참조를 찾지 못함(orphan 후보)

// 아카이브 진행/결과 상태.
export type ArchiveStatus = "pending" | "archived" | "skipped" | "failed";

// manifest 1건(= Storage object 1개). signed URL 미포함(보안).
export type StorageManifestEntry = {
  bucket: DrBucket;
  objectPath: string;            // 버킷 내 경로(canonical). 서명/공개 URL 아님.
  visibility: Visibility;
  size: number | null;           // bytes(metadata.size). 모르면 null.
  mimeType: string | null;       // metadata.mimetype. 모르면 null.
  fingerprint: string | null;    // 서버 제공 etag(참고용). 검증용 정본은 contentChecksum.
  contentChecksum: string | null;// sha-256(hex). 아카이브 시점에 실제 바이트로 계산. 미아카이브면 null.
  createdAt: string | null;
  updatedAt: string | null;
  sourceRefType: SourceRefType;
  relatedTable: string | null;   // 예: 'cleaning_reports'
  relatedRowId: string | null;   // 예: 보고서 id
  archiveStatus: ArchiveStatus;
};

export type StorageManifest = {
  manifestVersion: typeof STORAGE_MANIFEST_VERSION;
  generatedAt: string;
  tenantId: string;
  entries: StorageManifestEntry[];
  // DB 에 base64(data:)로만 존재하여 Storage object 가 없는 포인터(아카이브 대상 아님 · 경고).
  inlineOnly: InlineOnlyRef[];
};

// data: fallback 으로 DB 에만 존재(Storage object 없음) — 복원 불가 경고 대상.
export type InlineOnlyRef = {
  relatedTable: string;
  relatedRowId: string;
  field: string;                 // 예: 'before_photo_data_urls[0]'
  approxBytes: number | null;    // data URL 길이 기반 근사(실제 바이트 아님)
  mimeHint: string | null;
};

// 아카이브 object 1건 결과.
export type ArchiveObjectResult = {
  bucket: DrBucket;
  objectPath: string;
  status: ArchiveStatus;         // archived | skipped | failed
  contentChecksum: string | null;
  size: number | null;
  attempts: number;
  error?: string;                // 민감정보 미포함 요약
};

export type ArchiveRunResult = {
  startedAt: string;
  finishedAt: string;
  total: number;
  archived: number;
  skipped: number;
  failed: number;
  byBucket: Record<string, { total: number; archived: number; skipped: number; failed: number }>;
  results: ArchiveObjectResult[];
  // resume/idempotency 용: 실패분만 추려 재시도 입력으로 사용.
  failedEntries: StorageManifestEntry[];
};

// 복원 판정(안전 우선: 기본 overwrite 금지).
export type RestoreDecision =
  | "RESTORE"          // 대상에 object 없음 → 아카이브에서 복원
  | "SKIP"             // 동일 checksum 이미 존재 → 건너뜀
  | "CONFLICT"         // 경로 동일 + 내용 다름 → 사용자 확인 필요(자동 overwrite 안 함)
  | "ARCHIVE_MISSING"; // 아카이브에 바이너리 없음 → 복원 불가

export type RestorePlanItem = {
  bucket: DrBucket;
  objectPath: string;
  decision: RestoreDecision;
  archiveChecksum: string | null;
  targetChecksum: string | null;
};

export type RestoreExecResult = {
  item: RestorePlanItem;
  applied: boolean;              // 실제로 업로드했는가
  verifiedChecksum: string | null;
  verifyOk: boolean | null;      // 복원 후 checksum 재검증 결과
  error?: string;
};

// 재조정(reconciliation) — 자동 삭제 없음, 리포트 전용.
export type ReconcileKind =
  | "DANGLING"         // DB 포인터 존재 + Storage object 없음
  | "ORPHAN"           // Storage object 존재 + DB 참조 없음
  | "INLINE_ONLY"      // DB base64 fallback(Storage object 없음)
  | "ARCHIVE_MISSING"  // manifest 존재 + 아카이브 바이너리 없음
  | "CONTENT_MISMATCH";// 경로 동일 + checksum 불일치

export type ReconcileFinding = {
  kind: ReconcileKind;
  bucket: DrBucket | null;
  objectPath: string | null;
  relatedTable: string | null;
  relatedRowId: string | null;
  detail: string;
};

export type ReconcileReport = {
  generatedAt: string;
  tenantId: string;
  findings: ReconcileFinding[];
  counts: Record<ReconcileKind, number>;
};
