import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "../../types";
import { buildPermissionTree, permKey, DANGER_ACTIONS, isGrantableTab, type ActionDef, type MenuNode } from "./permissionCatalog";
import { loadRolePermissions, saveRolePermissions } from "./customRolePermissionService";

// 사용자 정의 권한의 메뉴×기능 권한 설정 트리(자체 저장 + 감사로그).
//  - 기존 role/시스템 권한 무변경. allow 부여만. alert/confirm 은 appConfirm 위임.
type Props = {
  roleId: string | null;                 // 신규 생성 직후엔 null → 저장 후 재편집 안내
  roleName: string;
  menus: MenuItem[];
  tenantId: string;
  actorId: string;
  darkMode: boolean;
  onToast?: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
};

// 체크박스 indeterminate 지원 ref 콜백.
function triState(checked: boolean, indeterminate: boolean) {
  return (el: HTMLInputElement | null) => { if (el) { el.checked = checked; el.indeterminate = indeterminate; } };
}

export default function PermissionTreeEditor({ roleId, roleName, menus, tenantId, actorId, darkMode, onToast, appConfirm }: Props) {
  // 관리자 전용 탭(사용자관리/권한관리/시스템설정/휴지통/군대설정)은 부여 대상에서 제외(권한상승 차단).
  const tree = useMemo<MenuNode[]>(
    () => buildPermissionTree(menus).map((g) => ({ ...g, children: g.children.filter((c) => isGrantableTab(String(c.tab))) })).filter((g) => g.children.length > 0),
    [menus]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!roleId) return;
      setLoading(true);
      const res = await loadRolePermissions(roleId, tenantId);
      if (!alive) return;
      const s = new Set(res.keys);
      setSelected(s); setInitial(new Set(s));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [roleId, tenantId]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const k of selected) if (!initial.has(k)) return true;
    return false;
  }, [selected, initial]);

  const toggle = (key: string, on?: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    const turnOn = on ?? !next.has(key);
    if (turnOn) next.add(key); else next.delete(key);
    return next;
  });
  const setMany = (keys: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    return next;
  });

  // 검색 필터된 트리.
  const visibleTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .map((g) => {
        const gMatch = g.group.toLowerCase().includes(q);
        const children = g.children.filter((c) => c.label.toLowerCase().includes(q) || String(c.tab).toLowerCase().includes(q));
        if (gMatch) return g;
        if (children.length) return { ...g, children };
        return null;
      })
      .filter((g): g is MenuNode => !!g);
  }, [tree, search]);

  const menuKeys = (tab: string, actions: ActionDef[]) => actions.map((a) => permKey(tab, a.key));
  const countOn = (keys: string[]) => keys.filter((k) => selected.has(k)).length;

  // 일괄 선택(그룹별 action 그룹). read/write/download/approve.
  const bulkByActionGroup = (grp: "read" | "write" | "download" | "approve", on: boolean) => {
    const keys: string[] = [];
    tree.forEach((g) => g.children.forEach((c) => c.actions.forEach((a) => { if (a.group === grp) keys.push(permKey(c.tab, a.key)); })));
    setMany(keys, on);
  };
  const allKeys = useMemo(() => { const out: string[] = []; tree.forEach((g) => g.children.forEach((c) => c.actions.forEach((a) => out.push(permKey(c.tab, a.key))))); return out; }, [tree]);

  const save = async () => {
    if (saving || !roleId) return;
    const added = Array.from(selected).filter((k) => !initial.has(k)).length;
    const removed = Array.from(initial).filter((k) => !selected.has(k)).length;
    const dangerAdded = Array.from(selected).filter((k) => !initial.has(k) && DANGER_ACTIONS.has((k.slice(k.lastIndexOf(".") + 1)) as never)).length;
    const ok = await appConfirm(
      "권한 변경 확인",
      `'${roleName}' 권한을 저장합니다.\n\n추가 ${added}개 · 해제 ${removed}개` + (dangerAdded ? `\n⚠ 위험 권한 ${dangerAdded}개 포함(삭제/승인/개인정보 등)` : "") + "\n\n변경 후 이 권한을 가진 계정의 접근 범위가 달라집니다.",
      { confirmText: "권한 저장", tone: dangerAdded ? "danger" : "default" }
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await saveRolePermissions(roleId, tenantId, actorId, Array.from(selected));
      setInitial(new Set(selected));
      if (res.partialError) onToast?.(`일부 권한 저장 실패: ${res.partialError}`);
      else onToast?.(`메뉴·기능 권한을 저장했습니다. (추가 ${res.added} · 해제 ${res.removed})`);
    } catch (e) {
      onToast?.((e as { message?: string })?.message || "권한 저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  };

  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";
  const chipBtn = darkMode ? "border border-slate-600 text-slate-200 hover:bg-slate-800" : "border border-slate-300 text-slate-700 hover:bg-slate-100";

  if (!roleId) {
    return <div className={`rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>먼저 권한을 저장한 뒤 다시 열어 메뉴·기능 권한을 설정할 수 있습니다.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="메뉴 검색" className={`rounded-xl border px-3 py-1.5 text-sm ${inputCls}`} />
        <button type="button" onClick={() => bulkByActionGroup("read", true)} className={`rounded-lg px-2 py-1 text-xs ${chipBtn}`}>읽기 일괄</button>
        <button type="button" onClick={() => bulkByActionGroup("write", true)} className={`rounded-lg px-2 py-1 text-xs ${chipBtn}`}>쓰기 일괄</button>
        <button type="button" onClick={() => bulkByActionGroup("download", true)} className={`rounded-lg px-2 py-1 text-xs ${chipBtn}`}>다운로드 일괄</button>
        <button type="button" onClick={() => bulkByActionGroup("approve", true)} className={`rounded-lg px-2 py-1 text-xs ${chipBtn}`}>승인 일괄</button>
        <button type="button" onClick={() => setMany(allKeys, false)} className={`rounded-lg px-2 py-1 text-xs ${chipBtn}`}>전체 해제</button>
        {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">변경사항 있음</span>}
      </div>

      <div className={`max-h-80 overflow-y-auto rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
        {loading ? <div className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</div> : visibleTree.map((g) => {
          const groupKeys = g.children.flatMap((c) => menuKeys(c.tab, c.actions));
          const gOn = countOn(groupKeys);
          const isCollapsed = collapsed.has(g.group);
          return (
            <div key={g.group} className={`border-b ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <div className={`flex items-center gap-2 px-3 py-2 ${darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                <input type="checkbox" ref={triState(gOn === groupKeys.length && groupKeys.length > 0, gOn > 0 && gOn < groupKeys.length)} onChange={(e) => setMany(groupKeys, e.target.checked)} className="h-4 w-4" />
                <button type="button" onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(g.group) ? n.delete(g.group) : n.add(g.group); return n; })} className="text-sm font-semibold">
                  {isCollapsed ? "▶" : "▼"} {g.group} <span className="text-xs text-slate-400">({gOn}/{groupKeys.length})</span>
                </button>
              </div>
              {!isCollapsed && g.children.map((c) => {
                const ck = menuKeys(c.tab, c.actions);
                const cOn = countOn(ck);
                return (
                  <div key={c.tab} className="px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <input type="checkbox" ref={triState(cOn === ck.length, cOn > 0 && cOn < ck.length)} onChange={(e) => setMany(ck, e.target.checked)} className="h-4 w-4" />
                      <span className="text-sm font-medium">{c.label}</span>
                    </div>
                    <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                      {c.actions.map((a) => {
                        const key = permKey(c.tab, a.key);
                        const danger = DANGER_ACTIONS.has(a.key);
                        return (
                          <label key={a.key} className={`inline-flex items-center gap-1.5 text-xs ${danger ? "text-rose-600" : darkMode ? "text-slate-300" : "text-slate-600"}`}>
                            <input type="checkbox" checked={selected.has(key)} onChange={(e) => toggle(key, e.target.checked)} className="h-3.5 w-3.5" />
                            {a.label}{danger && " ⚠"}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">선택 {selected.size}개</span>
        <button type="button" onClick={save} disabled={saving || !dirty} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">메뉴·기능 권한 저장</button>
      </div>
    </div>
  );
}
