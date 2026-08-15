import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import type { ExamColumn, ExamEntityConfig } from "../examMasterConfigs";
import {
  listExamRows, upsertExamRow, softDeleteExamRow, setExamRowActive,
  writeExamAudit, listExamAudit, examSupabaseReady, translateExamWriteError, isExamTableMissing, findScopedExistingId,
  examRefLabel, resolveEquipmentHierarchy, type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";

// 참조 옵션은 라벨뿐 아니라 상위 FK(category_id/group_id/part_id/process_id)와 활성여부를 함께 싣는다(종속 선택용).
type RefOpt = { id: string; label: string; code?: string | null; name?: string | null; is_active: boolean; category_id?: string | null; group_id?: string | null; part_id?: string | null; process_id?: string | null };

// "코드 · 이름" 표시 문자열을 코드/이름으로 안전 분리(부분일치·startsWith 금지). 구분자가 없으면 단일 토큰으로 취급.
//  §16 로 라벨 뒤에 상위 경로가 덧붙는 경우("… · A > B")가 있어, 앞의 두 세그먼트만 코드·이름으로 사용한다.
function parseMasterRefValue(value: unknown): { raw: string; code: string; name: string } {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { raw: "", code: "", name: "" };
  const seg = raw.split("·").map((s) => s.trim()).filter(Boolean);
  if (seg.length >= 2) return { raw, code: seg[0], name: seg[1] };
  return { raw, code: raw, name: "" };
}

// 하위 빠른 추가: 각 기준정보의 "자식" 탭. 상위 행에서 자식 등록 모달을 상위 FK 채운 채로 연다.
// 하위 빠른 추가: 각 기준정보의 "자식" 탭. 제품/파트 단계 제거로 groups/parts 는 빠른추가 대상에서 제외.
const CHILD_TAB: Record<string, { key: string; title: string }> = {
  exam_categories: { key: "groups", title: "그룹" },
  exam_processes: { key: "equipment", title: "장비" },
  exam_equipment: { key: "rules", title: "인증 규칙" },
};

export default function ExamMasterGrid({
  config, darkMode, canEdit, tenantId, userId, onToast, onQuickAdd, initialEdit, onInitialEditConsumed,
}: {
  config: ExamEntityConfig;
  darkMode: boolean;
  canEdit: boolean;
  tenantId: string;
  userId: string;
  onToast?: (msg: string) => void;
  // 하위 빠른 추가: 상위 그리드가 자식 탭 key 와 상위 FK 스코프를 부모(ExamRulesPage)로 전달 → 탭 전환 + 자식 그리드 initialEdit.
  onQuickAdd?: (childKey: string, scope: ExamRow) => void;
  initialEdit?: ExamRow | null;      // 자식 그리드가 열릴 때 미리 채울 상위 FK(신규 등록)
  onInitialEditConsumed?: () => void; // initialEdit 소비 완료 알림(부모 상태 정리)
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [refMap, setRefMap] = useState<Record<string, RefOpt[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"전체" | "사용" | "미사용">("전체");
  // 장비 목록 조회용 계단식 필터(그룹→제품군→공정). 표시 전용 — 저장 데이터 불변. 파생 계층이 있는 탭(장비)에서만 노출.
  const [filterGroup, setFilterGroup] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterProc, setFilterProc] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editRow, setEditRow] = useState<ExamRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyRow, setHistoryRow] = useState<ExamRow | null>(null);
  const [historyList, setHistoryList] = useState<ExamRow[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  // 미저장 변경 보호 + 앱 공통 닫기(ESC·뒤로가기·최상위 우선) 연동.
  const [editBase, setEditBase] = useState("");
  const editKey = editRow ? String(editRow.id ?? "__new__") : "";
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (editRow) setEditBase(JSON.stringify(editRow)); }, [editKey]);
  const editDirty = !!editRow && JSON.stringify(editRow) !== editBase;
  const requestCloseEdit = () => { if (saving) return; if (editDirty) setConfirmClose(true); else setEditRow(null); };
  const topClose = confirmClose ? undefined
    : historyRow ? () => setHistoryRow(null)
      : editRow ? requestCloseEdit
        : undefined;
  useRegisteredOverlay(!!topClose, () => topClose && topClose());

  const refColumns = useMemo(() => config.columns.filter((c) => c.type === "ref"), [config]);
  // 목록/Excel/검색에 쓰는 컬럼(필터 전용 transient 제외). 폼(등록/수정)은 transient 포함 전체를 렌더.
  const tableColumns = useMemo(() => config.columns.filter((c) => !c.transient), [config]);
  // 목록 표시 전용 파생 컬럼(예: 장비 목록의 그룹/제품군). 저장/Excel/정렬/검색 대상이 아니며 헤더는 tableColumns 앞에 표시.
  const derivedColumns = config.derived ?? [];

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const refTables = Array.from(new Set(refColumns.map((c) => c.refTable as ExamMasterTable)));
      // [계층 단순화] 공정을 "그룹" 기준으로 필터하려면 exam_parts(part.group_id)를 역추적해야 한다.
      //  공정을 참조하는데 exam_parts 가 참조 목록에 없으면(제품/파트 단계 제거) 역추적용으로 함께 로드.
      if (refTables.includes("exam_processes") && !refTables.includes("exam_parts")) refTables.push("exam_parts");
      const [data, refs] = await Promise.all([
        listExamRows(config.table, tenantId),
        Promise.all(refTables.map(async (t) => {
          // 미적용 참조 테이블(예: exam_lines DRAFT 미실행)이 있어도 해당 탭 로드가 깨지지 않도록 개별 catch → 빈 옵션.
          const refRows = await listExamRows(t, tenantId).catch(() => [] as ExamRow[]); // RLS 로 현재 tenant·권한 범위만. 비활성 포함(수정 화면 표시용).
          const opts: RefOpt[] = refRows.map((r) => ({
            id: String(r.id),
            label: [r.code, r.name].filter(Boolean).join(" · ") || String(r.name ?? r.id),
            code: (r.code ?? null) as string | null,
            name: (r.name ?? null) as string | null,
            is_active: r.is_active !== false,
            category_id: (r.category_id ?? null) as string | null,
            group_id: (r.group_id ?? null) as string | null,
            part_id: (r.part_id ?? null) as string | null,
            process_id: (r.process_id ?? null) as string | null,
          }));
          return [t as string, opts] as const;
        })),
      ]);
      setRows(data);
      // 미적용(미생성) 테이블이면 안내(오류 아님). 예: exam_lines DRAFT 미실행 → 라인 탭.
      if (isExamTableMissing(config.table)) setError("이 기능의 데이터 구조가 아직 적용되지 않았습니다. 관리자에게 문의해 주세요(기준정보 DB 적용 필요).");
      // [16] 동일 코드·품명이 서로 다른 상위 범위에 존재할 수 있으므로, 라벨이 겹치는 항목에만
      //  상위 경로를 덧붙여 구분한다(예: "검사 · DRAM > 2그룹 > ETCH AMAT").
      //  저장값은 그대로 row.id 이며, 겹치지 않는 항목의 라벨은 기존과 동일하게 유지한다.
      const refEntries: Record<string, RefOpt[]> = Object.fromEntries(refs);
      const byId: Record<string, Map<string, RefOpt>> = {};
      for (const [t, opts] of Object.entries(refEntries)) byId[t] = new Map(opts.map((o) => [o.id, o]));
      // [계층 단순화] 공정 옵션에 group_id/category_id 를 exam_parts(part.group_id)에서 역추적해 채운다
      //  → 인증규칙에서 공정을 제품/파트 없이 "그룹"으로 바로 필터. 저장값(process_id)·part_id 는 불변.
      const partsById = byId["exam_parts"];
      if (partsById && refEntries["exam_processes"]) {
        for (const o of refEntries["exam_processes"]) {
          if (!o.group_id && o.part_id) {
            const part = partsById.get(String(o.part_id));
            if (part) { o.group_id = part.group_id ?? null; if (!o.category_id) o.category_id = part.category_id ?? null; }
          }
        }
      }
      const parentOf = (t: string, o: RefOpt): { table: string; opt: RefOpt } | null => {
        const chain: Array<[string, string | null | undefined]> = [
          ["exam_processes", o.process_id], ["exam_parts", o.part_id],
          ["exam_groups", o.group_id], ["exam_categories", o.category_id],
        ];
        for (const [pt, pid] of chain) {
          if (pt === t || !pid) continue;
          const p = byId[pt]?.get(String(pid));
          if (p) return { table: pt, opt: p };
        }
        return null;
      };
      for (const [t, opts] of Object.entries(refEntries)) {
        const seen = new Map<string, number>();
        opts.forEach((o) => seen.set(o.label, (seen.get(o.label) || 0) + 1));
        opts.forEach((o) => {
          if ((seen.get(o.label) || 0) <= 1) return; // 유일한 라벨은 그대로 둔다
          const names: string[] = [];
          let curT = t, cur = o, guard = 0;
          while (guard++ < 5) {
            const p = parentOf(curT, cur);
            if (!p) break;
            names.unshift(p.opt.label);
            curT = p.table; cur = p.opt;
          }
          if (names.length) o.label = `${o.label} · ${names.join(" > ")}`;
        });
      }
      setRefMap(refEntries);
    } catch (e) {
      setError((e as { message?: string })?.message || "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [config.table, tenantId, refColumns]);

  // 최초/설정 변경 시 1회 데이터 로드(내부는 비동기 — 렌더 캐스케이드 아님).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);

  const refLabel = (col: ExamColumn, id: unknown) => {
    if (!id) return "-";
    const opt = (refMap[col.refTable as string] || []).find((o) => o.id === String(id));
    return opt?.label || "-";
  };
  const cellText = (col: ExamColumn, row: ExamRow) => {
    const v = row[col.key];
    if (col.type === "ref") return refLabel(col, v);
    if (col.type === "boolean") return v === true ? "예" : "아니오";
    if (v === null || v === undefined || v === "") return "-";
    if (col.type === "date") return String(v).slice(0, 10);
    return String(v);
  };
  // 목록(Table) 전용 표시: 참조 컬럼은 조합 라벨(코드·이름·상위경로)이 아니라 "이름만" 보여준다.
  //  상위 계층은 각 참조 컬럼에서 자기 값만 표시하므로 반복이 사라진다. Excel/검색이 쓰는 cellText 는 불변.
  const cellDisplay = (col: ExamColumn, row: ExamRow) => {
    if (col.type === "ref") {
      const id = row[col.key];
      if (!id) return "-";
      const opt = (refMap[col.refTable as string] || []).find((o) => o.id === String(id));
      return (opt?.name && String(opt.name).trim()) || opt?.label || "-";
    }
    return cellText(col, row);
  };

  // 파생 표시(그룹/제품군) 전용: 이미 로드된 참조를 id→옵션 Map 으로 만들어 행마다 조회 없이 이름을 찾는다(추가 Supabase 호출 없음).
  const refById = useMemo(() => {
    const m: Record<string, Map<string, RefOpt>> = {};
    for (const [t, opts] of Object.entries(refMap)) m[t] = new Map(opts.map((o) => [o.id, o]));
    return m;
  }, [refMap]);
  // process_id → 공정 → group_id/category_id → 이름. 관계를 못 찾으면 자연스러운 한글 폴백(UUID 미노출).
  const derivedText = (col: NonNullable<ExamEntityConfig["derived"]>[number], row: ExamRow): string => {
    const srcId = String(row[col.from] ?? "");
    if (!srcId) return col.missing;                 // 상위 FK 자체가 없음(예: 공정 미연결)
    const src = refById[col.via]?.get(srcId);
    if (!src) return col.missing;                    // 참조를 못 찾음(예: 공정 확인 필요)
    const parentId = String((src as Record<string, unknown>)[col.pick] ?? "");
    if (!parentId) return col.fallback;              // 상위 미지정(예: 그룹/제품군 미지정)
    const parent = refById[col.nameFrom]?.get(parentId);
    return (parent && ((parent.name && String(parent.name).trim()) || parent.label)) || col.fallback;
  };

  // 조회용 계단식 필터 옵션(이미 로드된 refMap 재사용 · 추가 DB 호출 없음). 상위 선택에 종속해 하위만 표시.
  const hierFilterOn = derivedColumns.length > 0; // 파생 계층(그룹/제품군) 컬럼이 있는 탭(장비)에서만 필터 노출
  const optName = (o: RefOpt) => (o.name && String(o.name).trim()) || o.label;
  const filterGroupOpts = useMemo(() => (refMap["exam_groups"] || []).filter((o) => o.is_active), [refMap]);
  const filterCatOpts = useMemo(
    () => (refMap["exam_categories"] || []).filter((o) => o.is_active && (!filterGroup || String(o.group_id ?? "") === filterGroup)),
    [refMap, filterGroup],
  );
  const filterProcOpts = useMemo(
    () => (refMap["exam_processes"] || []).filter((o) => {
      if (!o.is_active) return false;
      if (filterCat) return String(o.category_id ?? "") === filterCat;      // 제품군 선택 시 그 제품군 공정만
      if (filterGroup) return String(o.group_id ?? "") === filterGroup;     // 그룹만 선택 시 그 그룹 공정만
      return true;                                                          // 전체
    }),
    [refMap, filterGroup, filterCat],
  );
  // 상위 변경 시 하위 초기화(그룹 변경 → 제품군·공정 초기화, 제품군 변경 → 공정 초기화).
  const changeFilterGroup = (v: string) => { setFilterGroup(v); setFilterCat(""); setFilterProc(""); };
  const changeFilterCat = (v: string) => { setFilterCat(v); setFilterProc(""); };

  // 한 옵션이 상위 폼 선택에 부합하는지 판정(기본 FK → null 이면 fallback 상위로 역추적).
  const matchesFilter = (col: ExamColumn, opt: RefOpt, edit: ExamRow | null): boolean => {
    const fb = col.filterBy;
    if (!fb) return true;
    const pv = String(edit?.[fb.formKey] ?? "");
    if (!pv) return true; // 상위 미선택 → 전체 허용
    const all = refMap[col.refTable as string] || [];
    const refPresent = all.some((o) => (o as Record<string, unknown>)[fb.refField] != null);
    if (!refPresent) return true; // 참조 FK 컬럼 없음(미적용) → 필터 우회(무회귀)
    const primary = (opt as Record<string, unknown>)[fb.refField];
    if (primary != null) return String(primary) === pv;
    // 기본 FK 가 null 인 기존 데이터 → fallback 상위 단계(예: group_id 없으면 category_id)로 판정
    if (fb.fallback) {
      const fpv = String(edit?.[fb.fallback.formKey] ?? "");
      if (fpv) return String((opt as Record<string, unknown>)[fb.fallback.refField] ?? "") === fpv;
    }
    return false; // 상위 판정 불가 → 신규 선택에서 제외(저장된 값은 optionsFor 에서 별도 표시)
  };

  // 종속 선택: 상위 폼 값 기준으로 옵션을 필터한다(신규 선택은 활성만 · 저장된 값은 비활성/필터밖이어도 표시).
  const optionsFor = (col: ExamColumn, edit: ExamRow | null): RefOpt[] => {
    const all = refMap[col.refTable as string] || [];
    let list = all.filter((o) => o.is_active && matchesFilter(col, o, edit));
    const savedId = String(edit?.[col.key] ?? "");
    if (savedId && !list.some((o) => o.id === savedId)) {
      const saved = all.find((o) => o.id === savedId);
      if (saved) list = [saved, ...list];
    }
    return list;
  };

  // 참조 값 변경 시 하위 종속 필드를 연쇄 초기화(상위 변경 → 잘못된 하위 선택 제거).
  const changeRef = (colKey: string, value: string) => {
    setEditRow((f) => {
      const next: ExamRow = { ...(f || {}), [colKey]: value || null };
      const cleared = [colKey];
      let progress = true;
      while (progress) {
        progress = false;
        for (const cc of refColumns) {
          if (cc.filterBy && cleared.includes(cc.filterBy.formKey) && next[cc.key] != null) {
            next[cc.key] = null; cleared.push(cc.key); progress = true;
          }
        }
      }
      return next;
    });
  };

  // [인증 규칙 전용] 기준 구분 → 적용 라인 → 제품군 → 그룹 → 공정 순으로만 선택 가능하게 게이팅(제품/파트 단계 제거).
  //  적용 제품군은 filterBy 로 표현할 수 없는 선행조건(기준 구분)이 있어 별도 처리. 적용 라인은 선택(게이팅 없음). 다른 탭 동작은 불변.
  const isRules = config.table === "exam_rules";
  const rulesGate = (colKey: string): { disabled: boolean; reason: string } => {
    if (!isRules) return { disabled: false, reason: "" };
    const has = (k: string) => !!String(editRow?.[k] ?? "").trim();
    switch (colKey) {
      case "category_id": return { disabled: !has("rule_type"), reason: "기준 구분을 먼저 선택해 주세요." };
      case "group_id": return { disabled: !has("category_id"), reason: "적용 제품군을 먼저 선택해 주세요." };
      case "process_id": return { disabled: !has("group_id"), reason: "적용 그룹을 먼저 선택해 주세요." };
      default: return { disabled: false, reason: "" };
    }
  };
  // 기준 구분(select) 변경 시 인증 규칙의 하위 계층 전체 초기화(잘못된 상위-하위 조합 방지).
  const changeRuleType = (value: string) => {
    setEditRow((f) => {
      // 기존 선택에서 "다른 값으로 변경"할 때만 하위 초기화. 빈 값 → 첫 선택은 초기화하지 않음
      //  (하위 빠른 추가로 상위 FK 가 미리 채워진 상태를 보존).
      const prev = String(f?.rule_type ?? "").trim();
      const resetHier = !!prev && prev !== value;
      return { ...(f || {}), rule_type: value || null, ...(resetHier ? { category_id: null, group_id: null, process_id: null } : {}) };
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (activeFilter === "사용" && r.is_active === false) return false;
      if (activeFilter === "미사용" && r.is_active !== false) return false;
      // 계단식 필터(조회 전용): process_id → 공정 → group_id/category_id 를 refMap 으로 판정(행별 DB 호출 없음).
      if (hierFilterOn && (filterGroup || filterCat || filterProc)) {
        const pid = String(r.process_id ?? "");
        const p = pid ? refById["exam_processes"]?.get(pid) : undefined;
        if (filterGroup && String(p?.group_id ?? "") !== filterGroup) return false;
        if (filterCat && String(p?.category_id ?? "") !== filterCat) return false;
        if (filterProc && pid !== filterProc) return false;
      }
      if (q) {
        const text = tableColumns.map((c) => cellText(c, r)).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = tableColumns.find((c) => c.key === sortKey);
      list.sort((a, b) => {
        const av = col ? cellText(col, a) : String(a[sortKey] ?? "");
        const bv = col ? cellText(col, b) : String(b[sortKey] ?? "");
        const an = Number(av), bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
        return av.localeCompare(bv, "ko") * dir;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, activeFilter, filterGroup, filterCat, filterProc, sortKey, sortDir, refMap, config.columns]);

  const toggleSort = (k: string) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  const openAdd = () => setEditRow({});
  // 수정 진입 시 저장된 참조(process_id/part_id 등)로부터 상위 계층(filter 전용 transient: _cat/_group/_part)을 역복원한다.
  //  저장값(process_id·part_id 등)은 그대로 두고, 화면 표시용 상위 선택값만 채운다(임의 첫 항목 선택 금지 · 실제 부모 FK만 사용).
  const withEditScope = (r: ExamRow): ExamRow => {
    const transientRefs = config.columns.filter((c) => c.transient && c.type === "ref");
    if (transientRefs.length === 0) return { ...r };
    const find = (t: string, id: string) => (refMap[t] || []).find((o) => o.id === id);
    // 저장된(비 transient) 계층 참조 값 우선 → 없으면 하위(process/part)에서 부모 FK 로 역추적.
    const savedHier = (table: string) => {
      const col = config.columns.find((c) => c.type === "ref" && !c.transient && c.refTable === table);
      return col ? String(r[col.key] ?? "") : "";
    };
    let categoryId = savedHier("exam_categories");
    let groupId = savedHier("exam_groups");
    let partId = savedHier("exam_parts");
    const processId = savedHier("exam_processes");
    // 공정에서 그룹·제품군 복원: 공정.group_id/category_id(신 컬럼·FK 직접) 우선 → 없으면 공정→파트→그룹(레거시 호환).
    //  ⚠ 제품군은 반드시 process_id 가 가리키는 exam_processes.category_id 로 복원한다(공정명 문자열로 역추론 금지 → FLASH-CVD/DRAM-CVD 혼동 방지).
    if (processId) { const p = find("exam_processes", processId); if (!groupId) groupId = String(p?.group_id ?? ""); if (!categoryId) categoryId = String(p?.category_id ?? ""); if (!partId) partId = String(p?.part_id ?? ""); }
    if (!groupId && partId) { const pt = find("exam_parts", partId); groupId = String(pt?.group_id ?? ""); if (!categoryId) categoryId = String(pt?.category_id ?? ""); }
    if (!categoryId && groupId) { const g = find("exam_groups", groupId); categoryId = String(g?.category_id ?? ""); }
    const scope: ExamRow = {};
    for (const c of transientRefs) {
      if (c.refTable === "exam_categories") scope[c.key] = categoryId || null;
      else if (c.refTable === "exam_groups") scope[c.key] = groupId || null;
      else if (c.refTable === "exam_parts") scope[c.key] = partId || null;
    }
    return { ...r, ...scope };
  };
  const openEdit = (r: ExamRow) => setEditRow(withEditScope(r));

  // 하위 빠른 추가: 현재 행에서 자식 등록에 필요한 상위 FK(제품군/그룹/제품·파트/공정)를 도출한다(실제 FK만 · 이름 매칭 금지).
  const buildChildScope = (row: ExamRow): ExamRow => {
    const find = (t: string, id: string) => (refMap[t] || []).find((o) => o.id === String(id));
    let categoryId = "", groupId = "", partId = "", processId = "";
    switch (config.table) {
      case "exam_categories": categoryId = String(row.id ?? ""); break;
      case "exam_groups": groupId = String(row.id ?? ""); categoryId = String(row.category_id ?? ""); break;
      case "exam_parts": partId = String(row.id ?? ""); groupId = String(row.group_id ?? ""); categoryId = String(row.category_id ?? ""); break;
      case "exam_processes": processId = String(row.id ?? ""); groupId = String(row.group_id ?? ""); partId = String(row.part_id ?? ""); break;
      case "exam_equipment": processId = String(row.process_id ?? ""); break;
    }
    if (processId && !groupId) { const p = find("exam_processes", processId); groupId = String(p?.group_id ?? ""); if (!partId) partId = String(p?.part_id ?? ""); }
    if (!partId && processId) { const p = find("exam_processes", processId); partId = String(p?.part_id ?? ""); }
    if (!groupId && partId) { const pt = find("exam_parts", partId); groupId = String(pt?.group_id ?? ""); if (!categoryId) categoryId = String(pt?.category_id ?? ""); }
    if (!categoryId && groupId) { const g = find("exam_groups", groupId); categoryId = String(g?.category_id ?? ""); }
    return { category_id: categoryId || null, group_id: groupId || null, part_id: partId || null, process_id: processId || null };
  };
  const quickAddChild = (row: ExamRow) => {
    const child = CHILD_TAB[config.table];
    if (!child || !onQuickAdd) return;
    onQuickAdd(child.key, buildChildScope(row));
  };
  // 자식 그리드로 열릴 때: 전달받은 상위 FK 스코프로 신규 등록 모달을 연다(저장되는 참조 컬럼만 세팅 → transient 는 withEditScope 가 역복원).
  const initChildEditConsumedRef = useRef(false);
  useEffect(() => {
    if (!initialEdit || loading || Object.keys(refMap).length === 0 || initChildEditConsumedRef.current) return;
    const e: ExamRow = {};
    for (const c of config.columns) {
      if (c.type === "ref" && !c.transient && initialEdit[c.key] != null) e[c.key] = initialEdit[c.key];
    }
    initChildEditConsumedRef.current = true;
    setEditRow(withEditScope(e));
    onInitialEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEdit, loading, refMap]);
  const tableKeyDown = useTableKeyboardNav({
    count: filtered.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => { if (canEdit && filtered[i]) openEdit(filtered[i]); },
  });

  // [8단계] 기준정보 등록 편의: 코드 자동제안 · 코드/이름 중복 검사 · 정렬순서 자동제안(기존 rows 재사용, 추가 조회 없음).
  const hasCol = (k: string) => config.columns.some((c) => c.key === k);
  const suggestCode = (name: string) => String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const nextSort = () => rows.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1;
  // [요구사항 5·계층 역전] 코드·품명 중복 검사는 "부모 스코프" 기준(전역 unique 금지).
  //   그룹: tenant 전역(독립 마스터) · 제품군: group_id · 공정: group_id+category_id · 장비: process_id.
  //   다른 부모 스코프면 같은 코드/이름 허용(예: 1그룹/CVD 와 2그룹/CVD).
  //   범위 필드가 없는 표(levels/rules 등)는 tenant 전역 검사.
  const CODE_SCOPE_PARENT: Record<string, string[] | undefined> = {
    exam_groups: undefined,                         // tenant 전역(독립)
    exam_categories: ["group_id"],                  // 같은 그룹 내에서만
    exam_parts: ["group_id"],                       // (hidden·legacy)
    exam_processes: ["group_id", "category_id"],    // 같은 그룹+제품군 내에서만
    exam_equipment: ["process_id"],                 // 같은 공정 내에서만
  };
  const scopeFields = config.table in CODE_SCOPE_PARENT ? CODE_SCOPE_PARENT[config.table] : undefined;
  const sameScope = (r: ExamRow) => !scopeFields || scopeFields.every((f) => String(r[f] ?? "") === String(editRow?.[f] ?? ""));
  const codeDup = useMemo(() => {
    if (!editRow || !hasCol("code")) return false;
    const v = String(editRow.code ?? "").trim().toUpperCase(); if (!v) return false;
    return rows.some((r) => r.id !== editRow.id && String(r.code ?? "").trim().toUpperCase() === v && sameScope(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRow, rows, config.columns]);
  const nameDup = useMemo(() => {
    if (!editRow || !hasCol("name")) return false;
    const v = String(editRow.name ?? "").trim(); if (!v) return false;
    return rows.some((r) => r.id !== editRow.id && String(r.name ?? "").trim() === v && sameScope(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRow, rows, config.columns]);

  const saveRow = async () => {
    if (!editRow) return;
    if (saving) return; // 재진입 차단: disabled={saving} 는 리렌더 후에만 적용되어 빠른 연속 클릭이 2회 발송될 수 있음.
    for (const c of config.columns) {
      if (c.transient) continue; // 필터 전용 필드는 저장/필수 대상 아님
      if (c.required && !String(editRow[c.key] ?? "").trim()) { setError(`${c.label}은(는) 필수입니다.`); return; }
    }
    // [장비 안전보강] 계층(그룹→제품군→공정→장비)상 공정 없는 장비 저장 금지. 신규/수정 공통으로 화면에서 먼저 차단.
    if (config.table === "exam_equipment" && !String(editRow.process_id ?? "").trim()) { setError("공정을 선택해 주세요."); return; }
    // [인증 규칙 전용] 기준 구분→제품군→그룹→공정 전체 선택 필수(제품/파트 단계 제거). 적용 라인은 선택.
    if (isRules) {
      if (!String(editRow.rule_type ?? "").trim()) { setError("기준 구분을 선택해 주세요."); return; }
      if (!String(editRow.category_id ?? "").trim()) { setError("적용 제품군을 선택해 주세요."); return; }
      if (!String(editRow.group_id ?? "").trim()) { setError("적용 그룹을 선택해 주세요."); return; }
      if (!String(editRow.process_id ?? "").trim()) { setError("적용 공정을 선택해 주세요."); return; }
    }
    // 종속 무결성: 하위 선택이 상위에 속하는지 검증(참조 FK 가 있을 때만 — 없으면 텍스트/레거시 호환으로 통과).
    for (const c of refColumns) {
      if (!c.filterBy) continue;
      const childId = String(editRow[c.key] ?? ""); if (!childId) continue;
      const opt = (refMap[c.refTable as string] || []).find((o) => o.id === childId);
      if (opt && !matchesFilter(c, opt, editRow)) { setError(`선택한 ${c.label}은(는) 상위 항목에 속하지 않습니다.`); return; }
    }
    if (codeDup) { setError("동일한 코드가 이미 있습니다. 다른 코드를 사용하세요."); return; } // 저장 차단(코드 중복)
    setSaving(true); setError(null);
    try {
      const isNew = !editRow.id;
      const before = isNew ? null : rows.find((r) => r.id === editRow.id) || null;
      // 필터 전용(transient) 필드는 DB 로 보내지 않는다(없는 컬럼 강제 저장 방지).
      const payload: ExamRow = { ...editRow };
      for (const c of config.columns) if (c.transient) delete payload[c.key];
      const saved = await upsertExamRow(config.table, payload, tenantId, userId);
      await writeExamAudit(tenantId, userId, config.table, String(saved.id), isNew ? "create" : "update", before, saved);
      setEditRow(null);
      onToast?.(isNew ? `${config.title} 항목이 등록되었습니다.` : `${config.title} 항목이 수정되었습니다.`);
      await reload();
    } catch (e) {
      setError((e as { message?: string })?.message || "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (r: ExamRow) => {
    if (!r.id) return;
    try {
      await softDeleteExamRow(config.table, String(r.id), userId);
      await writeExamAudit(tenantId, userId, config.table, String(r.id), "delete", r, null);
      onToast?.(`${config.title} 항목이 삭제되었습니다.`);
      await reload();
    } catch (e) {
      setError((e as { message?: string })?.message || "삭제하지 못했습니다.");
    }
  };

  const toggleActive = async (r: ExamRow) => {
    if (!r.id) return;
    const next = r.is_active === false;
    try {
      await setExamRowActive(config.table, String(r.id), next, userId);
      await writeExamAudit(tenantId, userId, config.table, String(r.id), "toggle", { is_active: r.is_active }, { is_active: next });
      await reload();
    } catch (e) {
      setError((e as { message?: string })?.message || "변경하지 못했습니다.");
    }
  };

  const openHistory = async (r: ExamRow) => {
    setHistoryRow(r);
    try { setHistoryList(await listExamAudit(tenantId, config.table, String(r.id))); }
    catch { setHistoryList([]); }
  };

  const exportExcel = () => {
    // 장비 목록: 그룹/제품군 파생 컬럼을 앞에 붙이고, 공정 셀은 "공정만"(상위경로 결합 금지). 통합 다운로드와 동일한 단일 resolver 재사용.
    const equipRefs = derivedColumns.length ? {
      processById: new Map((refMap["exam_processes"] || []).map((o) => [o.id, { group_id: o.group_id ?? null, category_id: o.category_id ?? null, label: examRefLabel(o) }])),
      groupLabelById: new Map((refMap["exam_groups"] || []).map((o) => [o.id, examRefLabel(o)])),
      categoryLabelById: new Map((refMap["exam_categories"] || []).map((o) => [o.id, examRefLabel(o)])),
    } : null;
    const data = filtered.map((r) => {
      const o: Record<string, string> = {};
      const h = equipRefs ? resolveEquipmentHierarchy(r, equipRefs) : null;
      derivedColumns.forEach((d) => { o[d.label] = h ? (d.pick === "group_id" ? h.group : h.category) : ""; });
      // 공정 컬럼은 파생 resolver 의 순수 라벨(코드·이름)로 대체해 "CVD · CVD · 평택 · 기술1그룹" 결합 문자열을 방지.
      tableColumns.forEach((c) => { o[c.label] = (h && c.key === "process_id") ? h.process : cellText(c, r); });
      o["사용여부"] = r.is_active === false ? "미사용" : "사용";
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.title);
    XLSX.writeFile(wb, `시험관리_${config.title}.xlsx`);
  };

  const importExcel = async (file: File) => {
    setError(null);
    // 헤더 정규화: 앞뒤 공백/제로폭 문자(ZWSP·ZWJ·BOM)/대소문자 차이로 c.label 과 정확히 일치하지 않아 값이 누락되는 것을 방지.
    const normHeader = (s: string) => s.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const raw = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }) : [];

      // [진단] 개발 환경에서만 업로드 흐름을 구조화해 1회 출력(원시 행/개인정보 미출력 — 첫 행 키와 개수만).
      const firstRowKeys = raw.length ? Object.keys(raw[0]) : [];
      const normalizedHeaders = firstRowKeys.map(normHeader);
      const requiredCols = tableColumns.filter((c) => c.required).map((c) => ({ key: c.key, label: c.label }));

      // A. 파싱 결과가 0건 → 데이터/시트 문제. "0건 등록"으로 위장하지 않는다.
      if (raw.length === 0) {
        if (import.meta.env.DEV) console.warn("[ExamMasterGrid][ExcelImport] 파싱 0건", { masterType: config.table, sheetNames: wb.SheetNames, sheetName });
        setError("등록할 데이터가 없습니다. Excel 헤더와 데이터 행을 확인해 주세요.");
        return;
      }
      // B. 필수 헤더 누락 → 어떤 컬럼이 없는지 명확히 안내(모든 행이 조용히 skip 되는 것 방지).
      const headerSet = new Set(normalizedHeaders);
      const missingRequired = requiredCols.filter((c) => !headerSet.has(normHeader(c.label)));
      if (missingRequired.length > 0) {
        if (import.meta.env.DEV) console.warn("[ExamMasterGrid][ExcelImport] 필수 헤더 누락", { masterType: config.table, firstRowKeys, normalizedHeaders, missing: missingRequired });
        setError(`필수 컬럼 ‘${missingRequired.map((c) => c.label).join(", ")}’을(를) 찾을 수 없습니다. Excel 헤더를 확인해 주세요.`);
        return;
      }

      const rowErrors: Array<{ row: number; reason: string }> = [];
      const toSave: ExamRow[] = [];
      let refFailed = 0;
      // [3~5] 계층형 참조 해석기. 표시 라벨이 아니라 "코드·이름 정확일치 + 상위 parent FK 범위"로 연결한다.
      //  동일 이름이 다른 상위 경로에 있어도 부모 범위가 다르면 별도 기준정보로 정상 처리(모호 아님).
      const eqTxt = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
      const eqId = (a: unknown, b: string) => String(a ?? "") === b;
      const active = (list: RefOpt[]) => list.filter((o) => o.is_active !== false);
      const pickId = (cands: RefOpt[], p: { code: string; name: string }): string[] => {
        const m = p.code && p.name
          ? cands.filter((o) => eqTxt(o.code, p.code) && eqTxt(o.name, p.name))     // "코드 · 이름" 둘 다 일치
          : cands.filter((o) => eqTxt(o.code, p.code || p.name) || eqTxt(o.name, p.code || p.name)); // 단일 토큰: 코드 또는 이름
        return Array.from(new Set(m.map((o) => o.id)));
      };
      const cats = active(refMap["exam_categories"] || []);
      const groups = active(refMap["exam_groups"] || []);
      const procs = active(refMap["exam_processes"] || []);

      raw.forEach((r, idx) => {
        const rowByNorm = new Map<string, unknown>();
        for (const [k, val] of Object.entries(r)) rowByNorm.set(normHeader(k), val);
        const cell = (label: string) => (rowByNorm.has(normHeader(label)) ? rowByNorm.get(normHeader(label)) : "");
        const cellPath = (labels: string[]) => { for (const l of labels) { const v = String(cell(l) ?? "").trim(); if (v) return v; } return ""; };

        // [계층 역전] 상위 경로 해석: 그룹(독립) → 제품군(그룹 소속) → 공정(제품군 소속, group fallback). "적용 …"(인증 규칙) 헤더도 인식.
        const grpRaw = cellPath(["그룹", "적용 그룹"]);
        const catRaw = cellPath(["제품군", "적용 제품군"]);
        const procRaw = cellPath(["공정", "적용 공정"]);
        const chain: { category_id: string; group_id: string; part_id: string; process_id: string; error: string } = { category_id: "", group_id: "", part_id: "", process_id: "", error: "" };
        const resolveLevel = (rawVal: string, cands: RefOpt[], label: string, pathPrefix: string): string => {
          if (!rawVal) return "";
          const ids = pickId(cands, parseMasterRefValue(rawVal));
          if (ids.length === 0) { chain.error = chain.error || `${pathPrefix ? `‘${pathPrefix}’ 아래에서 ` : ""}${label} ‘${rawVal}’을(를) 찾을 수 없습니다`; refFailed++; return ""; }
          if (ids.length > 1) { chain.error = chain.error || `${pathPrefix ? `‘${pathPrefix}’ 아래에 ` : ""}동일한 ${label} ‘${rawVal}’이(가) 여러 건 존재합니다`; refFailed++; return ""; }
          return ids[0];
        };
        if (grpRaw) chain.group_id = resolveLevel(grpRaw, groups, "그룹", "");
        if (!chain.error && catRaw) {
          if (!chain.group_id) chain.error = `제품군 ‘${catRaw}’의 상위 그룹을 확인할 수 없습니다`;
          else chain.category_id = resolveLevel(catRaw, cats.filter((c) => eqId(c.group_id, chain.group_id)), "제품군", grpRaw);
        }
        if (!chain.error && procRaw) {
          if (!chain.group_id) chain.error = `공정 ‘${procRaw}’의 상위 그룹을 확인할 수 없습니다`;
          else {
            const cands = chain.category_id
              ? procs.filter((p) => eqId(p.category_id, chain.category_id) || (!p.category_id && eqId(p.group_id, chain.group_id)))
              : procs.filter((p) => eqId(p.group_id, chain.group_id));
            chain.process_id = resolveLevel(procRaw, cands, "공정", chain.category_id ? `${grpRaw} > ${catRaw}` : grpRaw);
          }
        }

        const row: ExamRow = {};
        let rowErr = chain.error;
        for (const c of tableColumns) {
          const v = String(cell(c.label) ?? "").trim();
          if (c.type === "ref") {
            // 계층 참조는 위에서 해석한 chain 값을 사용(라벨 매칭 금지). 그 외 참조(예: 인증레벨)는 코드·이름 정확일치.
            if (c.key === "category_id" || c.key === "group_id" || c.key === "part_id" || c.key === "process_id") {
              row[c.key] = (chain as Record<string, string>)[c.key] || null;
            } else if (!v) {
              row[c.key] = null;
            } else {
              const ids = pickId(active(refMap[c.refTable as string] || []), parseMasterRefValue(v));
              if (ids.length === 0) { rowErr = rowErr || `${c.label} ‘${v}’을(를) 기준정보에서 찾을 수 없습니다`; refFailed++; }
              else if (ids.length > 1) { rowErr = rowErr || `${c.label} ‘${v}’이(가) 여러 건 존재합니다`; refFailed++; }
              else row[c.key] = ids[0];
            }
          } else if (c.type === "number") {
            row[c.key] = v === "" ? null : Number(v.replace(/[^0-9.-]/g, ""));
          } else if (c.type === "boolean") {
            row[c.key] = /^(예|y|yes|true|1|자동|사용|o)$/i.test(v);
          } else {
            row[c.key] = v || null;
          }
          if (c.required && !v) rowErr = rowErr || `${c.label} 누락`;
        }
        // [장비 안전보강] 공정 미해석 장비 행은 저장하지 않는다(process_id null INSERT 금지).
        if (!rowErr && config.table === "exam_equipment" && !String(row.process_id ?? "").trim()) rowErr = "장비를 등록하려면 그룹·제품군·공정을 먼저 지정해야 합니다";
        if (rowErr) rowErrors.push({ row: idx + 2, reason: rowErr }); // +2: 헤더 1행 + 1-based
        else {
          // [scoped 신규/수정] 같은 부모 스코프 identity(code)가 있으면 그 행을 UPDATE, 없으면 INSERT.
          //  다른 부모 스코프의 같은 code 는 별개 행으로 취급(update 안 함).
          const existId = findScopedExistingId(rows, config.table, row);
          if (existId) row.id = existId;
          toSave.push(row);
        }
      });

      // D. 저장(행별 오류를 잡아 전체가 멈추지 않게 하고, 실제 Supabase 오류는 콘솔에만 남긴다).
      let ok = 0; const saveErrors: Array<{ row: number; reason: string }> = [];
      for (let i = 0; i < toSave.length; i++) {
        try {
          const saved = await upsertExamRow(config.table, toSave[i], tenantId, userId);
          await writeExamAudit(tenantId, userId, config.table, String(saved.id), "import", null, saved);
          ok++;
        } catch (e) {
          const err = e as { code?: unknown; message?: string; details?: unknown; hint?: unknown };
          console.error("[ExamMasterGrid][ExcelImport] 저장 실패", { masterType: config.table, code: err?.code, message: err?.message, details: err?.details, hint: err?.hint });
          saveErrors.push({ row: i, reason: translateExamWriteError(e) });
        }
      }

      const failCount = rowErrors.length + saveErrors.length;
      if (import.meta.env.DEV) {
        console.group("[Exam Excel Import Debug]");
        console.log({ masterType: config.table, sheetNames: wb.SheetNames, sheetName, parsedRowCount: raw.length, firstRowKeys, normalizedHeaders, requiredColumns: requiredCols, refFailedCount: refFailed, validRowCount: toSave.length, invalidRowCount: rowErrors.length, saveTargetCount: toSave.length, successCount: ok, failedCount: failCount });
        if (rowErrors.length) console.log("검증 실패 행:", rowErrors.slice(0, 20));
        console.groupEnd();
      }

      // 오류 상세는 "같은 사유"를 묶어 행 범위로 표시(동일 문구 반복 방지 · 최대 5개 사유).
      const byReason = new Map<string, number[]>();
      for (const e of [...rowErrors, ...saveErrors.map((s) => ({ row: 0, reason: s.reason }))]) {
        (byReason.get(e.reason) ?? byReason.set(e.reason, []).get(e.reason)!).push(e.row);
      }
      const errPreview = [...byReason.entries()].slice(0, 5).map(([reason, rowsArr]) => {
        const rs = rowsArr.filter(Boolean).sort((a, b) => a - b);
        const range = rs.length === 0 ? "" : rs.length === 1 ? `${rs[0]}행: ` : `${rs[0]}~${rs[rs.length - 1]}행 등 ${rs.length}건: `;
        return `${range}${reason}`;
      }).join(" · ");

      // [7] 성공/실패 건수 구분 토스트.
      if (ok > 0 && failCount === 0) onToast?.(`${config.title} Excel ${ok}건을 등록했습니다.`);
      else if (ok > 0 && failCount > 0) { onToast?.(`${config.title} Excel ${raw.length}건 중 ${ok}건을 등록했고 ${failCount}건은 실패했습니다.`); if (errPreview) setError(`일부 실패: ${errPreview}`); }
      else setError(`${config.title} Excel 등록에 실패했습니다.${errPreview ? ` (${errPreview})` : " 오류 내용을 확인해 주세요."}`);

      if (ok > 0) await reload();
    } catch (e) {
      console.error("[ExamMasterGrid][ExcelImport] 처리 실패", e);
      setError((e as { message?: string })?.message || "Excel 등록에 실패했습니다.");
    }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div>
      {/* 툴바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 조회용 계단식 필터(그룹 → 제품군 → 공정): 표시 전용 · 상위 변경 시 하위 초기화 · 저장 데이터 불변. */}
        {hierFilterOn && (
          <>
            <select value={filterGroup} onChange={(e) => changeFilterGroup(e.target.value)} aria-label="그룹 필터" className={inputCls}>
              <option value="">그룹: 전체</option>
              {filterGroupOpts.map((o) => <option key={o.id} value={o.id}>{optName(o)}</option>)}
            </select>
            <select value={filterCat} onChange={(e) => changeFilterCat(e.target.value)} aria-label="제품군 필터" className={inputCls}>
              <option value="">제품군: 전체</option>
              {filterCatOpts.map((o) => <option key={o.id} value={o.id}>{optName(o)}</option>)}
            </select>
            <select value={filterProc} onChange={(e) => setFilterProc(e.target.value)} aria-label="공정 필터" className={inputCls}>
              <option value="">공정: 전체</option>
              {filterProcOpts.map((o) => <option key={o.id} value={o.id}>{optName(o)}</option>)}
            </select>
          </>
        )}
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as "전체" | "사용" | "미사용")} className={inputCls}>
          <option value="전체">사용여부: 전체</option>
          <option value="사용">사용</option>
          <option value="미사용">미사용</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색" className={`${inputCls} min-w-[160px]`} />
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel 내보내기</button>
          {canEdit && (
            <label className={`${btn} cursor-pointer`}>
              Excel 등록
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); e.currentTarget.value = ""; }} />
            </label>
          )}
          {canEdit && <button className="rounded-xl bg-slate-900 inline-flex items-center justify-center min-h-[42px] min-w-[72px] px-5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap" onClick={openAdd}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      {/* 테이블 */}
      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label={`${config.title} 목록`} className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
              {/* 파생 표시 컬럼(그룹/제품군): 표시 전용이므로 정렬 대상에서 제외(기존 정렬 동작 불변). */}
              {derivedColumns.map((c) => (
                <th key={c.key} className="select-none whitespace-nowrap px-3 py-2">{c.label}</th>
              ))}
              {tableColumns.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:underline">
                  {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="px-3 py-2 whitespace-nowrap">사용여부</th>
              <th className="px-3 py-2 whitespace-nowrap">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, ri) => (
              <tr key={String(r.id)} aria-selected={ri === activeIdx} title={canEdit ? "클릭하여 수정" : undefined}
                onClick={() => { setActiveIdx(ri); if (canEdit) openEdit(r); }}
                className={`${ri === activeIdx ? (darkMode ? "ring-1 ring-inset ring-blue-500 bg-slate-800/60" : "ring-1 ring-inset ring-blue-400 bg-blue-50/60") : ""} border-t ${canEdit ? "cursor-pointer" : ""} ${darkMode ? "border-slate-700 hover:bg-slate-800/60" : "border-slate-100 hover:bg-slate-50"}`}>
                {/* 파생 표시(그룹/제품군): 길면 말줄임 + title(전체값 툴팁). 좁은 화면은 테이블 컨테이너 가로 스크롤. */}
                {derivedColumns.map((c) => { const t = derivedText(c, r); return (
                  <td key={c.key} className="px-3 py-2"><span className="block max-w-[160px] truncate" title={t}>{t}</span></td>
                ); })}
                {tableColumns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2">{cellDisplay(c, r)}</td>)}
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active === false ? "bg-slate-200 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>{r.is_active === false ? "미사용" : "사용"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {/* 행 클릭(=수정)과 충돌하지 않도록 각 액션 버튼은 전파를 차단한다(§16·§34). */}
                  <button className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                  {canEdit && <><span className="mx-1 text-slate-300">·</span>
                    <button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>수정</button>
                    {CHILD_TAB[config.table] && onQuickAdd && <>
                      <span className="mx-1 text-slate-300">·</span>
                      <button className="text-emerald-600 hover:underline" title={`이 항목 아래에 ${CHILD_TAB[config.table].title} 추가`} onClick={(e) => { e.stopPropagation(); quickAddChild(r); }}>{CHILD_TAB[config.table].title} 추가</button>
                    </>}
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void toggleActive(r); }}>{r.is_active === false ? "사용" : "미사용"}</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button>
                  </>}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={derivedColumns.length + tableColumns.length + 2} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">총 {filtered.length}건</div>

      {/* 등록/수정 모달 */}
      {editRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={requestCloseEdit}>
          <div role="dialog" aria-modal="true" aria-labelledby="exam-master-edit-title" tabIndex={-1} className={`my-8 w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h3 id="exam-master-edit-title" className="mb-4 text-lg font-semibold">{editRow.id ? `${config.title} 수정` : `${config.title} 등록`}</h3>
            <div className="space-y-3">
              {config.columns.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">{c.label}{c.required && <span className="text-rose-500"> *</span>}</label>
                  {c.type === "ref" ? (() => {
                    const gate = rulesGate(c.key);
                    const opts = gate.disabled ? [] : optionsFor(c, editRow); // 게이팅 중에는 하위 목록을 계산/노출하지 않음(중복 방지)
                    const parentMissing = !!c.filterBy && !String(editRow[c.filterBy.formKey] ?? "");
                    return (
                      <>
                        <select className={`${inputCls} w-full ${gate.disabled ? "cursor-not-allowed opacity-60" : ""}`} disabled={gate.disabled} value={String(editRow[c.key] ?? "")} onChange={(e) => changeRef(c.key, e.target.value)}>
                          <option value="">선택 안 함</option>
                          {/* 표시(label)만 이름으로: 상위 드롭다운으로 이미 범위가 좁혀졌으므로 상위 경로/코드는 반복 표시하지 않는다.
                              저장값(o.id)·FK·Excel·조회는 불변. name 이 없을 때만 기존 label 로 안전 폴백. */}
                          {opts.map((o) => <option key={o.id} value={o.id}>{(o.name && o.name.trim()) || o.label}{o.is_active ? "" : " (미사용)"}</option>)}
                        </select>
                        {gate.disabled ? <p className="mt-1 text-xs text-slate-400">{gate.reason}</p>
                          : parentMissing ? <p className="mt-1 text-xs text-slate-400">상위 항목을 먼저 선택하면 목록이 좁혀집니다.</p>
                            : opts.length === 0 ? <p className="mt-1 text-xs text-amber-600">선택 가능한 항목이 없습니다.</p> : null}
                      </>
                    );
                  })() : c.type === "boolean" ? (
                    <select className={`${inputCls} w-full`} value={editRow[c.key] === true ? "true" : "false"} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value === "true" }))}>
                      <option value="false">아니오</option>
                      <option value="true">예</option>
                    </select>
                  ) : c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => { if (isRules && c.key === "rule_type") changeRuleType(e.target.value); else setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null })); }}>
                      <option value="">선택</option>
                      {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : c.key === "code" ? (
                    <div>
                      <div className="flex items-center gap-1">
                        <input type="text" className={`${inputCls} w-full`} value={String(editRow.code ?? "")}
                          onChange={(e) => setEditRow((f) => ({ ...(f || {}), code: e.target.value || null }))} />
                        {String(editRow.name ?? "").trim() && <button type="button" className="shrink-0 rounded-lg bg-blue-100 px-2 py-2 text-xs font-medium text-blue-700 hover:bg-blue-200" title="이름 기준 코드 제안(확인 후 저장)" onClick={() => setEditRow((f) => ({ ...(f || {}), code: suggestCode(String(f?.name ?? "")) || f?.code || null }))}>제안</button>}
                      </div>
                      {codeDup && <p className="mt-1 text-xs text-rose-600">동일한 코드가 이미 있습니다.</p>}
                    </div>
                  ) : c.key === "sort_order" ? (
                    <div className="flex items-center gap-1">
                      <input type="text" inputMode="numeric" className={`${inputCls} w-full`} value={String(editRow.sort_order ?? "")}
                        onChange={(e) => setEditRow((f) => ({ ...(f || {}), sort_order: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, "")) }))} />
                      <button type="button" className="shrink-0 rounded-lg bg-slate-100 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200" title="다음 정렬순서 제안" onClick={() => setEditRow((f) => ({ ...(f || {}), sort_order: nextSort() }))}>다음</button>
                    </div>
                  ) : c.key === "name" ? (
                    <div>
                      <input type="text" className={`${inputCls} w-full`} value={String(editRow.name ?? "")}
                        onChange={(e) => setEditRow((f) => ({ ...(f || {}), name: e.target.value || null }))} />
                      {nameDup && <p className="mt-1 text-xs text-amber-600">같은 이름이 이미 있습니다(중복 가능성 확인).</p>}
                    </div>
                  ) : (
                    <input type={c.type === "number" ? "text" : c.type === "date" ? "date" : "text"} inputMode={c.type === "number" ? "numeric" : undefined}
                      className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "").slice(0, c.type === "date" ? 10 : undefined)}
                      onChange={(e) => { const v = c.type === "number" ? (e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9.-]/g, ""))) : (e.target.value || null); setEditRow((f) => ({ ...(f || {}), [c.key]: v })); }} />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={requestCloseEdit} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-50"}`}>취소</button>
              <button type="button" data-modal-save onClick={() => void saveRow()} disabled={saving} className={`min-h-[44px] rounded-2xl px-4 py-2 text-sm font-semibold text-white ${saving ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>{saving ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 변경이력 모달 */}
      {historyRow && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setHistoryRow(null)}>
          <div className={`my-8 w-full max-w-lg rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">변경이력</h3>
              <button onClick={() => setHistoryRow(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <div className="max-h-[50vh] overflow-auto">
              {historyList.length ? historyList.map((h) => (
                <div key={String(h.id)} className={`border-b py-2 text-xs ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <span className="font-semibold">{String(h.action_type)}</span>
                  <span className="ml-2 text-slate-400">{String(h.created_at || "").slice(0, 19).replace("T", " ")}</span>
                </div>
              )) : <div className="py-8 text-center text-sm text-slate-500">변경이력이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesDialog open={confirmClose} darkMode={darkMode}
        onKeepEditing={() => setConfirmClose(false)}
        onDiscard={() => { setConfirmClose(false); setEditRow(null); }}
        onSave={() => { setConfirmClose(false); void saveRow(); }} />
    </div>
  );
}
