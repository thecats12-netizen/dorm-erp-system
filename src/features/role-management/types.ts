// 권한관리(Custom Role) 타입.
//  - System Role(기존 profiles.role) 은 코드 상수로만 존재하며 여기서 저장/변환하지 않는다.
//  - CustomRole 만 custom_roles 테이블에 저장된다.
import type { UserRole } from "../../types";

export type CustomRole = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description?: string | null;
  base_system_role?: string | null;
  role_type: "custom";
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
