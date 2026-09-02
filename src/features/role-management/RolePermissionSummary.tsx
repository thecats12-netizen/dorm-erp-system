import { useMemo } from "react";
import type { MenuItem } from "../../types";
import { buildPermissionTree, parsePermKey, ACTION_LABEL, DANGER_ACTIONS, type ActionKey } from "./permissionCatalog";

// 사용자 정의 권한 상세보기 — 메뉴·기능 권한을 운영자용 요약(카운트 + 업무 그룹별 기능 칩)으로 표시.
//  · action key/내부값 미노출. ACTION_LABEL(permissionCatalog) 재사용.
type Props = { menus: MenuItem[]; permKeys: string[]; darkMode: boolean };

const READ_ACTIONS = new Set<ActionKey>(["menu_view", "list", "detail"]);

// 단색(currentColor) SaaS 스타일 아이콘(14px · stroke). 이모지 대체.
const svg = (d: React.ReactNode) => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const ICONS = {
  menu: svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="12" width="18" height="4" rx="1" /></>),
  eye: svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="2.5" /></>),
  plus: svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  pen: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  trash: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>),
  sheet: svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M12 3v18" /></>),
  file: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></>),
} as const;

export default function RolePermissionSummary({ menus, permKeys, darkMode }: Props) {
  const data = useMemo(() => {
    const tabMeta = new Map<string, { group: string; label: string; order: number; gorder: number }>();
    buildPermissionTree(menus).forEach((g) => g.children.forEach((c, i) => tabMeta.set(String(c.tab), { group: g.group, label: c.label, order: i, gorder: g.order })));
    // 탭별 부여 액션 집합
    const byTab = new Map<string, Set<ActionKey>>();
    permKeys.forEach((k) => { const p = parsePermKey(k); if (!p) return; (byTab.get(p.tab) ?? byTab.set(p.tab, new Set()).get(p.tab)!).add(p.action as ActionKey); });

    const has = (acts: Set<ActionKey>, a: ActionKey) => acts.has(a);
    // 카운트(메뉴 단위)
    const counts = { menu: 0, read: 0, create: 0, update: 0, del: 0, excel: 0, pdf: 0 };
    byTab.forEach((acts) => {
      if (has(acts, "menu_view")) counts.menu++;
      if (Array.from(READ_ACTIONS).some((a) => acts.has(a))) counts.read++;
      if (has(acts, "create")) counts.create++;
      if (has(acts, "update")) counts.update++;
      if (has(acts, "delete")) counts.del++;
      if (has(acts, "excel_download")) counts.excel++;
      if (has(acts, "pdf_download")) counts.pdf++;
    });

    // 업무 그룹별 메뉴 목록(칩)
    const groups = new Map<string, { gorder: number; menus: Array<{ label: string; chips: string[]; danger: boolean }> }>();
    byTab.forEach((acts, tab) => {
      const meta = tabMeta.get(tab); if (!meta) return;
      // 읽기류는 "조회" 한 칩으로 축약, 나머지는 ACTION_LABEL.
      const chips: string[] = [];
      if (Array.from(READ_ACTIONS).some((a) => acts.has(a))) chips.push("조회");
      (["create", "update", "delete", "status_change", "approve", "reject", "excel_download", "pdf_download", "csv_download", "print", "excel_upload", "file_upload", "file_download", "pii_view", "audit_view", "admin_config"] as ActionKey[])
        .forEach((a) => { if (acts.has(a)) chips.push(ACTION_LABEL[a] || a); });
      const danger = Array.from(acts).some((a) => DANGER_ACTIONS.has(a));
      const g = groups.get(meta.group) ?? groups.set(meta.group, { gorder: meta.gorder, menus: [] }).get(meta.group)!;
      g.menus.push({ label: meta.label, chips, danger });
    });
    const groupList = Array.from(groups.entries()).map(([group, v]) => ({ group, ...v })).sort((a, b) => a.gorder - b.gorder);
    return { counts, groupList };
  }, [menus, permKeys]);

  const card = darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white";
  const chip = darkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700";

  if (permKeys.length === 0) return <div className="text-xs text-slate-400">부여된 메뉴·기능 권한이 없습니다.</div>;

  const countCards: Array<{ label: string; value: number; icon: keyof typeof ICONS }> = [
    { label: "허용 메뉴", value: data.counts.menu, icon: "menu" },
    { label: "조회", value: data.counts.read, icon: "eye" },
    { label: "등록", value: data.counts.create, icon: "plus" },
    { label: "수정", value: data.counts.update, icon: "pen" },
    { label: "삭제", value: data.counts.del, icon: "trash" },
    { label: "Excel", value: data.counts.excel, icon: "sheet" },
    { label: "PDF", value: data.counts.pdf, icon: "file" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {countCards.map((c) => (
          <div key={c.label} className={`flex min-h-[58px] flex-col justify-between rounded-xl border px-2.5 py-2 ${card}`}>
            <div className="flex items-center gap-1 text-[0.65rem] font-medium text-slate-400"><span className="text-slate-400">{ICONS[c.icon]}</span>{c.label}</div>
            <div className="text-xl font-bold leading-none tracking-tight">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {data.groupList.map((g) => (
          <div key={g.group} className={`rounded-xl border p-2.5 ${card}`}>
            <div className="mb-1 text-xs font-semibold">{g.group}</div>
            <ul className="space-y-1">
              {g.menus.map((m) => (
                <li key={m.label} className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-emerald-600">✓</span>
                  <span className="text-xs font-medium">{m.label}</span>
                  {m.chips.map((ch, i) => (
                    <span key={i} className={`rounded-full px-1.5 py-0.5 text-[0.6rem] ${ch === "삭제" || ch === "승인" || ch === "반려" || ch === "개인정보 열람" ? "bg-rose-50 text-rose-600" : chip}`}>{ch}</span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
