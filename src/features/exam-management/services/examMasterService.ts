// 시험관리 기준정보/인증기준 CRUD 서비스 — 공통 supabase-js client 재사용(직접 fetch 없음).
// tenant_id 격리 + soft delete(deleted_at) + is_active. 변경이력은 exam_audit_logs 에 기록.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";

export type ExamMasterTable =
  | "exam_categories"
  | "exam_groups"
  | "exam_parts"
  | "exam_processes"
  | "exam_levels"
  | "exam_equipment"
  | "exam_rules"
  | "exam_personnel"
  | "exam_applications"
  | "pm_certifications"
  | "dm_certifications"
  | "exam_annual_targets"
  | "exam_monthly_results";

// 직원 상세(더블클릭)에서 조회하는 시험/인증 관련 테이블.
export type ExamPersonnelChildTable = "exam_applications" | "exam_results" | "pm_certifications" | "dm_certifications";

export type ExamRow = Record<string, unknown> & { id?: string };

const nowIso = () => new Date().toISOString();

export const examSupabaseReady = () => isSupabaseAvailable();

// 목록 조회(미삭제, 최신순). 실패 시 예외(상위에서 안내).
export async function listExamRows(table: ExamMasterTable, tenantId: string): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as ExamRow[]) || [];
}

// 참조 선택용 경량 목록({ id, label }). name(+code) 로 라벨 구성.
export async function listExamRefOptions(table: ExamMasterTable, tenantId: string): Promise<Array<{ id: string; label: string }>> {
  const rows = await listExamRows(table, tenantId);
  return rows
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      id: String(r.id),
      label: [r.code, r.name].filter(Boolean).join(" · ") || String(r.name || r.id),
    }));
}

// 등록/수정 upsert(id 없으면 신규). created_by/updated_by/시각 자동 세팅.
export async function upsertExamRow(table: ExamMasterTable, row: ExamRow, tenantId: string, userId: string): Promise<ExamRow> {
  if (!supabase) throw new Error("Supabase 미설정");
  const isNew = !row.id;
  const id = row.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const payload: ExamRow = {
    ...row,
    id,
    tenant_id: tenantId,
    updated_by: userId,
    updated_at: nowIso(),
    ...(isNew ? { created_by: userId, created_at: nowIso() } : {}),
  };
  const { data, error } = await supabase.from(table).upsert(payload, { onConflict: "id" }).select().single();
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return data as ExamRow;
}

// 소프트 삭제(원본 보존): deleted_at 세팅 + is_active=false.
export async function softDeleteExamRow(table: ExamMasterTable, id: string, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from(table).update({ deleted_at: nowIso(), is_active: false, updated_by: userId, updated_at: nowIso() }).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}

// 사용/미사용 토글.
export async function setExamRowActive(table: ExamMasterTable, id: string, isActive: boolean, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from(table).update({ is_active: isActive, updated_by: userId, updated_at: nowIso() }).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}

// 변경이력 기록(best-effort — 실패해도 본 작업은 유지).
export async function writeExamAudit(
  tenantId: string,
  userId: string,
  targetType: ExamMasterTable,
  targetId: string,
  actionType: "create" | "update" | "delete" | "import" | "toggle" | "approve" | "reject",
  before: unknown,
  after: unknown,
  memo?: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("exam_audit_logs").insert({
      tenant_id: tenantId,
      target_type: targetType,
      target_id: targetId,
      action_type: actionType,
      changed_by: userId,
      before_value: (before ?? null) as never,
      after_value: (after ?? null) as never,
      memo: memo || null,
      created_by: userId,
    });
  } catch (e) {
    console.warn("[examAudit] 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}

// 직원 상세: personnel_id 로 연결된 시험/인증 레코드 조회(미삭제, 최신순).
export async function listByPersonnel(table: ExamPersonnelChildTable, tenantId: string, personnelId: string): Promise<ExamRow[]> {
  if (!supabase || !personnelId) return [];
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("personnel_id", personnelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as ExamRow[]) || [];
}

// 사번 중복 확인(미삭제, 본인 제외). true = 중복.
export async function isDuplicateEmployeeNo(tenantId: string, employeeNo: string, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim()) return false;
  let q = supabase.from("exam_personnel").select("id").eq("tenant_id", tenantId).eq("employee_no", employeeNo).is("deleted_at", null).limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// 시험 응시 중복 확인(미삭제, 본인 제외): 동일 사원번호 + 동일 구분코드. true = 중복.
export async function isDuplicateApplication(tenantId: string, employeeNo: string, categoryCode: string, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim() || !String(categoryCode || "").trim()) return false;
  let q = supabase.from("exam_applications").select("id")
    .eq("tenant_id", tenantId).eq("employee_no", employeeNo).eq("category_code", categoryCode)
    .is("deleted_at", null).limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// D.M 인증 중복 확인(미삭제, 본인 제외): 동일 사원번호 + D.M 단계 + 취득일. true = 중복.
export async function isDuplicateDm(tenantId: string, employeeNo: string, dmStage: string, acquiredDate: string | null, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim() || !String(dmStage || "").trim()) return false;
  let q = supabase.from("dm_certifications").select("id")
    .eq("tenant_id", tenantId).eq("employee_no", employeeNo).eq("dm_stage", dmStage)
    .is("deleted_at", null).limit(1);
  q = acquiredDate ? q.eq("acquired_date", acquiredDate) : q.is("acquired_date", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// Excel 가져오기 작업 기록(best-effort). 반영 건수/오류 건수 집계용. job id 반환.
export async function writeImportJob(
  tenantId: string, userId: string, fileName: string, targetTable: string,
  total: number, success: number, errorRows: number
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("exam_import_jobs").insert({
      tenant_id: tenantId, file_name: fileName, target_table: targetTable, status: "done",
      total_rows: total, success_rows: success, error_rows: errorRows,
      started_at: nowIso(), finished_at: nowIso(), created_by: userId, updated_by: userId,
    }).select("id").single();
    if (error) return null;
    return (data as { id?: string })?.id || null;
  } catch { return null; }
}

// Excel 가져오기 오류 상세 기록(best-effort).
export async function writeImportErrors(
  tenantId: string, userId: string, jobId: string,
  errs: Array<{ row: number; column?: string; message: string; raw?: unknown }>
): Promise<void> {
  if (!supabase || !jobId || !errs.length) return;
  try {
    await supabase.from("exam_import_errors").insert(errs.slice(0, 500).map((e) => ({
      tenant_id: tenantId, job_id: jobId, row_no: e.row, column_name: e.column || null,
      message: e.message, raw_data: (e.raw ?? null) as never, created_by: userId,
    })));
  } catch { /* 무시 */ }
}

// 특정 대상의 변경이력 조회(최신순).
export async function listExamAudit(tenantId: string, targetType: ExamMasterTable, targetId: string): Promise<ExamRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("exam_audit_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as ExamRow[]) || [];
}
