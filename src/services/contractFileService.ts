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
  if (!isSupabaseAvailable() || !supabase) return { ok: 0, failed: files.length, message: "Supabase 연결이 필요합니다." };
  if (!contractId) return { ok: 0, failed: files.length, message: "계약을 먼저 저장한 뒤 첨부해 주세요." };
  const year = new Date().getFullYear();
  let ok = 0, failed = 0; let message: string | undefined;
  for (const f of files) {
    if (!isAllowedContractFile(f.name)) { failed++; message = "PDF, JPG, PNG 파일만 첨부할 수 있습니다."; continue; }
    const path = `${tenantId}/${year}/${contractId}/${rand()}-${f.name}`.replace(/\s+/g, "_");
    try {
      const up = await supabase.storage.from(CONTRACT_FILES_BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up.error) { failed++; console.warn("[contractFiles] 업로드 실패:", up.error.message); message = message || "파일 업로드에 실패했습니다."; continue; }
      const meta = await supabase.from(TABLE).insert({
        tenant_id: tenantId, contract_id: contractId, storage_path: path,
        file_name: f.name, mime: f.type || null, size_bytes: f.size ?? null, uploaded_by: userId || null,
      });
      if (meta.error) { failed++; console.warn("[contractFiles] 메타 저장 실패:", meta.error.message); message = message || "첨부 정보 저장에 실패했습니다."; continue; }
      ok++;
    } catch (e) { failed++; console.warn("[contractFiles] 업로드 예외:", (e as { message?: string })?.message || e); message = message || "파일 업로드 중 오류가 발생했습니다."; }
  }
  return { ok, failed, message };
};

// 미리보기/다운로드용 서명 URL(Private). 실패 시 null.
export const getContractFileSignedUrl = async (storagePath: string, expiresInSec = 600): Promise<string | null> => {
  if (!isSupabaseAvailable() || !supabase || !storagePath) return null;
  try {
    const { data, error } = await supabase.storage.from(CONTRACT_FILES_BUCKET).createSignedUrl(storagePath, expiresInSec);
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
