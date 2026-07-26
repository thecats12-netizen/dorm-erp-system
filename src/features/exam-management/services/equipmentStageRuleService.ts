// 설비별 인증단계(exam_equipment_stage_rules) CRUD 서비스 — criteria 엔진의 "설비→기준단계" 판단 입력.
//  supabase 직접 + tenant + soft delete + 감사로그. DB 미적용/오류는 상위에서 한글 안내(원문 비노출).
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { writeExamAudit, type ExamRow, type ExamMasterTable } from "./examMasterService";

const TABLE = "exam_equipment_stage_rules";
const AUDIT_TABLE = TABLE as unknown as ExamMasterTable;   // 감사로그 target_table(문자열) 캐스트 · union 미변경
const nowIso = () => new Date().toISOString();

// exclusion/겹침 등 DB 오류를 사용자용 한글로 변환(원문·SQLSTATE·relation 비노출).
function toUserError(err: { code?: string; message?: string } | null): string {
  const code = err?.code;
  if (code === "23P01") return "같은 설비에 적용기간이 겹치는 인증단계 기준이 이미 존재합니다.";
  if (code === "23505") return "동일한 활성 기준이 이미 존재합니다.";
  if (code === "23514") return "적용 시작일이 종료일보다 늦을 수 없습니다.";
  if (code === "PGRST205" || code === "42P01") return "설비 인증 기준 기능을 사용하려면 시험관리 DB 설정이 필요합니다.";
  return translateSupabaseError(err?.message || "저장하지 못했습니다.");
}

// 목록(기본 미삭제 · includeInactive=false 면 활성만). 미적용/오류 시 throw(상위 안내) — 조회는 [] 폴백.
export async function listEquipmentStageRules(tenantId: string): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase.from(TABLE).select("*").eq("tenant_id", tenantId).order("sort_order", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false });
  if (error) { console.warn("[equipmentStageRuleService] list 실패(미적용?):", (error as { code?: unknown }).code); return []; }
  return (data as ExamRow[]) || [];
}

// 등록/수정 — 필드 화이트리스트만 저장(임시/UI 필드 유출 방지). exclusion/check 오류는 한글 변환.
const FIELDS = ["category_id", "group_id", "process_id", "equipment_id", "level_id", "is_core_equipment", "sort_order", "effective_from", "effective_to", "is_active", "notes", "metadata"] as const;
export async function upsertEquipmentStageRule(row: ExamRow, tenantId: string, userId: string): Promise<ExamRow> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const isNew = !row.id;
  const id = row.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const before = isNew ? null : (await supabase.from(TABLE).select("*").eq("id", id).eq("tenant_id", tenantId).limit(1)).data?.[0] ?? null;
  const payload: ExamRow = { id, tenant_id: tenantId, updated_by: userId, updated_at: nowIso(), ...(isNew ? { created_by: userId, created_at: nowIso() } : {}) };
  for (const f of FIELDS) if (row[f] !== undefined) payload[f] = row[f];
  const { data, error } = await supabase.from(TABLE).upsert(payload, { onConflict: "id" }).select().single();
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, isNew ? "create" : "update", before, data as ExamRow, "설비별 인증단계 기준");
  return data as ExamRow;
}

export async function softDeleteEquipmentStageRule(id: string, tenantId: string, userId: string): Promise<void> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const before = (await supabase.from(TABLE).select("*").eq("id", id).eq("tenant_id", tenantId).limit(1)).data?.[0] ?? null;
  const { error } = await supabase.from(TABLE).update({ deleted_at: nowIso(), updated_by: userId, updated_at: nowIso() }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "delete", before, null, "설비별 인증단계 삭제(soft)");
}

// 복구 — deleted_at null. 유효기간 겹침이면 EXCLUDE 제약이 재차단(23P01) → 한글 안내.
export async function restoreEquipmentStageRule(id: string, tenantId: string, userId: string): Promise<void> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const before = (await supabase.from(TABLE).select("*").eq("id", id).eq("tenant_id", tenantId).limit(1)).data?.[0] ?? null;
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null, updated_by: userId, updated_at: nowIso() }).eq("id", id).eq("tenant_id", tenantId).select().single();
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "update", before, data as ExamRow, "설비별 인증단계 복구");
}
