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
// 확장자를 신뢰하지 않고 MIME 도 함께 검증(빈 MIME 은 통과 — 일부 브라우저/OS 에서 비어 있음).
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const mimeOk = (mime: string) => !mime || ALLOWED_MIME.has(mime.toLowerCase());
// Storage 객체 키는 ASCII(영문·숫자·하이픈·언더스코어·슬래시·점)만 사용 → 원본 한글/공백/괄호와 분리.
const buildStoragePath = (tenantId: string, contractId: string, ext: string) =>
  `${tenantId}/${contractId}/${Date.now()}_${rand()}.${ext}`;

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
export const uploadContractFiles = async (
  tenantId: string, contractId: string, userId: string, files: File[],
): Promise<{ ok: number; failed: number; message?: string }> => {
  if (!isSupabaseAvailable() || !supabase) return { ok: 0, failed: files.length, message: "파일 저장 공간이 설정되지 않았습니다." };
  // tenant_id 는 인증 컨텍스트에서 전달된 값 사용. 비어 있으면 업로드 중단(임의 "default" 대체 금지 — "default" 자체는 프로젝트의 정상 tenant 값).
  if (!tenantId) return { ok: 0, failed: files.length, message: "회사 정보를 확인할 수 없어 파일을 첨부하지 못했습니다. 다시 로그인한 후 시도해주세요." };
  if (!contractId) return { ok: 0, failed: files.length, message: "계약을 먼저 저장한 뒤 첨부해 주세요." };
  let ok = 0, failed = 0; let message: string | undefined;
  for (const f of files) {
    const ext = safeExt(f.name);
    if (!ext || !mimeOk(f.type || "")) { failed++; message = "PDF, JPG, PNG 파일만 첨부할 수 있습니다."; continue; }
    // 원본 파일명은 DB(file_name)에만 보존하고, Storage 키는 ASCII 안전 경로로 분리 생성(Invalid key 방지).
    const path = buildStoragePath(tenantId, contractId, ext);
    try {
      const up = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up.error) {
        failed++; console.warn("[contractFiles] 업로드 실패:", up.error.message);
        const m = String(up.error.message || "").toLowerCase();
        message = message || (/invalid key/.test(m) ? "파일명 처리 중 오류가 발생했습니다. 파일을 다시 선택해주세요."
          : /bucket|not found/.test(m) ? "파일 저장 공간이 설정되지 않았습니다."
            : /row-level security|permission|unauthorized/.test(m) ? "파일을 첨부할 권한이 없습니다." : "파일 업로드에 실패했습니다.");
        continue;
      }
      const meta = await supabase.from(TABLE).insert({
        tenant_id: tenantId, contract_id: contractId, storage_path: path,
        file_name: f.name, mime: f.type || null, size_bytes: f.size ?? null, uploaded_by: userId || null,
      });
      if (meta.error) {
        // 보상 처리: DB 저장 실패 시 방금 올린 Storage 파일 삭제(고아 파일 방지).
        failed++; console.warn("[contractFiles] 메타 저장 실패:", meta.error.message);
        try { await supabase.storage.from(CONTRACT_FILES_BUCKET).remove([path]); } catch { /* best-effort */ }
        message = message || "파일 정보 저장에 실패했습니다.";
        continue;
      }
      ok++;
    } catch (e) { failed++; console.warn("[contractFiles] 업로드 예외:", (e as { message?: string })?.message || e); message = message || "파일 업로드 중 오류가 발생했습니다."; }
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
