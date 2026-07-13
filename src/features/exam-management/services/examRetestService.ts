// 시험관리 재시험 후보 CRUD 서비스 — 공통 supabase-js client 재사용.
//  자동 후보 → 관리자 검토 → 승인 → 실제 재시험 신청 구조. 자동으로 실제 시험회차에 등록하지 않는다.
//  중복 방지: 동일 직원 + 동일 인증단계 + 동일 사유의 활성 후보(후보/승인)는 1건만.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { retestDedupKey, type RetestCandidateSpec } from "./examAutomationService";

export type RetestStatus = "후보" | "승인" | "반려" | "신청";
export type RetestCandidateRow = Record<string, unknown> & { id?: string; status?: string };

const nowIso = () => new Date().toISOString();
const ACTIVE: RetestStatus[] = ["후보", "승인"]; // 중복 판정 대상 상태

export const examRetestSupabaseReady = () => isSupabaseAvailable();

// 재시험 후보 목록(미삭제, 최신 발생일 순).
export async function listRetestCandidates(tenantId: string): Promise<RetestCandidateRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase
    .from("exam_retest_candidates")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("occurred_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as RetestCandidateRow[]) || [];
}

// 자동 후보 생성: 도출된 spec 중 "활성 후보로 아직 없는 것"만 신규 insert(중복 생성 방지). 생성 건수 반환.
export async function generateRetestCandidates(
  tenantId: string,
  userId: string,
  specs: RetestCandidateSpec[]
): Promise<{ created: number; skipped: number }> {
  if (!supabase) throw new Error("Supabase 미설정");
  const existing = await listRetestCandidates(tenantId);
  const activeKeys = new Set(
    existing.filter((r) => ACTIVE.includes(String(r.status) as RetestStatus))
      .map((r) => retestDedupKey({ employee_no: String(r.employee_no ?? ""), level_id: String(r.level_id ?? ""), reason: String(r.reason ?? "") }))
  );
  const toInsert = specs.filter((s) => !activeKeys.has(retestDedupKey(s)));
  const skipped = specs.length - toInsert.length;
  if (toInsert.length === 0) return { created: 0, skipped };

  const rows = toInsert.map((s) => ({
    id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    tenant_id: tenantId,
    employee_no: s.employee_no, name: s.name,
    level_id: s.level_id, level_label: s.level_label,
    reason: s.reason, occurred_date: s.occurred_date || null,
    status: "후보" as RetestStatus,
    source_type: s.source_type, source_id: s.source_id,
    created_by: userId, updated_by: userId,
  }));
  const { error } = await supabase.from("exam_retest_candidates").insert(rows);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return { created: rows.length, skipped };
}

// 상태 전환: 승인 / 반려 / 신청(실제 재시험 신청은 승인된 후보에서만). 승인 시 승인자/시각 기록.
export async function setRetestCandidateStatus(
  id: string,
  status: RetestStatus,
  userId: string
): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const patch: Record<string, unknown> = { status, updated_by: userId, updated_at: nowIso() };
  if (status === "승인") { patch.approved_by = userId; patch.approved_at = nowIso(); }
  const { error } = await supabase.from("exam_retest_candidates").update(patch).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}

// 후보 삭제(soft delete).
export async function deleteRetestCandidate(id: string, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from("exam_retest_candidates")
    .update({ deleted_at: nowIso(), is_active: false, updated_by: userId, updated_at: nowIso() }).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}
