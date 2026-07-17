// 권한 적용 방식(permission_mode) 공통 라벨/설명 상수 — 화면 문자열 중복 하드코딩 방지.
//  DB 코드값(additive/restrictive)은 화면에 직접 노출하지 않고 항상 이 매핑의 한글 라벨을 사용한다.
import type { PermissionMode } from "./types";

export const PERMISSION_MODES: PermissionMode[] = ["additive", "restrictive"];

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  additive: "기존 권한에 추가",
  restrictive: "선택한 메뉴만 허용",
};

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  additive: "현재 시스템 기본 권한을 유지하면서 선택한 메뉴와 기능 권한을 추가합니다.",
  // ※ Sidebar 필터링 미구현 단계 → "이후 권한 적용 단계에서" 로 명시(즉시 숨김 오해 방지).
  restrictive: "선택한 메뉴와 기능만 사용할 수 있습니다. 선택하지 않은 다른 메뉴는 이후 권한 적용 단계에서 숨겨집니다.",
};

// 과거 데이터 누락 대비 UI fallback = additive (DB 는 NOT NULL/기본값 적용됨. fallback 은 표시 안정성용).
export const permissionModeLabel = (m?: PermissionMode | string | null): string =>
  PERMISSION_MODE_LABELS[(m as PermissionMode) in PERMISSION_MODE_LABELS ? (m as PermissionMode) : "additive"];

export const isValidPermissionMode = (v: unknown): v is PermissionMode =>
  v === "additive" || v === "restrictive";
