// ============================================================================
// DR dataset registry — 백업/복원 대상의 단일 소스(single source of truth).
//  · UI(RestoreWizard)·backupService·App 배선이 각자 하드코딩 목록을 들지 않도록 여기만 바라본다.
//  · 저수준 상수(MILITARY_KEYS/라벨/모듈 라벨)도 여기로 모으고 backupService 가 re-export 해 기존 import 호환을 유지한다.
//  · 이 파일은 backupService 를 import 하지 않는다(순환 방지). backupService → registry 단방향.
// ============================================================================

// 군대 8키(정규 순서) + 업무명(사용자 표기) — 기존 위치(backupService)에서 이동, backupService 가 re-export.
export const MILITARY_KEYS = [
  "militaryPersonnel", "militaryTrainingRecords", "militaryNotices", "militaryReports",
  "militarySettings", "militaryTrainingRules", "militaryCodeValues", "militaryTrainingAutoConfig",
] as const;
export type MilitaryKey = (typeof MILITARY_KEYS)[number];
export const MILITARY_KEY_LABELS: Record<MilitaryKey, string> = {
  militaryPersonnel: "군 인사", militaryTrainingRecords: "훈련 기록", militaryNotices: "공지·통보",
  militaryReports: "보고서", militaryTrainingRules: "훈련 규칙", militarySettings: "군대관리 설정",
  militaryCodeValues: "부서·코드", militaryTrainingAutoConfig: "훈련 자동화 설정",
};

// 모듈 라벨(사용자 메뉴 명칭과 정합) — "자산관리"는 실제 데이터(비품/임차/매각) 중 서버 DR 비대상인 임차/매각 묶음.
export const MODULE_LABELS: Record<string, string> = {
  dorm: "기숙사관리", operational: "운영관리", asset: "자산관리(임차·매각)", military: "군대관리",
  system: "기본·설정", audit: "변경 이력(감사 로그)",
};
export const MODULE_ORDER: string[] = ["dorm", "operational", "asset", "military", "system", "audit"];

// P0 에서 이 백업에 담기지 않는 데이터(사용자에게 "백업되지 않음"으로 반드시 표시).
//  · 시험관리: App state 가 아니라 서버 다중테이블(FK) → 전용 서브시스템 필요(B-2, 미구현).
//  · 운영시뮬레이션 시나리오: 서버 테이블(App state 아님) → B-2.
export const P0_EXCLUDED: string[] = [
  "시험관리(전체) — 서버 다중테이블, 별도 복구 체계 필요",
  "운영시뮬레이션 시나리오 — 서버 테이블",
  "사용자 계정·비밀번호·세션·토큰",
  "첨부파일 원본(사진/증빙/계약서 바이너리) — DB 메타데이터만 일부 모듈에 포함",
];

// 복원 전략:
//  · module-replace-upsert : 모듈 전체를 upsert(onConflict:id, DELETE 없음). dorm/operational/asset.
//  · military-key          : 군대 8키 개별(REPLACE/MERGE). 기존 동작 보존.
//  · system-key            : system 설정 키(교체). 관리자 세션/권한 비파괴 항목만.
export type DatasetStrategy = "module-replace-upsert" | "military-key" | "system-key";

export type DatasetDescriptor = {
  key: string;            // 모듈 키("dorm") 또는 군대 8키 또는 "system"
  module: string;         // 묶음 모듈
  label: string;
  backup: boolean;        // DR 백업 포함 여부
  restoreSupported: boolean; // 선택 복원 실제 지원 여부(미지원이면 UI disabled + "백업 포함·복원 미지원")
  strategy: DatasetStrategy;
  note?: string;          // 제약/주의(로컬 전용 등)
};

// 선택 복원 UI/계획이 참조하는 dataset 목록(단일 소스).
//  · dorm/operational/system/audit 은 "모듈 단위" 행(기존 planRestore 와 동일 입도) — 세부 분리는 후속.
//  · 군대만 8키 개별(기존 동작 유지).
export const RESTORE_DATASETS: DatasetDescriptor[] = [
  { key: "dorm", module: "dorm", label: MODULE_LABELS.dorm, backup: true, restoreSupported: true, strategy: "module-replace-upsert" },
  { key: "operational", module: "operational", label: MODULE_LABELS.operational, backup: true, restoreSupported: true, strategy: "module-replace-upsert" },
  { key: "asset", module: "asset", label: MODULE_LABELS.asset, backup: true, restoreSupported: false, strategy: "module-replace-upsert", note: "임차·매각은 현재 localStorage 기반(서버 영속 아님) — 백업엔 포함되나 선택 복원은 후속 단계" },
  ...MILITARY_KEYS.map((k): DatasetDescriptor => ({ key: k, module: "military", label: MILITARY_KEY_LABELS[k], backup: true, restoreSupported: true, strategy: "military-key" })),
  { key: "system", module: "system", label: MODULE_LABELS.system, backup: true, restoreSupported: false, strategy: "system-key", note: "안전 복원(세션/권한 비파괴) 범위 확정 후 활성화 — 현재 백업만" },
  { key: "audit", module: "audit", label: MODULE_LABELS.audit, backup: true, restoreSupported: false, strategy: "module-replace-upsert", note: "감사 로그는 복원 대상 아님(현 실행 감사 보존)" },
];

// 모듈 → 트리에 표시할 하위 항목 라벨(건수 표기용). computeCounts(backupService)의 recordCounts 키와 정합.
//  · 이 라벨들은 "표시 전용"이다(dorm/operational 은 모듈 단위로 복원되며, 하위 개별 복원은 후속 단계).
//  · 군대는 여기 넣지 않는다(8키가 각각 실제 선택 복원 단위 → RESTORE_DATASETS 로 직접 렌더).
export const MODULE_CHILD_LABELS: Record<string, string[]> = {
  dorm: ["기숙사", "입주자", "신입사원", "계약"],
  operational: ["청소보고서", "하자", "비품", "정산기록", "정산항목", "입주전점검"],
  asset: ["임차현황", "비품매각"],
  system: ["시스템 설정", "테마", "사용자 정의 템플릿", "청소 설정"],
  audit: ["감사로그"],
};
// operational 하위 중 "백업엔 포함되나 선택 복원 미지원(executor 미배선)" 라벨 — 트리에서 '복구 준비 중' 표기.
export const OPERATIONAL_RESTORE_UNSUPPORTED_CHILDREN: string[] = ["입주전점검"];

// 모듈 → 그 모듈의 dataset 목록(트리 렌더용).
export function datasetsByModule(): Map<string, DatasetDescriptor[]> {
  const m = new Map<string, DatasetDescriptor[]>();
  for (const d of RESTORE_DATASETS) {
    const arr = m.get(d.module) || [];
    arr.push(d);
    m.set(d.module, arr);
  }
  return m;
}
