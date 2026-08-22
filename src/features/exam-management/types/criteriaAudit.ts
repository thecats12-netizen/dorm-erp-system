// 단계 기준 정합성 검사(공정별 달성기준 ↔ 설비별 인증단계) 결과 타입.
//  ⚠ 모든 식별은 equipment_id/level_id FK 기준(장비명 문자열 매칭 금지). UI 표시는 장비명/코드(UUID 비노출).
//  ⚠ 선택 적용은 사용자가 체크한 행만 · 미리보기 후 · 기존 서비스(upsert)로 감사/tenant/RLS 준수. 자동 일괄수정/삭제 없음.
import type { Criteria } from "./certificationCriteria";

export type AuditStatus =
  | "정상"
  | "미등록"
  | "필수설비 누락"
  | "불필요 설비 포함"
  | "선행단계 오류"
  | "min_equipment_count 사용 위험"
  | "criteria 중복"
  | "단계 설비 미등록"
  | "정책확인필요";

export interface AuditEquip { id: string; name: string; }

export interface CriteriaAuditRow {
  key: string;                       // `${processId}|${levelId}`
  groupName: string;
  categoryName: string;
  processId: string;
  processName: string;
  levelId: string;
  levelCode: string;
  levelName: string;
  rankOrder: number;
  stageName: string;                 // canonical: Single/Multi 1~4
  isSingle: boolean;

  stageEquip: AuditEquip[];          // 설비별 인증단계에서 집계한 단계 설비(공정 scope 검증 통과분)
  invalidStageCount: number;         // 장비 master 부재/비활성/공정 불일치로 제외된 stage rule 수
  expectedEquip: AuditEquip[];       // 예상 required_equipment_ids(Multi=전체, Single=후보)
  expectedPrereqLevelIds: string[];
  expectedPrereqNames: string[];

  currentExists: boolean;
  currentRowCount: number;           // 동일 process+level criteria 행 수(>1 → 중복)
  currentRequired: AuditEquip[];     // 현재 criteria required_equipment_ids
  currentPrereqLevelIds: string[];
  currentPrereqNames: string[];
  currentMinEquipmentCount: number | null;

  missing: AuditEquip[];             // 예상엔 있으나 현재 required 에 없음
  extra: AuditEquip[];               // 현재 required 에 있으나 예상(단계 설비)에 없음
  singleNeedsGroups: boolean;        // Single 설비 ≥2 → OR groups 필요(현재 폼 미지원)

  status: AuditStatus;               // 대표 상태(가장 심각)
  flags: AuditStatus[];              // 감지된 모든 상태
  notes: string[];                   // 추가 진단 설명(장비명 기준)

  // ── 선택 적용(권장값) ──
  applicable: boolean;               // 자동 적용 가능 여부(아래 blockReason 없을 때만)
  blockReason: string | null;        // 적용 불가 사유(Single 정책 미확정·중복·불일치·복잡 groups 등)
  recommendedCriteria: Criteria | null; // 적용 시 저장할 criteria(불가 시 null)
  targetRuleId: string | null;       // 갱신 대상 exam_rules id(null = 신규 등록)
  changes: string[];                 // 변경 요약(장비명 기준, 현재→권장)
}

export interface CriteriaAuditResult {
  rows: CriteriaAuditRow[];
  ok: boolean;
  message?: string;
}
