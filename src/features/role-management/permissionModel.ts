// 유효 권한 병합 모델(순수 함수). add-only: 기존 role 허용 위에 사용자 정의 권한을 "추가"만 한다.
//  - 기존 시스템 권한을 제거/축소하지 않는다. 컴포넌트는 `기존검사 || perms.can(...)` 형태로 결합.
//  - 하자접수/기숙사 담당 계정은 애초에 사용자 정의 권한이 배정되지 않아(grantedKeys 비어있음)
//    이 모델을 통과해도 어떤 메뉴/기능도 추가되지 않는다(4단계 보호 + 여기 무-추가).
import { permKey, type ActionKey } from "./permissionCatalog";
import type { TabKey } from "../../types";

export type EffectivePermissions = {
  hasCustom: boolean;                                   // 사용자 정의 권한이 하나라도 부여됐는지
  grantsMenu: (tab: TabKey | string) => boolean;        // 사용자 정의 권한이 이 메뉴 보기를 추가 허용
  can: (tab: TabKey | string, action: ActionKey) => boolean;  // 사용자 정의 권한이 이 기능을 추가 허용
  canWrite: (tab: TabKey | string) => boolean;          // create 또는 update 추가 허용
  has: (permissionKey: string) => boolean;
};

const EMPTY_KEYS = new Set<string>();

// grantedKeys: 로그인 사용자에게 배정된 사용자 정의 권한들의 활성 permission_key 합집합.
export function buildEffectivePermissions(grantedKeys: Set<string> = EMPTY_KEYS): EffectivePermissions {
  const keys = grantedKeys || EMPTY_KEYS;
  const can = (tab: TabKey | string, action: ActionKey) => keys.has(permKey(tab, action));
  return {
    hasCustom: keys.size > 0,
    grantsMenu: (tab) => keys.has(permKey(tab, "menu_view")),
    can,
    canWrite: (tab) => can(tab, "create") || can(tab, "update"),
    has: (k) => keys.has(k),
  };
}

// 미리보기용: 부여된 키를 메뉴별로 묶어 요약.
export function summarizeGrantedKeys(keys: Set<string>): Record<string, ActionKey[]> {
  const map: Record<string, ActionKey[]> = {};
  keys.forEach((k) => {
    const i = k.lastIndexOf(".");
    if (i < 0) return;
    const tab = k.slice(0, i); const action = k.slice(i + 1) as ActionKey;
    (map[tab] ||= []).push(action);
  });
  return map;
}
