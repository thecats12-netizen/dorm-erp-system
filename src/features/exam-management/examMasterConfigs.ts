import type { ExamMasterTable } from "./services/examMasterService";

export type ExamColumnType = "text" | "number" | "date" | "select" | "ref";
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
  {
    key: "parts", title: "파트", table: "exam_parts",
    columns: [
      { key: "category_id", label: "제품군", type: "ref", refTable: "exam_categories" },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "파트명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "processes", title: "공정", table: "exam_processes",
    columns: [
      { key: "part_id", label: "파트", type: "ref", refTable: "exam_parts" },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "공정명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "levels", title: "인증 레벨", table: "exam_levels",
    columns: [
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "레벨명 (PM Level/Single Job/M1~M4/D.M/Dual Multi/Master 등)", type: "text", required: true },
      { key: "rank_order", label: "순위", type: "number" },
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
    key: "rules", title: "인증 기준", table: "exam_rules",
    columns: [
      { key: "rule_type", label: "기준 구분", type: "select", options: ["취득 기준", "달성 기준", "시험 유효기간", "목표 기준"], required: true },
      { key: "part_id", label: "파트", type: "ref", refTable: "exam_parts" },
      { key: "process_id", label: "공정", type: "ref", refTable: "exam_processes" },
      { key: "level_id", label: "인증 레벨", type: "ref", refTable: "exam_levels" },
      { key: "effective_date", label: "적용일", type: "date" },
      { key: "notes", label: "기준 내용", type: "text" },
    ],
  },
];
