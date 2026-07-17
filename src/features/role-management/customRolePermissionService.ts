// 사용자 정의 권한의 메뉴×기능 권한(custom_role_permissions) 서비스.
//  - allow 부여만 저장. Soft Delete(is_active=false). 감사로그 재사용.
//  - 로그인 사용자의 유효 권한 병합을 위해 "내 배정 역할들의 활성 permission_key" 를 읽는다.
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";
import { writeAudit } from "./customRoleService";
import { arePermissionTablesMissing, markPermissionTablesMissing } from "./permissionSchemaState";

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
  if (arePermissionTablesMissing()) return { keys: [], tableMissing: true };
  const { data, error } = await supabase
    .from("custom_role_permissions")
    .select("permission_key, is_active")
    .eq("tenant_id", tenantId)
    .eq("custom_role_id", roleId)
    .eq("is_active", true);
  if (error) {
    if (isMissingTable(error)) { markPermissionTablesMissing(); return { keys: [], tableMissing: true }; }
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

// 여러 역할의 활성 permission_key 를 한 번에 조회(역할별 미리보기용). role_id → keys[].
export async function loadRolesPermissionsMap(roleIds: string[], tenantId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!isSupabaseAvailable() || !supabase || roleIds.length === 0) return out;
  if (arePermissionTablesMissing()) return out;
  const { data, error } = await supabase
    .from("custom_role_permissions").select("custom_role_id, permission_key")
    .eq("tenant_id", tenantId).in("custom_role_id", roleIds).eq("is_active", true);
  if (error) { if (isMissingTable(error)) markPermissionTablesMissing(); return out; }
  ((data as { custom_role_id: string; permission_key: string }[]) || []).forEach((r) => {
    (out[r.custom_role_id] ||= []).push(r.permission_key);
  });
  return out;
}

// 권한 복제: 출처 역할의 활성 메뉴·기능 권한을 대상 역할로 복사(원본 무변경) + 감사로그.
export async function copyRolePermissions(
  fromRoleId: string, toRoleId: string, tenantId: string, actorId: string
): Promise<number> {
  if (!supabase || !fromRoleId || !toRoleId) return 0;
  const src = await loadRolePermissions(fromRoleId, tenantId);
  if (src.tableMissing || src.keys.length === 0) return 0;
  const res = await saveRolePermissions(toRoleId, tenantId, actorId, src.keys);
  return res.added;
}

// 로그인 사용자의 유효 permission_key 합집합(내 활성 배정 역할들의 활성 권한). add-only 병합의 재료.
export async function loadMyGrantedPermissionKeys(userId: string, tenantId: string): Promise<Set<string>> {
  return (await loadMyMenuAccess(userId, tenantId)).allKeys;
}

// 로그인 사용자의 메뉴 접근 계산 재료(모드 인지). restrictive Sidebar 적용에 필요.
//  - allKeys: 활성 배정 역할들의 활성 permission_key 합집합(버튼/기능 additive 판정용, 기존과 동일).
//  - restrictiveActive: 활성·미삭제 restrictive 역할이 하나라도 있으면 true.
//  - restrictiveTabs: 그 restrictive 역할들이 "부여한 기능이 하나라도 있는" tabKey 집합(선택 메뉴).
import type { ScopeRow } from "./scopeCatalog";

export type MyMenuAccess = {
  allKeys: Set<string>; restrictiveActive: boolean; restrictiveTabs: Set<string>; restrictiveKeys: Set<string>;
  // 데이터 범위(9단계): restrictive 역할들의 활성 범위. restrictiveActive=false 면 빈 배열(범위 강제 없음).
  restrictiveScopeRows: ScopeRow[];
};

export async function loadMyMenuAccess(userId: string, tenantId: string): Promise<MyMenuAccess> {
  const empty: MyMenuAccess = { allKeys: new Set(), restrictiveActive: false, restrictiveTabs: new Set(), restrictiveKeys: new Set(), restrictiveScopeRows: [] };
  if (!isSupabaseAvailable() || !supabase || !userId) return empty;
  if (arePermissionTablesMissing()) return empty;
  try {
    const { data: ucr, error: e1 } = await supabase
      .from("user_custom_roles").select("custom_role_id")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_active", true);
    if (e1) { if (isMissingTable(e1)) markPermissionTablesMissing(); return empty; }
    const roleIds = ((ucr as { custom_role_id: string }[]) || []).map((r) => r.custom_role_id);
    if (roleIds.length === 0) return empty;

    // 배정 역할 중 활성·미삭제만 인정 + 모드 확인.
    const { data: rolesRaw, error: e2 } = await supabase
      .from("custom_roles").select("id, permission_mode, is_active, is_deleted")
      .eq("tenant_id", tenantId).in("id", roleIds);
    if (e2) { if (isMissingTable(e2)) markPermissionTablesMissing(); return empty; }
    const roles = ((rolesRaw as { id: string; permission_mode?: string; is_active: boolean; is_deleted: boolean }[]) || [])
      .filter((r) => r.is_active && !r.is_deleted);
    const activeRoleIds = roles.map((r) => r.id);
    if (activeRoleIds.length === 0) return empty;
    const restrictiveRoleIds = new Set(roles.filter((r) => (r.permission_mode ?? "additive") === "restrictive").map((r) => r.id));

    const { data: perms, error: e3 } = await supabase
      .from("custom_role_permissions").select("custom_role_id, permission_key")
      .eq("tenant_id", tenantId).in("custom_role_id", activeRoleIds).eq("is_active", true);
    if (e3) return empty;
    const rows = (perms as { custom_role_id: string; permission_key: string }[]) || [];

    const allKeys = new Set(rows.map((r) => r.permission_key));
    const restrictiveTabs = new Set<string>();
    const restrictiveKeys = new Set<string>();
    rows.forEach((r) => {
      if (!restrictiveRoleIds.has(r.custom_role_id)) return;
      restrictiveKeys.add(r.permission_key);
      const i = r.permission_key.lastIndexOf(".");
      if (i > 0) restrictiveTabs.add(r.permission_key.slice(0, i)); // 어떤 기능이든 부여되면 해당 메뉴 표시
    });
    // 데이터 범위: restrictive 역할이 있을 때만 그 역할들의 활성 범위를 로드(restrictive 우선 병합).
    let restrictiveScopeRows: ScopeRow[] = [];
    if (restrictiveRoleIds.size > 0) {
      const { data: scopes, error: e4 } = await supabase
        .from("custom_role_scopes")
        .select("scope_type, scope_value, action_scope, is_active, valid_from, valid_until, custom_role_id")
        .eq("tenant_id", tenantId).in("custom_role_id", Array.from(restrictiveRoleIds)).eq("is_active", true);
      if (!e4) {
        const now = Date.now();
        restrictiveScopeRows = ((scopes as Array<ScopeRow & { valid_from?: string | null; valid_until?: string | null }>) || [])
          .filter((s) => (!s.valid_from || Date.parse(s.valid_from) <= now) && (!s.valid_until || Date.parse(s.valid_until) >= now));
      }
    }
    return { allKeys, restrictiveActive: restrictiveRoleIds.size > 0, restrictiveTabs, restrictiveKeys, restrictiveScopeRows };
  } catch {
    return empty;
  }
}
