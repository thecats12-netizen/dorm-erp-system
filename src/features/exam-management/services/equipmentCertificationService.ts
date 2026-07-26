// 설비 취득(exam_equipment_certifications) 서비스 — 승인된 설비 취득의 유일한 원천.
//  응시 최종 합격 → eligible 후보 자동 생성(idempotent) · 승인/반려/취소/수동 취득 · 감사로그.
//  ⚠ 20260749 migration 미적용 시 테이블 부재로 실패할 수 있음(상위에서 안내). 행별 반복 조회 금지.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { writeExamAudit, type ExamRow, type ExamMasterTable } from "./examMasterService";

const TABLE = "exam_equipment_certifications";
// 감사로그(exam_audit_logs.target_table)는 문자열 필드 — writeExamAudit 의 좁은 union 에 신규 테이블을 맞추기 위한 캐스트(테이블 union 은 변경하지 않음).
const AUDIT_TABLE = TABLE as unknown as ExamMasterTable;
const nowIso = () => new Date().toISOString();

export type EqCertStatus = "eligible" | "pending" | "approved" | "rejected" | "suspended" | "revoked" | "expired";

// 상태 코드 → 사용자 표시 한글(개발값 노출 금지).
export const EQ_CERT_STATUS_KO: Record<EqCertStatus, string> = {
  eligible: "후보(자격 충족)", pending: "승인 대기", approved: "승인 완료",
  rejected: "반려", suspended: "일시중지", revoked: "취소", expired: "만료",
};
export const eqCertStatusKo = (s: unknown): string => EQ_CERT_STATUS_KO[(String(s ?? "") as EqCertStatus)] || "-";

// 취득 예정일 결정: 실기 합격일 → 필기 합격일 → 인증 취득일 → null (실제 컬럼만 사용).
export function resolveAcquiredDate(app: ExamRow): string | null {
  const pick = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : null; };
  return pick(app.practical_pass_date) || pick(app.written_pass_date) || pick(app.cert_acquired_date) || null;
}

// 조회(필터는 호출부에서 Map 구성). 미적용/오류 시 [] (상위 안내).
export async function listEquipmentCertifications(tenantId: string): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase.from(TABLE).select("*").eq("tenant_id", tenantId).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) { console.warn("[equipmentCertificationService] list 실패(미적용?):", (error as { code?: unknown }).code); return []; }
  return (data as ExamRow[]) || [];
}

// [응시 합격 연계] idempotent — 동일 personnel·equipment 의 approved 또는 활성 후보(eligible/pending)가 있으면 생성 안 함.
//  없으면 status=eligible 로 생성. application_id/line_id 스냅샷/acquired_date 후보값 저장. 행별 반복 조회 없음(단건).
export async function createEquipmentCertificationCandidateFromApplication(
  app: ExamRow, tenantId: string, userId: string,
): Promise<{ created: boolean; id?: string; reason?: string }> {
  if (!isSupabaseAvailable() || !supabase) return { created: false, reason: "supabase 미설정" };
  const personnelId = String(app.personnel_id ?? "").trim();
  const equipmentId = String(app.equipment_id ?? "").trim();
  const processId = String(app.process_id ?? "").trim();
  if (!personnelId || !equipmentId || !processId) return { created: false, reason: "personnel/equipment/process 누락" };

  // 기존 approved 또는 열린 후보 확인(1쿼리)
  const { data: existing, error: exErr } = await supabase
    .from(TABLE).select("id,status")
    .eq("tenant_id", tenantId).eq("personnel_id", personnelId).eq("equipment_id", equipmentId)
    .is("deleted_at", null).in("status", ["approved", "eligible", "pending"]).limit(1);
  if (exErr) throw new Error(translateSupabaseError(exErr.message || String(exErr)));
  if (existing && existing.length > 0) return { created: false, reason: `이미 ${eqCertStatusKo(existing[0].status)}` };

  const row: ExamRow = {
    tenant_id: tenantId, personnel_id: personnelId, application_id: app.id ?? null,
    category_id: app.category_id ?? null, group_id: app.group_id ?? null,
    process_id: processId, equipment_id: equipmentId, level_id: app.level_id ?? null,
    acquired_date: resolveAcquiredDate(app), status: "eligible" as EqCertStatus, source: "exam_application",
    line_id: app.line_id ?? null,   // 응시 스냅샷 보존(UI 미표시)
    requested_at: nowIso(), requested_by: userId,
    created_by: userId, updated_by: userId, created_at: nowIso(), updated_at: nowIso(),
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select("id").single();
  if (error) {
    // 부분 unique(동시 생성)로 23505 → idempotent 성공 취급(중복 아님)
    if ((error as { code?: string }).code === "23505") return { created: false, reason: "이미 후보 존재" };
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
  const id = String((data as { id?: string })?.id ?? "");
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "create", null, row, "설비 취득 후보 자동 생성(응시 합격)");
  return { created: true, id };
}

// 관리자 수동 취득(source=manual · 사유 필수). 중복 approved 는 DB unique 로 차단(23505 → 안내).
export async function createManualEquipmentCertification(
  input: { personnel_id: string; process_id: string; equipment_id: string; category_id?: string | null; group_id?: string | null; level_id?: string | null; acquired_date: string | null; reason: string },
  tenantId: string, userId: string,
): Promise<{ id: string }> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("supabase 미설정");
  if (!input.reason.trim()) throw new Error("수동 취득 사유는 필수입니다.");
  const row: ExamRow = {
    tenant_id: tenantId, personnel_id: input.personnel_id, process_id: input.process_id, equipment_id: input.equipment_id,
    category_id: input.category_id ?? null, group_id: input.group_id ?? null, level_id: input.level_id ?? null,
    acquired_date: input.acquired_date, status: "approved" as EqCertStatus, source: "manual",
    exception_reason: input.reason.trim(),
    approved_at: nowIso(), approved_by: userId, created_by: userId, updated_by: userId, created_at: nowIso(), updated_at: nowIso(),
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("이미 승인된 설비 취득이 있습니다(중복).");
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
  const id = String((data as { id?: string })?.id ?? "");
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "create", null, row, `수동 설비 취득(사유: ${input.reason.trim()})`);
  return { id };
}

// 상태 전이(승인/반려/일시중지/취소). 승인 취소=revoked(이력 보존). before/after·사유 감사로그.
export async function setEquipmentCertificationStatus(
  id: string, next: EqCertStatus, tenantId: string, userId: string, opts?: { reason?: string },
): Promise<ExamRow> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("supabase 미설정");
  const { data: beforeArr } = await supabase.from(TABLE).select("*").eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).limit(1);
  const before = (beforeArr?.[0] as ExamRow) || null;
  const patch: ExamRow = { status: next, updated_by: userId, updated_at: nowIso() };
  if (next === "approved") { patch.approved_at = nowIso(); patch.approved_by = userId; }
  if (next === "rejected") { patch.rejected_at = nowIso(); patch.rejected_by = userId; patch.rejection_reason = opts?.reason ?? null; }
  if (next === "revoked") { patch.revoked_at = nowIso(); patch.revoked_by = userId; patch.revoke_reason = opts?.reason ?? null; }
  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", id).eq("tenant_id", tenantId).select().single();
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("이미 승인된 동일 설비 취득이 있어 승인할 수 없습니다(중복).");
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "update", before, data as ExamRow, `설비 취득 상태 변경 → ${eqCertStatusKo(next)}${opts?.reason ? ` (사유: ${opts.reason})` : ""}`);
  return data as ExamRow;
}
