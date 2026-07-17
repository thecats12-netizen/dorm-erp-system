// 사용자 정의 권한의 메뉴×기능 권한(custom_role_permissions) 서비스.
//  - allow 부여만 저장. Soft Delete(is_active=false). 감사로그 재사용.
//  - 로그인 사용자의 유효 권한 병합을 위해 "내 배정 역할들의 활성 permission_key" 를 읽는다.
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";
import { writeAudit } from "./customRoleService";

const nowIso = () => new Date().toISOString();

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code || "";
  const msg = ((err as { message?: string } | null)?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("does not exist") || msg.includes("could not find the table");
}

export type RolePermLoad = { keys: string[]; tableMissing: boolean; error?: string };

// 특정 사용자 정의 권한의 활성 permission_key 목록.
export async function loadRolePermissions(roleId: string, tenantId: string): Promise<RolePermLoad> {
  if (!isSupabaseAvailable() || !supabase || !roleId) return { keys: [], tableMissing: false };
  const { data, error } = await supabase
    .from("custom_role_permissions")
    .select("permission_key, is_active")
    .eq("tenant_id", tenantId)
    .eq("custom_role_id", roleId)
    .eq("is_active", true);
  if (error) {
    if (isMissingTable(error)) return { keys: [], tableMissing: true };
    return { keys: [], tableMissing: false, error: error.message };
  }
  return { keys: ((data as { permission_key: string }[]) || []).map((r) => r.permission_key), tableMissing: false };
}

export type SaveRolePermsResult = { added: number; removed: number; partialError?: string };

// 선택된 permission_key 집합으로 역할 권한을 동기화(추가/재활성 + 해제 soft delete) + 감사로그.
export async function saveRolePermissions(
  roleId: string, tenantId: string, actorId: string, selectedKeys: string[]
): Promise<SaveRolePermsResult> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { data: beforeRows } = await supabase
    .from("custom_role_permissions").select("permission_key, is_active")
    .eq("tenant_id", tenantId).eq("custom_role_id", roleId);
  const before = (beforeRows as { permission_key: string; is_active: boolean }[]) || [];
  const beforeActive = new Set(before.filter((r) => r.is_active).map((r) => r.permission_key));
  const next = new Set(selectedKeys);

  let added = 0, removed = 0; let partialError: string | undefined;
  // 추가/재활성
  for (const key of next) {
    if (beforeActive.has(key)) continue;
    const exists = before.some((r) => r.permission_key === key);
    const payload = {
      tenant_id: tenantId, custom_role_id: roleId, permission_key: key, effect: "allow", is_active: true,
      deleted_at: null, updated_by: actorId || null, updated_at: nowIso(),
      ...(exists ? {} : { created_by: actorId || null }),
    };
    const { error } = await supabase.from("custom_role_permissions").upsert(payload, { onConflict: "tenant_id,custom_role_id,permission_key" });
    if (error) { partialError = error.message; continue; }
    added++;
  }
  // 해제(soft)
  for (const key of beforeActive) {
    if (!next.has(key)) {
      const { error } = await supabase.from("custom_role_permissions")
        .update({ is_active: false, deleted_at: nowIso(), updated_by: actorId || null, updated_at: nowIso() })
        .eq("tenant_id", tenantId).eq("custom_role_id", roleId).eq("permission_key", key);
      if (error) { partialError = error.message; continue; }
      removed++;
    }
  }
  if (added || removed) {
    await writeAudit(tenantId, actorId, roleId, "update",
      { permissions: Array.from(beforeActive) }, { permissions: Array.from(next), added, removed });
  }
  return { added, removed, partialError };
}

// 로그인 사용자의 유효 permission_key 합집합(내 활성 배정 역할들의 활성 권한). add-only 병합의 재료.
export async function loadMyGrantedPermissionKeys(userId: string, tenantId: string): Promise<Set<string>> {
  const empty = new Set<string>();
  if (!isSupabaseAvailable() || !supabase || !userId) return empty;
  try {
    const { data: ucr, error: e1 } = await supabase
      .from("user_custom_roles").select("custom_role_id")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_active", true);
    if (e1) return empty; // 테이블 미적용 등 → 병합 없음(기존 role 동작 유지)
    const roleIds = ((ucr as { custom_role_id: string }[]) || []).map((r) => r.custom_role_id);
    if (roleIds.length === 0) return empty;
    const { data: perms, error: e2 } = await supabase
      .from("custom_role_permissions").select("permission_key")
      .eq("tenant_id", tenantId).in("custom_role_id", roleIds).eq("is_active", true);
    if (e2) return empty;
    return new Set(((perms as { permission_key: string }[]) || []).map((r) => r.permission_key));
  } catch {
    return empty;
  }
}
