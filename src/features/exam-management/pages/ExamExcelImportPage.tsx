import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  listExamRows, listExamRefOptions, upsertExamRow, writeExamAudit,
  writeImportJob, writeImportErrors, examSupabaseReady, type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";

type RefOpt = { id: string; label: string };
type CType = "text" | "number" | "date" | "bool" | "ref";
type MapCol = { key: string; label: string; aliases: string[]; type: CType; refTable?: ExamMasterTable; required?: boolean };
type SheetConfig = {
  canonical: string;               // 표준 시트명
  aliases: string[];               // 실제 시트 제목 후보
  table: ExamMasterTable | null;   // null = 분석 전용(저장 안 함)
  mode?: "rows" | "rules";         // rules = criteria jsonb 저장
  cols: MapCol[];
  dedup: string[];                 // 중복 식별 키
  note?: string;
};

// ── 값 변환(수식 결과값만 사용. 오류/병합/빈셀은 상위에서 null 처리) ──
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

const SHEET_CONFIGS: SheetConfig[] = [
  {
    canonical: CANON.annual, aliases: ["년간목표", "연간목표"], table: "exam_annual_targets", dedup: ["year", "group_name", "product_group", "part_name", "level_id"],
    cols: [
      { key: "year", label: "연도", aliases: ["연도", "년도", "year"], type: "number", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹", "group"], type: "text" },
      { key: "product_group", label: "제품군", aliases: ["제품군", "제품"], type: "text" },
      { key: "part_name", label: "파트", aliases: ["파트", "part"], type: "text" },
      { key: "level_id", label: "인증레벨", aliases: ["인증레벨", "레벨", "level"], type: "ref", refTable: "exam_levels" },
      { key: "current_count", label: "현재인원", aliases: ["현재인원", "현재", "현인원"], type: "number" },
      { key: "target_count", label: "목표인원", aliases: ["목표인원", "목표"], type: "number" },
      { key: "notes", label: "비고", aliases: ["비고", "remark"], type: "text" },
    ],
  },
  {
    canonical: CANON.summary, aliases: ["인증현황", "인증현황요약", "요약"], table: null, dedup: [],
    note: "요약(집계) 시트입니다. 분석/검증만 하며 DB에는 저장하지 않습니다(원본 산출 데이터 우선).",
    cols: [
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "part_name", label: "파트", aliases: ["파트"], type: "text" },
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
      { key: "part_name", label: "파트", aliases: ["파트"], type: "text" },
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
      { key: "product", label: "제품", aliases: ["제품", "제품군"], type: "text" },
      { key: "process", label: "공정", aliases: ["공정"], type: "text" },
      { key: "category_code", label: "구분코드", aliases: ["구분코드"], type: "text" },
      { key: "category", label: "구분", aliases: ["구분"], type: "text" },
      { key: "level_id", label: "인증단계", aliases: ["인증단계", "단계", "레벨"], type: "ref", refTable: "exam_levels" },
      { key: "equipment_id", label: "인증 설비", aliases: ["인증설비", "설비"], type: "ref", refTable: "exam_equipment" },
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
    canonical: CANON.monthly, aliases: ["dm월간실적", "d.m월간실적", "월간실적"], table: "exam_monthly_results", dedup: ["year", "group_name", "product_group", "part_name", "level_id"],
    cols: [
      { key: "year", label: "연도", aliases: ["연도", "년도"], type: "number", required: true },
      { key: "group_name", label: "그룹", aliases: ["그룹"], type: "text" },
      { key: "product_group", label: "제품군", aliases: ["제품군", "제품"], type: "text" },
      { key: "part_name", label: "파트", aliases: ["파트"], type: "text" },
      { key: "level_id", label: "인증레벨", aliases: ["인증레벨", "레벨"], type: "ref", refTable: "exam_levels" },
      ...Array.from({ length: 12 }, (_, i) => ({ key: `m${i + 1}`, label: `${i + 1}월`, aliases: [`${i + 1}월`, `m${i + 1}`], type: "number" as CType })),
      { key: "target_count", label: "목표", aliases: ["목표", "목표건수"], type: "number" },
      { key: "notes", label: "비고", aliases: ["비고"], type: "text" },
    ],
  },
  {
    canonical: CANON.achieve, aliases: ["달성기준"], table: "exam_rules", mode: "rules", dedup: [],
    cols: [
      { key: "level_id", label: "레벨", aliases: ["레벨", "인증레벨", "level"], type: "ref", refTable: "exam_levels" },
      { key: "effective_date", label: "기준일", aliases: ["기준일", "적용일"], type: "date" },
      { key: "notes", label: "비고", aliases: ["비고", "설명"], type: "text" },
    ],
  },
  {
    canonical: CANON.acquire, aliases: ["취득기준"], table: "exam_rules", mode: "rules", dedup: [],
    cols: [
      { key: "level_id", label: "레벨", aliases: ["레벨", "인증레벨", "level"], type: "ref", refTable: "exam_levels" },
      { key: "effective_date", label: "기준일", aliases: ["기준일", "적용일"], type: "date" },
      { key: "notes", label: "비고", aliases: ["비고", "설명"], type: "text" },
    ],
  },
];

const findConfig = (sheetName: string): SheetConfig | null => {
  const n = norm(sheetName);
  return SHEET_CONFIGS.find((c) => norm(c.canonical) === n || c.aliases.some((a) => norm(a) === n || n.includes(norm(a)))) || null;
};
const convert = (col: MapCol, v: unknown) => col.type === "number" ? toNum(v) : col.type === "date" ? ymd(v) : col.type === "bool" ? toBool(v) : toStr(v);

type SheetResult = {
  sheetName: string; config: SheetConfig | null;
  mapped: Array<{ col: MapCol; header: string | null }>;
  missingRequired: string[];
  okRows: ExamRow[]; dup: number;
  errors: Array<{ row: number; column?: string; reason: string }>;
  total: number; extraHeaders: string[];
};

export default function ExamExcelImportPage({ darkMode, canEdit, tenantId, userId, onToast }: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (m: string) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SheetResult[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const refMaps = useRef<Record<string, RefOpt[]>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [ready, setReady] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setReady(examSupabaseReady()); }, []);

  const loadRefs = useCallback(async (tables: ExamMasterTable[]) => {
    for (const t of tables) if (!refMaps.current[t]) { try { refMaps.current[t] = await listExamRefOptions(t, tenantId); } catch { refMaps.current[t] = []; } }
  }, [tenantId]);
  const mapRef = (col: MapCol, v: unknown): string | null => {
    const s = String(v ?? "").trim(); if (!s) return null;
    const opts = refMaps.current[col.refTable as string] || [];
    const hit = opts.find((o) => o.label === s || o.label.split("·").some((p) => p.trim() === s) || o.label.includes(s));
    return hit ? hit.id : null;
  };

  const analyze = useCallback(async (file: File) => {
    setError(null); setResults([]); setApplied(false); setExpanded(new Set()); setAnalyzing(true);
    try {
      if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); return; }
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const configsUsed = Array.from(new Set(wb.SheetNames.map(findConfig).filter(Boolean) as SheetConfig[]));
      const refTables = Array.from(new Set(configsUsed.flatMap((c) => c.cols.filter((k) => k.type === "ref").map((k) => k.refTable as ExamMasterTable))));
      await loadRefs(refTables);
      // 중복 검증용 기존 데이터 키셋 로드
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
        // 오류셀(#REF! 등)을 null 로 무력화(수식 결과값만, 오류는 안전 처리)
        Object.keys(ws).forEach((addr) => { if (addr[0] === "!") return; const cell = ws[addr] as XLSX.CellObject; if (cell && cell.t === "e") { cell.t = "s"; cell.v = null as never; cell.w = ""; } });
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
        if (!config) { out.push({ sheetName, config: null, mapped: [], missingRequired: [], okRows: [], dup: 0, errors: [], total: 0, extraHeaders: [] }); continue; }

        // 헤더 행 탐색(설정 별칭이 가장 많이 매칭되는 상위 5행 중 선택)
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
          let idx = nHeaders.findIndex((h, i) => !used.has(i) && col.aliases.some((a) => h === norm(a)));           // 정확 매칭 우선
          if (idx < 0) idx = nHeaders.findIndex((h, i) => !used.has(i) && h && col.aliases.some((a) => h.includes(norm(a)))); // 부분 매칭
          if (idx >= 0) used.add(idx);
          return { col, header: idx >= 0 ? headers[idx] : null, idx };
        });
        const extraHeaders = headers.filter((_, i) => !used.has(i) && headers[i]);
        const missingRequired = mapped.filter((m) => m.col.required && m.header === null).map((m) => m.col.label);

        const okRows: ExamRow[] = []; const errors: SheetResult["errors"] = []; let dup = 0;
        const seen = new Set<string>(existing[config.canonical] ? Array.from(existing[config.canonical]) : []);
        const bodyStart = headerRow + 1;
        for (let r = bodyStart; r < aoa.length; r++) {
          const line = aoa[r] || [];
          if (line.every((c) => c === null || String(c).trim() === "")) continue; // 빈 행 skip
          const excelRow = r + 1;
          const row: ExamRow = {}; const criteria: Record<string, unknown> = {}; const reasons: string[] = [];
          for (const m of mapped) {
            if (m.idx < 0) continue;
            const raw = line[m.idx];
            if (m.col.type === "date" && !isValidDate(raw)) { reasons.push(`${m.col.label} 날짜형식 오류`); continue; }
            const val = m.col.type === "ref" ? mapRef(m.col, raw) : convert(m.col, raw);
            if (config.mode === "rules") { if (m.col.type === "ref" || m.col.key === "effective_date" || m.col.key === "notes") row[m.col.key] = val; }
            else row[m.col.key] = val;
          }
          if (config.mode === "rules") {
            headers.forEach((h, i) => { if (h && !used.has(i)) { const cv = toStr(line[i]) ?? toNum(line[i]); if (cv !== null) criteria[h] = cv; } });
            mapped.forEach((m) => { if (m.idx >= 0 && m.header) { const cv = line[m.idx]; if (cv !== null && cv !== "") criteria[m.header] = m.col.type === "date" ? ymd(cv) : (m.col.type === "number" ? toNum(cv) : toStr(cv)); } });
            row.rule_type = config.canonical; row.criteria = criteria as never;
            if (Object.keys(criteria).length === 0) { errors.push({ row: excelRow, reason: "빈 기준 행" }); continue; }
          }
          // 필수값 검증
          const missVal = config.cols.filter((c) => c.required && (row[c.key] === null || row[c.key] === undefined || row[c.key] === "")).map((c) => c.label);
          if (missVal.length) { errors.push({ row: excelRow, reason: `필수값 누락: ${missVal.join(", ")}` }); continue; }
          if (reasons.length) { errors.push({ row: excelRow, reason: reasons.join(" / ") }); continue; }
          // 중복 검증
          if (config.dedup.length) {
            const k = config.dedup.map((key) => String(row[key] ?? "")).join("|");
            if (seen.has(k)) { dup++; continue; }
            seen.add(k);
          } else if (config.mode === "rules") {
            const k = JSON.stringify(criteria); if (seen.has(k)) { dup++; continue; } seen.add(k);
          }
          okRows.push(row);
        }
        out.push({ sheetName, config, mapped: mapped.map((m) => ({ col: m.col, header: m.header })), missingRequired, okRows, dup, errors, total: Math.max(0, aoa.length - bodyStart), extraHeaders });
      }
      setResults(out);
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석에 실패했습니다."); }
    finally { setAnalyzing(false); }
  }, [tenantId, loadRefs]);

  const applyAll = async () => {
    setApplying(true); setError(null);
    try {
      let totalOk = 0, totalErr = 0, totalDup = 0;
      for (const res of results) {
        if (!res.config || !res.config.table || res.missingRequired.length) continue;
        const table = res.config.table; let success = 0;
        for (const row of res.okRows) {
          try { const saved = await upsertExamRow(table, row, tenantId, userId); await writeExamAudit(tenantId, userId, table, String(saved.id), "import", null, saved, `Excel 가져오기: ${res.sheetName}`); success++; }
          catch (e) { res.errors.push({ row: -1, reason: (e as { message?: string })?.message || "저장 실패" }); }
        }
        totalOk += success; totalErr += res.errors.length; totalDup += res.dup;
        const jobId = await writeImportJob(tenantId, userId, fileName, table, res.total, success, res.errors.length);
        if (jobId) await writeImportErrors(tenantId, userId, jobId, res.errors.map((e) => ({ row: e.row, column: e.column, message: e.reason })));
      }
      setApplied(true);
      onToast?.(`반영 완료 · 정상 ${totalOk}건 · 중복 ${totalDup}건 · 오류 ${totalErr}건`);
    } catch (e) { setError((e as { message?: string })?.message || "반영 중 오류가 발생했습니다."); }
    finally { setApplying(false); }
  };

  const reset = () => { setFileName(""); setResults([]); setError(null); setApplied(false); setExpanded(new Set()); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (file?: File) => { if (!file) return; setFileName(file.name); void analyze(file); };

  const recognized = results.filter((r) => r.config);
  const importable = recognized.filter((r) => r.config?.table && r.missingRequired.length === 0);
  const sumOk = importable.reduce((a, r) => a + r.okRows.length, 0);
  const sumDup = recognized.reduce((a, r) => a + r.dup, 0);
  const sumErr = recognized.reduce((a, r) => a + r.errors.length, 0);

  const section = `rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`;
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const badge = (t: string, tone: string) => <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tone}`}>{t}</span>;

  return (
    <div className="space-y-5">
      <section className={section}>
        <div className="mb-4"><h2 className="text-lg font-semibold">Excel 가져오기</h2><p className="text-sm text-slate-500">기존 시험관리 Excel 파일을 업로드하면 시트를 자동 인식·매핑하여 반영합니다. (2016~365 호환, 수식 결과값만 사용)</p></div>

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
        {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      </section>

      {results.length > 0 && (
        <section className={section}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-base font-semibold">분석 결과</h3><p className="text-xs text-slate-500">인식 {recognized.length} · 반영대상 {importable.length}개 시트</p></div>
            <div className="flex flex-wrap gap-2">
              {badge(`정상 ${sumOk}`, "bg-emerald-100 text-emerald-700")}
              {badge(`중복 ${sumDup}`, "bg-amber-100 text-amber-700")}
              {badge(`오류 ${sumErr}`, "bg-rose-100 text-rose-700")}
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
                        {badge(`정상 ${res.okRows.length}`, "bg-emerald-100 text-emerald-700")}
                        {badge(`중복 ${res.dup}`, "bg-amber-100 text-amber-700")}
                        {badge(`오류 ${res.errors.length}`, "bg-rose-100 text-rose-700")}
                      </div>
                    )}
                  </div>

                  {blocked && <div className="mt-2 text-xs text-rose-600">필수 컬럼을 찾지 못해 이 시트는 반영되지 않습니다: {res.missingRequired.join(", ")}</div>}
                  {res.config?.note && <div className="mt-2 text-xs text-indigo-500">{res.config.note}</div>}

                  {open && res.config && (
                    <div className="mt-3 space-y-3">
                      {/* 컬럼 매핑 */}
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-500">컬럼 매핑</div>
                        <div className="flex flex-wrap gap-1.5">
                          {res.mapped.map((m) => (
                            <span key={m.col.key} className={`rounded-lg px-2 py-1 text-[0.7rem] ${m.header ? (darkMode ? "bg-slate-800" : "bg-slate-100") : "bg-rose-50 text-rose-500"}`}>
                              {m.col.label}: {m.header ? `‹${m.header}›` : (m.col.required ? "누락(필수)" : "없음")}
                            </span>
                          ))}
                        </div>
                        {res.extraHeaders.length > 0 && <div className="mt-1 text-[0.7rem] text-slate-400">매핑 안 된 컬럼: {res.extraHeaders.join(", ")}{res.config.mode === "rules" ? " (기준 상세로 저장)" : " (무시)"}</div>}
                      </div>
                      {/* 오류 미리보기 */}
                      {res.errors.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-rose-500">오류 미리보기 ({res.errors.length}건)</div>
                          <div className={`max-h-40 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            {res.errors.slice(0, 50).map((e, i) => <div key={i} className="py-0.5">{e.row > 0 ? `${e.row}행` : "저장"}: {e.reason}</div>)}
                            {res.errors.length > 50 && <div className="py-0.5 text-slate-400">…외 {res.errors.length - 50}건</div>}
                          </div>
                        </div>
                      )}
                      {/* 정상 데이터 샘플 */}
                      {res.okRows.length > 0 && res.config.table && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-emerald-600">정상 데이터 미리보기 (상위 5행)</div>
                          <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-left text-[0.7rem]">
                              <thead className={darkMode ? "bg-slate-800" : "bg-slate-100"}><tr>{res.mapped.filter((m) => m.header).slice(0, 8).map((m) => <th key={m.col.key} className="whitespace-nowrap px-2 py-1">{m.col.label}</th>)}</tr></thead>
                              <tbody>{res.okRows.slice(0, 5).map((row, i) => <tr key={i} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>{res.mapped.filter((m) => m.header).slice(0, 8).map((m) => <td key={m.col.key} className="whitespace-nowrap px-2 py-1">{m.col.type === "ref" ? (row[m.col.key] ? "✓매핑" : "-") : String(row[m.col.key] ?? "-")}</td>)}</tr>)}</tbody>
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

          {/* 최종 반영(관리자) */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 dark:border-slate-700">
            <div className="text-xs text-slate-500">
              {applied ? "반영이 완료되었습니다." : `반영 시 ${importable.length}개 시트의 정상 ${sumOk}건이 등록됩니다. (중복/오류 제외, 오류 행은 정상 행 반영에 영향 없음)`}
            </div>
            {canEdit ? (
              <button
                onClick={() => void applyAll()}
                disabled={applying || applied || sumOk === 0}
                className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${applying || applied || sumOk === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}
              >
                {applied ? "반영 완료" : applying ? "반영 중…" : `관리자 최종 반영 (${sumOk}건)`}
              </button>
            ) : <span className="text-xs text-slate-400">반영 권한이 없습니다(조회 전용).</span>}
          </div>
        </section>
      )}
    </div>
  );
}
