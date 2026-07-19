// 실기 평가관리 타입(1차 · 조회 중심). exam_results(설비별) + exam_rules(요건) 기반.
//  DB 저장/확정은 2차. 여기서는 조회·판정 미리보기용 타입만 정의(기존 타입과 충돌 없음).

export type EvalStatus = "pending" | "in_progress" | "awaiting_decision" | "passed" | "failed" | "review_required";
export type OverallStatus = EvalStatus | "partial_complete";
export type EquipmentCertMethod = "one" | "all" | "representative" | "equipment_group" | "individual";

export const EVAL_STATUS_LABEL: Record<OverallStatus, string> = {
  pending: "평가 대기", in_progress: "평가 중", awaiting_decision: "판정 대기",
  passed: "합격", failed: "불합격", review_required: "재검토 필요", partial_complete: "부분 완료",
};

export type ChecklistItem = {
  id: string; label: string; required: boolean;
  passed: boolean | null; score: number | null; maxScore: number | null; note?: string;
};

export type PracticalEvaluatorResult = {
  resultId: string | null; applicationId: string; personnelId: string | null; equipmentId: string | null;
  evaluator: string | null; evaluatorNo: number | null;
  score: number | null; maxScore: number | null; checklist: ChecklistItem[]; notes: string | null; resultDate: string | null;
  evalStatus: EvalStatus | null;
};

export type EquipmentEvaluationSummary = {
  equipmentId: string; equipmentName: string; status: EvalStatus;
  averageScore: number | null; variance: number; evaluatorRequired: number; evaluatorCompleted: number;
  checklistPassed: boolean; passed: boolean; reasons: string[]; warnings: string[];
};

export type PracticalEvalSummary = {
  applicationId: string; overallStatus: OverallStatus; overallPassed: boolean;
  method: EquipmentCertMethod; requiredCount: number | null;
  targetCount: number; completedCount: number; passedCount: number; failedCount: number; reviewRequiredCount: number;
  partialComplete: boolean; equipmentSummaries: EquipmentEvaluationSummary[]; reasons: string[]; warnings: string[];
};

// 규칙 요건(파생용 · nullable 대비). 실제 exam_rules 행에서 안전 추출.
export type PracticalRule = {
  requirePractical: boolean; practicalPassScore: number | null; evaluatorCount: number | null;
  equipmentCertMethod: EquipmentCertMethod | null; requiredEquipmentCount: number | null;
};

// 목록 대상(조회 + 편집용 원천).
export type PracticalTarget = {
  applicationId: string; employeeNo: string; name: string; process: string; levelCode: string;
  writtenPassDate: string | null; personnelId: string | null; canSave: boolean; // personnel_id 연결 여부
  summary: PracticalEvalSummary; warnings: string[];
  // 2차 입력용 원천(계산 로직 재사용 · UI 계산 금지)
  rule: PracticalRule;
  equipment: Array<{ id: string; name: string; isRepresentative: boolean; group: string | null }>;
  results: PracticalEvaluatorResult[]; // 기존 저장 결과(설비×위원, prefill)
};
