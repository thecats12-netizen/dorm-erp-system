// System Role(기존 권한) 읽기 전용 카탈로그 + 메뉴 범위 계산.
//  - 이 프로젝트의 실제 System Role 은 4개뿐이다(admin/viewer/dorm_manager/maintenance_reporter).
//  - 여기서는 "표시/미리보기" 목적으로만 읽는다. 어떤 값도 수정/저장하지 않는다.
//  - 메뉴 범위 계산은 App.tsx 의 visibleMenuGroups 판정(하드 오버라이드 포함)과 동일한 규칙을 재현한다.
import type { MenuItem, UserRole } from "../../types";
import type { SystemRoleInfo } from "./types";

// 실제 코드(domain.ts UserRole)에 존재하는 System Role 전체. 순서 = 화면 표시 순서.
export const SYSTEM_ROLES: SystemRoleInfo[] = [
  { code: "admin", name: "관리자", description: "전체 메뉴 접근 및 등록/수정/삭제/설정 전권" },
  { code: "viewer", name: "뷰어", description: "시스템 그룹을 제외한 전체 메뉴 조회 전용" },
  { code: "dorm_manager", name: "기숙사 관리자", description: "운영관리 > 청소관리·하자접수만 접근" },
  { code: "maintenance_reporter", name: "하자접수 담당자", description: "운영관리 > 청소관리·하자접수만 접근(본인 기숙사)" },
];

export const SYSTEM_ROLE_CODES = new Set<string>(SYSTEM_ROLES.map((r) => r.code));

export function isSystemRoleCode(code: string): boolean {
  return SYSTEM_ROLE_CODES.has(code);
}

// 하자접수/기숙사 담당자는 청소관리·하자접수 2개만 노출(App.tsx isMaintenanceAccessUser 하드 오버라이드).
const MAINTENANCE_ONLY_TABS = new Set(["cleaningReports", "defects"]);

export type MenuScope = {
  visible: Array<{ group: string; menu: string }>;
  hiddenGroups: string[];
};

// role 기준으로 현재 코드가 보여주는 메뉴 범위를 계산한다(App.tsx visibleMenuGroups 규칙 재현, 읽기 전용).
export function computeMenuScope(role: UserRole, menus: MenuItem[]): MenuScope {
  const isMaintenanceAccess = role === "maintenance_reporter" || role === "dorm_manager";
  const allGroups = new Set<string>();
  const visible: Array<{ group: string; menu: string }> = [];
  const visibleGroups = new Set<string>();

  menus
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((menu) => {
      allGroups.add(menu.groupName);
      if (!menu.isVisible || !menu.requiredRoles.includes(role)) return;
      if (isMaintenanceAccess && !MAINTENANCE_ONLY_TABS.has(menu.tabKey)) return;
      visible.push({ group: menu.groupName, menu: menu.menuName });
      visibleGroups.add(menu.groupName);
    });

  const hiddenGroups = Array.from(allGroups).filter((g) => !visibleGroups.has(g));
  return { visible, hiddenGroups };
}
