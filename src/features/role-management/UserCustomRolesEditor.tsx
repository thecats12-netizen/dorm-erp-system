import { useEffect, useMemo, useState } from "react";
import { loadCustomRoles } from "./customRoleService";
import { getUserCustomRoles, saveUserCustomRoles, computeAssignable } from "./userCustomRoleService";
import { loadRolesPermissionsMap } from "./customRolePermissionService";
import { loadRolesScopesMap } from "./customRoleScopeService";
import { ACTION_LABEL, type ActionKey } from "./permissionCatalog";
import { PERMISSION_MODE_LABELS } from "./permissionMode";
import type { ScopeRow } from "./scopeCatalog";
import type { CustomRole } from "./types";
import type { MenuItem } from "../../types";

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
  menus: MenuItem[];                // 최종 권한 미리보기(메뉴 라벨/기준 역할 메뉴 계산)용
  onToast?: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
  onSaved?: () => void;             // 저장 후 목록 요약 갱신용
};

// 하자접수/기숙사 담당 계정은 기본 메뉴(청소·하자)만 유지 → 추가 권한 부여 금지(보호).
const PROTECTED_ROLES = new Set(["maintenance_reporter", "dorm_manager"]);

export default function UserCustomRolesEditor({
  userId, userLabel, baseRole, tenantId, actingUserId, canManage, darkMode, menus, onToast, appConfirm, onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [allRoles, setAllRoles] = useState<CustomRole[]>([]);
  const [roleKeys, setRoleKeys] = useState<Record<string, string[]>>({});          // role_id → permission_key[](미리보기)
  const [roleScopes, setRoleScopes] = useState<Record<string, ScopeRow[]>>({});     // role_id → 데이터 범위(미리보기)
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
      // 미리보기용: 선택 가능한 활성 역할들의 permission_key 일괄 로드(선택 변경 시 즉시 계산).
      const activeRoleIds = rolesRes.roles.filter((r) => r.is_active && !r.is_deleted).map((r) => r.id);
      const [keysMap, scopesMap] = await Promise.all([
        loadRolesPermissionsMap(activeRoleIds, tenantId),
        loadRolesScopesMap(activeRoleIds, tenantId),
      ]);
      if (alive) { setRoleKeys(keysMap); setRoleScopes(scopesMap); }
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
    // 권한명·코드·설명 검색.
    return selectableRoles.filter((r) =>
      r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q));
  }, [selectableRoles, search]);

  // ── 최종 권한 실시간 미리보기(선택 역할 + 기준 역할 + permission_mode 병합) ──────
  const tabInfo = useMemo(() => {
    const m = new Map<string, { group: string; menu: string }>();
    menus.forEach((menu) => m.set(menu.tabKey, { group: menu.groupName, menu: menu.menuName }));
    return m;
  }, [menus]);

  const preview = useMemo(() => {
    const sel = Array.from(selected).map((id) => roleById.get(id)).filter((r): r is CustomRole => !!r);
    const restrictiveRoles = sel.filter((r) => (r.permission_mode ?? "additive") === "restrictive");
    const isRestrictive = restrictiveRoles.length > 0;

    const menuTabs = new Set<string>();
    const actionsByTab = new Map<string, Set<string>>();
    const addKeys = (roles: CustomRole[]) => roles.forEach((r) => (roleKeys[r.id] || []).forEach((k) => {
      const i = k.lastIndexOf("."); if (i < 0) return;
      const tab = k.slice(0, i); const action = k.slice(i + 1);
      menuTabs.add(tab);
      (actionsByTab.get(tab) ?? (actionsByTab.set(tab, new Set()).get(tab)!)).add(action);
    }));

    if (isRestrictive) {
      addKeys(restrictiveRoles);                       // restrictive 우선: 기존 role/additive 무시
    } else {
      // additive: 기준 역할(baseRole)의 메뉴 + 선택 역할들의 메뉴 합집합
      menus.forEach((mn) => { if (mn.isVisible && mn.requiredRoles.includes(baseRole as never)) menuTabs.add(mn.tabKey); });
      addKeys(sel);
    }

    const menuList = Array.from(menuTabs)
      .map((t) => tabInfo.get(t))
      .filter((v): v is { group: string; menu: string } => !!v)
      .sort((a, b) => (a.group + a.menu).localeCompare(b.group + b.menu));

    // 기능 요약: 액션별 부여 메뉴 수(menu_view 제외).
    const funcCount = new Map<string, number>();
    actionsByTab.forEach((acts) => acts.forEach((a) => { if (a !== "menu_view") funcCount.set(a, (funcCount.get(a) || 0) + 1); }));

    return { isRestrictive, menuList, funcCount };
  }, [selected, roleById, roleKeys, menus, baseRole, tabInfo]);

  // 데이터 범위 미리보기: restrictive 역할이 있으면 그 역할들의 범위, 아니면 additive → 제한 없음.
  //  개발 코드값(region/dorm UUID 등) 미노출 — 한글 라벨 + 개수로 요약.
  const scopePreview = useMemo(() => {
    const sel = Array.from(selected).map((id) => roleById.get(id)).filter((r): r is CustomRole => !!r);
    const restrictiveRoles = sel.filter((r) => (r.permission_mode ?? "additive") === "restrictive");
    if (restrictiveRoles.length === 0) return { restricted: false, lines: [] as string[] };
    const rows: ScopeRow[] = restrictiveRoles.flatMap((r) => roleScopes[r.id] || []);
    const valuesOf = (t: string) => Array.from(new Set(rows.filter((s) => s.scope_type === t).map((s) => s.scope_value)));
    const genderLabel = (v: string) => (v === "남" ? "남성" : v === "여" ? "여성" : v === "all" ? "전체" : v);
    const lines: string[] = [];
    const org = valuesOf("organization");
    if (org.includes("all")) lines.push("전체 데이터");
    const region = valuesOf("region"); if (region.length) lines.push(`지역: ${region.map((v) => v === "all" ? "전체" : v).join(", ")}`);
    const gender = valuesOf("gender"); if (gender.length) lines.push(`성별: ${gender.map(genderLabel).join(", ")}`);
    const dorm = valuesOf("dorm");
    if (dorm.length) {
      const ids = dorm.filter((v) => !["all", "assigned"].includes(v));
      lines.push(dorm.includes("all") ? "기숙사: 전체" : dorm.includes("assigned") ? "기숙사: 담당 기숙사" : `기숙사: 특정 ${ids.length}곳`);
    }
    const proc = valuesOf("process");
    if (proc.length) {
      const ids = proc.filter((v) => !["all", "assigned"].includes(v));
      lines.push(proc.includes("all") ? "시험 공정: 전체" : proc.includes("assigned") ? "시험 공정: 담당 공정" : `시험 공정: 특정 ${ids.length}개`);
    }
    const owner = valuesOf("owner");
    if (owner.length) lines.push("본인이 등록한 데이터만");
    if (lines.length === 0) lines.push("설정된 데이터 범위 없음(해당 메뉴 0건)");
    return { restricted: true, lines };
  }, [selected, roleById, roleScopes]);

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
                <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${(r.permission_mode ?? "additive") === "restrictive" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                  {PERMISSION_MODE_LABELS[(r.permission_mode ?? "additive")]}
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.65rem] text-emerald-700">사용중</span>
                {r.description && <span className="truncate text-xs text-slate-400" title={r.description}>· {r.description}</span>}
              </label>
            ))}
          </div>

          {/* 최종 권한 실시간 미리보기(선택 변경 시 즉시 반영, permission_mode 적용) */}
          <div className={`mt-3 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
              최종 권한 미리보기
              <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${preview.isRestrictive ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                {preview.isRestrictive ? PERMISSION_MODE_LABELS.restrictive : PERMISSION_MODE_LABELS.additive}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              <div className="mt-1 font-semibold">보이는 메뉴 ({preview.menuList.length})</div>
              {preview.menuList.length === 0 ? (
                <div className="text-slate-400">{preview.isRestrictive ? "선택한 권한이 부여한 메뉴가 없습니다." : "기준 역할 메뉴만 적용됩니다."}</div>
              ) : (
                <ul className="ml-4 max-h-28 list-disc overflow-y-auto">
                  {preview.menuList.map((v, i) => <li key={i}>{v.group} &gt; {v.menu}</li>)}
                </ul>
              )}
              {preview.funcCount.size > 0 && (
                <>
                  <div className="mt-2 font-semibold">기능</div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(preview.funcCount.entries()).map(([a, n]) => (
                      <span key={a} className={`rounded-full px-2 py-0.5 text-[0.65rem] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                        {ACTION_LABEL[a as ActionKey] || a} {n}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {/* 데이터 범위 미리보기 */}
              <div className="mt-2 border-t border-slate-100 pt-2">
                <div className="font-semibold">데이터 범위</div>
                {scopePreview.restricted ? (
                  <ul className="ml-4 list-disc">{scopePreview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                ) : (
                  <div className="text-slate-400">제한 없음(기존 역할 데이터 범위 유지)</div>
                )}
              </div>
              <p className="mt-2 text-[0.7rem] text-slate-400">{preview.isRestrictive ? "선택한 메뉴만 허용(기존 role 무시). " : "기존 역할 권한 + 선택 권한 합집합. "}적용은 다음 로그인/새로고침 후.</p>
            </div>
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
