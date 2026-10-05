// ============================================================================
// Storage DR — Supabase 전용 버킷 아카이브 어댑터(서버 전용 · StorageArchiveAdapter 구현).
//  · 목적지: private 'dr-archive' 버킷. 서버(service_role)만 접근(RLS 기본 거부).
//  · 바이너리 + checksum 사이드카(.meta.json)를 함께 보관해 무결성 재검증을 지원한다.
//  · 아카이브 경로에 tenantId 를 포함 → 아카이브 자체도 테넌트 격리.
//  · supabase-js 에 구조적으로만 의존(StorageClientLike) → Node 하네스/Deno 양쪽에서 동작.
//  · 외부 provider(S3 등)로 교체하려면 동일 인터페이스로 다른 구현만 추가하면 된다.
// ============================================================================
import type { StorageArchiveAdapter, ArchiveStat } from "./archiveAdapter";

// supabase.storage 의 최소 구조(버전/런타임 비의존).
export type StorageClientLike = {
  from(bucket: string): {
    upload(path: string, body: unknown, opts?: { contentType?: string; upsert?: boolean }): Promise<{ error: { message?: string } | null }>;
    download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message?: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message?: string } | null }>;
  };
};

const DEFAULT_ARCHIVE_BUCKET = "dr-archive";

export class SupabaseBucketArchiveAdapter implements StorageArchiveAdapter {
  readonly name = "supabase-dr-archive";
  private storage: StorageClientLike;
  private tenantId: string;
  private archiveBucket: string;
  constructor(storage: StorageClientLike, tenantId: string, archiveBucket: string = DEFAULT_ARCHIVE_BUCKET) {
    this.storage = storage; this.tenantId = tenantId; this.archiveBucket = archiveBucket;
  }

  private binPath(bucket: string, objectPath: string) { return `${this.tenantId}/${bucket}/${objectPath}`; }
  private metaPath(bucket: string, objectPath: string) { return `${this.binPath(bucket, objectPath)}.meta.json`; }

  async put(bucket: string, objectPath: string, bytes: Uint8Array, meta: { checksum: string; mimeType?: string | null }): Promise<void> {
    const up1 = await this.storage.from(this.archiveBucket).upload(this.binPath(bucket, objectPath), toBody(bytes), { contentType: meta.mimeType || "application/octet-stream", upsert: true });
    if (up1.error) throw new Error(up1.error.message || "archive put failed");
    const sidecar = JSON.stringify({ checksum: meta.checksum, size: bytes.length, mimeType: meta.mimeType ?? null });
    const up2 = await this.storage.from(this.archiveBucket).upload(this.metaPath(bucket, objectPath), toBody(new TextEncoder().encode(sidecar)), { contentType: "application/json", upsert: true });
    if (up2.error) throw new Error(up2.error.message || "archive meta put failed");
  }

  async get(bucket: string, objectPath: string): Promise<Uint8Array | null> {
    const { data, error } = await this.storage.from(this.archiveBucket).download(this.binPath(bucket, objectPath));
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async exists(bucket: string, objectPath: string): Promise<boolean> {
    const { data } = await this.storage.from(this.archiveBucket).download(this.binPath(bucket, objectPath));
    return !!data;
  }

  async stat(bucket: string, objectPath: string): Promise<ArchiveStat> {
    const bin = await this.storage.from(this.archiveBucket).download(this.binPath(bucket, objectPath));
    if (bin.error || !bin.data) return { exists: false, size: null, checksum: null };
    let checksum: string | null = null; let size: number | null = null;
    const meta = await this.storage.from(this.archiveBucket).download(this.metaPath(bucket, objectPath));
    if (!meta.error && meta.data) {
      try { const j = JSON.parse(new TextDecoder().decode(new Uint8Array(await meta.data.arrayBuffer()))); checksum = j.checksum ?? null; size = j.size ?? null; } catch { /* no sidecar */ }
    }
    return { exists: true, size, checksum };
  }

  async delete(bucket: string, objectPath: string): Promise<void> {
    await this.storage.from(this.archiveBucket).remove([this.binPath(bucket, objectPath), this.metaPath(bucket, objectPath)]);
  }
}

// Node(Buffer) / Deno(Blob) 모두에서 업로드 가능한 본문으로 변환.
function toBody(bytes: Uint8Array): unknown {
  const G = globalThis as { Buffer?: { from(b: Uint8Array): unknown } };
  if (typeof G.Buffer !== "undefined" && G.Buffer?.from) return G.Buffer.from(bytes);
  return new Blob([bytes as unknown as BlobPart]);
}
