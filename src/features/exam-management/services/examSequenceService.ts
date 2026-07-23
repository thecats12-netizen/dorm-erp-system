// 시험 응시 연번 발급 서비스 — tenant·연도별 동시성 안전 RPC(next_exam_sequence) 호출.
//  · RPC 미적용(초안 SQL 미실행) 환경에서도 throw 없이 null 반환 → 기존 시험 응시 저장을 절대 깨뜨리지 않음(안전 폴백).
//  · 프론트 배열 길이/ max(seq_no)+1 방식 금지. 번호 증가는 서버 RPC(advisory lock)에서만.
//  · service_role_key 미사용(anon key + RLS + security definer RPC).
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";

// 다음 연번(number) 발급. 실패/미적용이면 null(호출부에서 seq_no 미지정으로 저장 → 기존 동작 유지).
export async function getNextExamSequence(tenantId: string, year: number): Promise<number | null> {
  if (!isSupabaseAvailable() || !supabase || !tenantId || !Number.isFinite(year)) return null;
  try {
    const { data, error } = await supabase.rpc("next_exam_sequence", { p_tenant_id: tenantId, p_year: Math.trunc(year) });
    if (error) { console.error("[examSequence] 연번 발급 RPC 실패:", error.message || error); return null; }
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    console.error("[examSequence] 연번 발급 예외:", (e as { message?: string })?.message || e);
    return null;
  }
}
