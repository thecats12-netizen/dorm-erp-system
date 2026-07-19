// 인증 기준관리 통합 Excel(7시트) — 양식 다운로드 + 현재 데이터 다운로드.
//  · 기존 단일 Excel(ExamMasterGrid.exportExcel)·CRUD 는 그대로 두고, 통합 다운로드만 추가한다.
//  · 시트/컬럼은 EXAM_ENTITY_CONFIGS 를 그대로 따른다 → 확장 필드가 config 에 배선되면 통합 양식도 자동 확장.
//  · 통합 업로드(파싱/검증/미리보기/트랜잭션 저장)는 별도 단계(RPC 필요)에서 구현한다.
import * as XLSX from "xlsx";
import { EXAM_ENTITY_CONFIGS, type ExamEntityConfig, type ExamColumn } from "../examMasterConfigs";
import { listExamRows, type ExamMasterTable, type ExamRow } from "./examMasterService";

// EXAM_ENTITY_CONFIGS 순서(제품군→그룹→제품파트→공정→장비→인증레벨→인증규칙)에 맞춘 시트명.
const SHEET_LABEL: Record<string, string> = {
  categories: "01_제품군", groups: "02_그룹", parts: "03_제품파트", processes: "04_공정",
  equipment: "05_장비", levels: "06_인증레벨", rules: "07_인증규칙",
};
const sheetNameFor = (cfg: ExamEntityConfig, i: number) => SHEET_LABEL[cfg.key] || `${String(i + 1).padStart(2, "0")}_${cfg.title}`;

// 참조 컬럼(ref)은 사람이 읽는 이름으로 출력한다. 필요한 참조 테이블만 로드해 id→라벨 맵 구성.
async function loadRefMaps(tenantId: string): Promise<Record<string, Map<string, string>>> {
  const refTables = new Set<ExamMasterTable>();
  EXAM_ENTITY_CONFIGS.forEach((c) => c.columns.forEach((col) => { if (col.type === "ref" && col.refTable) refTables.add(col.refTable); }));
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

// 각 엔티티 시트의 헤더(컬럼 라벨 + 사용여부). 코드/이름은 config 에 이미 포함.
const headersFor = (cfg: ExamEntityConfig) => [...cfg.columns.map((c) => c.label + (c.required ? " *" : "")), "사용여부"];

// 00_작성안내 시트(안내/규칙).
function guideSheet(): XLSX.WorkSheet {
  const aoa: string[][] = [
    ["시험관리 · 인증 기준관리 통합 등록 양식"],
    [""],
    ["[등록 순서] 제품군 → 그룹 → 제품/파트 → 공정 → 장비 → 인증 레벨 → 인증 규칙"],
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
    ["[시트] 01_제품군 · 02_그룹 · 03_제품파트 · 04_공정 · 05_장비 · 06_인증레벨 · 07_인증규칙"],
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

// 통합 양식(빈 양식) 다운로드.
export function downloadExamMasterTemplate(): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, guideSheet(), "00_작성안내");
  EXAM_ENTITY_CONFIGS.forEach((cfg, i) => {
    const ws = XLSX.utils.aoa_to_sheet([headersFor(cfg)]); // 헤더만
    XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(cfg, i));
  });
  XLSX.writeFile(wb, "시험관리_인증기준_통합등록양식.xlsx");
}

// 현재 데이터 통합 다운로드(현재 tenant · 권한 범위는 RLS 가 강제). includeInactive: 미사용 포함 여부.
export async function downloadExamMasterCurrent(tenantId: string, includeInactive = false): Promise<{ counts: Record<string, number> }> {
  const refMaps = await loadRefMaps(tenantId);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, guideSheet(), "00_작성안내");
  const counts: Record<string, number> = {};
  for (let i = 0; i < EXAM_ENTITY_CONFIGS.length; i++) {
    const cfg = EXAM_ENTITY_CONFIGS[i];
    const rows = (await listExamRows(cfg.table, tenantId).catch(() => [] as ExamRow[]))
      .filter((r) => includeInactive || r.is_active !== false);
    counts[cfg.key] = rows.length;
    const json = rows.map((r) => {
      const o: Record<string, string> = {};
      cfg.columns.forEach((c) => { o[c.label] = cellValue(c, r, refMaps); });
      o["사용여부"] = r.is_active === false ? "미사용" : "사용";
      return o;
    });
    const ws = json.length ? XLSX.utils.json_to_sheet(json) : XLSX.utils.aoa_to_sheet([headersFor(cfg)]);
    XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(cfg, i));
  }
  XLSX.writeFile(wb, `시험관리_인증기준_현재데이터_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { counts };
}

// 상단 요약 카운트(현재 tenant · 활성 기준). 등록 순서 진행 상태 표시에 사용.
export async function loadExamMasterCounts(tenantId: string, includeInactive = false): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(EXAM_ENTITY_CONFIGS.map(async (cfg) => {
    const rows = await listExamRows(cfg.table, tenantId).catch(() => [] as ExamRow[]);
    out[cfg.key] = rows.filter((r) => includeInactive || r.is_active !== false).length;
  }));
  return out;
}
