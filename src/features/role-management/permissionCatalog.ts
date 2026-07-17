// 메뉴×기능 권한 카탈로그(코드 단일 원본).
//  - permission_key = `${tabKey}.${actionKey}` (tabKey 는 전역 유일). 화면엔 한글 라벨만 노출.
//  - 메뉴 트리는 systemSettings.menus 를 그대로 재사용해 drift 를 막는다.
//  - 이번 단계는 allow(추가 허용)만. deny 없음.
import type { MenuItem, TabKey } from "../../types";

export type ActionKey =
  | "menu_view" | "list" | "detail" | "create" | "update" | "delete" | "restore"
  | "status_change" | "approve" | "reject"
  | "excel_upload" | "excel_download" | "csv_download" | "pdf_download" | "print"
  | "file_upload" | "file_download" | "pii_view" | "audit_view" | "admin_config";

export type ActionDef = { key: ActionKey; label: string; danger?: boolean; group: "read" | "write" | "download" | "approve" | "admin" };

export const ACTIONS: ActionDef[] = [
  { key: "menu_view", label: "메뉴 보기", group: "read" },
  { key: "list", label: "목록 조회", group: "read" },
  { key: "detail", label: "상세 조회", group: "read" },
  { key: "create", label: "등록", group: "write" },
  { key: "update", label: "수정", group: "write" },
  { key: "delete", label: "삭제", danger: true, group: "write" },
  { key: "restore", label: "복구", group: "write" },
  { key: "status_change", label: "상태 변경", group: "write" },
  { key: "approve", label: "승인", danger: true, group: "approve" },
  { key: "reject", label: "반려", danger: true, group: "approve" },
  { key: "excel_upload", label: "Excel 업로드", danger: true, group: "download" },
  { key: "excel_download", label: "Excel 다운로드", group: "download" },
  { key: "csv_download", label: "CSV 다운로드", group: "download" },
  { key: "pdf_download", label: "PDF 다운로드", group: "download" },
  { key: "print", label: "인쇄", group: "download" },
  { key: "file_upload", label: "파일 업로드", group: "write" },
  { key: "file_download", label: "파일 다운로드", group: "download" },
  { key: "pii_view", label: "개인정보 열람", danger: true, group: "read" },
  { key: "audit_view", label: "감사로그 열람", danger: true, group: "read" },
  { key: "admin_config", label: "관리자 설정", danger: true, group: "admin" },
];

export const ACTION_LABEL: Record<ActionKey, string> = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label])) as Record<ActionKey, string>;
export const DANGER_ACTIONS = new Set<ActionKey>(ACTIONS.filter((a) => a.danger).map((a) => a.key));

export const permKey = (tab: TabKey | string, action: ActionKey) => `${tab}.${action}`;
export function parsePermKey(key: string): { tab: string; action: ActionKey } | null {
  const i = key.lastIndexOf(".");
  if (i < 0) return null;
  return { tab: key.slice(0, i), action: key.slice(i + 1) as ActionKey };
}

const DEFAULT_ACTIONS: ActionKey[] = ["menu_view", "list", "detail", "create", "update", "delete", "status_change", "excel_download", "pdf_download", "csv_download", "print"];
const READONLY_ACTIONS: ActionKey[] = ["menu_view", "list", "excel_download", "pdf_download", "csv_download", "print"];
const APPROVAL_ACTIONS: ActionKey[] = ["menu_view", "list", "detail", "create", "update", "approve", "reject", "excel_download", "pdf_download", "print"];
const ADMIN_ACTIONS: ActionKey[] = ["menu_view", "admin_config", "audit_view"];

// 메뉴별 적용 가능한 기능 집합(불필요한 권한은 노출하지 않음).
const ACTIONS_BY_TAB: Partial<Record<TabKey, ActionKey[]>> = {
  dashboard: READONLY_ACTIONS,
  examDashboard: READONLY_ACTIONS,
  militaryDashboard: READONLY_ACTIONS,
  reportManagement: READONLY_ACTIONS,
  examReports: READONLY_ACTIONS,
  militaryReports: READONLY_ACTIONS,
  cleaningReports: ["menu_view", "list", "detail", "create", "update", "status_change", "file_upload", "file_download", "excel_download", "pdf_download", "print"],
  defects: ["menu_view", "list", "detail", "create", "update", "status_change", "file_upload", "file_download", "excel_download", "pdf_download", "print"],
  occupants: ["menu_view", "list", "detail", "create", "update", "delete", "pii_view", "excel_download", "pdf_download", "csv_download", "print"],
  newHires: ["menu_view", "list", "detail", "create", "update", "delete", "pii_view", "excel_download", "pdf_download", "csv_download", "print"],
  examApplications: APPROVAL_ACTIONS,
  examPmCertifications: APPROVAL_ACTIONS,
  examDmCertifications: APPROVAL_ACTIONS,
  examExcelImport: ["menu_view", "excel_upload", "excel_download"],
  personnelManagement: ["menu_view", "list", "detail", "create", "update", "delete", "pii_view", "excel_download", "pdf_download", "print"],
  trainingRecords: ["menu_view", "list", "detail", "create", "update", "delete", "status_change", "excel_download", "pdf_download", "print"],
  users: ["menu_view", "admin_config", "audit_view", "pii_view"],
  settings: ADMIN_ACTIONS,
  permissions: ADMIN_ACTIONS,
  recycleBin: ["menu_view", "list", "restore", "delete"],
  militarySettings: ADMIN_ACTIONS,
};

// 권한상승 차단: 관리자 전용 탭 기능은 사용자 정의 권한으로 부여 불가(서버 crp_is_grantable_key 와 동일 기준).
export const NON_GRANTABLE_TABS = new Set<string>(["users", "permissions", "settings", "recycleBin", "militarySettings"]);
export const isGrantableTab = (tab: string) => !NON_GRANTABLE_TABS.has(tab);

export function actionsForTab(tab: TabKey): ActionDef[] {
  const keys = ACTIONS_BY_TAB[tab] || DEFAULT_ACTIONS;
  return ACTIONS.filter((a) => keys.includes(a.key));
}

export type MenuNode = { group: string; order: number; children: Array<{ tab: TabKey; label: string; actions: ActionDef[] }> };

// systemSettings.menus 로 권한 트리(그룹→메뉴→기능) 구성.
export function buildPermissionTree(menus: MenuItem[]): MenuNode[] {
  const groups: Record<string, MenuNode> = {};
  menus.slice().sort((a, b) => a.order - b.order).forEach((m) => {
    const node = (groups[m.groupName] ||= { group: m.groupName, order: m.order, children: [] });
    if (!node.children.some((c) => c.tab === m.tabKey)) {
      node.children.push({ tab: m.tabKey, label: m.menuName, actions: actionsForTab(m.tabKey) });
    }
    node.order = Math.min(node.order, m.order);
  });
  return Object.values(groups).sort((a, b) => a.order - b.order);
}

// 특정 역할의 모든 부여 가능한 permission_key(트리 전개) — 전체선택/미리보기용.
export function allPermKeysForTree(tree: MenuNode[]): string[] {
  const out: string[] = [];
  tree.forEach((g) => g.children.forEach((c) => c.actions.forEach((a) => out.push(permKey(c.tab, a.key)))));
  return out;
}
