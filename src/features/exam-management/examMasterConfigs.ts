import type { ExamMasterTable } from "./services/examMasterService";

export type ExamColumnType = "text" | "number" | "date" | "select" | "ref" | "boolean";
export type ExamColumn = {
  key: string;
  label: string;
  type: ExamColumnType;
  options?: string[];          // select
  refTable?: ExamMasterTable;  // ref (참조 선택)
  required?: boolean;
};
export type ExamEntityConfig = {
  key: string;      // 하위 탭 키
  title: string;    // 화면 표시 제목
  table: ExamMasterTable;
  columns: ExamColumn[];
};

// 인증 기준관리 하위 기준정보/기준 엔티티 정의. 시험 규칙(취득/달성/유효기간/목표)은 exam_rules 에서 관리(하드코딩 금지).
// ★ 파트 통합: 목표 구조(제품군→공정→설비→레벨→규칙)에 맞춰 "파트" 탭을 제거하고 공정 기준으로 통합했다.
//   - exam_parts 테이블/데이터, part_id/part_name 컬럼은 모두 그대로 유지(하위호환·Excel 호환) — 화면에서만 감춘다.
//   - 신규 등록은 공정을 사용한다. 기존 공정/규칙의 part_id 값은 보존되며 편집 화면에서 노출하지 않는다.
export const EXAM_ENTITY_CONFIGS: ExamEntityConfig[] = [
  {
    key: "categories", title: "제품군", table: "exam_categories",
    columns: [
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "제품군명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "groups", title: "그룹", table: "exam_groups",
    columns: [
      { key: "category_id", label: "제품군", type: "ref", refTable: "exam_categories" },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "그룹명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  // (파트 탭 제거됨 — 공정으로 통합. exam_parts 테이블/데이터/part_id 컬럼은 유지)
  {
    key: "processes", title: "공정", table: "exam_processes",
    columns: [
      // exam_processes 에는 현재 상위 FK 로 part_id 만 존재(group_id/category_id 컬럼 없음).
      // 파트 탭 제거로 상위 선택 UI 를 감춘다(공정을 독립 항목으로 등록). 기존 행의 part_id 값은 DB 에 그대로 보존.
      // ※ 제품군→공정 직접 연결이 필요하면 다음 단계에서 exam_processes.category_id(nullable) 추가(migration) 후 여기에 ref 를 넣는다.
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "공정명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "levels", title: "인증 레벨", table: "exam_levels",
    columns: [
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "레벨명 (Single/M1~M4/D.M/Master 등)", type: "text", required: true },
      { key: "rank_order", label: "정렬순서", type: "number" },
      { key: "auto_promote", label: "자동승급", type: "boolean" },
    ],
  },
  {
    key: "equipment", title: "장비 목록", table: "exam_equipment",
    columns: [
      { key: "process_id", label: "공정", type: "ref", refTable: "exam_processes" },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "장비명", type: "text", required: true },
      { key: "spec", label: "사양", type: "text" },
      { key: "location", label: "위치", type: "text" },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "rules", title: "인증 규칙", table: "exam_rules",
    columns: [
      { key: "rule_type", label: "기준 구분", type: "select", options: ["취득 기준", "달성 기준", "시험 유효기간", "목표 기준"], required: true },
      { key: "category_id", label: "적용 제품군", type: "ref", refTable: "exam_categories" },
      { key: "group_id", label: "적용 그룹", type: "ref", refTable: "exam_groups" },
      // 파트 통합: "적용 파트" 선택 제거 → 공정 기준. exam_rules.part_id 컬럼/기존 값은 보존(화면에서만 감춤).
      { key: "process_id", label: "적용 공정", type: "ref", refTable: "exam_processes" },
      { key: "level_id", label: "인증 단계", type: "ref", refTable: "exam_levels" },
      { key: "prerequisite_level_id", label: "선행 인증 단계", type: "ref", refTable: "exam_levels" },
      { key: "require_written", label: "필기 합격 필요", type: "boolean" },
      { key: "require_practical", label: "실기 합격 필요", type: "boolean" },
      { key: "required_equipment_count", label: "필수 설비 수", type: "number" },
      { key: "required_months", label: "취득 기한(개월)", type: "number" },
      { key: "min_tenure_months", label: "최소 재직기간(개월)", type: "number" },
      { key: "valid_months", label: "유효기간(개월)", type: "number" },
      { key: "expiry_notice_days", label: "만료 예정 기준일(일)", type: "number" },
      { key: "retest_condition", label: "재시험 가능 기준", type: "text" },
      { key: "auto_promote", label: "자동승급 여부", type: "boolean" },
      { key: "effective_date", label: "적용일", type: "date" },
      { key: "notes", label: "비고", type: "text" },
    ],
  },
];
