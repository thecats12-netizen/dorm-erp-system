// ============================================================================
// Storage DR — 아카이브 목적지 추상화(StorageArchiveAdapter).
//  · 특정 업체(S3/GCS/…)에 강결합하지 않는다. put/get/exists/stat/delete 만 요구.
//  · 실제 외부 provider credential 이 필요한 구현은 별도 단계(사용자 직접 작업)로 분리.
//  · 이 파일은 런타임 의존성이 없다(인터페이스 + Web Crypto 체크섬). node:fs 등 미사용 →
//    프런트 번들에 안전. LOCAL filesystem 어댑터는 node 전용 파일(scripts/)에 둔다.
// ============================================================================

// 아카이브에 저장되는 1개 object 의 키(버킷/경로를 합성한 논리 키).
export const archiveKey = (bucket: string, objectPath: string): string => `${bucket}/${objectPath}`;

export type ArchiveStat = {
  exists: boolean;
  size: number | null;
  checksum: string | null; // 저장 시 함께 보관한 sha-256(hex). 없으면 null.
};

// 바이너리 아카이브 목적지. 구현체는 암호화/최소권한/audit 를 책임진다(설계 전제).
export interface StorageArchiveAdapter {
  readonly name: string;
  // 바이너리 저장. checksum 을 함께 기록해 무결성 재검증을 지원한다.
  put(bucket: string, objectPath: string, bytes: Uint8Array, meta: { checksum: string; mimeType?: string | null }): Promise<void>;
  // 바이너리 로드. 없으면 null.
  get(bucket: string, objectPath: string): Promise<Uint8Array | null>;
  exists(bucket: string, objectPath: string): Promise<boolean>;
  stat(bucket: string, objectPath: string): Promise<ArchiveStat>;
  // 선택: 정리용. 미지원이면 생략 가능.
  delete?(bucket: string, objectPath: string): Promise<void>;
}

// sha-256(hex). 브라우저/Node(24+) 공통 globalThis.crypto.subtle 사용.
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error("WebCrypto subtle unavailable");
  // Uint8Array -> ArrayBuffer(정확한 길이) 보장.
  const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const digest = await subtle.digest("SHA-256", buf as ArrayBuffer);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, "0");
  return hex;
}
