// 권한관리(Custom Role) 타입.
//  - System Role(기존 profiles.role) 은 코드 상수로만 존재하며 여기서 저장/변환하지 않는다.
//  - CustomRole 만 custom_roles 테이블에 저장된다.
import type { UserRole } from "../../types";

// 권한 적용 방식: additive(기존 권한에 추가) | restrictive(선택한 메뉴만 허용).
//  DB custom_roles.permission_mode 와 1:1. 이번 단계는 저장/타입만, 실제 권한 계산 반영은 다음 단계.
export type PermissionMode = "additive" | "restrictive";

export type CustomRole = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description?: string | null;
  base_system_role?: string | null;
  role_type: "custom";
  // 마이그레이션 20260724000000 적용 전 행에는 없을 수 있어 optional. 기본 의미는 'additive'.
  permission_mode?: PermissionMode;
  is_active: boolean;
  is_deleted: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  cloned_from_role_code?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
};

// 신규/수정 입력 페이로드(코드 규칙 검증은 서비스에서 수행).
export type CustomRoleInput = {
  code: string;
  name: string;
  description?: string;
  base_system_role?: string | null;
  permission_mode?: PermissionMode;   // 미지정 시 서버 기본값 'additive'
  is_active: boolean;
  notes?: string;
  cloned_from_role_code?: string | null;
};

export type CustomRoleAuditAction =
  | "create"
  | "update"
  | "clone"
  | "deactivate"
  | "activate"
  | "soft_delete"
  | "restore";

// 화면 필터.
export type RoleKindFilter = "all" | "system" | "custom";
export type RoleStatusFilter = "all" | "active" | "inactive" | "deleted";

// System Role 표시용(읽기 전용 · 잠금).
export type SystemRoleInfo = {
  code: UserRole;
  name: string;          // 한글 라벨
  description: string;
};
