// 인증 이력(exam_certification_history) 서비스 — append-only. 최신 상태는 pm_certifications 유지,
//  본 이력은 "언제/누가/어떤 단계를/어떤 사유로/어떤 경로로" 취득했는지 영구 보존(수정/삭제 없음).
//  쓰기는 서비스 내부(승인 완료 시점)에서만 호출 · UI CRUD 없음. 조회는 viewer 이상.
//  ⚠ 20260750 migration 미적용 시 테이블 부재로 실패 가능(호출부에서 비차단 처리).
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { writeExamAudit, type ExamRow, type ExamMasterTable } from "./examMasterService";

const TABLE = "exam_certification_history";
// 감사로그(target_table 문자열)용 캐스트 — writeExamAudit 의 좁은 union 은 변경하지 않음.
const AUDIT_TABLE = TABLE as unknown as ExamMasterTable;
const nowIso = () => new Date().toISOString();

// 이력 1건 입력값. 값이 없으면 생략(스키마 nullable). metadata 는 확장 스냅샷(향후 경과개월 근거 등).
export type CertificationHistoryInput = {
  personnel_id: string;
  process_id?: string | null;
  certification_type?: string | null;   // Single/M1~M4/PM/DM/Senior DM/Maestro 등(데이터)
  level_id?: string | null;
  previous_level_id?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  source_type?: string | null;          // 'pm_certification' / 'manual' / 'exam_application' 등
  source_id?: string | null;
  reason?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
};

// append(불변 이력 1건). 실패 시 throw — 호출부(승인 흐름)에서 비차단 try/catch 로 감싼다.
export async function appendCertificationHistory(input: CertificationHistoryInput, tenantId: string, userId: string): Promise<{ id: string } | null> {
  if (!isSupabaseAvailable() || !supabase) return null;
  if (!input.personnel_id) throw new Error("personnel_id 누락");
  const row: ExamRow = {
    tenant_id: tenantId,
    personnel_id: input.personnel_id,
    process_id: input.process_id ?? null,
    certification_type: input.certification_type ?? null,
    level_id: input.level_id ?? null,
    previous_level_id: input.previous_level_id ?? null,
    approved_at: input.approved_at ?? null,
    approved_by: input.approved_by ?? userId,
    source_type: input.source_type ?? null,
    source_id: input.source_id ?? null,
    reason: input.reason ?? null,
    status: input.status ?? null,
    metadata: (input.metadata ?? {}) as ExamRow[keyof ExamRow],
    created_by: userId,
    created_at: nowIso(),
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select("id").single();
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  const id = String((data as { id?: string })?.id ?? "");
  await writeExamAudit(tenantId, userId, AUDIT_TABLE, id, "create", null, row, "인증 이력 기록(append)");
  return { id };
}

// 이력 조회(최신순). personnel/process 필터 선택. 미적용/오류 시 [](상위 안내).
export async function listCertificationHistory(
  tenantId: string, opts?: { personnelId?: string; processId?: string; limit?: number },
): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  let q = supabase.from(TABLE).select("*").eq("tenant_id", tenantId);
  if (opts?.personnelId) q = q.eq("personnel_id", opts.personnelId);
  if (opts?.processId) q = q.eq("process_id", opts.processId);
  q = q.order("approved_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(opts?.limit ?? 200);
  const { data, error } = await q;
  if (error) { console.warn("[certificationHistoryService] list 실패(미적용?):", (error as { code?: unknown }).code); return []; }
  return (data as ExamRow[]) || [];
}
