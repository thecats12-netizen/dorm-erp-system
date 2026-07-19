import type { ExamMasterTable } from "./services/examMasterService";

export type ExamColumnType = "text" | "number" | "date" | "select" | "ref" | "boolean";
export type ExamColumn = {
  key: string;
  label: string;
  type: ExamColumnType;
  options?: string[];          // select
  refTable?: ExamMasterTable;  // ref (참조 선택)
  required?: boolean;
  // 종속 선택(cascade): 이 참조 옵션을 상위 폼 값으로 필터한다.
  //  - formKey: 같은 폼에서 상위로 쓰는 필드(예: "category_id")
  //  - refField: 이 참조 행에서 상위 id 를 담은 FK 필드(예: exam_groups.category_id)
  //  ※ 대상 참조 행에 refField 컬럼이 아직 없으면(마이그레이션 미적용) 필터를 건너뛰어(전체 표시)
  //    기존 텍스트/데이터 호환을 유지한다(무회귀).
  //  fallback: 기본 refField 값이 null 인 기존 데이터(예: part.group_id 미설정)는 상위 단계로 역추적한다
  //    (예: group_id 없으면 category_id 로 판정). 신규 저장값은 기본 FK 로 저장한다.
  filterBy?: { formKey: string; refField: string; fallback?: { formKey: string; refField: string } };
  // transient: 폼에서 상위 종속 선택을 좁히는 "필터 전용" 필드. DB 에 저장하지 않고 목록/Excel 에도 표시하지 않는다.
  //  (해당 테이블에 저장 컬럼이 없는 상위 단계를 안전하게 드릴다운하기 위함 — 없는 컬럼 강제 저장 방지)
  transient?: boolean;
};
export type ExamEntityConfig = {
  key: string;      // 하위 탭 키
  title: string;    // 화면 표시 제목
  table: ExamMasterTable;
  columns: ExamColumn[];
};

// 인증 기준관리 하위 기준정보/기준 엔티티 정의. 시험 규칙(취득/달성/유효기간/목표)은 exam_rules 에서 관리(하드코딩 금지).
// 등록 순서(업무 흐름): 제품군 → 그룹 → 제품/파트 → 공정 → 장비 → 인증 레벨 → 인증 규칙.
//   - exam_parts 를 "제품/파트" 로 다시 화면에 노출한다(테이블/데이터/part_id 컬럼은 그대로 — 하위호환·Excel 호환).
//   - 컬럼은 실제 DB 에 존재하는 것만 노출한다(없는 컬럼을 payload 에 넣으면 400). 확장 필드는 컬럼 추가 migration 적용 후 활성화한다.
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
    key: "parts", title: "제품/파트", table: "exam_parts",
    columns: [
      // exam_parts.category_id·group_id 모두 운영 DB 존재 확인 → 제품군→그룹 종속 저장.
      { key: "category_id", label: "제품군", type: "ref", refTable: "exam_categories" },
      { key: "group_id", label: "그룹", type: "ref", refTable: "exam_groups", filterBy: { formKey: "category_id", refField: "category_id" } },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "제품/파트명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "processes", title: "공정", table: "exam_processes",
    columns: [
      // exam_processes 에는 part_id 만 존재(category_id/group_id 없음 — 운영 확인). 저장은 part_id.
      //  제품군·그룹은 필터 전용(_cat/_group). 그룹 → 제품/파트(part.group_id, group_id null 은 category_id fallback) → part_id 저장.
      { key: "_cat", label: "제품군", type: "ref", refTable: "exam_categories", transient: true },
      { key: "_group", label: "그룹", type: "ref", refTable: "exam_groups", transient: true, filterBy: { formKey: "_cat", refField: "category_id" } },
      { key: "part_id", label: "제품/파트", type: "ref", refTable: "exam_parts", filterBy: { formKey: "_group", refField: "group_id", fallback: { formKey: "_cat", refField: "category_id" } } },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "공정명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "equipment", title: "장비 목록", table: "exam_equipment",
    columns: [
      // 저장은 process_id(exam_equipment.process_id). 제품군·그룹·제품/파트는 필터 전용.
      //  _cat → _group(group.category_id) → 제품/파트(part.group_id, fallback category_id) → 공정(process.part_id) → process_id 저장.
      { key: "_cat", label: "제품군", type: "ref", refTable: "exam_categories", transient: true },
      { key: "_group", label: "그룹", type: "ref", refTable: "exam_groups", transient: true, filterBy: { formKey: "_cat", refField: "category_id" } },
      { key: "_part", label: "제품/파트", type: "ref", refTable: "exam_parts", transient: true, filterBy: { formKey: "_group", refField: "group_id", fallback: { formKey: "_cat", refField: "category_id" } } },
      { key: "process_id", label: "공정", type: "ref", refTable: "exam_processes", filterBy: { formKey: "_part", refField: "part_id" } },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "장비명", type: "text", required: true },
      { key: "spec", label: "사양", type: "text" },
      { key: "location", label: "위치", type: "text" },
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
    key: "rules", title: "인증 규칙", table: "exam_rules",
    columns: [
      { key: "rule_type", label: "기준 구분", type: "select", options: ["취득 기준", "달성 기준", "시험 유효기간", "목표 기준"], required: true },
      { key: "category_id", label: "적용 제품군", type: "ref", refTable: "exam_categories" },
      // 그룹은 제품군에 종속(exam_groups.category_id — 확실). 저장 컬럼.
      { key: "group_id", label: "적용 그룹", type: "ref", refTable: "exam_groups", filterBy: { formKey: "category_id", refField: "category_id" } },
      // 제품/파트는 필터 전용(그룹 종속 · part.group_id, group_id null 은 category_id fallback). 규칙은 공정 기준 저장이라 파트는 저장 안 함.
      { key: "_part", label: "적용 제품/파트", type: "ref", refTable: "exam_parts", transient: true, filterBy: { formKey: "group_id", refField: "group_id", fallback: { formKey: "category_id", refField: "category_id" } } },
      // 공정은 제품/파트에 종속(process.part_id — 확실). exam_rules.part_id 기존 값은 보존.
      { key: "process_id", label: "적용 공정", type: "ref", refTable: "exam_processes", filterBy: { formKey: "_part", refField: "part_id" } },
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
