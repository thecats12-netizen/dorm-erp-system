import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import {
  listExamRows, listExamRefOptions, upsertExamRow, softDeleteExamRow,
  writeExamAudit, listExamAudit, isDuplicateApplication, examSupabaseReady,
  type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";
import { calculateExamStatus, calculateCertificationStatus, isCertificationApproved, resolveAcquisitionTiming, resolvePmLevel, resolveDmLevel, extractTimingMonths, PM_STAGES, buildExamCandidates, type ExamCandidate } from "../services/examAutomationService";
import { loadMyExamPermissions, type MyExamPermissions } from "../services/examPermissionService";
// [4단계] 공통 사원선택 + 라이선스 요약(조회 전용, 추가 UI). 기존 사번 select/필드/저장은 그대로 유지.
import EmployeeSelector from "../components/EmployeeSelector";
import { loadEmployeeAutofill } from "../services/employeeAutofillService";
import type { EmployeeLite, EmployeeAutofill } from "../types/employeeLookup";

type RefOpt = { id: string; label: string };
type ColType = "text" | "date" | "number" | "select" | "ref" | "cert";
type Col = { key: string; label: string; type: ColType; options?: string[]; refTable?: ExamMasterTable; required?: boolean; filter?: boolean; hideable?: boolean };

// 응시 상태(개발용 코드값 노출 금지 — 한글 라벨만 저장/표시)
//  후보/승인대기 = 자동 후보→관리자 승인 흐름, 연기 = 일정 보류. (미취득/재응시는 기존 데이터 호환 유지)
const STATUS_OPTIONS = ["후보", "승인대기", "예정", "필기 진행", "필기 합격", "필기 불합격", "실기 진행", "실기 합격", "실기 불합격", "인증 취득", "연기", "미취득", "취소", "재응시"];
const TIMING_OPTIONS = ["조기취득", "정상취득", "지연취득"];
const PAGE_SIZE = 20;

const ymd = (v: unknown) => {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return s.slice(0, 10);
};
const isValidDateCell = (v: unknown) => { const s = ymd(v); return s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s); };

// 표시/필터/폼 컬럼 정의
const COLS: Col[] = [
  { key: "seq_no", label: "연번", type: "number", hideable: true },
  { key: "employee_no", label: "사원번호", type: "text", required: true },
  { key: "name", label: "성명", type: "text", required: true },
  { key: "group_name", label: "그룹", type: "text", filter: true },
  { key: "product", label: "제품", type: "text", filter: true },
  { key: "process", label: "공정", type: "text", filter: true },
  { key: "category_code", label: "구분코드", type: "text" },
  { key: "category", label: "구분", type: "text", hideable: true },
  { key: "level_id", label: "인증단계", type: "ref", refTable: "exam_levels", filter: true },
  { key: "equipment_id", label: "인증 설비", type: "ref", refTable: "exam_equipment", filter: true },
  { key: "status", label: "응시상태", type: "select", options: STATUS_OPTIONS, filter: true },
  { key: "written_exam_date", label: "필기 진행일", type: "date" },
  { key: "written_pass_date", label: "필기 합격일", type: "date" },
  { key: "practical_acquire_date", label: "실기 취득일", type: "date" },
  { key: "practical_pass_date", label: "실기 합격일", type: "date" },
  { key: "cert_acquired_date", label: "인증 취득일", type: "date", hideable: true },
  { key: "cert_status", label: "인증취득여부", type: "cert", filter: true },
  { key: "timing_status", label: "조기/지연취득", type: "select", options: TIMING_OPTIONS, filter: true },
  { key: "pm_level", label: "PM Level", type: "text", filter: true },
  { key: "dm_process", label: "D.M 공정", type: "text", filter: true, hideable: true },
  { key: "notes", label: "비고", type: "text", hideable: true },
];
const FILTERS = COLS.filter((c) => c.filter);

// 사번(연명부) 선택 시 응시 필드 ← 인력(exam_personnel) 필드 자동입력 매핑.
const PERSONNEL_AUTOFILL: Array<{ app: string; person: string }> = [
  { app: "name", person: "name" },                 // 성명
  { app: "group_name", person: "group_name" },     // 그룹
  { app: "product", person: "product_group" },     // 제품(← 제품군)
  { app: "process", person: "part_name" },         // 공정(← 연명부 파트/공정 표기)
  { app: "pm_level", person: "current_pm_level" }, // PM Level
  { app: "category_code", person: "category_code" }, // 구분코드(인력에 있으면)
  { app: "category", person: "category" },           // 구분(인력에 있으면)
];
// 사번 기준 자동입력 → 사용자가 직접 입력하지 않는(읽기전용) 식별 필드.
const AUTO_READONLY = new Set(["name", "group_name", "product", "process", "pm_level"]);

// 연명부 단계 플래그(Single/M1~M4/D.M 등)의 보유 여부(느슨한 텍스트 판정).
const truthyFlag = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return !!s && !["0", "false", "n", "no", "x", "-", "없음", "미이수", "불필요"].includes(s);
};
// 재직여부: 값이 없으면 통과(미기재), 있으면 "재직" 포함만 재직으로 본다.
const isEmployed = (v: unknown): boolean => { const s = String(v ?? "").trim(); return s === "" || /재직/.test(s); };

// 자동계산 응시상태(AutoExamStatus, 공백 없음) → 저장 라벨(STATUS_OPTIONS, 공백 포함) 매핑.
const AUTO_STATUS_MAP: Record<string, string> = {
  "인증취득": "인증 취득", "실기합격": "실기 합격", "실기불합격": "실기 불합격", "실기진행": "실기 진행",
  "필기합격": "필기 합격", "필기불합격": "필기 불합격", "필기진행": "필기 진행",
  "응시예정": "예정", "미등록": "예정", "취소": "취소", "재응시": "재응시",
};

// 인증취득여부: 수동 확정값 우선, 아니면 실기 합격일 존재 시 "취득"(자동계산).
const certOf = (r: ExamRow): "취득" | "미취득" => {
  if (r.cert_status_manual && (r.cert_status === "취득" || r.cert_status === "미취득")) return r.cert_status as "취득" | "미취득";
  return r.practical_pass_date ? "취득" : "미취득";
};

export default function ExamApplicationsPage({
  darkMode, canEdit, tenantId, userId, onToast, refreshKey,
}: {
  darkMode: boolean; canEdit: boolean; tenantId: string; userId: string; onToast?: (msg: string) => void; refreshKey?: number;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [refMap, setRefMap] = useState<Record<string, RefOpt[]>>({});
  const [rules, setRules] = useState<ExamRow[]>([]); // exam_rules(인증취득 요건 검증용)
  const [personnel, setPersonnel] = useState<ExamRow[]>([]);       // exam_personnel(사번 선택/자동입력용)
  const [equipmentRows, setEquipmentRows] = useState<ExamRow[]>([]); // exam_equipment(인증단계별 설비 필터용 — process_id 보유)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [yearF, setYearF] = useState("전체");
  const [monthF, setMonthF] = useState("전체");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pinFirst, setPinFirst] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [autofill, setAutofill] = useState<EmployeeAutofill | null>(null); // [4단계] 라이선스 요약(읽기전용)
  const [detailRow, setDetailRow] = useState<ExamRow | null>(null);
  const [historyRow, setHistoryRow] = useState<ExamRow | null>(null);
  const [historyList, setHistoryList] = useState<ExamRow[]>([]);
  const [importPreview, setImportPreview] = useState<{ okRows: ExamRow[]; dup: number; err: Array<{ row: number; reason: string }> } | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // 응시 후보 자동계산
  const [showCand, setShowCand] = useState(false);
  const [cands, setCands] = useState<ExamCandidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [candSel, setCandSel] = useState<Set<string>>(new Set());
  const [candApplying, setCandApplying] = useState(false);
  const candKey = (c: ExamCandidate) => `${c.employee_no}|${c.target_level}`;

  // 미저장 변경 보호 + 앱 공통 닫기(ESC·뒤로가기·최상위 우선) 연동.
  const [editBase, setEditBase] = useState("");
  const editKey = editRow ? String(editRow.id ?? "__new__") : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (editRow) setEditBase(JSON.stringify(editRow)); }, [editKey]);
  const editDirty = !!editRow && JSON.stringify(editRow) !== editBase;
  const requestCloseEdit = () => { if (saving) return; if (editDirty) setConfirmClose(true); else setEditRow(null); };
  const topClose = importPreview ? () => setImportPreview(null)
    : confirmClose ? undefined
      : historyRow ? () => setHistoryRow(null)
        : detailRow ? () => setDetailRow(null)
          : editRow ? requestCloseEdit
            : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const [activeIdx, setActiveIdx] = useState(-1);

  const refCols = useMemo(() => COLS.filter((c) => c.type === "ref"), []);
  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [data, refs, ruleRows, people, equip] = await Promise.all([
        listExamRows("exam_applications", tenantId),
        Promise.all(refCols.map(async (c) => [c.refTable as string, await listExamRefOptions(c.refTable as ExamMasterTable, tenantId)] as const)),
        listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]), // 인증취득 요건(없으면 기본값)
        listExamRows("exam_personnel", tenantId).catch(() => [] as ExamRow[]), // 사번 선택/자동입력
        listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]), // 인증단계별 설비 필터(process_id)
      ]);
      setRows(data); setRefMap(Object.fromEntries(refs)); setRules(ruleRows); setPersonnel(people); setEquipmentRows(equip);
    } catch (e) { setError((e as { message?: string })?.message || "불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [tenantId, refCols, refreshKey]);

  // 최초 로드(내부 비동기).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const refLabel = (c: Col, id: unknown) => (!id ? "-" : ((refMap[c.refTable as string] || []).find((o) => o.id === String(id))?.label || "-"));
  const cellText = (c: Col, r: ExamRow) => {
    if (c.type === "cert") return certOf(r);
    if (c.type === "ref") return refLabel(c, r[c.key]);
    const v = r[c.key];
    if (c.type === "date") return ymd(v) || "-";
    if (v === null || v === undefined || v === "") return "-";
    return String(v);
  };
  const rowMonth = (r: ExamRow) => ymd(r.written_exam_date || r.cert_acquired_date || r.practical_pass_date).slice(0, 7);

  // 사번(연명부) 선택 → 인력 정보 자동입력(성명/그룹/제품/공정/PM Level 등). 사용자 직접 입력 방지.
  const applyPersonnel = (empNo: string) => {
    const p = personnel.find((x) => String(x.employee_no ?? "") === empNo);
    setEditRow((f) => {
      const next: ExamRow = { ...(f || {}), employee_no: empNo };
      if (p) for (const { app, person } of PERSONNEL_AUTOFILL) {
        const v = p[person];
        if (v !== undefined && v !== null && v !== "") next[app] = v;
        else if (AUTO_READONLY.has(app)) next[app] = ""; // 인력값 없으면 식별 필드 비움(이전 사번 잔재 제거)
      }
      return next;
    });
  };

  // 선택된 인증단계(level_id)에 연결된 공정(process_id) 집합 — exam_rules 기준. 매핑 없으면 null(전체 설비 표시).
  const levelProcessIds = useMemo(() => {
    const lvl = String(editRow?.level_id ?? "");
    if (!lvl) return null;
    const ids = new Set(rules.filter((r) => String(r.level_id ?? "") === lvl && r.process_id).map((r) => String(r.process_id)));
    return ids.size ? ids : null;
  }, [editRow?.level_id, rules]);

  // 인증 설비 드롭다운 옵션 — 인증단계 선택 시 해당 공정의 설비만, 미선택/매핑없음이면 전체 표시(폴백).
  const equipmentOptions = useMemo(() => {
    const all = refMap["exam_equipment"] || [];
    if (!levelProcessIds) return all;
    const allowed = new Set(equipmentRows.filter((e) => levelProcessIds.has(String(e.process_id ?? ""))).map((e) => String(e.id)));
    const cur = String(editRow?.equipment_id ?? ""); // 현재 선택값은 항상 보이도록(수정 시 유실 방지)
    return all.filter((o) => allowed.has(o.id) || o.id === cur);
  }, [refMap, levelProcessIds, equipmentRows, editRow?.equipment_id]);

  // 선택된 사번의 인력(연명부) 레코드 — 재직여부/기존 인증 단계/이력 요약 표시용.
  const selectedPerson = useMemo(
    () => personnel.find((p) => String(p.employee_no ?? "") === String(editRow?.employee_no ?? "")) || null,
    [personnel, editRow?.employee_no]
  );

  // [4단계] 공통 EmployeeSelector 표시값(선택된 연명부 → EmployeeLite). 기존 사번 select 와 동기화.
  const selectorValue = useMemo<EmployeeLite | null>(() => {
    const p = selectedPerson; if (!p) return null;
    return {
      id: String(p.id), employeeNo: String(p.employee_no ?? ""), name: String(p.name ?? ""),
      group: (p.group_name as string) ?? null, productFamily: (p.product_group as string) ?? null,
      part: (p.part_name as string) ?? null, processId: (p.process_id as string) ?? null,
      position: (p.position as string) ?? null,
      joinDate: p.hire_date ? String(p.hire_date).slice(0, 10) : null,
      employmentStatus: (p.employment_status as string) ?? null,
    };
  }, [selectedPerson]);

  // 사번(연명부) 변경 시 라이선스 요약 1회 로드(기존 사번 select/신규 EmployeeSelector 공용 · 중복조회 방지).
  useEffect(() => {
    const id = selectedPerson ? String(selectedPerson.id) : "";
    if (!id) { setAutofill(null); return; }
    let alive = true;
    loadEmployeeAutofill(id, tenantId).then((af) => { if (alive) setAutofill(af); }).catch(() => {});
    return () => { alive = false; };
  }, [selectedPerson, tenantId]);

  // 읽기전용 요약 셀(자동입력/추천 카드 공용).
  const sumItem = (label: string, val: string | number | null, danger?: boolean) => (
    <div className={`rounded-lg border px-2 py-1.5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
      <div className="text-[0.6rem] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm ${danger ? "font-semibold text-rose-600" : ""}`}>{val ?? "-"}</div>
    </div>
  );
  // 기존 인증 이력 요약(연명부 단계 플래그 기준).
  const certHistorySummary = useMemo(() => {
    const p = selectedPerson; if (!p) return "";
    const stages: Array<[string, string]> = [["single_job", "Single"], ["m1", "M1"], ["m2", "M2"], ["m3", "M3"], ["m4", "M4"], ["dm", "D.M"]];
    const held = stages.filter(([k]) => truthyFlag(p[k])).map(([, label]) => label);
    return held.length ? held.join(" · ") : "이력 없음";
  }, [selectedPerson]);

  // 인증단계(level_id) 선택 시 인증 기준관리(exam_rules) 기준 자동판정.
  const levelReq = useMemo(() => {
    const lvlId = String(editRow?.level_id ?? "");
    if (!lvlId) return null;
    const levelOpts = refMap["exam_levels"] || [];
    const levelName = levelOpts.find((o) => o.id === lvlId)?.label || "";
    const rule = rules.find((r) => String(r.level_id ?? "") === lvlId) || null;
    const prereqId = String(rule?.prerequisite_level_id ?? "");
    const prereqName = prereqId ? (levelOpts.find((o) => o.id === prereqId)?.label || "") : "";
    const p = selectedPerson;
    // 선행 충족: 선행 규칙 없으면 충족. 있으면 연명부 단계 플래그/현재 레벨 텍스트로 보유 확인.
    const holds = (name: string): boolean => {
      if (!name) return true; if (!p) return false;
      const ln = name.toLowerCase();
      const flagMap: Record<string, unknown> = { single: p.single_job, m1: p.m1, m2: p.m2, m3: p.m3, m4: p.m4, "d.m": p.dm, dm: p.dm };
      for (const [k, v] of Object.entries(flagMap)) if (ln.includes(k) && truthyFlag(v)) return true;
      const cur = `${p.current_pm_level ?? ""} ${p.cert_level ?? ""}`.toLowerCase();
      return cur.includes(ln);
    };
    const prereqMet = !prereqId || holds(prereqName);
    const employed = isEmployed(p?.employment_status);
    const requireWritten = rule?.require_written === true;
    const requirePractical = rule?.require_practical === true;
    const requiredEquip = Number(rule?.required_equipment_count) || 0;
    const validMonths = rule?.valid_months != null && rule.valid_months !== "" ? Number(rule.valid_months) : null;
    const autoPromote = rule?.auto_promote === true;
    const timingMonths = extractTimingMonths(rules, { level: lvlId });
    const isDm = /d\.?m|dual|multi|single\s*job|master/i.test(levelName);
    const idx = PM_STAGES.findIndex((s) => levelName.toLowerCase().replace(/\s+/g, "").includes(s.toLowerCase()));
    const nextPm = idx >= 0 && idx < PM_STAGES.length - 1 ? PM_STAGES[idx + 1] : (idx === PM_STAGES.length - 1 ? "최고 단계" : "-");
    return { levelName, hasRule: !!rule, prereqName, prereqMet, employed, requireWritten, requirePractical, requiredEquip, validMonths, autoPromote, timingMonths, isDm, expectedLevel: levelName, nextPm };
  }, [editRow?.level_id, rules, refMap, selectedPerson]);

  // 저장 시 자동계산(사용자가 직접 계산하지 않음): 진행 날짜 → 인증 취득일/취득여부/PM Level/D.M 공정.
  //  기존 자동화 함수(examAutomationService)와 화면 표시 규칙(certOf)을 그대로 재사용한다.
  const computeDerivedFields = (row: ExamRow): ExamRow => {
    const next: ExamRow = { ...row };
    // 인증 기준관리(exam_rules) — 선택 인증단계의 필기/실기 필요 여부(규칙 없으면 기존 규칙: 실기 합격 = 취득).
    const rule = rules.find((r) => String(r.level_id ?? "") === String(next.level_id ?? "")) || null;
    const requireWritten = rule?.require_written === true;
    const requirePractical = rule?.require_practical === true;
    const writtenPass = ymd(next.written_pass_date);
    const practicalPass = ymd(next.practical_pass_date);
    // 필기 필요 인증은 필기 합격일, 실기 필요 인증은 실기 합격일이 있어야 충족 → 모두 충족 시 취득.
    const writtenOk = requireWritten ? !!writtenPass : true;
    const practicalOk = requirePractical ? !!practicalPass : true;
    const acquired = rule ? (writtenOk && practicalOk && (!!writtenPass || !!practicalPass)) : !!practicalPass;

    // ① 인증취득여부: 관리자 수동 확정(cert_status_manual)이 우선, 아니면 규칙 기반 자동.
    if (next.cert_status_manual !== true) next.cert_status = acquired ? "취득" : "미취득";

    // ② 인증 취득일 = 가장 늦은 "필수 합격일"(비어 있을 때만 — 관리자 지정일/수동값 보존). 취득일 때만.
    if (!ymd(next.cert_acquired_date) && acquired) {
      const req: string[] = [];
      if ((requireWritten || !rule) && writtenPass) req.push(writtenPass);
      if ((requirePractical || !rule) && practicalPass) req.push(practicalPass);
      if (!req.length && practicalPass) req.push(practicalPass);
      if (req.length) next.cert_acquired_date = req.sort().slice(-1)[0]; // 가장 늦은 날짜
    }

    // ③ 응시상태: 비어 있거나 기본값("예정")일 때만 자동(날짜 기반). 사용자가 명시 선택한 상태(취소/재응시/불합격 등)는 보존.
    const curStatus = String(next.status ?? "").trim();
    if (curStatus === "" || curStatus === "예정") {
      const autoStatus = AUTO_STATUS_MAP[calculateExamStatus(next).value] ?? "";
      if (autoStatus) next.status = autoStatus;
    }

    // ④ 조기/지연취득: 비어 있을 때만 자동(수동 선택 보존). 취득일 때만 판정.
    if (acquired && !String(next.timing_status ?? "").trim()) {
      const t = resolveAcquisitionTiming(next, rules).value;
      if (t) next.timing_status = t;
    }

    // ⑤ PM Level(후보) / D.M 공정: 연결 인력(연명부) 기준 자동계산.
    //    불합격/미취득이면 취득 레벨을 변경하지 않고, 실제 PM Level 확정은 PM 인증관리 "승인" 시에만 반영(여기선 후보값).
    const person = personnel.find((x) => String(x.employee_no ?? "") === String(next.employee_no ?? ""));
    if (person) {
      if (acquired) { const pm = resolvePmLevel(person, undefined, rules); if (pm.value) next.pm_level = pm.value; }
      const dm = resolveDmLevel(person, undefined, rules);
      if (dm.value && dm.value !== "확인 필요") next.dm_process = dm.value;
    }
    return next;
  };

  const filterOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    FILTERS.forEach((c) => {
      if (c.type === "cert") { m[c.key] = ["취득", "미취득"]; return; }
      const vals = rows.map((r) => (c.type === "ref" ? refLabel(c, r[c.key]) : String(r[c.key] ?? ""))).filter((v) => v && v !== "-");
      m[c.key] = Array.from(new Set(vals)).sort();
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, refMap]);

  const years = useMemo(() => Array.from(new Set(rows.map((r) => rowMonth(r).slice(0, 4)).filter(Boolean))).sort().reverse(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      const ym = rowMonth(r);
      if (yearF !== "전체" && ym.slice(0, 4) !== yearF) return false;
      if (monthF !== "전체" && ym.slice(5, 7) !== monthF) return false;
      for (const c of FILTERS) {
        const f = filters[c.key]; if (!f || f === "전체") continue;
        const val = c.type === "cert" ? certOf(r) : (c.type === "ref" ? refLabel(c, r[c.key]) : String(r[c.key] ?? ""));
        if (val !== f) return false;
      }
      if (q) {
        const text = `${r.employee_no ?? ""} ${r.name ?? ""} ${r.category_code ?? ""} ${refLabel(COLS.find((c) => c.key === "equipment_id")!, r.equipment_id)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = COLS.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? "");
        const bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "-" && bv !== "-") return (an - bn) * dir;
        return String(av).localeCompare(String(bv), "ko") * dir;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filters, yearF, monthF, sortKey, sortDir, refMap]);

  const kpi = useMemo(() => {
    const byStatus = (s: string) => filtered.filter((r) => r.status === s).length;
    const acquired = filtered.filter((r) => certOf(r) === "취득").length;
    const total = filtered.length;
    return {
      total, pending: byStatus("승인대기"), w진행: byStatus("필기 진행"), w합격: byStatus("필기 합격"), s진행: byStatus("실기 진행"), s합격: byStatus("실기 합격"),
      acquired, notAcquired: total - acquired, re: byStatus("재응시"), rate: total ? Math.round((acquired / total) * 100) : 0,
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const paged = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const visibleCols = COLS.filter((c) => !hidden.has(c.key));

  const toggleSort = (k: string) => { if (sortKey !== k) { setSortKey(k); setSortDir("asc"); } else if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); setSortDir("asc"); } };
  const rowKey = (r: ExamRow) => String(r.id);
  const toggleSel = (k: string) => setSelected((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allPagedSel = paged.length > 0 && paged.every((r) => selected.has(rowKey(r)));

  const saveRow = async () => {
    if (!editRow) return;
    for (const c of COLS) if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    for (const c of COLS) if (c.type === "date" && !isValidDateCell(editRow[c.key])) { setError(`${c.label} 날짜 형식이 올바르지 않습니다.`); return; }
    // 선행 인증 미충족 시 저장 차단(인증 기준관리 규칙 기준). 브라우저 alert 미사용 — 오류 배너로 안내.
    if (levelReq && !levelReq.prereqMet) {
      setError(`선행 인증 단계(${levelReq.prereqName || "-"})가 충족되지 않아 저장할 수 없습니다. 선행 단계 취득 후 등록해주세요.`);
      return;
    }
    // 인증취득여부 수동 확정 시 사유 필수(변경 이력 기록용).
    const manualReason = String((editRow as { cert_status_manual_reason?: string }).cert_status_manual_reason ?? "").trim();
    if (editRow.cert_status_manual === true && !manualReason) {
      setError("인증취득여부를 수동 확정하려면 확정 사유를 입력해야 합니다.");
      return;
    }
    setSaving(true); setError(null);
    try {
      const empNo = String(editRow.employee_no ?? "").trim(), code = String(editRow.category_code ?? "").trim();
      if (code && await isDuplicateApplication(tenantId, empNo, code, editRow.id ? String(editRow.id) : undefined)) {
        setError(`이미 등록된 응시입니다(사원번호+구분코드 중복): ${empNo} / ${code}`); setSaving(false); return;
      }
      const isNew = !editRow.id;
      // [P1] 퇴사(퇴직) 사원의 "신규" 응시 등록 하드 차단(데이터 정합성). 기존 응시 수정/재직자·미확인은 영향 없음.
      if (isNew && selectedPerson && /퇴직|퇴사/.test(String(selectedPerson.employment_status ?? ""))) {
        setError("퇴사(퇴직) 사원은 신규 응시를 등록할 수 없습니다. 관리자에게 문의해 주세요."); setSaving(false); return;
      }
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      // 사유는 전용 DB 컬럼이 아니므로 페이로드에서 제외하고 감사로그 memo 로만 기록(스키마 변경 없음).
      const { cert_status_manual_reason: _omit, ...editForSave } = editRow as ExamRow & { cert_status_manual_reason?: string };
      void _omit;
      const payload = computeDerivedFields(editForSave); // 저장 직전 자동계산(인증 취득일/취득여부/PM Level/D.M 공정)
      const saved = await upsertExamRow("exam_applications", payload, tenantId, userId);
      const auditMemo = editRow.cert_status_manual === true ? `인증취득여부 수동 확정(${String(editRow.cert_status ?? "")}) 사유: ${manualReason}` : undefined;
      await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), isNew ? "create" : "update", before, saved, auditMemo);
      setEditRow(null); onToast?.(isNew ? "응시 항목이 등록되었습니다." : "응시 항목이 수정되었습니다."); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try { await softDeleteExamRow("exam_applications", String(r.id), userId); await writeExamAudit(tenantId, userId, "exam_applications", String(r.id), "delete", r, null); onToast?.("응시 항목이 삭제되었습니다."); await reload(); }
    catch (e) { setError((e as { message?: string })?.message || "삭제하지 못했습니다."); }
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus || selected.size === 0) return;
    setError(null);
    try {
      const targets = rows.filter((r) => selected.has(rowKey(r)));
      for (const r of targets) {
        const saved = await upsertExamRow("exam_applications", { ...r, status: bulkStatus }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), "update", r, saved, "일괄 상태 변경");
      }
      onToast?.(`${targets.length}건 상태를 '${bulkStatus}'(으)로 변경했습니다.`);
      setSelected(new Set()); setBulkStatus(""); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "일괄 변경 실패."); }
  };

  // 응시 후보 자동계산(인력현황+인증기준). 공정 담당자는 허용 공정 후보만.
  const openCandidates = async () => {
    setShowCand(true); setCandLoading(true); setCandSel(new Set());
    try {
      const list = buildExamCandidates(personnel as Record<string, unknown>[], rows as Record<string, unknown>[], rules as Record<string, unknown>[]);
      let filtered = list;
      try {
        const perms: MyExamPermissions = await loadMyExamPermissions(tenantId);
        if (!perms.isAdmin && !perms.isViewerAll) {
          const procOpts = await listExamRefOptions("exam_processes", tenantId);
          const mapProc = (label: string) => { const hit = procOpts.find((o) => o.label === label || o.label.includes(label)); return hit ? hit.id : null; };
          filtered = list.filter((c) => perms.can(c.process ? mapProc(c.process) : null, "create"));
        }
      } catch { /* 권한 로드 실패 시 전체 표시(관리자 가정) */ }
      // 자동 선택: 응시 가능한 후보만 기본 체크
      setCands(filtered);
      setCandSel(new Set(filtered.filter((c) => c.eligible).map(candKey)));
    } finally { setCandLoading(false); }
  };

  // 관리자 승인 → 응시 등록(상태 '승인대기'). 후보는 자동계산이지만 등록은 승인 필요.
  //  · 다건을 개별 처리하고 성공/실패를 분리 집계한다(한 건 실패로 전체를 성공/실패 처리하지 않음).
  //  · 저장 전 필수값(사번·성명)을 검증해 잘못된 요청을 Supabase 로 보내지 않는다.
  const approveCandidates = async () => {
    const chosen = cands.filter((c) => candSel.has(candKey(c)) && c.eligible);
    if (candApplying || chosen.length === 0) return;
    // 회사 정보(tenant) 미확정 상태 저장 차단.
    if (!tenantId) { setError("회사 정보가 확인되지 않았습니다.\n다시 로그인한 후 시도해주세요."); return; }
    setCandApplying(true); setError(null);
    let ok = 0;
    const failures: Array<{ ref: string; reason: string }> = [];
    for (const c of chosen) {
      const ref = `${c.employee_no || "?"} ${c.name || ""}`.trim();
      try {
        // 필수값 검증(요청 전 차단).
        if (!String(c.employee_no || "").trim()) { failures.push({ ref, reason: "대상자 사번이 없습니다." }); continue; }
        if (!String(c.name || "").trim()) { failures.push({ ref, reason: "대상자 성명이 없습니다." }); continue; }
        const payload: ExamRow = {
          employee_no: c.employee_no, name: c.name, group_name: c.group_name,
          product: c.product, process: c.process, pm_level: c.current_level, status: "승인대기",
        };
        const saved = await upsertExamRow("exam_applications", payload, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), "create", null, saved, `자동 후보 승인 → 승인대기(목표 ${c.target_level})`);
        ok++;
      } catch (e) {
        failures.push({ ref, reason: (e as { message?: string })?.message || "저장 실패" });
      }
    }
    setCandApplying(false);
    // 결과 UX: 전체 성공 / 부분 성공 / 전체 실패 구분.
    if (ok > 0 && failures.length === 0) {
      onToast?.(`응시 대상 ${ok}건을 승인대기로 등록했습니다.`);
      setShowCand(false); await reload();
    } else if (ok > 0 && failures.length > 0) {
      onToast?.(`응시 대상 ${ok}건 등록, ${failures.length}건 실패했습니다.`);
      setError(`일부 등록 실패(${failures.length}건):\n` + failures.map((f) => `· ${f.ref}: ${f.reason}`).join("\n"));
      await reload();
    } else {
      setError(`응시 등록에 실패했습니다(${failures.length}건):\n` + failures.map((f) => `· ${f.ref}: ${f.reason}`).join("\n"));
    }
  };

  const openDetail = (r: ExamRow) => setDetailRow(r);
  const openHistory = async (r: ExamRow) => { setHistoryRow(r); try { setHistoryList(await listExamAudit(tenantId, "exam_applications", String(r.id))); } catch { setHistoryList([]); } };

  // 테이블 행 키보드 이동(위/아래/Home/End/PageUp·Down) + Enter 상세 + Space 선택 토글.
  const tableKeyDown = useTableKeyboardNav({
    count: paged.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => paged[i] && openDetail(paged[i]),
    onSpace: (i) => paged[i] && toggleSel(rowKey(paged[i])),
  });

  const exportRows = () => filtered.map((r) => { const o: Record<string, string> = {}; COLS.forEach((c) => { o[c.label] = cellText(c, r); }); return o; });
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(exportRows()); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "시험응시"); XLSX.writeFile(wb, "시험관리_시험응시.xlsx"); };
  const exportCsv = () => {
    const cols = COLS.map((c) => c.label);
    const lines = [cols.join(",")].concat(filtered.map((r) => COLS.map((c) => `"${String(cellText(c, r)).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "시험관리_시험응시.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const printTable = () => {
    const w = window.open("", "_blank", "width=1100,height=760"); if (!w) return;
    const th = visibleCols.map((c) => `<th>${c.label}</th>`).join("");
    const trs = filtered.map((r) => `<tr>${visibleCols.map((c) => `<td>${cellText(c, r)}</td>`).join("")}</tr>`).join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>시험 응시</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic';font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 6px}th{background:#f1f5f9}</style><h3>시험 응시 (${filtered.length}건)</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  };

  const buildImportPreview = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const okRows: ExamRow[] = []; const err: Array<{ row: number; reason: string }> = []; let dup = 0;
      const levelOpts = refMap["exam_levels"] || []; const equipOpts = refMap["exam_equipment"] || [];
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i]; const row: ExamRow = {}; let bad = "";
        for (const c of COLS) {
          if (c.type === "cert") continue;
          const v = r[c.label];
          if (c.type === "date") { if (!isValidDateCell(v)) bad = bad || `${c.label} 날짜 오류`; row[c.key] = ymd(v) || null; }
          else if (c.type === "number") { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); row[c.key] = s === "" ? null : Number(s); }
          else if (c.type === "ref") {
            const s = String(v ?? "").trim(); if (!s) { row[c.key] = null; continue; }
            const opts = c.refTable === "exam_levels" ? levelOpts : equipOpts;
            const opt = opts.find((o) => o.label === s || o.label.startsWith(s) || o.label.includes(s));
            if (opt) row[c.key] = opt.id; else { row[c.key] = null; if (c.key === "equipment_id") bad = bad || "설비 확인 필요"; }
          } else { const s = String(v ?? "").replace(/#REF!|#N\/A|#VALUE!/gi, "").trim(); row[c.key] = s || null; }
        }
        if (!String(row.employee_no ?? "").trim() || !String(row.name ?? "").trim()) { err.push({ row: i + 2, reason: "사원번호/성명 누락" }); continue; }
        if (bad) { err.push({ row: i + 2, reason: bad }); continue; }
        const code = String(row.category_code ?? "").trim();
        if (code && await isDuplicateApplication(tenantId, String(row.employee_no), code)) { dup++; continue; }
        okRows.push(row);
      }
      setImportPreview({ okRows, dup, err });
    } catch (e) { setError((e as { message?: string })?.message || "Excel 분석 실패."); }
  };
  const commitImport = async () => {
    if (!importPreview) return;
    try {
      for (const row of importPreview.okRows) { const saved = await upsertExamRow("exam_applications", computeDerivedFields(row), tenantId, userId); await writeExamAudit(tenantId, userId, "exam_applications", String(saved.id), "import", null, saved); }
      onToast?.(`정상 ${importPreview.okRows.length}건 등록 · 중복 ${importPreview.dup}건 · 오류 ${importPreview.err.length}건`);
      setImportPreview(null); await reload();
    } catch (e) { setError((e as { message?: string })?.message || "Excel 반영 실패."); }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";
  const kpiCard = (label: string, value: string) => (
    <div className={`rounded-2xl border p-2.5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">시험 응시관리</h2>
        <p className="text-sm text-slate-500">시험관리 · 인증시험 응시데이터를 관리합니다.</p>
      </div>

      {/* KPI */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {kpiCard("전체 응시", String(kpi.total))}
        {kpiCard("승인대기", String(kpi.pending))}
        {kpiCard("필기 진행", String(kpi.w진행))}
        {kpiCard("필기 합격", String(kpi.w합격))}
        {kpiCard("실기 진행", String(kpi.s진행))}
        {kpiCard("실기 합격", String(kpi.s합격))}
        {kpiCard("인증 취득", String(kpi.acquired))}
        {kpiCard("미취득", String(kpi.notAcquired))}
        {kpiCard("재응시", String(kpi.re))}
        {kpiCard("취득률", `${kpi.rate}%`)}
      </div>

      {/* 필터/검색 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="검색(사원번호/성명/구분코드/설비명)" className={`${inputCls} min-w-[210px]`} />
        <select value={yearF} onChange={(e) => { setYearF(e.target.value); setPage(1); }} className={inputCls}><option value="전체">연도: 전체</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={monthF} onChange={(e) => { setMonthF(e.target.value); setPage(1); }} className={inputCls}><option value="전체">월: 전체</option>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{m}</option>)}</select>
        {FILTERS.map((c) => (
          <select key={c.key} value={filters[c.key] || "전체"} onChange={(e) => { setFilters((p) => ({ ...p, [c.key]: e.target.value })); setPage(1); }} className={inputCls}>
            <option value="전체">{c.label}: 전체</option>
            {(filterOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>

      {/* 툴바 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button className={btn} onClick={() => setShowColMenu((v) => !v)}>컬럼 ▾</button>
          {showColMenu && (
            <div className={`absolute z-10 mt-1 w-40 rounded-lg border p-2 shadow-lg ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
              {COLS.filter((c) => c.hideable).map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
        <button className={`${btn} ${pinFirst ? "text-blue-600" : ""}`} onClick={() => setPinFirst((v) => !v)}>사번 고정{pinFirst ? " ✓" : ""}</button>
        {canEdit && selected.size > 0 && (
          <span className="flex items-center gap-1">
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className={inputCls}><option value="">일괄 상태…</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500" onClick={() => void applyBulkStatus()}>적용 ({selected.size})</button>
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel</button>
          <button className={btn} onClick={exportCsv}>CSV</button>
          <button className={btn} onClick={printTable}>인쇄</button>
          {canEdit && <label className={`${btn} cursor-pointer`}>Excel 등록<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void buildImportPreview(f); e.currentTarget.value = ""; }} /></label>}
          {canEdit && <button className={btn} onClick={() => void openCandidates()}>응시 후보 자동계산</button>}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={() => setEditRow({ status: "예정" })}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      {/* 테이블 */}
      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label="시험 응시 목록" className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              <th className={`px-2 py-2 ${pinFirst ? "sticky left-0 " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>
                <input type="checkbox" checked={allPagedSel} onChange={() => setSelected((p) => { const n = new Set(p); if (paged.every((r) => n.has(rowKey(r)))) paged.forEach((r) => n.delete(rowKey(r))); else paged.forEach((r) => n.add(rowKey(r))); return n; })} />
              </th>
              {visibleCols.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className={`cursor-pointer select-none whitespace-nowrap px-2.5 py-2 hover:underline ${pinFirst && c.key === "employee_no" ? "sticky left-9 " + (darkMode ? "bg-slate-800" : "bg-slate-100") : ""}`}>{c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
              ))}
              <th className="whitespace-nowrap px-2.5 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, ri) => {
              const k = rowKey(r); const sel = selected.has(k); const activeRow = ri === activeIdx;
              return (
                <tr key={k} aria-selected={activeRow} title={canEdit ? "클릭하여 수정" : "클릭하여 상세"} onClick={() => { setActiveIdx(ri); if (canEdit) setEditRow({ ...r }); else openDetail(r); }} onDoubleClick={() => openDetail(r)} className={`${activeRow ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : sel ? (darkMode ? "bg-blue-950/40" : "bg-blue-50") : ""} cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                  <td className={`px-2 py-2 ${pinFirst ? "sticky left-0 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}><input type="checkbox" checked={sel} onChange={() => toggleSel(k)} onClick={(e) => e.stopPropagation()} /></td>
                  {visibleCols.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-2.5 py-2 ${pinFirst && c.key === "employee_no" ? "sticky left-9 " + (darkMode ? "bg-slate-900" : "bg-white") : ""}`}>
                      {c.type === "cert" ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certOf(r) === "취득" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{certOf(r)}{r.cert_status_manual ? " ✓" : ""}</span>
                        : c.key === "status" ? (() => {
                          // 저장된 status(수동/저장값)는 그대로 표시하고, 자동계산 상태를 작은 배지+툴팁(근거)으로 보조 표시.
                          const auto = calculateExamStatus(r);
                          return (
                            <span className="inline-flex items-center gap-1">
                              <span>{cellText(c, r)}</span>
                              <span title={`자동계산 근거: ${auto.reasons.join(", ")}`} className={`rounded px-1 py-0.5 text-[0.6rem] font-medium ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>자동:{auto.value}</span>
                            </span>
                          );
                        })()
                          : c.key === "timing_status" ? (() => {
                            // 저장된 조기/지연 값은 그대로 두고, 취득 시점 자동판정을 배지+툴팁(근거)으로 보조 표시.
                            const t = resolveAcquisitionTiming(r, rules);
                            return (
                              <span className="inline-flex items-center gap-1">
                                <span>{cellText(c, r)}</span>
                                <span title={`자동판정 근거: ${t.reasons.join(", ") || "-"}${t.warnings.length ? " · " + t.warnings.join(", ") : ""}`} className={`rounded px-1 py-0.5 text-[0.6rem] font-medium ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>자동:{t.value}</span>
                              </span>
                            );
                          })()
                            : cellText(c, r)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>상세</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                    {canEdit && <><span className="mx-1 text-slate-300">·</span><button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setEditRow({ ...r }); }}>수정</button><span className="mx-1 text-slate-300">·</span><button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button></>}
                  </td>
                </tr>
              );
            })}
            {!loading && paged.length === 0 && <tr><td colSpan={visibleCols.length + 2} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>총 {filtered.length}건{selected.size ? ` · 선택 ${selected.size}` : ""}</span>
        <span className="flex items-center gap-2"><button className={btn} disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>이전</button><span>{curPage} / {pageCount}</span><button className={btn} disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>다음</button></span>
      </div>

      {/* 응시 후보 자동계산 모달(후보=자동, 등록=관리자 승인) */}
      {showCand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !candApplying && setShowCand(false)}>
          <div className={`max-h-[85vh] w-full max-w-4xl overflow-auto rounded-2xl p-5 shadow-xl ${darkMode ? "bg-slate-900" : "bg-white"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">응시 후보 자동계산</h3>
              <button className={btn} onClick={() => setShowCand(false)} disabled={candApplying}>닫기</button>
            </div>
            <p className="mb-3 text-xs text-slate-500">인력현황·인증 기준으로 자동 도출한 후보입니다. <b>응시 가능</b> 후보만 선택해 관리자 승인(→ 승인대기)으로 등록됩니다.</p>
            {candLoading ? <div className="py-8 text-center text-sm text-slate-500">계산 중…</div> : (
              <>
                <div className="mb-2 text-xs text-slate-500">총 {cands.length}명 · 응시 가능 {cands.filter((c) => c.eligible).length}명 · 선택 {candSel.size}명</div>
                <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-xs">
                    <thead className={darkMode ? "bg-slate-800" : "bg-slate-100"}>
                      <tr><th className="px-2 py-1.5">선택</th><th className="px-2 py-1.5">사번</th><th className="px-2 py-1.5">성명</th><th className="px-2 py-1.5">공정</th><th className="px-2 py-1.5">현재→목표</th><th className="px-2 py-1.5">설비</th><th className="px-2 py-1.5">재시험 가능일</th><th className="px-2 py-1.5">판정</th></tr>
                    </thead>
                    <tbody>
                      {cands.length === 0 && <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-400">후보가 없습니다.</td></tr>}
                      {cands.map((c) => (
                        <tr key={candKey(c)} className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"} ${c.eligible ? "" : "opacity-60"}`}>
                          <td className="px-2 py-1.5"><input type="checkbox" disabled={!c.eligible || !canEdit} checked={candSel.has(candKey(c))} onChange={() => setCandSel((p) => { const n = new Set(p); const k = candKey(c); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /></td>
                          <td className="px-2 py-1.5">{c.employee_no}</td><td className="px-2 py-1.5">{c.name}</td><td className="px-2 py-1.5">{c.process || "-"}</td>
                          <td className="px-2 py-1.5">{c.current_level} → <b>{c.target_level}</b></td>
                          <td className="px-2 py-1.5">{c.needEquipment ? "필요" : "-"}</td>
                          <td className="px-2 py-1.5">{c.retestAvailableDate || "-"}</td>
                          <td className="px-2 py-1.5">{c.eligible ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">응시 가능</span> : <span className="text-rose-600">{c.blockedReasons.join(", ")}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <div className="mt-3 flex justify-end">
                    <button onClick={() => void approveCandidates()} disabled={candApplying || candSel.size === 0}
                      className={`rounded-2xl px-5 py-2 text-sm font-semibold text-white ${candApplying || candSel.size === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>
                      {candApplying ? "등록 중…" : `승인하여 응시 등록 (${candSel.size}건)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 등록/수정 모달 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-app-edit-title" tabIndex={-1} className={`my-8 w-full max-w-3xl rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-app-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? "시험 응시 수정" : "시험 응시 등록"}</h3>

            {/* [4단계] 공통 사원선택 + 라이선스 요약/추천(추가 전용 · 아래 기존 사번 select/필드/저장은 그대로 유지) */}
            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">사원 빠른 선택 <span className="text-slate-400">(사번/이름 검색 · 자동입력)</span></label>
                <EmployeeSelector value={selectorValue} onChange={(emp) => applyPersonnel(emp?.employeeNo || "")} tenantId={tenantId} darkMode={darkMode}
                  helperText="선택 시 성명·그룹·제품·공정·PM Level 이 자동 입력되고, 아래 라이선스 요약이 표시됩니다." />
              </div>
              {autofill && (
                <>
                  {/* 사원 기본정보(읽기전용) */}
                  <div className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
                    <div className="mb-2 text-xs font-semibold text-slate-500">사원 기본정보 <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[0.6rem] text-slate-600 dark:bg-slate-700 dark:text-slate-300">자동</span></div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {sumItem("이름", autofill.employee.name)}
                      {sumItem("그룹", autofill.employee.group)}
                      {sumItem("제품군", autofill.employee.productFamily)}
                      {sumItem("파트", autofill.employee.part)}
                      {sumItem("현재 PM", autofill.pmSummary.currentLevel)}
                      {sumItem("현재 D.M", autofill.dmSummary.currentLevel)}
                      {sumItem("재직", autofill.employee.employmentStatus)}
                    </div>
                  </div>
                  {/* 응시 가능 단계 추천(읽기전용 안내 — 기존 등록 흐름은 유지, 하드 차단 아님) */}
                  {(() => {
                    const ls = autofill.licenseSummary;
                    const inactiveEmp = /퇴직|퇴사/.test(String(autofill.employee.employmentStatus ?? ""));
                    const canApply = !!ls.activePlanId && !inactiveEmp;
                    const reason = inactiveEmp ? "퇴사자는 신규 응시 등록 대상이 아닙니다(관리자 예외 등록)."
                      : !ls.activePlanId ? "진행 중(ACTIVE)인 라이선스 단계가 없습니다. 선행 단계 완료/승인이 필요할 수 있습니다."
                      : ls.overdue ? "목표취득일이 경과했습니다(기한 초과) — 우선 응시 권장." : "응시 가능";
                    return (
                      <div className={`rounded-2xl border p-3 ${canApply ? (darkMode ? "border-emerald-700 bg-emerald-950/30" : "border-emerald-200 bg-emerald-50") : (darkMode ? "border-amber-700 bg-amber-950/30" : "border-amber-200 bg-amber-50")}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-500">응시 가능 단계(추천)</div>
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${canApply ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{canApply ? "응시 가능" : "확인 필요"}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {sumItem("현재 단계", ls.currentStage)}
                          {sumItem("다음 추천 단계", ls.nextStage)}
                          {sumItem("목표취득일", ls.targetDate)}
                          {sumItem("남은개월", ls.remainingMonths != null ? `${ls.remainingMonths}개월` : null, ls.overdue)}
                          {sumItem("기한초과", ls.overdue ? "초과" : "정상", ls.overdue)}
                          {sumItem("재시험 가능일", ls.retestAvailableDate)}
                        </div>
                        {!canApply && <div className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">{reason}</div>}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLS.filter((c) => c.type !== "cert").map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}{AUTO_READONLY.has(c.key) && <span className="ml-1 text-[0.6rem] font-normal text-slate-400">(사번 자동)</span>}</label>
                  {c.key === "employee_no" ? (
                    // 사번: 인력(연명부)에서 선택 → 성명/그룹/제품/공정/PM Level 자동입력.
                    <select className={`${inputCls} w-full`} value={String(editRow.employee_no ?? "")} onChange={(e) => applyPersonnel(e.target.value)}>
                      <option value="">사번 선택</option>
                      {personnel.map((p) => <option key={String(p.id)} value={String(p.employee_no ?? "")}>{String(p.employee_no ?? "")}{p.name ? ` · ${String(p.name)}` : ""}</option>)}
                    </select>
                  ) : AUTO_READONLY.has(c.key) ? (
                    // 사번 선택 시 자동입력되는 식별 필드 — 직접 입력 금지(읽기전용).
                    <input readOnly disabled className={`${inputCls} w-full cursor-not-allowed opacity-70`} value={String(editRow[c.key] ?? "")} placeholder="사번 선택 시 자동 입력" />
                  ) : c.key === "level_id" ? (
                    // 인증단계 변경 시 설비 선택 초기화(단계별 설비만 표시되도록).
                    <select className={`${inputCls} w-full`} value={String(editRow.level_id ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), level_id: e.target.value || null, equipment_id: null }))}><option value="">선택</option>{(refMap["exam_levels"] || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  ) : c.key === "equipment_id" ? (
                    // 인증 설비: 선택된 인증단계에 연결된 공정의 설비만 표시.
                    <select className={`${inputCls} w-full`} value={String(editRow.equipment_id ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), equipment_id: e.target.value || null }))}><option value="">선택</option>{equipmentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  ) : c.type === "ref" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(refMap[c.refTable as string] || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                  ) : c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}><option value="">선택</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : (
                    <input type={c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined} className={`${inputCls} w-full`} value={c.type === "date" ? ymd(editRow[c.key]) : String(editRow[c.key] ?? "")} onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
              {/* 인증취득여부 수동 확정(사유 필수 · 변경이력 기록) */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">인증취득여부 (수동 확정)</label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!editRow.cert_status_manual} onChange={(e) => setEditRow((f) => ({ ...(f || {}), cert_status_manual: e.target.checked }))} />수동</label>
                  <select disabled={!editRow.cert_status_manual} className={`${inputCls} flex-1`} value={String(editRow.cert_status ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), cert_status: e.target.value || null }))}><option value="">자동({editRow.practical_pass_date ? "취득" : "미취득"})</option><option value="취득">취득</option><option value="미취득">미취득</option></select>
                </div>
                {!!editRow.cert_status_manual && (
                  <input
                    className={`${inputCls} mt-1.5 w-full`}
                    placeholder="수동 확정 사유(필수) — 변경 이력에 기록됩니다"
                    value={String((editRow as { cert_status_manual_reason?: string }).cert_status_manual_reason ?? "")}
                    onChange={(e) => setEditRow((f) => ({ ...(f || {}), cert_status_manual_reason: e.target.value }))}
                  />
                )}
              </div>
            </div>

            {/* 인력 정보(사번 자동 · 읽기전용): 재직여부 / 기존 인증 단계 / 인증 이력 요약 */}
            {selectedPerson && (
              <div className={`mt-3 rounded-xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
                <div className="mb-1 font-semibold text-slate-500">인력 정보 <span className="font-normal text-slate-400">(사번 자동 · 읽기전용)</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div><div className="text-slate-400">재직여부</div><div>{String(selectedPerson.employment_status ?? "") || "-"}</div></div>
                  <div><div className="text-slate-400">기존 인증 단계</div><div>{String(selectedPerson.cert_level ?? selectedPerson.current_pm_level ?? "") || "-"}</div></div>
                  <div className="col-span-2 sm:col-span-1"><div className="text-slate-400">인증 이력 요약</div><div>{certHistorySummary || "-"}</div></div>
                </div>
              </div>
            )}

            {/* 인증단계 자동판정(인증 기준관리 exam_rules 기준) */}
            {levelReq && (
              <div className={`mt-3 rounded-xl border p-3 text-xs ${levelReq.prereqMet ? (darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50") : "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold text-slate-500">
                  인증단계 자동판정
                  <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${levelReq.prereqMet && levelReq.employed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{levelReq.prereqMet && levelReq.employed ? "응시 가능" : "응시 불가"}</span>
                  {!levelReq.hasRule && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-medium text-amber-700">규칙 미등록(수동)</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div><div className="text-slate-400">선행 인증 충족</div><div className={levelReq.prereqMet ? "" : "font-semibold text-rose-600"}>{levelReq.prereqName ? `${levelReq.prereqName} · ${levelReq.prereqMet ? "충족" : "미충족"}` : "없음"}</div></div>
                  <div><div className="text-slate-400">필기/실기 필요</div><div>{`필기 ${levelReq.requireWritten ? "필요" : "불필요"} · 실기 ${levelReq.requirePractical ? "필요" : "불필요"}`}</div></div>
                  <div><div className="text-slate-400">필수/선택 설비</div><div>{`필수 ${levelReq.requiredEquip || 0}종 · 선택가능 ${equipmentOptions.length}종`}</div></div>
                  <div><div className="text-slate-400">예상 취득 단계</div><div>{levelReq.expectedLevel || "-"}</div></div>
                  <div><div className="text-slate-400">조기/지연 기준</div><div>{levelReq.timingMonths ? `${levelReq.timingMonths}개월` : "-"}{levelReq.validMonths ? ` · 유효 ${levelReq.validMonths}개월` : ""}</div></div>
                  <div><div className="text-slate-400">다음 PM Level</div><div>{levelReq.nextPm}</div></div>
                  <div><div className="text-slate-400">D.M 공정 적용</div><div>{levelReq.isDm ? "적용" : "미적용"}{levelReq.autoPromote ? " · 자동승급" : ""}</div></div>
                </div>
                {!levelReq.prereqMet && <div className="mt-1.5 font-semibold text-rose-600">※ 선행 인증 미충족 — 저장이 차단됩니다.</div>}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Excel 미리보기(정상/중복/오류) */}
      {importPreview && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setImportPreview(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Excel 등록 미리보기</h3>
            <div className="mb-3 flex gap-2 text-sm">
              <span className="rounded-lg bg-emerald-100 px-3 py-1 text-emerald-700">정상 {importPreview.okRows.length}</span>
              <span className="rounded-lg bg-amber-100 px-3 py-1 text-amber-700">중복 {importPreview.dup}</span>
              <span className="rounded-lg bg-rose-100 px-3 py-1 text-rose-700">오류 {importPreview.err.length}</span>
            </div>
            {importPreview.err.length > 0 && (
              <div className={`mb-3 max-h-40 overflow-auto rounded-lg border p-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                {importPreview.err.slice(0, 30).map((e, i) => <div key={i} className="py-0.5">{e.row}행: {e.reason}</div>)}
              </div>
            )}
            <p className="mb-4 text-xs text-slate-500">정상 {importPreview.okRows.length}건만 반영됩니다(중복/오류 제외, 자동 저장 안 함).</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportPreview(null)} className={`rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button onClick={() => void commitImport()} disabled={importPreview.okRows.length === 0} className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${importPreview.okRows.length === 0 ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{importPreview.okRows.length}건 반영</button>
            </div>
          </div>
        </div>
      )}

      {/* 상세보기(더블클릭) */}
      {detailRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setDetailRow(null)}>
          <div className={`my-8 w-full max-w-2xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div><h3 className="text-lg font-semibold">{String(detailRow.name || "-")} <span className="text-sm font-normal text-slate-500">시험 응시 상세</span></h3>
                <p className="text-sm text-slate-500">사번 {String(detailRow.employee_no || "-")} · 구분코드 {String(detailRow.category_code || "-")}</p></div>
              {/* 빠른 액션: 상세 → 기존 등록/수정 폼(edit 모드) 재사용. 수정 권한 없으면 미표시(§19·§24). */}
              <div className="flex items-center gap-1">
                {canEdit && <button onClick={() => { const r = detailRow; setDetailRow(null); setEditRow({ ...r }); }} className="rounded-lg border border-blue-500 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40">수정</button>}
                <button onClick={() => { const r = detailRow; void openHistory(r); }} className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">이력</button>
                <button onClick={() => setDetailRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
              </div>
            </div>
            {[
              ["직원 기본정보", ["employee_no", "name", "group_name", "product", "process"]],
              ["시험 정보", ["category_code", "category", "level_id", "equipment_id", "status"]],
              ["필기 이력", ["written_exam_date", "written_pass_date"]],
              ["실기 이력", ["practical_acquire_date", "practical_pass_date"]],
              ["인증 결과", ["cert_status", "cert_acquired_date", "timing_status"]],
              ["PM Level 근거", ["pm_level"]],
              ["D.M 근거", ["dm_process"]],
              ["비고", ["notes"]],
            ].map(([title, keys]) => (
              <div key={title as string} className="mb-3">
                <div className="mb-1 text-sm font-semibold text-slate-500">{title as string}</div>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {(keys as string[]).map((key) => { const c = COLS.find((x) => x.key === key) || { key, label: key, type: "text" } as Col; return (
                    <div key={key} className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="text-[0.65rem] uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-0.5">{cellText(c, detailRow)}</div></div>
                  ); })}
                </dl>
              </div>
            ))}

            {/* 인증취득 자동판정(exam_rules 요건 검증) — 저장값 미변경, 표시 전용. 수동 확정 시 그 값 유지. */}
            {(() => {
              const cert = calculateCertificationStatus(detailRow, rules);
              const approved = isCertificationApproved(detailRow);
              const manual = detailRow.cert_status_manual === true;
              const tone = cert.value === "인증취득 확정" ? "bg-emerald-100 text-emerald-700"
                : cert.value === "인증취득 후보" ? "bg-blue-100 text-blue-700"
                  : cert.value === "확인 필요" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-500";
              return (
                <div className="mb-3">
                  <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-500">
                    인증취득 자동판정
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{cert.value}</span>
                    {manual && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[0.65rem] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">수동 확정값 유지</span>}
                  </div>
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-emerald-500">충족 조건</div>
                      <div className="mt-0.5">{cert.reasons.length ? cert.reasons.join(" · ") : "-"}</div>
                    </div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-amber-500">미충족 / 확인 필요</div>
                      <div className="mt-0.5">{cert.warnings.length ? cert.warnings.join(" · ") : "-"}</div>
                    </div>
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className="text-[0.65rem] uppercase tracking-wide text-slate-400">관리자 승인 여부</div>
                      <div className="mt-0.5">{approved ? "승인 완료" : "미승인(승인 대기)"}</div>
                    </div>
                  </dl>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 변경이력 */}
      {historyRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setHistoryRow(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold">변경이력</h3><button onClick={() => setHistoryRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button></div>
            <div className="max-h-[50vh] overflow-auto">
              {historyList.length ? historyList.map((h) => <div key={String(h.id)} className={`border-b py-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-100"}`}><span className="font-semibold">{String(h.action_type)}</span>{h.memo ? <span className="ml-2 text-slate-500">{String(h.memo)}</span> : null}<span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span></div>) : <div className="py-8 text-center text-sm text-slate-500">변경이력이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesDialog open={confirmClose} darkMode={darkMode}
        onKeepEditing={() => setConfirmClose(false)}
        onDiscard={() => { setConfirmClose(false); setEditRow(null); }}
        onSave={() => { setConfirmClose(false); void saveRow(); }} />
    </section>
  );
}
