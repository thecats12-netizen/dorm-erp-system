// 시험관리 공통 사원 검색/자동입력 타입(신규 · 조회 전용 기반 기능).
//  - 기존 타입/테이블 변경 없음. DB 는 snake_case, 화면/훅은 camelCase 로 명시 매핑한다.

export type EmployeeStatus = "재직" | "휴직" | "퇴직" | string;

// 검색 결과/선택 대상 사원(경량). exam_personnel 실제 컬럼 기반.
export type EmployeeLite = {
  id: string;              // exam_personnel.id (uuid)
  employeeNo: string;      // employee_no
  name: string;            // name
  group?: string | null;         // group_name
  productFamily?: string | null; // product_group
  part?: string | null;          // part_name
  processId?: string | null;     // process_id (uuid)
  position?: string | null;      // position
  joinDate?: string | null;      // hire_date (YYYY-MM-DD)
  employmentStatus?: EmployeeStatus | null; // employment_status
};

// 최근 선택 사원(localStorage) — 민감정보 저장 금지. id/사번/이름만.
export type RecentEmployee = { id: string; employeeNo: string; name: string };

// 사원 선택 시 한 번에 반환하는 자동입력 payload.
export type EmployeeAutofill = {
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    group: string | null;
    productFamily: string | null;
    part: string | null;
    process: string | null;        // process_id (이름 해석은 화면 계층에서)
    position: string | null;
    joinDate: string | null;       // hire_date
    employmentStatus: string | null;
  };
  licenseSummary: {
    // 하위호환 alias(기존 컴포넌트) — 신규 UI 는 아래 3분리 필드를 사용한다.
    currentStage: string | null;   // = acquiredStageCode || activeStageCode
    nextStage: string | null;      // = nextRecommendedStageCode
    activePlanId: string | null;
    targetDate: string | null;
    remainingMonths: number | null;
    overdue: boolean;
    retestAvailableDate: string | null;
    // 3분리(취득/진행/추천)
    acquiredStageCode: string | null;
    acquiredStageName: string | null;
    acquiredDate: string | null;
    activeStageCode: string | null;
    activeStageName: string | null;
    activeTargetDate: string | null;
    remainingDays: number | null;
    isOverdue: boolean;
    nextRecommendedStageCode: string | null;
    nextRecommendedStageName: string | null;
    recommendationReason: string | null;
    isEligibleForNextStage: boolean;
    source: "license_plan" | "exam_application" | "mixed" | "none";
    warnings: string[];
    planStatus: string | null;
    applicationStatus: string | null;
    // PM/DM 후속 재사용 준비(§14)
    highestAcquiredSortOrder: number | null;
    completedLevelCodes: string[];
    activeLevelCodes: string[];
    nextEligibleLevelCodes: string[];
    // 하위호환 alias
    acquiredStage?: string | null;
  };
  pmSummary: {
    currentLevel: string | null;
    eligibleLevel: string | null;
    acquiredDate: string | null;
    expiryDate: string | null;
  };
  dmSummary: {
    currentLevel: string | null;
    eligibleLevel: string | null;
    processCount: number | null;
    equipmentCount: number | null;
    dualMulti: boolean;
  };
};
