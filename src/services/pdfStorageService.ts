// 모바일/태블릿 PDF·인쇄문서 다운로드 안정화용 Storage 헬퍼.
// blob URL 은 모바일에서 "파일에 액세스할 수 없음" 오류가 잦으므로, Storage 에 임시 업로드 후
// 실제 https signed URL(10분)로 열도록 한다. service_role_key 미사용(anon key + RLS).
// 버킷이 없거나 실패하면 null 을 반환하여 호출부에서 기존 blob 방식으로 fallback 한다.
import { supabase, isSupabaseAvailable } from "./supabaseService";

const PDF_BUCKET = "generated-pdfs";

// 파일명 안전화(경로/특수문자 제거, 한글·영숫자·.-_ 유지).
const sanitizeName = (name: string) => name.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 120) || "file";

/**
 * Blob 을 generated-pdfs 버킷의 tenant 경로에 업로드하고 10분 signed URL 을 반환.
 * @returns signed URL(성공) 또는 null(미지원/실패 → 호출부에서 blob fallback)
 */
export async function uploadTempFileAndSign(
  blob: Blob,
  fileName: string,
  contentType: string,
  tenantId: string
): Promise<string | null> {
  if (!isSupabaseAvailable() || !supabase) return null;
  try {
    const path = `${tenantId || "default"}/pdf-temp/${Date.now()}-${sanitizeName(fileName)}`;
    const { error: upErr } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(path, blob, { contentType, upsert: true });
    if (upErr) {
      console.warn("[generated-pdfs] 업로드 실패(blob fallback):", (upErr as { message?: string })?.message || upErr);
      return null;
    }
    const { data, error: signErr } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(path, 60 * 10);
    if (signErr || !data?.signedUrl) {
      console.warn("[generated-pdfs] signedUrl 생성 실패(blob fallback):", (signErr as { message?: string })?.message || signErr);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn("[generated-pdfs] 예외(blob fallback):", (e as { message?: string })?.message || e);
    return null;
  }
}
