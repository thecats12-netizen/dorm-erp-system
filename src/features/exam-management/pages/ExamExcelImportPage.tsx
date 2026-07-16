import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { listExamRows, listExamRefOptions, examSupabaseReady, syncExamPersonnel, type ExamRow, type ExamMasterTable } from "../services/examMasterService";
import { loadMyExamPermissions, type MyExamPermissions } from "../services/examPermissionService";

// 시험관리 > Excel 가져오기 — 이번 단계는 [분석·검증·미리보기]까지만. DB 저장은 하지 않는다.
//  - 8개 시트 자동 인식/컬럼 자동 매핑 · 수식 결과값 사용 · 날짜/숫자 자동변환 · 사번 문자열 유지
//  - 병합셀 해석 · 숨김열 포함 확인 · 필수시트/필수컬럼/사번중복/날짜오류/미존재 참조/#REF! 등 검증
//  - 제품군/공정/설비/레벨 매핑 · 파트→공정 매핑 · 신규/수정/오류 건수 · 오류 행 다운로드

type RefOpt = { id: string; label: string };
type CType = "text" | "number" | "date" | "bool" | "ref";
type MapCol = {
  key: string; label: string; aliases: string[]; type: CType;
  refTable?: ExamMasterTable;    // ref
  refErrorOnMiss?: boolean;      // ref: 값이 있는데 매칭 실패 시 오류(공정/설비/레벨)
  mapPartToProcess?: boolean;    // 파트 컬럼 → 공정(exam_processes) 으로 매핑
  required?: boolean;
};
type SheetConfig = {
  canonical: string; aliases: string[]; table: ExamMasterTable | null;
  mode?: "rows" | "rules"; cols: MapCol[]; dedup: string[]; note?: string;
};

// ── 값 변환(수식 결과값만 사용. 오류/병합/빈셀은 상위에서 처리) ──
const norm = (s: unknown) => String(s ?? "").replace(/[\s\r\n().]/g, "").toLowerCase();
const toStr = (v: unknown) => { const s = String(v ?? "").replace(/#REF!|#N\/A|#VALUE!|#NAME\?|#NULL!|#DIV\/0!|#NUM!/gi, "").trim(); return s || null; };
const toNum = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const s = String(v).replace(/[^0-9.-]/g, ""); if (s === "" || s === "-" || s === ".") return null; const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const toBool = (v: unknown) => { if (v === null || v === undefined || v === "") return null; if (typeof v === "boolean") return v; return !["0", "false", "n", "no", "x", "-", "없음", "미보유", "불가"].includes(String(v).trim().toLowerCase()); };
const ymd = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) { const t = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return t.toISOString().slice(0, 10); }
  if (typeof v === "number" && Number.isFinite(v)) { const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null; if (d && d.y) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`; }
  const s = String(v).trim(); const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};
const isValidDate = (v: unknown) => v === null || v === undefined || v === "" ? true : ymd(v) !== null;

const CANON = { annual: "년간목표", summary: "인증현황(요약)", personnel: "인력현황(연명부)", apps: "인증시험 응시데이터", achieve: "달성기준", acquire: "취득기준", dm: "D.M인증", monthly: "D.M 월간 실적" };

// 파트 컬럼(별칭 파트/part)은 공정으로 매핑(mapPartToProcess). 공정/설비/레벨은 미존재 시 오류(refErrorOnMiss).
const SHEET_CONFIGS: SheetConfig[] = [
  {
    canonical: CANON.annual, aliases: ["년간목표", "연간목표"], table: "exam_annual_targets", dedup: ["year", "group_name", "product_group", "part_id", "level_id"],
    cols: [
      { key: "year", label: "연도", aliases: ["연도", "년도", "year"], type: "number", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹", "group"], type: "text" },
      { key: "product_group", label: "제품군", aliases: ["제품군", "제품"], type: "text" },
      { key: "part_id", label: "파트→공정", aliases: ["파트", "part"], type: "ref", refTable: "exam_processes", mapPartToProcess: true, refErrorOnMiss: true },
      { key: "level_id", label: "인증레벨", aliases: ["인증레벨", "레벨", "level"], type: "ref", refTable: "exam_levels", refErrorOnMiss: true },
      { key: "current_count", label: "현재인원", aliases: ["현재인원", "현재", "현인원"], type: "number" },
      { key: "target_count", label: "목표인원", aliases: ["목표인원", "목표"], type: "number" },
      { key: "notes", label: "비고", aliases: ["비고", "remark"], type: "text" },
    ],
  },
  {
    canonical: CANON.summary, aliases: ["인증현황", "인증현황요약", "요약"], table: null, dedup: [],
    note: "요약(집계) 시트입니다. 분석/검증만 하며 저장 대상이 아닙니다.",
    cols: [
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "part_id", label: "파트→공정", aliases: ["파트", "part"], type: "ref", refTable: "exam_processes", mapPartToProcess: true },
      { key: "level", label: "레벨", aliases: ["레벨", "level"], type: "text" },
      { key: "count", label: "인원", aliases: ["인원", "합계", "count"], type: "number" },
    ],
  },
  {
    canonical: CANON.personnel, aliases: ["인력현황", "연명부", "인력현황연명부"], table: "exam_personnel", dedup: ["employee_no"],
    cols: [
      { key: "employee_no", label: "사원번호", aliases: ["사원번호", "사번", "empno"], type: "text", required: true },
      { key: "name", label: "이름", aliases: ["이름", "성명", "name"], type: "text", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "product_group", label: "제품군", aliases: ["제품군", "제품"], type: "text" },
      // 파트는 원본 텍스트(part_name)로 보존하고, 저장 시 공정(process_id)으로 매핑한다.
      { key: "part_name", label: "파트", aliases: ["파트", "part"], type: "text" },
      { key: "position", label: "직책", aliases: ["직책", "직급"], type: "text" },
      { key: "hire_date", label: "입사일", aliases: ["입사일", "입사일자"], type: "date" },
      { key: "employment_status", label: "재직여부", aliases: ["재직여부", "재직", "재직상태"], type: "text" },
      { key: "career_type", label: "경력/신입", aliases: ["경력신입", "경력/신입", "경력구분"], type: "text" },
      { key: "current_pm_level", label: "현재PM Level", aliases: ["현재pmlevel", "pmlevel", "현재pm"], type: "text" },
      { key: "pm_capable_rate", label: "PM가능률", aliases: ["pm가능률", "가능률"], type: "number" },
      { key: "single_job", label: "Single Job", aliases: ["singlejob", "single"], type: "bool" },
      { key: "m1", label: "M1", aliases: ["m1"], type: "bool" }, { key: "m2", label: "M2", aliases: ["m2"], type: "bool" },
      { key: "m3", label: "M3", aliases: ["m3"], type: "bool" }, { key: "m4", label: "M4", aliases: ["m4"], type: "bool" },
      { key: "dm", label: "D.M", aliases: ["dm", "d.m"], type: "bool" },
      { key: "cert_level", label: "인증Level", aliases: ["인증level", "인증레벨", "certlevel"], type: "text" },
      { key: "dual_multi", label: "Dual Multi", aliases: ["dualmulti", "dualmulti여부", "듀얼멀티"], type: "bool" },
      { key: "notes", label: "비고", aliases: ["비고"], type: "text" },
    ],
  },
  {
    canonical: CANON.apps, aliases: ["인증시험응시데이터", "응시데이터", "응시"], table: "exam_applications", dedup: ["employee_no", "category_code"],
    cols: [
      { key: "seq_no", label: "연번", aliases: ["연번", "no", "순번"], type: "number" },
      { key: "employee_no", label: "사원번호", aliases: ["사원번호", "사번"], type: "text", required: true },
      { key: "name", label: "성명", aliases: ["성명", "이름"], type: "text", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "product", label: "제품군", aliases: ["제품", "제품군"], type: "text" },
      { key: "process_id", label: "공정", aliases: ["공정"], type: "ref", refTable: "exam_processes", refErrorOnMiss: true },
      { key: "category_code", label: "구분코드", aliases: ["구분코드"], type: "text" },
      { key: "category", label: "구분", aliases: ["구분"], type: "text" },
      { key: "level_id", label: "인증단계", aliases: ["인증단계", "단계", "레벨"], type: "ref", refTable: "exam_levels", refErrorOnMiss: true },
      { key: "equipment_id", label: "인증 설비", aliases: ["인증설비", "설비"], type: "ref", refTable: "exam_equipment", refErrorOnMiss: true },
      { key: "written_exam_date", label: "필기 진행일", aliases: ["필기진행일", "필기시작일"], type: "date" },
      { key: "written_pass_date", label: "필기 합격일", aliases: ["필기합격일"], type: "date" },
      { key: "practical_acquire_date", label: "실기 취득일", aliases: ["실기취득일"], type: "date" },
      { key: "practical_pass_date", label: "실기 합격일", aliases: ["실기합격일"], type: "date" },
      { key: "cert_acquired_date", label: "인증 취득일", aliases: ["인증취득일", "인증취득"], type: "date" },
      { key: "cert_status", label: "인증취득여부", aliases: ["인증취득여부"], type: "text" },
      { key: "timing_status", label: "조기/지연취득", aliases: ["조기지연취득", "조기/지연취득", "조기지연"], type: "text" },
      { key: "pm_level", label: "PM Level", aliases: ["pmlevel"], type: "text" },
      { key: "dm_process", label: "D.M 공정", aliases: ["dm공정", "d.m공정"], type: "text" },
      { key: "notes", label: "비고", aliases: ["비고"], type: "text" },
    ],
  },
  {
    canonical: CANON.dm, aliases: ["dm인증", "d.m인증", "dm인증현황"], table: "dm_certifications", dedup: ["employee_no", "dm_stage", "acquired_date"],
    cols: [
      { key: "employee_no", label: "사원번호", aliases: ["사원번호", "사번"], type: "text", required: true },
      { key: "name", label: "성명", aliases: ["성명", "이름"], type: "text", required: true },
      { key: "dm_stage", label: "D.M 단계", aliases: ["dm단계", "d.m단계", "단계"], type: "text", required: true },
      { key: "dm_level", label: "D.M Level", aliases: ["dmlevel", "d.mlevel", "level"], type: "text" },
      { key: "process_count", label: "인증 공정 수", aliases: ["인증공정수", "공정수"], type: "number" },
      { key: "equipment_count", label: "인증 장비 수", aliases: ["인증장비수", "장비수"], type: "number" },
      { key: "process_combination", label: "공정 조합", aliases: ["공정조합"], type: "text" },
      { key: "dual_multi", label: "Dual Multi", aliases: ["dualmulti", "듀얼멀티"], type: "bool" },
      { key: "acquired_date", label: "취득일", aliases: ["취득일"], type: "date" },
      { key: "expiry_date", label: "만료일", aliases: ["만료일"], type: "date" },
      { key: "renewal_date", label: "갱신일", aliases: ["갱신일", "갱신"], type: "date" },
      { key: "cert_no", label: "인증번호", aliases: ["인증번호"], type: "text" },
      { key: "proof_file", label: "인증 증빙", aliases: ["인증증빙", "증빙"], type: "text" },
      { key: "approval_status", label: "승인상태", aliases: ["승인상태", "승인"], type: "text" },
      { key: "notes", label: "비고", aliases: ["비고"], type: "text" },
    ],
  },
  {
    canonical: CANON.monthly, aliases: ["dm월간실적", "d.m월간실적", "월간실적"], table: "exam_monthly_results", dedup: ["year", "group_name", "product_group", "part_id", "level_id"],
    cols: [
      { key: "year", label: "연도", aliases: ["연도", "년도"], type: "number", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "product_group", label: "제품군", aliases: ["제품군", "제품"], type: "text" },
      { key: "part_id", label: "파트→공정", aliases: ["파트", "part"], type: "ref", refTable: "exam_processes", mapPartToProcess: true },
      { key: "level_id", label: "인증레벨", aliases: ["인증레벨", "레벨"], type: "ref", refTable: "exam_levels", refErrorOnMiss: true },
      ...Array.from({ length: 12 }, (_, i) => ({ key: `m${i + 1}`, label: `${i + 1}월`, aliases: [`${i + 1}월`, `m${i + 1}`], type: "number" as CType })),
      { key: "target_count", label: "목표", aliases: ["목표", "목표건수"], type: "number" },
      { key: "notes", label: "비고", aliases: ["비고"], type: "text" },
    ],
  },
  {
    canonical: CANON.achieve, aliases: ["달성기준"], table: "exam_rules", mode: "rules", dedup: [],
    cols: [
      { key: "level_id", label: "레벨", aliases: ["레벨", "인증레벨", "level"], type: "ref", refTable: "exam_levels", refErrorOnMiss: true },
      { key: "effective_date", label: "기준일", aliases: ["기준일", "적용일"], type: "date" },
      { key: "notes", label: "비고", aliases: ["비고", "설명"], type: "text" },
    ],
  },
  {
    canonical: CANON.acquire, aliases: ["취득기준"], table: "exam_rules", mode: "rules", dedup: [],
    cols: [
      { key: "level_id", label: "레벨", aliases: ["레벨", "인증레벨", "level"], type: "ref", refTable: "exam_levels", refErrorOnMiss: true },
      { key: "effective_date", label: "기준일", aliases: ["기준일", "적용일"], type: "date" },
      { key: "notes", label: "비고", aliases: ["비고", "설명"], type: "text" },
    ],
  },
];

const findConfig = (sheetName: string): SheetConfig | null => {
  const n = norm(sheetName);
  return SHEET_CONFIGS.find((c) => norm(c.canonical) === n || c.aliases.some((a) => norm(a) === n || n.includes(norm(a)))) || null;
};

// 병합셀 해석: 병합 범위의 좌상단 값을 나머지 셀에 전개(연명부 헤더/그룹 병합 대응).
function applyMerges(ws: XLSX.WorkSheet) {
  const merges = ws["!merges"] || [];
  for (const m of merges) {
    const topLeft = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    const src = ws[topLeft] as XLSX.CellObject | undefined;
    if (!src) continue;
    for (let R = m.s.r; R <= m.e.r; R++) for (let C = m.s.c; C <= m.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (addr === topLeft) continue;
      ws[addr] = { t: src.t, v: src.v, w: src.w } as XLSX.CellObject;
    }
  }
}

type RowStatus = "new" | "update";
type SheetResult = {
  sheetName: string; config: SheetConfig | null;
  mapped: Array<{ col: MapCol; header: string | null }>;
  hiddenHeaders: string[];
  missingRequired: string[];
  okRows: Array<ExamRow & { _status: RowStatus }>;
  newCount: number; updateCount: number;
  errors: Array<{ row: number; column?: string; reason: string }>;
  total: number; extraHeaders: string[];
};

export default function ExamExcelImportPage({ darkMode, canEdit, tenantId, userId, onToast, onDataChanged }: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void; onDataChanged?: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SheetResult[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [noRequiredSheet, setNoRequiredSheet] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [personnelApplied, setPersonnelApplied] = useState(false);
  const refMaps = useRef<Record<string, RefOpt[]>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [ready, setReady] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setReady(examSupabaseReady()); }, []);

  const loadRefs = useCallback(async (tables: ExamMasterTable[]) => {
    for (const t of tables) if (!refMaps.current[t]) { try { refMaps.current[t] = await listExamRefOptions(t, tenantId); } catch { refMaps.current[t] = []; } }
  }, [tenantId]);
  const mapRefTo = (table: string, v: unknown): string | null => {
    const s = String(v ?? "").trim(); if (!s) return null;
    const opts = refMaps.current[table] || [];
    const hit = opts.find((o) => o.label === s || o.label.split("·").some((p) => p.trim() === s) || o.label.includes(s));
    return hit ? hit.id : null;
  };

  const analyze = useCallback(async (file: File) => {
    setError(null); setResults([]); setExpanded(new Set()); setNoRequiredSheet(false); setAnalyzing(true);
    try {
      if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다(기준정보 매핑 확인용)."); return; }
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }); // 수식은 계산 결과값(v)만 로드
      const configsUsed = Array.from(new Set(wb.SheetNames.map(findConfig).filter(Boolean) as SheetConfig[]));
      if (configsUsed.length === 0) setNoRequiredSheet(true); // 오류: 필수 시트 없음

      // 매핑 검증용 기준정보(제품군/공정/설비/레벨) + 중복검증용 기존 데이터
      const refTables = Array.from(new Set(configsUsed.flatMap((c) => c.cols.filter((k) => k.type === "ref").map((k) => k.refTable as ExamMasterTable))));
      await loadRefs(refTables);
      const existing: Record<string, Set<string>> = {};
      const keyOf = (cfg: SheetConfig, r: ExamRow) => cfg.dedup.map((k) => String(r[k] ?? "")).join("|");
      for (const cfg of configsUsed) if (cfg.table && cfg.dedup.length && !existing[cfg.canonical]) {
        try { const rows = await listExamRows(cfg.table, tenantId); existing[cfg.canonical] = new Set(rows.map((r) => keyOf(cfg, r))); }
        catch { existing[cfg.canonical] = new Set(); }
      }

      const out: SheetResult[] = [];
      for (const sheetName of wb.SheetNames) {
        const config = findConfig(sheetName);
        const ws = wb.Sheets[sheetName];
        applyMerges(ws); // 병합셀 전개

        // 숨김열 인덱스 수집(포함 여부 확인 · 데이터는 포함하되 표시)
        const hiddenColIdx = new Set<number>();
        (ws["!cols"] || []).forEach((c, i) => { if (c && (c.hidden || c.width === 0)) hiddenColIdx.add(i); });

        // 오류셀(#REF!/#N/A/#VALUE! 등) 주소→코드 기록 후 null 무력화
        const errCells = new Map<string, string>();
        Object.keys(ws).forEach((addr) => {
          if (addr[0] === "!") return; const cell = ws[addr] as XLSX.CellObject;
          if (cell && cell.t === "e") { errCells.set(addr, String(cell.w || "#ERR")); cell.t = "s"; cell.v = null as never; cell.w = ""; }
        });
        const cellText = (r: number, c: number): string | null => { const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined; return cell && cell.w != null && cell.w !== "" ? String(cell.w) : null; };

        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
        if (!config) { out.push({ sheetName, config: null, mapped: [], hiddenHeaders: [], missingRequired: [], okRows: [], newCount: 0, updateCount: 0, errors: [], total: 0, extraHeaders: [] }); continue; }

        // 헤더 행 탐색
        let headerRow = 0, bestHit = -1;
        for (let i = 0; i < Math.min(aoa.length, 6); i++) {
          const hs = (aoa[i] || []).map(norm);
          const hit = config.cols.reduce((n, c) => n + (c.aliases.some((a) => hs.includes(norm(a)) || hs.some((h) => h && h.includes(norm(a)))) ? 1 : 0), 0);
          if (hit > bestHit) { bestHit = hit; headerRow = i; }
        }
        const headers = (aoa[headerRow] || []).map((h) => String(h ?? "").trim());
        const nHeaders = headers.map(norm);
        const used = new Set<number>();
        const mapped = config.cols.map((col) => {
          let idx = nHeaders.findIndex((h, i) => !used.has(i) && col.aliases.some((a) => h === norm(a)));
          if (idx < 0) idx = nHeaders.findIndex((h, i) => !used.has(i) && h && col.aliases.some((a) => h.includes(norm(a))));
          if (idx >= 0) used.add(idx);
          return { col, header: idx >= 0 ? headers[idx] : null, idx };
        });
        const extraHeaders = headers.filter((_, i) => !used.has(i) && headers[i]);
        const hiddenHeaders = headers.filter((h, i) => h && hiddenColIdx.has(i));
        const missingRequired = mapped.filter((m) => m.col.required && m.header === null).map((m) => m.col.label);

        const okRows: SheetResult["okRows"] = []; const errors: SheetResult["errors"] = [];
        let newCount = 0, updateCount = 0;
        const existSet = existing[config.canonical] || new Set<string>();
        const fileSeen = new Set<string>();
        const bodyStart = headerRow + 1;

        for (let r = bodyStart; r < aoa.length; r++) {
          const line = aoa[r] || [];
          if (line.every((c) => c === null || String(c).trim() === "")) continue;
          const excelRow = r + 1;
          const row: ExamRow = {}; const criteria: Record<string, unknown> = {}; const reasons: string[] = [];

          for (const m of mapped) {
            if (m.idx < 0) continue;
            const addr = XLSX.utils.encode_cell({ r, c: m.idx });
            if (errCells.has(addr)) { reasons.push(`${m.col.label} 오류값(${errCells.get(addr)})`); continue; } // #REF!/#N/A/#VALUE!
            const raw = line[m.idx];
            if (m.col.type === "ref") {
              const s = String(raw ?? "").trim();
              if (!s) { row[m.col.key] = null; continue; }
              const id = mapRefTo(m.col.refTable as string, s);
              if (!id) { if (m.col.refErrorOnMiss) reasons.push(`존재하지 않는 ${m.col.mapPartToProcess ? "공정(파트)" : m.col.label}: ${s}`); row[m.col.key] = null; continue; }
              row[m.col.key] = id;
            } else if (m.col.type === "date") {
              if (!isValidDate(raw)) { reasons.push(`${m.col.label} 날짜형식 오류`); continue; }
              row[m.col.key] = ymd(raw);
            } else if (m.col.type === "text") {
              row[m.col.key] = cellText(r, m.idx) ?? toStr(raw); // 사번 등: 표시 문자열 우선(선행 0 보존)
            } else {
              row[m.col.key] = m.col.type === "number" ? toNum(raw) : m.col.type === "bool" ? toBool(raw) : toStr(raw);
            }
          }

          if (config.mode === "rules") {
            headers.forEach((h, i) => { if (h && !used.has(i)) { const cv = toStr(line[i]) ?? toNum(line[i]); if (cv !== null) criteria[h] = cv; } });
            mapped.forEach((m) => { if (m.idx >= 0 && m.header) { const cv = line[m.idx]; if (cv !== null && cv !== "") criteria[m.header] = m.col.type === "date" ? ymd(cv) : (m.col.type === "number" ? toNum(cv) : toStr(cv)); } });
            row.rule_type = config.canonical; row.criteria = criteria as never;
            if (Object.keys(criteria).length === 0) { errors.push({ row: excelRow, reason: "빈 기준 행" }); continue; }
          }

          const missVal = config.cols.filter((c) => c.required && (row[c.key] === null || row[c.key] === undefined || row[c.key] === "")).map((c) => c.label);
          if (missVal.length) { errors.push({ row: excelRow, reason: `필수값 누락: ${missVal.join(", ")}` }); continue; }
          if (reasons.length) { errors.push({ row: excelRow, reason: reasons.join(" / ") }); continue; }

          // 신규/수정/중복(사번 등) 판정
          if (config.dedup.length) {
            const k = config.dedup.map((key) => String(row[key] ?? "")).join("|");
            if (fileSeen.has(k)) { errors.push({ row: excelRow, reason: `중복(${config.dedup.join("+")}): ${k}` }); continue; }
            fileSeen.add(k);
            if (existSet.has(k)) { updateCount++; okRows.push({ ...row, _status: "update" }); }
            else { newCount++; okRows.push({ ...row, _status: "new" }); }
          } else {
            newCount++; okRows.push({ ...row, _status: "new" }); // 기준(rules) 등 dedup 없음 → 신규 취급
          }
        }
        out.push({ sheetName, config, mapped: mapped.map((m) => ({ col: m.col, header: m.header })), hiddenHeaders, missingRequired, okRows, newCount, updateCount, errors, total: Math.max(0, aoa.length - bodyStart), extraHeaders });
      }
      setResults(out);
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석에 실패했습니다."); }
    finally { setAnalyzing(false); }
  }, [tenantId, loadRefs]);

  const reset = () => { setFileName(""); setResults([]); setError(null); setExpanded(new Set()); setNoRequiredSheet(false); setPersonnelApplied(false); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (file?: File) => { if (!file) return; setPersonnelApplied(false); setFileName(file.name); void analyze(file); };

  // 검증 완료 boolean 판정(single_job/m1~ 은 미리보기에서 toBool 처리됨).
  const truthy = (v: unknown) => v === true;
  // 인증 Level 자동 계산: Single~M4 연속 취득 최상위 + D.M. (엑셀 값이 있으면 그 값 우선)
  const computeLadder = (row: ExamRow) => {
    const ladder: Array<[string, string]> = [["single_job", "Single"], ["m1", "M1"], ["m2", "M2"], ["m3", "M3"], ["m4", "M4"]];
    let pm = ""; for (const [k, label] of ladder) { if (truthy(row[k])) pm = label; else break; }
    const cert = truthy(row.dm) ? (pm ? `${pm}+D.M` : "D.M") : pm;
    return { pm, cert };
  };

  const personnelResult = results.find((r) => r.config?.table === "exam_personnel");

  // 관리자 승인 후 인력현황만 동기화(사번 기준 신규/수정/변경없음, 부분 실패 허용).
  const applyPersonnel = async () => {
    if (syncing || !personnelResult || personnelResult.okRows.length === 0) return;
    setSyncing(true); setError(null);
    try {
      await loadRefs(["exam_processes"]); // 공정 매핑용
      const perms: MyExamPermissions = await loadMyExamPermissions(tenantId);
      const canWrite = (pid: string | null | undefined, action: "create" | "update") => perms.can(pid ?? null, action);

      const prepared: ExamRow[] = personnelResult.okRows.map((row) => {
        const r: ExamRow = { ...row };
        delete (r as { _status?: unknown })._status;
        // 공정 자동 매핑: 파트(텍스트) → exam_processes id (미매칭 시 null)
        r.process_id = r.part_name ? mapRefTo("exam_processes", r.part_name) : null;
        // PM Level(엑셀 우선, 없으면 자동), 인증 Level 자동 계산(없으면)
        const { pm, cert } = computeLadder(r);
        if (String(r.current_pm_level ?? "").trim() === "" && pm) r.current_pm_level = pm;
        if (String(r.cert_level ?? "").trim() === "" && cert) r.cert_level = cert;
        return r;
      });

      const res = await syncExamPersonnel(prepared, tenantId, userId, canWrite);
      setPersonnelApplied(true);
      onToast?.(`총 ${res.total}건 중 신규 ${res.newCount}건, 수정 ${res.updateCount}건, 변경 없음 ${res.unchangedCount}건, 오류 ${res.errors.length}건입니다.`);
      onDataChanged?.(); // 인력현황만 최소 재조회 신호
    } catch (e) {
      setError((e as { message?: string })?.message || "인력현황 동기화에 실패했습니다.");
    } finally { setSyncing(false); }
  };

  // 오류 행 다운로드(전체 시트 통합, .xlsx)
  const downloadErrors = () => {
    const rows: (string | number)[][] = [["시트", "엑셀행", "오류사유"]];
    results.forEach((res) => res.errors.forEach((e) => rows.push([res.sheetName, e.row > 0 ? e.row : "-", e.reason])));
    if (rows.length === 1) return;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "오류행");
    XLSX.writeFile(wb, `시험관리_가져오기_오류_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const recognized = results.filter((r) => r.config);
  const sumNew = recognized.reduce((a, r) => a + r.newCount, 0);
  const sumUpd = recognized.reduce((a, r) => a + r.updateCount, 0);
  const sumErr = recognized.reduce((a, r) => a + r.errors.length, 0);

  const section = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const badge = (t: string, tone: string) => <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tone}`}>{t}</span>;

  return (
    <div className="space-y-5">
      <section className={section}>
        <div className="mb-4"><h2 className="text-lg font-semibold">Excel 가져오기</h2><p className="text-sm text-slate-500">Excel 을 업로드하면 시트 자동 인식·매핑·검증 후 <b>미리보기</b>까지 제공합니다. (이번 단계는 저장하지 않습니다 · 수식 결과값만 사용)</p></div>

        {!ready && <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">Supabase 연결이 필요합니다.</div>}

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (canEdit) pick(e.dataTransfer.files?.[0]); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center ${darkMode ? "border-slate-700 hover:bg-slate-950" : "border-slate-300 hover:bg-slate-50"} ${!canEdit ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span className="text-3xl">📄</span>
          <span className="text-sm font-medium">{fileName || "Excel 파일을 선택하거나 여기로 끌어다 놓으세요"}</span>
          <span className="text-xs text-slate-400">.xlsx / .xls · 지원 시트: 년간목표 · 인증현황(요약) · 인력현황 · 응시데이터 · 달성/취득기준 · D.M인증 · D.M 월간 실적</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={!canEdit} onChange={(e) => pick(e.target.files?.[0] || undefined)} />
        </label>

        {fileName && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{fileName}</span>
            <button className={btn} onClick={reset}>초기화</button>
            {analyzing && <span className="text-xs text-slate-500">분석 중…</span>}
          </div>
        )}
        {noRequiredSheet && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">인식된 지원 시트가 없습니다. (필수 시트 없음)</div>}
        {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      </section>

      {results.length > 0 && (
        <section className={section}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-base font-semibold">분석 결과 (미리보기)</h3><p className="text-xs text-slate-500">인식 {recognized.length}개 시트 · 저장 없음</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {badge(`신규 ${sumNew}`, "bg-emerald-100 text-emerald-700")}
              {badge(`수정 ${sumUpd}`, "bg-sky-100 text-sky-700")}
              {badge(`오류 ${sumErr}`, "bg-rose-100 text-rose-700")}
              {sumErr > 0 && <button className={btn} onClick={downloadErrors}>오류 행 다운로드</button>}
            </div>
          </div>

          <div className="space-y-3">
            {results.map((res) => {
              const key = res.sheetName; const open = expanded.has(key);
              const unsupported = !res.config;
              const summaryOnly = res.config && !res.config.table;
              const blocked = res.config && res.config.table && res.missingRequired.length > 0;
              return (
                <div key={key} className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button className="text-sm font-semibold hover:underline" onClick={() => setExpanded((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; })}>
                        {open ? "▾" : "▸"} {res.sheetName}
                      </button>
                      {unsupported ? badge("미지원(건너뜀)", "bg-slate-200 text-slate-500")
                        : summaryOnly ? badge("분석전용", "bg-indigo-100 text-indigo-700")
                          : blocked ? badge("필수컬럼 누락", "bg-rose-100 text-rose-700")
                            : badge(`→ ${res.config!.canonical}`, "bg-blue-100 text-blue-700")}
                    </div>
                    {res.config && !unsupported && (
                      <div className="flex gap-1.5">
                        {badge(`신규 ${res.newCount}`, "bg-emerald-100 text-emerald-700")}
                        {badge(`수정 ${res.updateCount}`, "bg-sky-100 text-sky-700")}
                        {badge(`오류 ${res.errors.length}`, "bg-rose-100 text-rose-700")}
                      </div>
                    )}
                  </div>

                  {blocked && <div className="mt-2 text-xs text-rose-600">필수 컬럼을 찾지 못했습니다: {res.missingRequired.join(", ")}</div>}
                  {res.config?.note && <div className="mt-2 text-xs text-indigo-500">{res.config.note}</div>}
                  {res.hiddenHeaders.length > 0 && <div className="mt-2 text-[0.7rem] text-amber-600">숨김 열 포함됨: {res.hiddenHeaders.join(", ")}</div>}

                  {open && res.config && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-500">컬럼 매핑</div>
                        <div className="flex flex-wrap gap-1.5">
                          {res.mapped.map((m) => (
                            <span key={m.col.key} className={`rounded-lg px-2 py-1 text-[0.7rem] ${m.header ? (darkMode ? "bg-slate-800" : "bg-slate-100") : "bg-rose-50 text-rose-500"}`}>
                              {m.col.label}: {m.header ? `‹${m.header}›` : (m.col.required ? "누락(필수)" : "없음")}
                            </span>
                          ))}
                        </div>
                        {res.extraHeaders.length > 0 && <div className="mt-1 text-[0.7rem] text-slate-400">매핑 안 된 컬럼: {res.extraHeaders.join(", ")}{res.config.mode === "rules" ? " (기준 상세로 저장 예정)" : " (무시)"}</div>}
                      </div>
                      {res.errors.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-rose-500">오류 미리보기 ({res.errors.length}건)</div>
                          <div className={`max-h-40 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            {res.errors.slice(0, 50).map((e, i) => <div key={i} className="py-0.5">{e.row > 0 ? `${e.row}행` : "-"}: {e.reason}</div>)}
                            {res.errors.length > 50 && <div className="py-0.5 text-slate-400">…외 {res.errors.length - 50}건</div>}
                          </div>
                        </div>
                      )}
                      {res.okRows.length > 0 && res.config.table && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-emerald-600">정상 데이터 미리보기 (상위 5행)</div>
                          <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-left text-[0.7rem]">
                              <thead className={darkMode ? "bg-slate-800" : "bg-slate-100"}><tr><th className="px-2 py-1">구분</th>{res.mapped.filter((m) => m.header).slice(0, 7).map((m) => <th key={m.col.key} className="whitespace-nowrap px-2 py-1">{m.col.label}</th>)}</tr></thead>
                              <tbody>{res.okRows.slice(0, 5).map((row, i) => <tr key={i} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                                <td className="px-2 py-1">{row._status === "new" ? badge("신규", "bg-emerald-100 text-emerald-700") : badge("수정", "bg-sky-100 text-sky-700")}</td>
                                {res.mapped.filter((m) => m.header).slice(0, 7).map((m) => <td key={m.col.key} className="whitespace-nowrap px-2 py-1">{m.col.type === "ref" ? (row[m.col.key] ? "✓매핑" : "-") : String(row[m.col.key] ?? "-")}</td>)}
                              </tr>)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 인력현황 동기화(관리자 승인 후 저장) — 인력현황 시트에만 적용. 다른 시트는 미리보기 전용. */}
          {personnelResult && personnelResult.config?.table === "exam_personnel" && personnelResult.missingRequired.length === 0 && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="mb-2 text-sm font-semibold">인력현황 동기화 (사번 기준)</div>
              <div className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                변경 요약: 신규 <b>{personnelResult.newCount}</b>건 · 수정(변경분만) <b>{personnelResult.updateCount}</b>건 · 오류 <b>{personnelResult.errors.length}</b>건
                <span className="block mt-1 text-[0.7rem] text-slate-400">사번 기준 upsert · 빈값은 기존값 유지 · 퇴사=상태 변경(삭제 아님) · 변경 없음 행은 저장 생략 · 부분 실패 허용</span>
              </div>
              {canEdit ? (
                <button type="button" onClick={() => void applyPersonnel()} disabled={syncing || personnelApplied || personnelResult.okRows.length === 0}
                  className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${syncing || personnelApplied || personnelResult.okRows.length === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>
                  {personnelApplied ? "반영 완료" : syncing ? "동기화 중…" : `관리자 승인 후 인력현황 반영 (${personnelResult.okRows.length}건)`}
                </button>
              ) : <span className="text-xs text-slate-400">인력현황 반영 권한이 없습니다(조회 전용).</span>}
            </div>
          )}

          <div className="mt-4 border-t pt-4 text-xs text-slate-500 dark:border-slate-700">
            <b>인력현황 시트만</b> Supabase 동기화를 지원합니다(사번 기준). 나머지 시트는 미리보기 전용이며 다음 단계에서 저장을 연결합니다. (오류 행은 상단 “오류 행 다운로드”로 내려받을 수 있습니다.)
          </div>
        </section>
      )}
    </div>
  );
}
