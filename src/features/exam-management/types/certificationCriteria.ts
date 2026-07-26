// 인증 기준(criteria) 표준 타입 — exam_rules.criteria(jsonb) 및 평가 엔진 공용.
//  모든 임계값은 데이터(하드코딩 금지). 미지정(undefined) 조건은 평가에서 무시하며, 0 과 미지정을 혼동하지 않는다.

export type CriteriaOperator = "AND" | "OR";

// 중첩 조건 그룹(AND/OR). conditions 는 개별 CriteriaLeaf(부분 조건) 배열.
export interface CriteriaGroup {
  operator?: CriteriaOperator;          // 그룹 내부 결합(기본 AND)
  conditions?: CriteriaLeaf[];          // 개별 조건들
  groups?: CriteriaGroup[];             // 중첩 그룹
}

// 개별(leaf) 조건 — 지정된 필드만 평가. 미지정은 무시.
export interface CriteriaLeaf {
  min_equipment_count?: number;
  min_core_equipment_count?: number;
  min_completion_rate?: number;         // 0~100 (%)
  required_equipment_ids?: string[];
  required_process_ids?: string[];
  required_category_ids?: string[];
  prerequisite_level_ids?: string[];
  min_tenure_months?: number;
  min_elapsed_months?: number;          // 직전 단계 취득 후 경과
  cumulative_elapsed_months?: number;   // 누적 경과
  // 교차(DM 등) — 이번 단계 엔진은 정의만(평가는 후속). 미지정 시 무시.
  source_process_id?: string | null;
  source_required_level_id?: string | null;
  target_process_ids?: string[];
  target_required_equipment_count?: number;
  target_required_core_equipment_count?: number;
}

// 최상위 criteria — leaf 필드 + groups + 메타.
export interface Criteria extends CriteriaLeaf {
  version?: number;
  priority?: number;
  operator?: CriteriaOperator;          // 최상위 결합(기본 AND)
  groups?: CriteriaGroup[];
  allow_exception?: boolean;
  effective_from?: string | null;       // YYYY-MM-DD
  effective_to?: string | null;
  valid_months?: number | null;
  description?: string;                 // 관리자 메모
  label_ko?: string;                    // 사용자 표시용 한글(없으면 엔진이 생성)
}

// 평가 입력: 대상(직원) 스냅샷 — 배치 로드된 데이터에서 구성(행별 DB 호출 없음).
export interface EvaluationSubject {
  tenantId: string;
  personnelId: string;
  processId?: string | null;
  // 승인된 설비 취득(approved) 집합
  acquiredEquipmentIds: Set<string>;
  coreEquipmentIds: Set<string>;        // 주력설비(설비별 단계 규칙 is_core_equipment) 중 취득한 것
  // 공정 대상 설비(분모)
  targetEquipmentIds: Set<string>;
  // 이미 확정된 선행 레벨 id 집합
  achievedLevelIds: Set<string>;
  tenureMonths?: number | null;
  elapsedMonths?: number | null;
  cumulativeElapsedMonths?: number | null;
}

export interface CriteriaResult {
  passed: boolean;
  met: string[];        // 충족 조건(한글)
  missing: string[];    // 부족 조건(한글)
}

// 설비/공정 요약(계산 결과 · Preview 표시용).
export interface EquipmentSummary {
  targetCount: number;      // 대상 설비 수
  acquiredCount: number;    // 승인 취득 수
  coreCount: number;        // 주력설비 취득 수
  completionRate: number;   // 취득률(%)
}

// 공정별 단계 적격 결과.
export interface StageEligibility {
  levelId: string;
  code: string;
  rankOrder: number;
  passed: boolean;
  requiresApproval: boolean;
  autoPromote: boolean;
  result: CriteriaResult;
}
