// 데이터 범위 카탈로그(코드 단일 원본).
//  - scope_type × scope_value × action_scope. 화면엔 한글 라벨만 노출.
//  - add-only(합집합). 기존 role 범위를 축소하지 않는다.
export type ScopeType = "organization" | "region" | "gender" | "dorm" | "process" | "owner";
export type ActionScope = "read" | "write" | "all";

export const SCOPE_TYPE_LABEL: Record<ScopeType, string> = {
  organization: "조직 범위",
  region: "지역 범위",
  gender: "성별 범위",
  dorm: "기숙사 범위",
  process: "시험 공정 범위",
  owner: "본인 데이터 범위",
};

export const ACTION_SCOPE_LABEL: Record<ActionScope, string> = {
  read: "조회 전용",
  write: "쓰기",
  all: "전체",
};

// 고정 값 옵션(동적 값=dorm/process UUID 는 별도 선택기로).
export const ORG_VALUES = [
  { value: "all", label: "전체 조직" },
  { value: "tenant", label: "현재 tenant" },
  { value: "own", label: "본인 조직만" },
];
export const REGION_VALUES = [
  { value: "all", label: "전체 지역" },
  { value: "평택", label: "평택" },
  { value: "천안", label: "천안" },
];
export const GENDER_VALUES = [
  { value: "all", label: "전체" },
  { value: "남", label: "남성" },
  { value: "여", label: "여성" },
];
export const DORM_MODE_VALUES = [
  { value: "all", label: "전체 기숙사" },
  { value: "assigned", label: "담당 기숙사만" },
  { value: "region", label: "지역 내 기숙사 전체" },
  // 그 외: 직접 선택한 dorm UUID
];
export const PROCESS_MODE_VALUES = [
  { value: "all", label: "전체 공정" },
  { value: "assigned", label: "담당 공정만" },
  // 그 외: 직접 선택한 process UUID (실제 강제는 exam_user_process_scopes)
];
export const OWNER_VALUES = [
  { value: "all", label: "전체 데이터" },
  { value: "created_by_me", label: "본인 생성 데이터" },
  { value: "assigned_to_me", label: "본인 담당 데이터" },
  { value: "approver_me", label: "본인이 승인할 데이터" },
];

// 저장 행 형태.
export type ScopeRow = {
  id?: string;
  scope_type: ScopeType;
  scope_value: string;
  action_scope: ActionScope;
  is_active?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
};
