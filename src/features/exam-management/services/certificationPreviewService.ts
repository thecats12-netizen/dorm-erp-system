// 직원별 인증 Preview 데이터 로더 — 조회 전용(저장 없음). 배치 조회만(행별 호출 금지).
//  마스터(테넌트 단위)와 직원별 상태를 분리 로드해 재계산 시 직원 상태만 갱신한다.
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { listExamRows, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules } from "./processCriteriaRuleService";

export type PreviewMaster = {
  levels: ExamRow[]; equipment: ExamRow[]; processes: ExamRow[]; groups: ExamRow[]; categories: ExamRow[];
  stageRules: ExamRow[]; criteriaRules: ExamRow[]; ok: boolean;
};

// 테넌트 마스터 배치 로드(1회). 개별 실패는 빈 배열로 격리 — 화면은 안내 후 계속 동작.
export async function loadPreviewMaster(tenantId: string): Promise<PreviewMaster> {
  if (!isSupabaseAvailable() || !supabase) return { levels: [], equipment: [], processes: [], groups: [], categories: [], stageRules: [], criteriaRules: [], ok: false };
  const [levels, equipment, processes, groups, categories, stageRules, criteriaRules] = await Promise.all([
    listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
    listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),
    listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[]),
  ]);
  return { levels, equipment, processes, groups, categories, stageRules, criteriaRules, ok: true };
}

// pm_certifications 확정 단계(경량). level_id 우선 · pm_level 텍스트 fallback은 화면 계층에서 해석.
//  acquired_date 는 신뢰 가능한 단계 확정일(경과개월 계산의 근거) · expiry_date 로 만료 판정.
export type PmCertLite = { levelId: string | null; pmLevel: string | null; processId: string; acquiredDate: string | null; expiryDate: string | null };

export type PersonnelCertState = {
  approvedEquipmentIds: string[];   // 승인(approved) 설비 취득 id
  pmCerts: PmCertLite[];            // pm_certifications 확정 단계(읽기 전용 · 만료/공정 필터는 화면에서)
  needsReeval: boolean;             // 설비 취득 metadata.needs_reeval
  ok: boolean;                      // DB 미적용/오류면 false(상위에서 한글 안내)
};

// 직원 1명의 취득/확정 상태 배치 조회(2쿼리). 설비 취득 미적용이면 ok=false, PM 오류는 무시(빈 확정).
export async function loadPersonnelCertState(tenantId: string, personnelId: string): Promise<PersonnelCertState> {
  const empty: PersonnelCertState = { approvedEquipmentIds: [], pmCerts: [], needsReeval: false, ok: false };
  if (!isSupabaseAvailable() || !supabase || !personnelId) return empty;
  const [certRes, pmRes] = await Promise.all([
    supabase.from("exam_equipment_certifications").select("equipment_id,status,metadata").eq("tenant_id", tenantId).eq("personnel_id", personnelId).is("deleted_at", null),
    supabase.from("pm_certifications").select("level_id,pm_level,process_id,acquired_date,expiry_date,approval_status,is_active").eq("tenant_id", tenantId).eq("personnel_id", personnelId).is("deleted_at", null),
  ]);
  if (certRes.error) { console.warn("[certificationPreview] certs 조회 실패(미적용?):", (certRes.error as { code?: unknown }).code); return empty; }
  const certs = (certRes.data as ExamRow[]) || [];
  const approvedEquipmentIds = certs.filter((c) => c.status === "approved").map((c) => String(c.equipment_id ?? "")).filter(Boolean);
  const needsReeval = certs.some((c) => (c.metadata as { needs_reeval?: unknown } | null)?.needs_reeval === true);
  // 확정 단계로 인정: 프로젝트 표준 isApproved(=approval_status "승인") + 활성. 대기/반려/취소·승인취소(대기) 제외.
  const pmCerts: PmCertLite[] = (pmRes.error ? [] : ((pmRes.data as ExamRow[]) || []))
    .filter((r) => String(r.approval_status ?? "") === "승인" && r.is_active !== false)
    .map((r) => ({
    levelId: r.level_id ? String(r.level_id) : null,
    pmLevel: r.pm_level ? String(r.pm_level) : null,
    processId: String(r.process_id ?? ""),
    acquiredDate: r.acquired_date ? String(r.acquired_date).slice(0, 10) : null,
    expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : null,
  }));
  return { approvedEquipmentIds, pmCerts, needsReeval, ok: true };
}
