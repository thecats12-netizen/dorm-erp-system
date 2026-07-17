// 사용자 정의 권한(Custom Role) 서비스.
//  - 저장소: custom_roles / custom_role_audit_logs (20260718000000_custom_roles.sql).
//  - 접근 제어는 Supabase RLS(admin + 동일 tenant)가 서버에서 강제한다. 프론트는 방어적 UX.
//  - service_role_key 미사용. 공통 anon/authenticated client 만 사용.
//  - 마이그레이션 미적용 환경에서도 오류로 죽지 않고 tableMissing 신호를 돌려준다(무회귀).
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";
import { isSystemRoleCode } from "./systemRoles";
import type { CustomRole, CustomRoleInput, CustomRoleAuditAction } from "./types";

const nowIso = () => new Date().toISOString();

export type LoadResult = {
  roles: CustomRole[];
  tableMissing: boolean;   // custom_roles 테이블이 아직 없음(SQL 미적용)
  error?: string;
};

// 테이블 부재( undefined table ) 판별. Postgres 42P01, PostgREST PGRST205/PGRST204.
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code || "";
  const msg = ((err as { message?: string } | null)?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("does not exist") || msg.includes("could not find the table");
}

// 권한 코드 규칙: 영문 소문자 시작, 소문자/숫자/underscore. 예약(System Role) 코드 재사용 금지.
export function validateRoleCode(code: string): string | null {
  const c = (code || "").trim();
  if (!c) return "권한 코드를 입력해주세요.";
  if (!/^[a-z][a-z0-9_]*$/.test(c)) return "권한 코드는 영문 소문자로 시작하고 소문자/숫자/밑줄(_)만 사용할 수 있습니다.";
  if (isSystemRoleCode(c)) return "시스템 기본 권한 코드는 사용할 수 없습니다.";
  return null;
}

export async function loadCustomRoles(tenantId: string): Promise<LoadResult> {
  if (!isSupabaseAvailable() || !supabase) return { roles: [], tableMissing: false, error: "Supabase 미설정" };
  const { data, error } = await supabase
    .from("custom_roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { roles: [], tableMissing: true };
    return { roles: [], tableMissing: false, error: error.message };
  }
  return { roles: (data as CustomRole[]) || [], tableMissing: false };
}

// 동일 tenant 활성(미삭제) 코드 중복 검사(클라이언트 선검사 — 서버 부분 유니크 인덱스가 최종 방어).
async function codeExists(tenantId: string, code: string, excludeId?: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase
    .from("custom_roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .eq("is_deleted", false);
  const rows = (data as { id: string }[]) || [];
  return rows.some((r) => r.id !== excludeId);
}

export async function createCustomRole(
  input: CustomRoleInput, tenantId: string, actorId: string
): Promise<CustomRole> {
  if (!supabase) throw new Error("Supabase 미설정");
  const codeErr = validateRoleCode(input.code);
  if (codeErr) throw new Error(codeErr);
  if (await codeExists(tenantId, input.code)) throw new Error("이미 사용 중인 권한 코드입니다.");

  const payload = {
    tenant_id: tenantId,
    code: input.code.trim(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    base_system_role: input.base_system_role || null,
    role_type: "custom" as const,
    is_active: input.is_active,
    is_deleted: false,
    cloned_from_role_code: input.cloned_from_role_code || null,
    notes: input.notes?.trim() || null,
    created_by: actorId || null,
    updated_by: actorId || null,
  };
  const { data, error } = await supabase.from("custom_roles").insert(payload).select().single();
  if (error) throw new Error(error.message);
  const role = data as CustomRole;
  await writeAudit(tenantId, actorId, role.id, input.cloned_from_role_code ? "clone" : "create", null, role);
  return role;
}

// 수정: 권한 코드는 변경하지 않는다(스키마상 넘겨도 무시).
export async function updateCustomRole(
  id: string, input: Omit<CustomRoleInput, "code">, tenantId: string, actorId: string, before: CustomRole
): Promise<CustomRole> {
  if (!supabase) throw new Error("Supabase 미설정");
  const patch = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    base_system_role: input.base_system_role || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
    updated_by: actorId || null,
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("custom_roles").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  const role = data as CustomRole;
  await writeAudit(tenantId, actorId, id, "update", before, role);
  return role;
}

// 복제: System Role 또는 Custom Role 을 출처로 새 Custom Role 생성(출처 원본은 변경하지 않음).
export async function cloneRole(
  sourceCode: string, sourceBaseSystemRole: string | null,
  newCode: string, newName: string, tenantId: string, actorId: string
): Promise<CustomRole> {
  return createCustomRole(
    {
      code: newCode,
      name: newName,
      // System Role 복제 시 그 자신이 기준, Custom 복제 시 원본의 기준을 승계.
      base_system_role: isSystemRoleCode(sourceCode) ? sourceCode : (sourceBaseSystemRole || null),
      is_active: true,
      cloned_from_role_code: sourceCode,
    },
    tenantId, actorId
  );
}

export async function setRoleActive(
  id: string, active: boolean, tenantId: string, actorId: string, before: CustomRole
): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from("custom_roles")
    .update({ is_active: active, updated_by: actorId || null, updated_at: nowIso() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await writeAudit(tenantId, actorId, id, active ? "activate" : "deactivate", before, { ...before, is_active: active });
}

// Soft Delete(물리삭제 금지). 배정 계정 수 확인은 호출부(UI)에서 countAssignedUsers 로 선검사.
export async function softDeleteRole(
  id: string, tenantId: string, actorId: string, before: CustomRole
): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from("custom_roles")
    .update({ is_deleted: true, deleted_at: nowIso(), deleted_by: actorId || null, updated_by: actorId || null, updated_at: nowIso() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await writeAudit(tenantId, actorId, id, "soft_delete", before, { ...before, is_deleted: true });
}

export async function restoreRole(
  id: string, tenantId: string, actorId: string, before: CustomRole
): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  // 복구 시 활성 코드 중복이면 거부(부분 유니크 인덱스 위반 방지 선검사).
  if (await codeExists(tenantId, before.code)) throw new Error("같은 코드의 활성 권한이 이미 존재하여 복구할 수 없습니다. 코드를 변경한 새 권한으로 생성해주세요.");
  const { error } = await supabase.from("custom_roles")
    .update({ is_deleted: false, deleted_at: null, deleted_by: null, updated_by: actorId || null, updated_at: nowIso() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await writeAudit(tenantId, actorId, id, "restore", before, { ...before, is_deleted: false });
}

// 이 Custom Role 을 배정받은 계정 수.
//  - 현재 단계는 계정 연결 전이므로 항상 0(profiles.custom_role_id 컬럼 미도입).
//  - 컬럼 도입 후 이 함수만 교체하면 삭제 가드가 그대로 동작한다.
export async function countAssignedUsers(_roleId: string, _tenantId: string): Promise<number> {
  return 0;
}

export async function writeAudit(
  tenantId: string, actorId: string, roleId: string | null,
  action: CustomRoleAuditAction, before: unknown, after: unknown
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("custom_role_audit_logs").insert({
      tenant_id: tenantId,
      role_id: roleId,
      action,
      before_data: (before ?? null) as never,
      after_data: (after ?? null) as never,
      actor_user_id: actorId || null,
    });
  } catch (e) {
    console.warn("[customRole] 감사로그 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}
