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
// 목록 표시 전용 "파생" 컬럼: DB 컬럼이 없어도 이미 로드된 참조(refMap)만으로 상위 계층 이름을 보여준다.
//   예) 장비 목록의 그룹/제품군 — exam_equipment 에 컬럼 추가 없이 process_id → 공정 → group_id/category_id 이름을 표시.
//   저장/Excel/정렬/검색 대상이 아니며(순수 표시), UUID 는 노출하지 않는다. 관계를 못 찾으면 자연스러운 한글 폴백.
export type ExamDerivedColumn = {
  key: string;                 // 표시용 키(저장 안 함)
  label: string;              // 헤더
  from: string;               // 이 행에서 상위를 역추적할 시작 FK(예: "process_id")
  via: ExamMasterTable;       // from 이 가리키는 참조 테이블(예: exam_processes)
  pick: "group_id" | "category_id"; // via 행에서 꺼낼 상위 FK
  nameFrom: ExamMasterTable;  // pick 값을 이름으로 변환할 테이블(예: exam_groups)
  fallback: string;           // pick 값이 없을 때(예: "그룹 미지정")
  missing: string;            // from/via 를 못 찾을 때(예: "공정 확인 필요")
};
export type ExamEntityConfig = {
  key: string;      // 하위 탭 키
  title: string;    // 화면 표시 제목
  table: ExamMasterTable;
  columns: ExamColumn[];
  hidden?: boolean; // 탭/등록 흐름에서 제외(테이블·데이터·config 는 유지 · 하위호환/역추적용). 예: 제품/파트.
  derived?: ExamDerivedColumn[]; // 목록 표시 전용 파생 컬럼(저장/Excel/정렬 대상 아님). 헤더는 columns 앞에 표시.
};

// 인증 기준관리 하위 기준정보/기준 엔티티 정의. 시험 규칙(취득/달성/유효기간/목표)은 exam_rules 에서 관리(하드코딩 금지).
// 등록 순서(업무 흐름): 제품군 → 그룹 → 제품/파트 → 공정 → 장비 → 인증 레벨 → 인증 규칙.
//   - exam_parts 를 "제품/파트" 로 다시 화면에 노출한다(테이블/데이터/part_id 컬럼은 그대로 — 하위호환·Excel 호환).
//   - 컬럼은 실제 DB 에 존재하는 것만 노출한다(없는 컬럼을 payload 에 넣으면 400). 확장 필드는 컬럼 추가 migration 적용 후 활성화한다.
export const EXAM_ENTITY_CONFIGS: ExamEntityConfig[] = [
  {
    // [라인 UI 제외] 라인 탭 숨김. 테이블·데이터·line_id·FK·index·migration·저장값(exam_rules 등)은 모두 보존(백엔드 호환).
    key: "lines", title: "라인", table: "exam_lines", hidden: true,
    columns: [
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "라인명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    // [순서 통일] 그룹 → 제품군 → 공정 → 장비 → 인증 레벨 → 인증 규칙(사용자 화면 표시 순서).
    // [계층 역전] 그룹은 최상위 독립 기준정보 → 제품군 필드 제거(그룹은 제품군에 종속되지 않음).
    key: "groups", title: "그룹", table: "exam_groups",
    columns: [
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "그룹명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    // [계층 역전] 제품군은 그룹의 하위 → group_id 필수(exam_categories.group_id · 20260752 선행). 동일 tenant 그룹만(ref 는 tenant 범위 로드).
    key: "categories", title: "제품군", table: "exam_categories",
    columns: [
      { key: "group_id", label: "그룹", type: "ref", refTable: "exam_groups", required: true },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "제품군명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    // [계층 단순화] 제품/파트 단계는 인증 기준관리 탭/등록 흐름에서 제외(hidden). 테이블·데이터·part_id·Excel 은 유지.
    //  공정→그룹 연결은 exam_parts(group_id)를 역추적해 표시/필터에만 사용한다.
    key: "parts", title: "제품/파트", table: "exam_parts", hidden: true,
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
      // [계층 역전] 그룹 → 제품군(그룹 소속) 순서로 선택, 둘 다 저장(group_id + category_id). 기존 part_id 는 payload 로 보존(삭제 금지).
      //  제품군은 선택 그룹의 category(group_id) 만 표시 → 저장 시 category.group_id === 선택 그룹 보장.
      { key: "group_id", label: "그룹", type: "ref", refTable: "exam_groups", required: true },
      { key: "category_id", label: "제품군", type: "ref", refTable: "exam_categories", required: true, filterBy: { formKey: "group_id", refField: "group_id" } },
      { key: "code", label: "코드", type: "text" },
      { key: "name", label: "공정명", type: "text", required: true },
      { key: "sort_order", label: "정렬", type: "number" },
    ],
  },
  {
    key: "equipment", title: "장비 목록", table: "exam_equipment",
    // [표시 전용] 동일 공정명·코드가 다른 그룹/제품군에 존재할 수 있어, 장비 목록에 상위 그룹·제품군을 함께 표시한다.
    //  exam_equipment 에는 컬럼을 추가하지 않고 process_id → 공정(refMap) → group_id/category_id 이름을 파생 표시한다.
    //  공정 옵션의 group_id/category_id 는 그리드 로드시 legacy part 로도 역채움되므로 추가 조회가 필요 없다.
    derived: [
      { key: "_group_name", label: "그룹", from: "process_id", via: "exam_processes", pick: "group_id", nameFrom: "exam_groups", fallback: "그룹 미지정", missing: "공정 확인 필요" },
      { key: "_cat_name", label: "제품군", from: "process_id", via: "exam_processes", pick: "category_id", nameFrom: "exam_categories", fallback: "제품군 미지정", missing: "공정 확인 필요" },
    ],
    columns: [
      // [계층 역전] 그룹 → 제품군(그룹 소속) → 공정(제품군 소속) 순서로 필터, 저장은 process_id(불변).
      //  _group → _cat(category.group_id) → 공정(process.category_id, 없으면 group_id fallback) → process_id 저장.
      { key: "_group", label: "그룹", type: "ref", refTable: "exam_groups", transient: true },
      { key: "_cat", label: "제품군", type: "ref", refTable: "exam_categories", transient: true, filterBy: { formKey: "_group", refField: "group_id" } },
      { key: "process_id", label: "공정", type: "ref", refTable: "exam_processes", filterBy: { formKey: "_cat", refField: "category_id", fallback: { formKey: "_group", refField: "group_id" } } },
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
      // "달성 기준"은 여기서 신규 선택 불가(공정별 달성기준 탭에서 criteria 로 등록). 기존 rule_type="달성 기준" row 는 보존·조회·수정(그리드 select 가 legacy 값 유지).
      { key: "rule_type", label: "기준 구분", type: "select", options: ["취득 기준", "시험 유효기간", "목표 기준"], required: true },
      // [라인 UI 제외] "적용 라인" select 제거. exam_rules.line_id 컬럼/저장값은 보존(수정 시 non-config 필드로 유지 · null 덮어쓰기 없음).
      // [계층 역전] 적용 그룹 → 제품군(그룹 소속) → 공정(제품군 소속). 제품군은 category.group_id 로 필터.
      { key: "group_id", label: "적용 그룹", type: "ref", refTable: "exam_groups" },
      { key: "category_id", label: "적용 제품군", type: "ref", refTable: "exam_categories", filterBy: { formKey: "group_id", refField: "group_id" } },
      //  공정은 선택 제품군(category_id) 소속만, 없으면 group_id fallback. 기존 규칙의 part_id/기존 값은 보존(저장 안 할 뿐 삭제 없음).
      { key: "process_id", label: "적용 공정", type: "ref", refTable: "exam_processes", filterBy: { formKey: "category_id", refField: "category_id", fallback: { formKey: "group_id", refField: "group_id" } } },
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
