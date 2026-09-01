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
//  ⚠ label/desc(화면 표시)만 개선 · value(저장값)는 절대 변경하지 않는다. "tenant" 기술 용어는 UI 에 노출하지 않는다.
//  실제 의미(dataScopeModel.buildDataScopeAccess): all/tenant = 전체 허용(fullScope) · own = 제한.
export const ORG_VALUES = [
  { value: "all", label: "전체 조직", desc: "현재 로그인한 회사 내 모든 조직 데이터를 조회할 수 있습니다." },
  { value: "tenant", label: "현재 회사 전체", desc: "현재 로그인한 회사(테넌트)의 모든 조직 데이터를 조회할 수 있습니다." },
  { value: "own", label: "소속 조직만", desc: "사용자가 소속된 조직의 데이터만 조회할 수 있습니다." },
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
  { value: "all", label: "전체 기숙사", desc: "현재 회사에서 접근 가능한 모든 기숙사입니다." },
  // assigned = profiles.dorm_id(사용자에게 지정된 담당 기숙사) 와 연결됨(buildDataScopeAccess assignedDormId).
  { value: "assigned", label: "담당 기숙사", desc: "해당 사용자에게 담당자로 지정된 기숙사(프로필의 담당 기숙사)입니다." },
  { value: "region", label: "지역 기준", desc: "선택한 지역 범위의 기숙사만 대상으로 합니다." },
  // 그 외: 직접 선택한 dorm UUID
];
export const PROCESS_MODE_VALUES = [
  { value: "all", label: "전체 공정" },
  { value: "assigned", label: "담당 공정만" },
  // 그 외: 직접 선택한 process UUID (실제 강제는 exam_user_process_scopes)
];
// ⚠ 현재 owner scope 는 저장만 되고 화면 강제(buildDataScopeAccess)에는 아직 반영되지 않는다.
//   과장 표현 금지 — UI 에서 "설정값 저장 · 화면 적용 별도 확인 필요"로 안내한다(DataScopeEditor).
export const OWNER_VALUES = [
  { value: "all", label: "전체 데이터", desc: "본인 데이터 조건으로 제한하지 않습니다." },
  { value: "created_by_me", label: "본인이 생성한 데이터", desc: "사용자 본인이 생성한 데이터를 대상으로 합니다." },
  { value: "assigned_to_me", label: "본인이 담당자인 데이터", desc: "사용자 본인이 담당자로 지정된 데이터를 대상으로 합니다." },
  { value: "approver_me", label: "본인이 승인 담당자인 데이터", desc: "사용자 본인이 승인 담당자인 데이터를 대상으로 합니다." },
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
