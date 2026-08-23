// 인증 기준관리 통합 Excel(7시트) — 양식 다운로드 + 현재 데이터 다운로드.
//  · 기존 단일 Excel(ExamMasterGrid.exportExcel)·CRUD 는 그대로 두고, 통합 다운로드만 추가한다.
//  · 시트/컬럼은 EXAM_ENTITY_CONFIGS 를 그대로 따른다 → 확장 필드가 config 에 배선되면 통합 양식도 자동 확장.
//  · 통합 업로드(파싱/검증/미리보기/트랜잭션 저장)는 별도 단계(RPC 필요)에서 구현한다.
import * as XLSX from "xlsx";
import { EXAM_ENTITY_CONFIGS, type ExamEntityConfig, type ExamColumn } from "../examMasterConfigs";
import { listExamRows, buildProcessRefIndex, resolveEquipmentHierarchy, type ExamMasterTable, type ExamProcessRef, type ExamRow } from "./examMasterService";
import { listEquipmentStageRules } from "./equipmentStageRuleService";
import { listProcessCriteriaRules, isAchieveType } from "./processCriteriaRuleService";
import { criteriaToFormState } from "../utils/criteriaFormMapper";

// "인증 규칙"(06_인증규칙/배지) 범위 = 달성기준이 아닌 exam_rules(취득/유효/목표). 그 외 테이블은 전건.
//  · 달성기준(rule_type='달성기준')은 08_공정별달성기준에서만 관리 → 여기선 제외.
const isRulesEntity = (cfg: ExamEntityConfig) => cfg.key === "rules" || cfg.table === "exam_rules";
const inRulesScope = (cfg: ExamEntityConfig, r: ExamRow) => !isRulesEntity(cfg) || !isAchieveType(r.rule_type);

// [단일 source of truth] 라인/제품파트(hidden)는 통합 Excel 3기능 모두에서 제외 → 표시 config 만 사용.
const VISIBLE_CONFIGS = EXAM_ENTITY_CONFIGS.filter((c) => !c.hidden);
// 표준 시트명(그룹→제품군→공정→장비→인증레벨→인증규칙→07 설비별인증단계→08 공정별달성기준).
const SHEET_LABEL: Record<string, string> = {
  groups: "01_그룹", categories: "02_제품군", processes: "03_공정",
  equipment: "04_장비목록", levels: "05_인증레벨", rules: "06_인증규칙",
};
const sheetNameFor = (cfg: ExamEntityConfig, i: number) => SHEET_LABEL[cfg.key] || `${String(i + 1).padStart(2, "0")}_${cfg.title}`;

// 참조 컬럼(ref)은 사람이 읽는 이름으로 출력한다. 필요한 참조 테이블만 로드해 id→라벨 맵 구성.
async function loadRefMaps(tenantId: string): Promise<Record<string, Map<string, string>>> {
  const refTables = new Set<ExamMasterTable>();
  VISIBLE_CONFIGS.forEach((c) => c.columns.forEach((col) => { if (col.type === "ref" && col.refTable) refTables.add(col.refTable); }));
  const maps: Record<string, Map<string, string>> = {};
  await Promise.all([...refTables].map(async (t) => {
    const rows = await listExamRows(t, tenantId).catch(() => [] as ExamRow[]);
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(String(r.id), [r.code, r.name].filter(Boolean).join(" · ") || String(r.name ?? r.id)));
    maps[t] = m;
  }));
  return maps;
}

const cellValue = (col: ExamColumn, r: ExamRow, refMaps: Record<string, Map<string, string>>): string => {
  const v = r[col.key];
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "ref" && col.refTable) return refMaps[col.refTable]?.get(String(v)) ?? String(v);
  if (col.type === "boolean") return v === true ? "Y" : v === false ? "N" : "";
  return String(v);
};

// 시트에 실제로 출력하는 컬럼(필터 전용 transient 제외). 파생 컬럼(그룹/제품군)은 앞에 별도로 붙인다.
//  ⚠ transient(_group/_cat)를 그대로 출력하면 장비 row 에는 해당 필드가 없어 값이 항상 빈칸이 된다(통합 다운로드 그룹/제품군 공백 원인).
const visibleCols = (cfg: ExamEntityConfig) => cfg.columns.filter((c) => !c.transient);
// 각 엔티티 시트의 헤더(파생 컬럼 라벨 + 실출력 컬럼 라벨 + 사용여부). 코드/이름은 config 에 이미 포함.
const headersFor = (cfg: ExamEntityConfig) => [
  ...(cfg.derived ?? []).map((d) => d.label),
  ...visibleCols(cfg).map((c) => c.label + (c.required ? " *" : "")),
  "사용여부",
];

// 08_설비별인증단계(커스텀 테이블 exam_equipment_stage_rules). 참조는 "코드 · 이름" 결합형(round-trip 호환).
const STAGE_SHEET = "07_설비별인증단계";
const stageHeaders = () => ["그룹 *", "제품군 *", "공정 *", "설비 *", "인증단계 *", "주력설비여부", "적용시작일", "적용종료일", "정렬", "비고", "사용여부"];
async function stageDataSheet(tenantId: string, refMaps: Record<string, Map<string, string>>, includeInactive: boolean): Promise<{ ws: XLSX.WorkSheet; count: number }> {
  const equipMap = new Map<string, string>();
  (await listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[])).forEach((r) => equipMap.set(String(r.id), [r.code, r.name].filter(Boolean).join(" · ") || String(r.name ?? r.id)));
  const rows = (await listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[])).filter((r) => !r.deleted_at && (includeInactive || r.is_active !== false));
  const json = rows.map((r) => ({
    "그룹 *": refMaps["exam_groups"]?.get(String(r.group_id ?? "")) ?? "",
    "제품군 *": refMaps["exam_categories"]?.get(String(r.category_id ?? "")) ?? "",
    "공정 *": refMaps["exam_processes"]?.get(String(r.process_id ?? "")) ?? "",
    "설비 *": equipMap.get(String(r.equipment_id ?? "")) ?? "",
    "인증단계 *": refMaps["exam_levels"]?.get(String(r.level_id ?? "")) ?? "",
    "주력설비여부": r.is_core_equipment === true ? "Y" : "N",
    "적용시작일": r.effective_from ? String(r.effective_from).slice(0, 10) : "",
    "적용종료일": r.effective_to ? String(r.effective_to).slice(0, 10) : "",
    "정렬": r.sort_order ?? "",
    "비고": r.notes ?? "",
    "사용여부": r.is_active === false ? "미사용" : "사용",
  }));
  return { ws: json.length ? XLSX.utils.json_to_sheet(json) : XLSX.utils.aoa_to_sheet([stageHeaders()]), count: rows.length };
}

// 09_공정별달성기준(exam_rules 달성기준). criteria(jsonb)를 관리형 원자 컬럼으로 풀어 출력(groups/unknown 은 노출 안 함 — 보존은 재등록 UPDATE 시).
const CRITERIA_SHEET = "08_공정별달성기준";
const criteriaHeaders = () => ["그룹 *", "제품군 *", "공정 *", "인증단계 *", "조건방식", "최소설비수", "최소주력설비수", "최소취득률", "최소근속개월", "단계간경과개월", "누적경과개월", "선행단계", "필수설비", "예외허용", "적용시작일", "적용종료일", "표시문구", "관리자메모", "변경사유", "사용여부"];
const codeById = (rows: ExamRow[]) => new Map(rows.map((r) => [String(r.id), String(r.code ?? "")]));
async function criteriaDataSheet(tenantId: string, refMaps: Record<string, Map<string, string>>, includeInactive: boolean): Promise<{ ws: XLSX.WorkSheet; count: number }> {
  const levelCode = codeById(await listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]));
  const equipCode = codeById(await listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]));
  const rows = (await listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[])).filter((r) => !r.deleted_at && (includeInactive || r.is_active !== false));
  const json = rows.map((r) => {
    const f = criteriaToFormState(r.criteria);
    return {
      "그룹 *": refMaps["exam_groups"]?.get(String(r.group_id ?? "")) ?? "",
      "제품군 *": refMaps["exam_categories"]?.get(String(r.category_id ?? "")) ?? "",
      "공정 *": refMaps["exam_processes"]?.get(String(r.process_id ?? "")) ?? "",
      "인증단계 *": refMaps["exam_levels"]?.get(String(r.level_id ?? "")) ?? "",
      "조건방식": f.operator,
      "최소설비수": f.minEquipmentCount, "최소주력설비수": f.minCoreEquipmentCount, "최소취득률": f.minCompletionRate,
      "최소근속개월": f.minTenureMonths, "단계간경과개월": f.minElapsedMonths, "누적경과개월": f.cumulativeElapsedMonths,
      "선행단계": f.prerequisiteLevelIds.map((id) => levelCode.get(id) || "").filter(Boolean).join("|"),
      "필수설비": f.requiredEquipmentIds.map((id) => equipCode.get(id) || "").filter(Boolean).join("|"),
      "예외허용": f.allowException ? "Y" : "N",
      "적용시작일": f.effectiveFrom, "적용종료일": f.effectiveTo, "표시문구": f.labelKo,
      "관리자메모": r.notes ?? "", "변경사유": "",
      "사용여부": r.is_active === false ? "미사용" : "사용",
    };
  });
  return { ws: json.length ? XLSX.utils.json_to_sheet(json) : XLSX.utils.aoa_to_sheet([criteriaHeaders()]), count: rows.length };
}

// 00_작성안내 시트(안내/규칙).
function guideSheet(): XLSX.WorkSheet {
  const aoa: string[][] = [
    ["시험관리 · 인증 기준관리 통합 등록 양식"],
    [""],
    ["[등록 순서] 그룹 → 제품군 → 공정 → 장비 → 인증 레벨 → 인증 규칙"],
    ["상위 시트를 먼저 채우고, 하위 시트의 상위 항목은 상위 시트의 '코드' 또는 표시명(코드 · 이름)으로 참조합니다."],
    [""],
    ["[공통 규칙]"],
    ["· '*' 표시 컬럼은 필수입니다."],
    ["· 사용여부: 사용 / 미사용 (미입력 시 사용)."],
    ["· Y/N 컬럼: Y 또는 N."],
    ["· 날짜: YYYY-MM-DD 형식."],
    ["· 코드는 같은 상위 범위 내에서 중복될 수 없습니다."],
    ["· 파일에 없는 기존 데이터는 삭제되지 않습니다(비활성은 명시적으로 '미사용' 입력 시에만)."],
    [""],
    ["[인증 규칙 · 장비 인증 방식 허용값] 1대 / 전체 / 대표 장비 / 장비군 / 개별 인증"],
    ["[시트] 01_그룹 · 02_제품군 · 03_공정 · 04_장비목록 · 05_인증레벨 · 06_인증규칙 · 07_설비별인증단계 · 08_공정별달성기준"],
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

// 통합 양식(빈 양식) 다운로드.
export function downloadExamMasterTemplate(): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, guideSheet(), "00_작성안내");
  VISIBLE_CONFIGS.forEach((cfg, i) => {
    const ws = XLSX.utils.aoa_to_sheet([headersFor(cfg)]); // 헤더만
    XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(cfg, i));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([stageHeaders()]), STAGE_SHEET); // 08_설비별인증단계
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([criteriaHeaders()]), CRITERIA_SHEET); // 09_공정별달성기준
  XLSX.writeFile(wb, "시험관리_인증기준_통합등록양식.xlsx");
}

// 현재 데이터 통합 다운로드(현재 tenant · 권한 범위는 RLS 가 강제). includeInactive: 미사용 포함 여부.
export async function downloadExamMasterCurrent(tenantId: string, includeInactive = false): Promise<{ counts: Record<string, number> }> {
  const refMaps = await loadRefMaps(tenantId);
  // 파생 컬럼(장비의 그룹/제품군)을 위한 공정 인덱스(공정→group_id/category_id, legacy part 보완). 화면과 동일한 단일 resolver 사용.
  const needHier = VISIBLE_CONFIGS.some((c) => c.derived?.length);
  let procIndex = new Map<string, ExamProcessRef>();
  if (needHier) {
    const [procRows, partRows] = await Promise.all([
      listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
      listExamRows("exam_parts", tenantId).catch(() => [] as ExamRow[]),
    ]);
    procIndex = buildProcessRefIndex(procRows, partRows);
  }
  const groupLabelById = new Map<string, string>([...(refMaps["exam_groups"]?.entries() ?? [])]);
  const categoryLabelById = new Map<string, string>([...(refMaps["exam_categories"]?.entries() ?? [])]);
  const hierRefs = { processById: procIndex, groupLabelById, categoryLabelById };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, guideSheet(), "00_작성안내");
  const counts: Record<string, number> = {};
  for (let i = 0; i < VISIBLE_CONFIGS.length; i++) {
    const cfg = VISIBLE_CONFIGS[i];
    const rows = (await listExamRows(cfg.table, tenantId).catch(() => [] as ExamRow[]))
      .filter((r) => (includeInactive || r.is_active !== false) && inRulesScope(cfg, r));
    counts[cfg.key] = rows.length;
    const json = rows.map((r) => {
      const o: Record<string, string> = {};
      // 파생 컬럼(그룹/제품군): process_id → 공정 → group_id/category_id 라벨. UUID 미노출.
      if (cfg.derived?.length) {
        const h = resolveEquipmentHierarchy(r, hierRefs);
        cfg.derived.forEach((d) => { o[d.label] = d.pick === "group_id" ? h.group : h.category; });
      }
      visibleCols(cfg).forEach((c) => { o[c.label] = cellValue(c, r, refMaps); });
      o["사용여부"] = r.is_active === false ? "미사용" : "사용";
      return o;
    });
    const ws = json.length ? XLSX.utils.json_to_sheet(json) : XLSX.utils.aoa_to_sheet([headersFor(cfg)]);
    XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(cfg, i));
  }
  // 08_설비별인증단계(커스텀 테이블) — 현재 데이터.
  const stage = await stageDataSheet(tenantId, refMaps, includeInactive);
  counts["stageRules"] = stage.count;
  XLSX.utils.book_append_sheet(wb, stage.ws, STAGE_SHEET);
  const crit = await criteriaDataSheet(tenantId, refMaps, includeInactive);
  counts["criteriaRules"] = crit.count;
  XLSX.utils.book_append_sheet(wb, crit.ws, CRITERIA_SHEET);
  XLSX.writeFile(wb, `시험관리_인증기준_현재데이터_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { counts };
}

// 상단 요약 카운트(현재 tenant · 활성 기준). 등록 순서 진행 상태 표시에 사용.
export async function loadExamMasterCounts(tenantId: string, includeInactive = false): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(VISIBLE_CONFIGS.map(async (cfg) => {
    const rows = await listExamRows(cfg.table, tenantId).catch(() => [] as ExamRow[]);
    out[cfg.key] = rows.filter((r) => (includeInactive || r.is_active !== false) && inRulesScope(cfg, r)).length;
  }));
  return out;
}
