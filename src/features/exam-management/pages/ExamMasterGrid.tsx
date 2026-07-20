import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useRegisteredOverlay, useTableKeyboardNav } from "../../../hooks/overlayA11y";
import { UnsavedChangesDialog } from "../../../components/UnsavedChangesDialog";
import type { ExamColumn, ExamEntityConfig } from "../examMasterConfigs";
import {
  listExamRows, upsertExamRow, softDeleteExamRow, setExamRowActive,
  writeExamAudit, listExamAudit, examSupabaseReady, type ExamRow, type ExamMasterTable,
} from "../services/examMasterService";

// 참조 옵션은 라벨뿐 아니라 상위 FK(category_id/group_id/part_id/process_id)와 활성여부를 함께 싣는다(종속 선택용).
type RefOpt = { id: string; label: string; is_active: boolean; category_id?: string | null; group_id?: string | null; part_id?: string | null; process_id?: string | null };

export default function ExamMasterGrid({
  config, darkMode, canEdit, tenantId, userId, onToast,
}: {
  config: ExamEntityConfig;
  darkMode: boolean;
  canEdit: boolean;
  tenantId: string;
  userId: string;
  onToast?: (msg: string) => void;
}) {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [refMap, setRefMap] = useState<Record<string, RefOpt[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"전체" | "사용" | "미사용">("전체");
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

  const reload = useCallback(async () => {
    if (!examSupabaseReady()) { setError("Supabase 연결이 필요합니다."); setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const refTables = Array.from(new Set(refColumns.map((c) => c.refTable as ExamMasterTable)));
      const [data, refs] = await Promise.all([
        listExamRows(config.table, tenantId),
        Promise.all(refTables.map(async (t) => {
          const refRows = await listExamRows(t, tenantId); // RLS 로 현재 tenant·권한 범위만. 비활성 포함(수정 화면 표시용).
          const opts: RefOpt[] = refRows.map((r) => ({
            id: String(r.id),
            label: [r.code, r.name].filter(Boolean).join(" · ") || String(r.name ?? r.id),
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
      // [16] 동일 코드·품명이 서로 다른 상위 범위에 존재할 수 있으므로, 라벨이 겹치는 항목에만
      //  상위 경로를 덧붙여 구분한다(예: "검사 · DRAM > 2그룹 > ETCH AMAT").
      //  저장값은 그대로 row.id 이며, 겹치지 않는 항목의 라벨은 기존과 동일하게 유지한다.
      const refEntries: Record<string, RefOpt[]> = Object.fromEntries(refs);
      const byId: Record<string, Map<string, RefOpt>> = {};
      for (const [t, opts] of Object.entries(refEntries)) byId[t] = new Map(opts.map((o) => [o.id, o]));
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (activeFilter === "사용" && r.is_active === false) return false;
      if (activeFilter === "미사용" && r.is_active !== false) return false;
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
  }, [rows, search, activeFilter, sortKey, sortDir, refMap, config.columns]);

  const toggleSort = (k: string) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  const openAdd = () => setEditRow({});
  const openEdit = (r: ExamRow) => setEditRow({ ...r });
  const tableKeyDown = useTableKeyboardNav({
    count: filtered.length, active: activeIdx, setActive: setActiveIdx, pageSize: 10,
    onEnter: (i) => { if (canEdit && filtered[i]) openEdit(filtered[i]); },
  });

  // [8단계] 기준정보 등록 편의: 코드 자동제안 · 코드/이름 중복 검사 · 정렬순서 자동제안(기존 rows 재사용, 추가 조회 없음).
  const hasCol = (k: string) => config.columns.some((c) => c.key === k);
  const suggestCode = (name: string) => String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const nextSort = () => rows.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1;
  // [요구사항 5] 코드·품명 중복 검사는 "부모 범위" 기준(전역 unique 금지).
  //   제품군(exam_categories): tenant 전역 · 그룹: category_id · 제품/파트: group_id · 공정: part_id · 장비: process_id.
  //   범위 필드가 없는 표(levels/rules 등)는 기존대로 tenant 전역 검사.
  const CODE_SCOPE_PARENT: Record<string, string | undefined> = {
    exam_categories: undefined, // 전역
    exam_groups: "category_id",
    exam_parts: "group_id",
    exam_processes: "part_id",
    exam_equipment: "process_id",
  };
  const scopeField = config.table in CODE_SCOPE_PARENT ? CODE_SCOPE_PARENT[config.table] : undefined;
  const sameScope = (r: ExamRow) => !scopeField || String(r[scopeField] ?? "") === String(editRow?.[scopeField] ?? "");
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
    const data = filtered.map((r) => {
      const o: Record<string, string> = {};
      tableColumns.forEach((c) => { o[c.label] = cellText(c, r); });
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
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      let ok = 0;
      for (const r of raw) {
        const row: ExamRow = {};
        let hasRequired = true;
        for (const c of tableColumns) {
          const v = String(r[c.label] ?? "").trim();
          if (c.type === "ref") {
            // 빈 셀은 참조 미지정(null). (v==="" 일 때 startsWith 가 항상 참이 되어 첫 옵션이 잘못 배정되는 것을 방지)
            const opt = v ? (refMap[c.refTable as string] || []).find((o) => o.label === v || o.label.startsWith(v)) : undefined;
            row[c.key] = opt?.id ?? null;
          } else if (c.type === "number") {
            row[c.key] = v === "" ? null : Number(v.replace(/[^0-9.-]/g, ""));
          } else if (c.type === "boolean") {
            row[c.key] = /^(예|y|yes|true|1|자동|사용|o)$/i.test(v);
          } else {
            row[c.key] = v || null;
          }
          if (c.required && !v) hasRequired = false;
        }
        if (!hasRequired) continue;
        const saved = await upsertExamRow(config.table, row, tenantId, userId);
        await writeExamAudit(tenantId, userId, config.table, String(saved.id), "import", null, saved);
        ok++;
      }
      onToast?.(`${config.title} Excel ${ok}건을 등록했습니다.`);
      await reload();
    } catch (e) {
      setError((e as { message?: string })?.message || "Excel 등록에 실패했습니다.");
    }
  };

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const btn = darkMode ? "rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-800" : "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100";

  return (
    <div>
      {/* 툴바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색" className={`${inputCls} min-w-[160px]`} />
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as "전체" | "사용" | "미사용")} className={inputCls}>
          <option value="전체">사용여부: 전체</option>
          <option value="사용">사용</option>
          <option value="미사용">미사용</option>
        </select>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button className={btn} onClick={exportExcel}>Excel 내보내기</button>
          {canEdit && (
            <label className={`${btn} cursor-pointer`}>
              Excel 등록
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importExcel(f); e.currentTarget.value = ""; }} />
            </label>
          )}
          {canEdit && <button className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" onClick={openAdd}>등록</button>}
        </span>
      </div>

      {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
      {loading && <div className="mb-2 text-xs text-slate-500">불러오는 중…</div>}

      {/* 테이블 */}
      <div tabIndex={0} onKeyDown={tableKeyDown} aria-label={`${config.title} 목록`} className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>
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
                {tableColumns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2">{cellText(c, r)}</td>)}
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active === false ? "bg-slate-200 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>{r.is_active === false ? "미사용" : "사용"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {/* 행 클릭(=수정)과 충돌하지 않도록 각 액션 버튼은 전파를 차단한다(§16·§34). */}
                  <button className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={(e) => { e.stopPropagation(); void openHistory(r); }}>이력</button>
                  {canEdit && <><span className="mx-1 text-slate-300">·</span>
                    <button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>수정</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-slate-500 hover:underline" onClick={(e) => { e.stopPropagation(); void toggleActive(r); }}>{r.is_active === false ? "사용" : "미사용"}</button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button className="text-rose-600 hover:underline" onClick={(e) => { e.stopPropagation(); void removeRow(r); }}>삭제</button>
                  </>}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={tableColumns.length + 2} className="px-3 py-10 text-center text-slate-500">데이터가 없습니다.</td></tr>
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
                    const opts = optionsFor(c, editRow);
                    const parentMissing = !!c.filterBy && !String(editRow[c.filterBy.formKey] ?? "");
                    return (
                      <>
                        <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => changeRef(c.key, e.target.value)}>
                          <option value="">선택 안 함</option>
                          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}{o.is_active ? "" : " (미사용)"}</option>)}
                        </select>
                        {parentMissing && <p className="mt-1 text-xs text-slate-400">상위 항목을 먼저 선택하면 목록이 좁혀집니다.</p>}
                        {!parentMissing && opts.length === 0 && <p className="mt-1 text-xs text-amber-600">선택 가능한 항목이 없습니다.</p>}
                      </>
                    );
                  })() : c.type === "boolean" ? (
                    <select className={`${inputCls} w-full`} value={editRow[c.key] === true ? "true" : "false"} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value === "true" }))}>
                      <option value="false">아니오</option>
                      <option value="true">예</option>
                    </select>
                  ) : c.type === "select" ? (
                    <select className={`${inputCls} w-full`} value={String(editRow[c.key] ?? "")} onChange={(e) => setEditRow((f) => ({ ...(f || {}), [c.key]: e.target.value || null }))}>
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
