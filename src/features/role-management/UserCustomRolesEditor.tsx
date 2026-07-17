import { useEffect, useMemo, useState } from "react";
import { loadCustomRoles } from "./customRoleService";
import { getUserCustomRoles, saveUserCustomRoles, computeAssignable } from "./userCustomRoleService";
import type { CustomRole } from "./types";

// 계정 등록/수정 모달의 "추가 권한(사용자 정의 권한)" 편집기.
//  - ExamProcessScopeEditor 와 동일하게 자체 저장 + 감사로그(saveUser 흐름 무수정).
//  - 신규 계정(userId=null)은 저장 후 지정 안내만.
//  - 하자접수/기숙사 담당(maintenance_reporter/dorm_manager)은 보호: 추가 권한 부여 불가.
//  - System Role 은 이 목록에 표시하지 않는다(중복 방지). 사용중·미삭제 권한만 신규 선택 가능.
//  - alert/confirm 은 부모 앱 모달(appConfirm)로 위임(window.* 금지).
type Props = {
  userId: string | null;
  userLabel: string;
  baseRole: string;                 // userForm.role (System Role)
  tenantId: string;
  actingUserId: string;
  canManage: boolean;               // 시스템 admin 만 관리
  darkMode: boolean;
  onToast?: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onSaved?: () => void;             // 저장 후 목록 요약 갱신용
};

// 하자접수/기숙사 담당 계정은 기본 메뉴(청소·하자)만 유지 → 추가 권한 부여 금지(보호).
const PROTECTED_ROLES = new Set(["maintenance_reporter", "dorm_manager"]);

export default function UserCustomRolesEditor({
  userId, userLabel, baseRole, tenantId, actingUserId, canManage, darkMode, onToast, appConfirm, onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [allRoles, setAllRoles] = useState<CustomRole[]>([]);
  const [assignedActive, setAssignedActive] = useState<Set<string>>(new Set());   // 저장된 활성 배정
  const [assignedInactive, setAssignedInactive] = useState<CustomRole[]>([]);      // 배정됐으나 사용중지/삭제된 권한(읽기전용 배지)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const isProtected = PROTECTED_ROLES.has(baseRole);
  const isNew = !userId;

  const roleById = useMemo(() => new Map(allRoles.map((r) => [r.id, r])), [allRoles]);
  const selectableRoles = useMemo(
    () => allRoles.filter((r) => r.is_active && !r.is_deleted),
    [allRoles]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isNew || isProtected) return;
      setLoading(true);
      const rolesRes = await loadCustomRoles(tenantId);
      const assignRes = await getUserCustomRoles(userId!, tenantId);
      if (!alive) return;
      setTableMissing(rolesRes.tableMissing || assignRes.tableMissing);
      setAllRoles(rolesRes.roles);
      const active = new Set(assignRes.rows.filter((r) => r.is_active).map((r) => r.custom_role_id));
      setAssignedActive(active);
      setSelected(new Set(active));
      // 배정됐지만 현재 사용중지/삭제된 권한 → 읽기전용 배지
      const byId = new Map(rolesRes.roles.map((r) => [r.id, r]));
      const inactive = assignRes.rows
        .filter((r) => r.is_active)
        .map((r) => byId.get(r.custom_role_id))
        .filter((r): r is CustomRole => !!r && (!r.is_active || r.is_deleted));
      setAssignedInactive(inactive);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, tenantId, isNew, isProtected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectableRoles;
    return selectableRoles.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [selectableRoles, search]);

  const save = async () => {
    if (saving || !userId) return;
    const assignable = computeAssignable(allRoles);
    const added = Array.from(selected).filter((id) => !assignedActive.has(id));
    const removed = Array.from(assignedActive).filter((id) => !selected.has(id));
    if (added.length === 0 && removed.length === 0) { onToast?.("변경된 추가 권한이 없습니다."); return; }

    const nameOf = (id: string) => roleById.get(id)?.name || id;
    const ok = await appConfirm(
      "계정 권한 변경 확인",
      `${userLabel} 계정의 추가 권한이 변경됩니다.\n\n` +
      (added.length ? `추가:\n${added.map((id) => `- ${nameOf(id)}`).join("\n")}\n\n` : "") +
      (removed.length ? `해제:\n${removed.map((id) => `- ${nameOf(id)}`).join("\n")}\n\n` : "") +
      "변경 후 일부 메뉴와 기능의 접근 범위가 달라질 수 있습니다.\n(다음 로그인 또는 새로고침 후 적용)",
      { confirmText: "권한 변경" }
    );
    if (!ok) return;

    setSaving(true);
    try {
      const res = await saveUserCustomRoles(userId, tenantId, actingUserId, Array.from(selected), assignable);
      setAssignedActive(new Set(res.kept.concat(res.added)));
      if (res.partialError) onToast?.(`일부 권한 저장에 실패했습니다: ${res.partialError}`);
      else onToast?.("추가 권한을 저장했습니다. 다음 로그인 또는 새로고침 후 적용됩니다.");
      onSaved?.();
    } catch (e) {
      onToast?.((e as { message?: string })?.message || "추가 권한 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  const wrap = darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4";
  const head = darkMode ? "mb-1 text-sm font-semibold text-slate-300" : "mb-1 text-sm font-semibold text-slate-700";
  const note = darkMode ? "text-xs text-slate-400" : "text-xs text-slate-500";
  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";

  return (
    <div className={wrap}>
      <h4 className={head}>추가 권한</h4>
      <p className={`mb-3 ${note}`}>시스템 기본 권한 외에 추가로 적용할 사용자 정의 권한을 선택합니다. (기본 권한을 제거하지 않는 추가 허용)</p>

      {isProtected ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          하자접수/기숙사 담당 계정은 기본 메뉴(청소관리·하자접수) 보호를 위해 추가 권한을 부여하지 않습니다.
        </div>
      ) : isNew ? (
        <div className={`rounded-xl border px-3 py-2 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>
          먼저 계정을 저장한 뒤 다시 열어 추가 권한을 지정할 수 있습니다.
        </div>
      ) : !canManage ? (
        <div className={`rounded-xl border px-3 py-2 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>
          추가 권한은 관리자만 변경할 수 있습니다.
        </div>
      ) : tableMissing ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          추가 권한 저장소가 아직 적용되지 않았습니다. Supabase SQL Editor 에서 <b>20260719000000_user_custom_roles.sql</b> 실행 후 사용 가능합니다.
        </div>
      ) : (
        <>
          {assignedInactive.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {assignedInactive.map((r) => (
                <span key={r.id} className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500" title="사용중지/삭제된 권한(읽기전용)">
                  {r.name} (비활성)
                </span>
              ))}
            </div>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="권한 검색" className={`mb-2 w-full rounded-xl border px-3 py-2 text-sm ${inputCls}`} />
          <div className={`max-h-48 overflow-y-auto rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            {loading ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">선택 가능한 사용자 정의 권한이 없습니다.</div>
            ) : filtered.map((r) => (
              <label key={r.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${darkMode ? "hover:bg-slate-800" : "hover:bg-white"}`}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4" />
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-xs text-slate-400">({r.code})</span>
                {r.base_system_role && <span className="text-xs text-slate-400">· 기준 {r.base_system_role}</span>}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className={note}>선택 {selected.size}개 · 저장된 배정 {assignedActive.size}개</span>
            <button type="button" onClick={save} disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              추가 권한 저장
            </button>
          </div>
          <p className={`mt-2 ${note}`}>권한 변경은 대상 사용자의 다음 로그인 또는 화면 새로고침 후 적용됩니다.</p>
        </>
      )}
    </div>
  );
}
