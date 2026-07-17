import { useCallback, useEffect, useMemo, useState } from "react";
import type { MenuItem, UserRole } from "../../../types";
import { SYSTEM_ROLES, computeMenuScope, isSystemRoleCode } from "../systemRoles";
import {
  loadCustomRoles, createCustomRole, updateCustomRole, cloneRole,
  setRoleActive, softDeleteRole, restoreRole, countAssignedUsers, validateRoleCode,
} from "../customRoleService";
import type { CustomRole, RoleKindFilter, RoleStatusFilter } from "../types";
import PermissionTreeEditor from "../PermissionTreeEditor";
import DataScopeEditor from "../DataScopeEditor";
import { loadRolePermissions } from "../customRolePermissionService";
import { loadRoleScopes } from "../customRoleScopeService";
import { countUsersForRole } from "../userCustomRoleService";
import { ACTION_LABEL, DANGER_ACTIONS, parsePermKey, buildPermissionTree } from "../permissionCatalog";
import { SCOPE_TYPE_LABEL, type ScopeRow } from "../scopeCatalog";

// 시스템 > 권한관리 화면.
//  - 기존 System Role(4종)은 읽기 전용·잠금(복제/상세만). custom_roles 만 CRUD.
//  - alert/confirm 은 부모의 앱 모달(appAlert/appConfirm)로 위임(window.* 금지).
//  - 실제 접근 제어는 RLS. 이 화면 자체 진입은 App.tsx 에서 admin 만 렌더/가드.
type Props = {
  darkMode: boolean;
  tenantId: string;
  userId: string;
  menus: MenuItem[];                                   // System Role 메뉴 범위 미리보기용
  userCountsBySystemRole: Record<string, number>;      // System Role 사용자 수
  onToast: (msg: string) => void;
  appAlert: (title: string, message: string) => Promise<void>;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  resolveUserName?: (id?: string | null) => string;
  dormOptions?: Array<{ id: string; label: string }>;   // 데이터 범위(기숙사 직접선택)용
};

type FormMode = { kind: "create" } | { kind: "edit"; role: CustomRole } | { kind: "clone"; sourceCode: string; sourceName: string; sourceBase: string | null };

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-");

export default function RoleManagementPage({
  darkMode, tenantId, userId, menus, userCountsBySystemRole, onToast, appAlert, appConfirm, resolveUserName, dormOptions = [],
}: Props) {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<RoleKindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<RoleStatusFilter>("all");

  const [form, setForm] = useState<FormMode | null>(null);
  const [detail, setDetail] = useState<{ system: UserRole } | { custom: CustomRole } | null>(null);

  const nameOf = useCallback((id?: string | null) => (resolveUserName ? resolveUserName(id) : (id || "-")), [resolveUserName]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await loadCustomRoles(tenantId);
    setRoles(res.roles);
    setTableMissing(res.tableMissing);
    if (res.error) setLoadError(res.error);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void reload(); }, [reload]);

  // ── 표시용 행 조립: System Role(가상) + Custom Role ──────────────────────────
  type Row = {
    key: string; name: string; code: string; kind: "system" | "custom";
    base: string; status: "active" | "inactive" | "deleted"; users: number;
    createdBy: string; createdAt: string; updatedBy: string; updatedAt: string;
    system?: UserRole; custom?: CustomRole;
  };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    // System Role 행(항상 사용중, 사용자수는 profiles 집계).
    SYSTEM_ROLES.forEach((s) => {
      out.push({
        key: `sys-${s.code}`, name: s.name, code: s.code, kind: "system",
        base: "-", status: "active", users: userCountsBySystemRole[s.code] ?? 0,
        createdBy: "시스템", createdAt: "-", updatedBy: "-", updatedAt: "-", system: s.code,
      });
    });
    // Custom Role 행.
    roles.forEach((r) => {
      out.push({
        key: `cust-${r.id}`, name: r.name, code: r.code, kind: "custom",
        base: r.base_system_role || "-",
        status: r.is_deleted ? "deleted" : r.is_active ? "active" : "inactive",
        users: 0, createdBy: nameOf(r.created_by), createdAt: fmtDate(r.created_at),
        updatedBy: nameOf(r.updated_by), updatedAt: fmtDate(r.updated_at), custom: r,
      });
    });
    return out;
  }, [roles, userCountsBySystemRole, nameOf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, kindFilter, statusFilter]);

  // ── 액션 ─────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (values: { code: string; name: string; description: string; base: string | null; isActive: boolean; notes: string }) => {
    try {
      if (!form) return;
      if (!values.name.trim()) { await appAlert("권한관리", "권한명을 입력해주세요."); return; }
      if (form.kind === "edit") {
        await updateCustomRole(form.role.id, {
          name: values.name, description: values.description, base_system_role: values.base,
          is_active: values.isActive, notes: values.notes,
        }, tenantId, userId, form.role);
        onToast("사용자 정의 권한을 수정했습니다.");
      } else if (form.kind === "clone") {
        const codeErr = validateRoleCode(values.code);
        if (codeErr) { await appAlert("권한관리", codeErr); return; }
        await cloneRole(form.sourceCode, form.sourceBase, values.code, values.name, tenantId, userId);
        onToast(`'${form.sourceName}' 권한을 복제했습니다.`);
      } else {
        const codeErr = validateRoleCode(values.code);
        if (codeErr) { await appAlert("권한관리", codeErr); return; }
        await createCustomRole({
          code: values.code, name: values.name, description: values.description,
          base_system_role: values.base, is_active: values.isActive, notes: values.notes,
        }, tenantId, userId);
        onToast("사용자 정의 권한을 생성했습니다.");
      }
      setForm(null);
      await reload();
    } catch (e) {
      await appAlert("권한관리", (e as { message?: string })?.message || "저장 중 오류가 발생했습니다.");
    }
  }, [form, tenantId, userId, onToast, appAlert, reload]);

  const handleToggleActive = useCallback(async (r: CustomRole) => {
    try {
      await setRoleActive(r.id, !r.is_active, tenantId, userId, r);
      onToast(r.is_active ? "권한을 사용중지했습니다." : "권한을 다시 사용합니다.");
      await reload();
    } catch (e) {
      await appAlert("권한관리", (e as { message?: string })?.message || "상태 변경 중 오류가 발생했습니다.");
    }
  }, [tenantId, userId, onToast, appAlert, reload]);

  const handleDelete = useCallback(async (r: CustomRole) => {
    const assigned = await countAssignedUsers(r.id, tenantId);
    if (assigned > 0) {
      await appAlert("권한을 삭제할 수 없습니다", "현재 이 권한을 사용하는 계정이 있습니다.\n계정의 권한을 먼저 변경한 후 다시 시도해주세요.");
      return;
    }
    const ok = await appConfirm("사용자 정의 권한 삭제", `'${r.name}' 권한을 삭제(휴지)하시겠습니까?\n삭제 후에도 이력은 보관되며 복구할 수 있습니다.`, { tone: "danger", confirmText: "삭제" });
    if (!ok) return;
    try {
      await softDeleteRole(r.id, tenantId, userId, r);
      onToast("사용자 정의 권한을 삭제했습니다.");
      await reload();
    } catch (e) {
      await appAlert("권한관리", (e as { message?: string })?.message || "삭제 중 오류가 발생했습니다.");
    }
  }, [tenantId, userId, onToast, appAlert, appConfirm, reload]);

  const handleRestore = useCallback(async (r: CustomRole) => {
    try {
      await restoreRole(r.id, tenantId, userId, r);
      onToast("사용자 정의 권한을 복구했습니다.");
      await reload();
    } catch (e) {
      await appAlert("권한관리", (e as { message?: string })?.message || "복구 중 오류가 발생했습니다.");
    }
  }, [tenantId, userId, onToast, appAlert, reload]);

  const exportCsv = useCallback(() => {
    const header = ["권한명", "권한코드", "구분", "기준권한", "상태", "사용자수", "생성자", "생성일", "수정자", "수정일"];
    const statusLabel = (s: Row["status"]) => (s === "active" ? "사용중" : s === "inactive" ? "사용중지" : "삭제됨");
    const kindLabel = (k: Row["kind"]) => (k === "system" ? "시스템 기본" : "사용자 정의");
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    filtered.forEach((r) => lines.push([r.name, r.code, kindLabel(r.kind), r.base, statusLabel(r.status), String(r.users), r.createdBy, r.createdAt, r.updatedBy, r.updatedAt].map(esc).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `권한관리_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filtered]);

  // ── 스타일 헬퍼 ──────────────────────────────────────────────────────────────
  const card = darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200";
  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";
  const btnGhost = darkMode ? "border border-slate-600 text-slate-200 hover:bg-slate-800" : "border border-slate-300 text-slate-700 hover:bg-slate-100";
  const btnPrimary = "bg-slate-900 text-white hover:bg-slate-800";
  const statusChip = (s: Row["status"]) =>
    s === "active" ? "bg-emerald-100 text-emerald-700" : s === "inactive" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${card}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">권한관리</h2>
          <p className="text-sm text-slate-500">시스템 기본 권한은 잠금(읽기 전용)이며, 사용자 정의 권한만 생성·복제·수정·삭제할 수 있습니다.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm({ kind: "create" })} disabled={tableMissing} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${tableMissing ? "cursor-not-allowed bg-slate-300 text-slate-500" : btnPrimary}`}>+ 신규 권한</button>
          <button type="button" onClick={exportCsv} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${btnGhost}`}>내보내기</button>
        </div>
      </div>

      {tableMissing && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          권한관리 저장소(custom_roles)가 아직 적용되지 않았습니다. Supabase SQL Editor 에서 <b>20260718000000_custom_roles.sql</b> 실행 후 사용자 정의 권한 기능이 활성화됩니다. (시스템 기본 권한은 아래에서 확인 가능)
        </div>
      )}
      {loadError && !tableMissing && (
        <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">권한 목록을 불러오지 못했습니다: {loadError}</div>
      )}

      {/* 툴바 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="권한명·권한코드 검색" className={`rounded-2xl border px-3 py-2 text-sm ${inputCls}`} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as RoleKindFilter)} className={`rounded-2xl border px-3 py-2 text-sm ${inputCls}`}>
          <option value="all">구분: 전체</option>
          <option value="system">시스템 기본</option>
          <option value="custom">사용자 정의</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RoleStatusFilter)} className={`rounded-2xl border px-3 py-2 text-sm ${inputCls}`}>
          <option value="all">상태: 전체</option>
          <option value="active">사용중</option>
          <option value="inactive">사용중지</option>
          <option value="deleted">삭제됨</option>
        </select>
      </div>

      {/* 테이블 */}
      <div className={`overflow-x-auto rounded-2xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className={darkMode ? "bg-slate-950 text-slate-300" : "bg-slate-50 text-slate-600"}>
            <tr>
              {["권한명", "권한코드", "구분", "기준권한", "상태", "사용자수", "생성자", "생성일", "수정자", "수정일", "작업"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">불러오는 중…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">표시할 권한이 없습니다.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.key} className={darkMode ? "hover:bg-slate-800/50" : "hover:bg-slate-50"}>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{r.kind === "system" ? "🔒 " : ""}{r.name}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.kind === "system" ? "시스템 기본" : "사용자 정의"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.base}</td>
                <td className="whitespace-nowrap px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.status)}`}>{r.status === "active" ? "사용중" : r.status === "inactive" ? "사용중지" : "삭제됨"}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-center">{r.users}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.createdBy}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.createdAt}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.updatedBy}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{r.updatedAt}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.kind === "system" ? (
                      <>
                        <button type="button" onClick={() => setDetail({ system: r.system! })} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>상세보기</button>
                        <button type="button" disabled={tableMissing} onClick={() => setForm({ kind: "clone", sourceCode: r.code, sourceName: r.name, sourceBase: r.code })} className={`rounded-lg px-2 py-1 text-xs ${tableMissing ? "cursor-not-allowed text-slate-400" : btnGhost}`}>복제</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setDetail({ custom: r.custom! })} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>상세보기</button>
                        {r.status === "deleted" ? (
                          <button type="button" onClick={() => handleRestore(r.custom!)} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>복구</button>
                        ) : (
                          <>
                            <button type="button" onClick={() => setForm({ kind: "edit", role: r.custom! })} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>수정</button>
                            <button type="button" onClick={() => setForm({ kind: "clone", sourceCode: r.code, sourceName: r.name, sourceBase: r.custom!.base_system_role || null })} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>복제</button>
                            <button type="button" onClick={() => handleToggleActive(r.custom!)} className={`rounded-lg px-2 py-1 text-xs ${btnGhost}`}>{r.status === "active" ? "사용중지" : "사용"}</button>
                            <button type="button" onClick={() => handleDelete(r.custom!)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">삭제</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <RoleFormModal
          darkMode={darkMode} mode={form} menus={menus} tenantId={tenantId} actorId={userId} dormOptions={dormOptions}
          onToast={onToast} appConfirm={appConfirm} onClose={() => setForm(null)} onSubmit={handleSave}
        />
      )}
      {detail && (
        <RoleDetailModal
          darkMode={darkMode} detail={detail} menus={menus} tenantId={tenantId} onClose={() => setDetail(null)}
        />
      )}
    </section>
  );
}

// ── 등록/수정/복제 모달 ─────────────────────────────────────────────────────────
function RoleFormModal({
  darkMode, mode, menus, tenantId, actorId, dormOptions, onToast, appConfirm, onClose, onSubmit,
}: {
  darkMode: boolean;
  mode: FormMode;
  menus: MenuItem[];
  tenantId: string;
  actorId: string;
  dormOptions: Array<{ id: string; label: string }>;
  onToast: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onClose: () => void;
  onSubmit: (v: { code: string; name: string; description: string; base: string | null; isActive: boolean; notes: string }) => void;
}) {
  const editRole = mode.kind === "edit" ? mode.role : null;
  const [code, setCode] = useState(editRole?.code || "");
  const [name, setName] = useState(mode.kind === "clone" ? `${mode.sourceName} 복제` : editRole?.name || "");
  const [description, setDescription] = useState(editRole?.description || "");
  const [base, setBase] = useState<string>(mode.kind === "clone" ? (mode.sourceBase || "") : (editRole?.base_system_role || ""));
  const [isActive, setIsActive] = useState(editRole ? editRole.is_active : true);
  const [notes, setNotes] = useState(editRole?.notes || "");
  const [saving, setSaving] = useState(false);

  const title = mode.kind === "edit" ? "사용자 정의 권한 수정" : mode.kind === "clone" ? "사용자 정의 권한 복제" : "신규 사용자 정의 권한";
  const codeReadOnly = mode.kind === "edit"; // 수정 시 코드 변경 불가
  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";
  const panel = darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900";

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSubmit({ code, name, description, base: base || null, isActive, notes }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${mode.kind === "edit" ? "max-w-2xl" : "max-w-lg"} overflow-y-auto rounded-3xl p-5 shadow-xl ${panel}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-semibold">{title}</h3>
        {mode.kind === "clone" && <p className="mb-3 text-xs text-slate-500">출처: {mode.sourceName} ({mode.sourceCode}) — 원본은 변경되지 않습니다.</p>}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">권한명 *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`w-full rounded-2xl border px-3 py-2 ${inputCls}`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">권한 코드 * {codeReadOnly && <span className="text-xs text-slate-400">(수정 불가)</span>}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} readOnly={codeReadOnly} placeholder="예: exam_manager" className={`w-full rounded-2xl border px-3 py-2 font-mono ${inputCls} ${codeReadOnly ? "opacity-60" : ""}`} />
            <span className="mt-1 block text-xs text-slate-400">영문 소문자로 시작, 소문자·숫자·밑줄(_)만. 시스템 기본 코드는 사용 불가.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">설명</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={`w-full rounded-2xl border px-3 py-2 ${inputCls}`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">기준 시스템 권한 (템플릿)</span>
            <select value={base} onChange={(e) => setBase(e.target.value)} className={`w-full rounded-2xl border px-3 py-2 ${inputCls}`}>
              <option value="">선택 안 함</option>
              {SYSTEM_ROLES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-400">선택한 시스템 권한 자체는 변경되지 않습니다(초기 설정 참고용).</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
            <span>사용 여부(사용중)</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">비고</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`w-full rounded-2xl border px-3 py-2 ${inputCls}`} />
          </label>
        </div>

        {mode.kind === "edit" && (
          <div className={`mt-5 rounded-2xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            <h4 className="mb-1 text-sm font-semibold">메뉴·기능 권한</h4>
            <p className="mb-2 text-xs text-slate-500">이 권한이 배정된 계정에 <b>추가로 허용</b>할 메뉴와 기능을 선택합니다(기존 권한은 축소되지 않음).</p>
            <PermissionTreeEditor
              roleId={editRole!.id} roleName={editRole!.name} menus={menus}
              tenantId={tenantId} actorId={actorId} darkMode={darkMode} onToast={onToast} appConfirm={appConfirm}
            />
          </div>
        )}

        {mode.kind === "edit" && (
          <div className={`mt-4 rounded-2xl border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            <h4 className="mb-1 text-sm font-semibold">데이터 범위</h4>
            <p className="mb-2 text-xs text-slate-500">이 권한이 배정된 계정에 <b>추가로 허용</b>할 데이터 범위(지역·성별·기숙사·공정·소유)를 설정합니다(기존 범위 축소 없음).</p>
            <DataScopeEditor
              roleId={editRole!.id} roleName={editRole!.name} tenantId={tenantId} actorId={actorId}
              darkMode={darkMode} dormOptions={dormOptions} onToast={onToast} appConfirm={appConfirm}
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${darkMode ? "border border-slate-600 text-slate-200" : "border border-slate-300 text-slate-700"}`}>취소</button>
          <button type="button" onClick={submit} disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">저장</button>
        </div>
      </div>
    </div>
  );
}

// ── 상세 미리보기 모달(읽기 전용) ────────────────────────────────────────────────
function RoleDetailModal({
  darkMode, detail, menus, tenantId, onClose,
}: {
  darkMode: boolean;
  detail: { system: UserRole } | { custom: CustomRole };
  menus: MenuItem[];
  tenantId: string;
  onClose: () => void;
}) {
  const panel = darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900";
  const isSystem = "system" in detail;
  const scope = isSystem ? computeMenuScope(detail.system, menus) : null;
  const info = isSystem ? SYSTEM_ROLES.find((s) => s.code === detail.system) : null;

  // 사용자 정의 권한 미리보기(부여된 메뉴·기능 + 위험 권한 + 적용 사용자 수).
  const customRole = isSystem ? null : (detail as { custom: CustomRole }).custom;
  const [permKeys, setPermKeys] = useState<string[]>([]);
  const [scopeRows, setScopeRows] = useState<ScopeRow[]>([]);
  const [userCount, setUserCount] = useState<number>(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!customRole) return;
      setPreviewLoading(true);
      const [perms, scopes, cnt] = await Promise.all([
        loadRolePermissions(customRole.id, tenantId),
        loadRoleScopes(customRole.id, tenantId),
        countUsersForRole(customRole.id, tenantId),
      ]);
      if (!alive) return;
      setPermKeys(perms.keys); setScopeRows(scopes.rows); setUserCount(cnt); setPreviewLoading(false);
    })();
    return () => { alive = false; };
  }, [customRole, tenantId]);

  const preview = useMemo(() => {
    const tabLabel = new Map<string, { group: string; label: string }>();
    buildPermissionTree(menus).forEach((g) => g.children.forEach((c) => tabLabel.set(String(c.tab), { group: g.group, label: c.label })));
    const menusOn: string[] = []; const dangerOn: string[] = [];
    const byAction: Record<string, string[]> = {};
    permKeys.forEach((k) => {
      const p = parsePermKey(k); if (!p) return;
      const meta = tabLabel.get(p.tab);
      const menuName = meta ? `${meta.group} > ${meta.label}` : p.tab;
      if (p.action === "menu_view") menusOn.push(menuName);
      if (DANGER_ACTIONS.has(p.action)) dangerOn.push(`${menuName} · ${ACTION_LABEL[p.action] || p.action}`);
      (byAction[ACTION_LABEL[p.action] || p.action] ||= []).push(menuName);
    });
    return { menusOn, dangerOn, byAction };
  }, [permKeys, menus]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`w-full max-w-lg rounded-3xl p-5 shadow-xl ${panel}`} onClick={(e) => e.stopPropagation()}>
        {isSystem && info ? (
          <>
            <h3 className="mb-1 text-base font-semibold">🔒 {info.name} <span className="font-mono text-xs text-slate-400">({info.code})</span></h3>
            <p className="mb-3 text-xs text-slate-500">시스템 기본 권한 — 읽기 전용(현재 코드가 적용하는 메뉴 범위)</p>
            <div className="space-y-3 text-sm">
              <div>{info.description}</div>
              <div>
                <div className="mb-1 font-semibold text-emerald-600">보이는 메뉴</div>
                <ul className="ml-4 list-disc space-y-0.5 text-slate-500">
                  {scope!.visible.length === 0 ? <li>없음</li> : scope!.visible.map((v, i) => <li key={i}>{v.group} &gt; {v.menu}</li>)}
                </ul>
              </div>
              <div>
                <div className="mb-1 font-semibold text-rose-500">숨겨지는 그룹</div>
                <ul className="ml-4 list-disc space-y-0.5 text-slate-500">
                  {scope!.hiddenGroups.length === 0 ? <li>없음</li> : scope!.hiddenGroups.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
              <p className="text-xs text-slate-400">이 화면은 기존 권한을 수정하지 않습니다. 분석 결과를 읽기 전용으로 표시합니다.</p>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-1 text-base font-semibold">{(detail as { custom: CustomRole }).custom.name} <span className="font-mono text-xs text-slate-400">({(detail as { custom: CustomRole }).custom.code})</span></h3>
            <p className="mb-3 text-xs text-slate-500">사용자 정의 권한 — 기본정보(메뉴·기능 권한 편집은 다음 단계)</p>
            {(() => {
              const c = (detail as { custom: CustomRole }).custom;
              const row = (k: string, v: string) => (
                <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5"><span className="text-slate-500">{k}</span><span className="text-right">{v || "-"}</span></div>
              );
              return (
                <div className="text-sm">
                  {row("설명", c.description || "")}
                  {row("기준 시스템 권한", c.base_system_role || "")}
                  {row("상태", c.is_deleted ? "삭제됨" : c.is_active ? "사용중" : "사용중지")}
                  {row("복제 출처", c.cloned_from_role_code || "")}
                  {row("비고", c.notes || "")}
                  {row("생성일", fmtDate(c.created_at))}
                  {row("수정일", fmtDate(c.updated_at))}
                  {row("적용 사용자 수", previewLoading ? "…" : `${userCount}명`)}
                </div>
              );
            })()}
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-slate-500">권한 미리보기</div>
              {previewLoading ? (
                <div className="text-xs text-slate-400">불러오는 중…</div>
              ) : permKeys.length === 0 ? (
                <div className="text-xs text-slate-400">부여된 메뉴·기능 권한이 없습니다. (수정에서 설정)</div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-emerald-600">추가로 보이는 메뉴</div>
                    <ul className="ml-4 list-disc text-xs text-slate-500">{preview.menusOn.length ? preview.menusOn.map((m, i) => <li key={i}>{m}</li>) : <li>없음</li>}</ul>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">기능</div>
                    <ul className="ml-4 list-disc text-xs text-slate-500">
                      {Object.entries(preview.byAction).filter(([a]) => a !== "메뉴 보기").map(([a, tabs]) => <li key={a}>{a}: {tabs.length}개 메뉴</li>)}
                    </ul>
                  </div>
                  {preview.dangerOn.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-rose-500">위험 권한</div>
                      <ul className="ml-4 list-disc text-xs text-rose-500">{preview.dangerOn.map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">데이터 범위 미리보기 (추가 허용)</div>
                {scopeRows.length === 0 ? (
                  <div className="text-xs text-slate-400">추가 데이터 범위 없음 (기본 역할 범위만 적용)</div>
                ) : (
                  <ul className="ml-4 list-disc text-xs text-slate-500">
                    {Object.entries(
                      scopeRows.reduce<Record<string, string[]>>((acc, r) => { (acc[r.scope_type] ||= []).push(r.scope_value); return acc; }, {})
                    ).map(([t, vals]) => (
                      <li key={t}>{SCOPE_TYPE_LABEL[t as keyof typeof SCOPE_TYPE_LABEL] || t}: {vals.join(", ")}{scopeRows.some((s) => s.action_scope === "read") ? " (조회 전용)" : ""}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">닫기</button>
        </div>
      </div>
    </div>
  );
}
