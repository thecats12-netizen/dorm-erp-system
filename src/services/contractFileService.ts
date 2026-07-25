// 계약 첨부파일 서비스 — Private 버킷(contract-files) + 메타 테이블(dorm_contract_files).
//  · 기존 계약(dorm_contracts) 저장 경로와 완전히 분리 → 이 기능이 실패해도 계약 저장은 절대 영향 없음.
//  · 버킷/테이블 미적용 환경에서도 throw 없이 안전 폴백(빈 목록/실패 플래그 반환).
//  · service_role_key 미사용(anon key + RLS). Private 이므로 조회는 서명 URL 사용.
import { supabase, isSupabaseAvailable } from "./supabaseService";

export const CONTRACT_FILES_BUCKET = "contract-files";
const TABLE = "dorm_contract_files";

export type ContractFile = {
  id: string;
  contract_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
};

const ALLOWED = /\.(pdf|jpe?g|png)$/i;
export const isAllowedContractFile = (name: string) => ALLOWED.test(name || "");

const rand = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// 원본 파일명에서 확장자만 안전 추출(소문자 정규화). 허용: pdf/jpg/jpeg/png.
const safeExt = (name: string): string | null => {
  const m = String(name || "").match(/\.([A-Za-z0-9]+)\s*$/);
  const ext = m ? m[1].toLowerCase() : "";
  return ["pdf", "jpg", "jpeg", "png"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : null;
};
// 확장자를 신뢰하지 않고 MIME 도 함께 검증(빈 MIME 은 통과 — 일부 브라우저/OS(모바일)에서 비어 있음).
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const mimeOk = (mime: string) => !mime || ALLOWED_MIME.has(mime.toLowerCase());
const EXT_MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
// Storage 객체 키는 ASCII(영문·숫자·하이픈·언더스코어·슬래시·점)만 사용 → 원본 한글/공백/괄호와 분리.
const buildStoragePath = (tenantId: string, contractId: string, ext: string) =>
  `${tenantId}/${contractId}/${Date.now()}_${rand()}.${ext}`;

// 네트워크성 오류(fetch reject) 판정 — 1회 재시도 대상. HTTP 오류(4xx/5xx)는 여기서 false.
const isNetworkError = (e: unknown): boolean => {
  const n = (e as { name?: string })?.name || "";
  const m = ((e as { message?: string })?.message || "").toLowerCase();
  return n === "TypeError" || /failed to fetch|network|load failed|networkerror/.test(m);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 첨부 목록(미삭제). 실패/미적용 시 빈 배열.
export const listContractFiles = async (tenantId: string, contractId: string): Promise<ContractFile[]> => {
  if (!isSupabaseAvailable() || !supabase || !contractId) return [];
  try {
    const { data, error } = await supabase.from(TABLE).select("*")
      .eq("tenant_id", tenantId).eq("contract_id", contractId).is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) { console.warn("[contractFiles] 목록 조회 실패:", error.message || error); return []; }
    return (data || []) as ContractFile[];
  } catch (e) { console.warn("[contractFiles] 목록 예외:", (e as { message?: string })?.message || e); return []; }
};

// 파일 업로드(Private 버킷) + 메타 insert. 반환: 성공 건수/실패 건수(계약 저장과 무관 · throw 없음).
// 파일 선택/드래그앤드롭 공통 업로드. 순차 처리(모바일 안정). 파일별 결과 분리 집계.
//  · Storage 키는 UUID 안전 경로(한글/공백/특수문자 분리), 원본명은 DB file_name 에 보존.
//  · 네트워크성 오류는 1회 자동 재시도. 개발 상세는 console.error 구조화 기록(토큰/개인정보 미출력).
export const uploadContractFiles = async (
  tenantId: string, contractId: string, userId: string, files: File[],
): Promise<{ ok: number; failed: number; message?: string }> => {
  if (!isSupabaseAvailable() || !supabase) return { ok: 0, failed: files.length, message: "파일 저장 공간이 설정되지 않았습니다." };
  if (!tenantId) return { ok: 0, failed: files.length, message: "회사 정보를 확인할 수 없어 파일을 첨부하지 못했습니다. 다시 로그인한 후 시도해주세요." };
  if (!contractId) return { ok: 0, failed: files.length, message: "계약을 먼저 저장한 뒤 첨부해 주세요." };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: 0, failed: files.length, message: "파일 업로드 중 네트워크 연결이 끊겼습니다. 연결 상태를 확인한 후 다시 시도해주세요." };
  }
  let ok = 0, failed = 0; let message: string | undefined;
  const setMsg = (m: string) => { message = message || m; };
  const logErr = (stage: string, f: File, path: string, err: unknown, extra?: Record<string, unknown>) => {
    const e = err as { name?: string; message?: string; status?: unknown; statusCode?: unknown };
    console.error("[contractFiles] upload failed", {
      stage, fileName: f.name, fileSize: f.size, fileType: f.type, bucket: CONTRACT_FILES_BUCKET,
      storagePath: path, contractId, tenantId, online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      errorName: e?.name, errorMessage: e?.message, status: e?.status ?? e?.statusCode, ...extra,
    });
  };

  for (const f of files) {
    // [검증] 확장자 + MIME(빈 MIME 은 확장자로 보조) + 0바이트 + 최대 용량.
    const ext = safeExt(f.name);
    if (!ext || !mimeOk(f.type || "")) { failed++; setMsg("지원하지 않는 파일 형식입니다. (PDF, JPG, PNG)"); continue; }
    if (!f.size || f.size <= 0) { failed++; setMsg("빈 파일(0바이트)은 첨부할 수 없습니다."); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { failed++; setMsg("파일 크기가 업로드 허용 범위(25MB)를 초과했습니다."); continue; }
    const path = buildStoragePath(tenantId, contractId, ext);
    const contentType = f.type || EXT_MIME[ext] || "application/octet-stream"; // 모바일 빈 MIME → 확장자 기반 보조
    try {
      // [Storage 업로드] 네트워크성 reject 는 1회 재시도(느린 회사망/모바일 일시 오류 대응).
      let up: { error: { message?: string } | null };
      try {
        up = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(path, f, { upsert: false, contentType, cacheControl: "3600" });
      } catch (netErr) {
        if (!isNetworkError(netErr)) throw netErr;
        logErr("storage-network-retry", f, path, netErr);
        await sleep(1000);
        up = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(path, f, { upsert: false, contentType, cacheControl: "3600" });
      }
      if (up.error) {
        failed++; logErr("storage-http", f, path, up.error);
        const m = String(up.error.message || "").toLowerCase();
        setMsg(/invalid key/.test(m) ? "파일명 처리 중 오류가 발생했습니다. 파일을 다시 선택해주세요."
          : /bucket|not found/.test(m) ? "파일 저장 공간이 설정되지 않았습니다."
            : /row-level security|permission|unauthorized|jwt|401|403/.test(m) ? "파일 업로드 권한을 확인할 수 없습니다. 다시 로그인한 후 시도해주세요."
              : /exceeded|too large|413|payload/.test(m) ? "파일 크기가 업로드 허용 범위를 초과했습니다."
                : "파일을 업로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
        continue;
      }
      // [DB insert] 성공한 Storage object 에 대해서만 메타 저장.
      const meta = await supabase.from(TABLE).insert({
        tenant_id: tenantId, contract_id: contractId, storage_path: path,
        file_name: f.name, mime: f.type || contentType, size_bytes: f.size ?? null, uploaded_by: userId || null,
      });
      if (meta.error) {
        // 보상: DB 저장 실패 시 방금 올린 Storage 파일 삭제(고아 방지). 정리 실패는 로그만.
        failed++; logErr("db-insert", f, path, meta.error);
        try { await supabase.storage.from(CONTRACT_FILES_BUCKET).remove([path]); } catch (rmErr) { console.error("[contractFiles] orphan cleanup failed", { path, err: (rmErr as { message?: string })?.message }); }
        setMsg("파일 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
        continue;
      }
      ok++;
    } catch (e) {
      failed++; logErr("exception", f, path, e);
      setMsg(isNetworkError(e)
        ? "파일 업로드 중 네트워크 연결이 끊겼습니다. 연결 상태를 확인한 후 다시 시도해주세요."
        : "파일을 업로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }
  return { ok, failed, message };
};

// 미리보기/다운로드용 서명 URL(Private). 실패 시 null.
//  downloadName 을 주면 Content-Disposition attachment(원본 파일명)로 내려받게 한다(Storage UUID 키 대신 원본명).
export const getContractFileSignedUrl = async (storagePath: string, expiresInSec = 600, downloadName?: string): Promise<string | null> => {
  if (!isSupabaseAvailable() || !supabase || !storagePath) return null;
  try {
    const opts = downloadName ? { download: downloadName } : undefined;
    const { data, error } = await supabase.storage.from(CONTRACT_FILES_BUCKET).createSignedUrl(storagePath, expiresInSec, opts);
    if (error) { console.warn("[contractFiles] 서명 URL 실패:", error.message); return null; }
    return data?.signedUrl ?? null;
  } catch (e) { console.warn("[contractFiles] 서명 URL 예외:", (e as { message?: string })?.message || e); return null; }
};

// 휴지통(soft delete). 물리 삭제/이력 손실 없음.
export const softDeleteContractFile = async (id: string): Promise<boolean> => {
  if (!isSupabaseAvailable() || !supabase || !id) return false;
  try {
    const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) { console.warn("[contractFiles] 삭제 실패:", error.message); return false; }
    return true;
  } catch (e) { console.warn("[contractFiles] 삭제 예외:", (e as { message?: string })?.message || e); return false; }
};
