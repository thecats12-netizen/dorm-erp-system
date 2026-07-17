// 사용자 정의 권한의 데이터 범위(custom_role_scopes) 서비스.
//  - add-only. Soft Delete(is_active=false). 감사로그 재사용.
//  - 로그인 사용자의 유효 범위 병합을 위해 "내 배정 역할들의 활성 범위"를 읽는다.
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";
import { writeAudit } from "./customRoleService";
import { arePermissionTablesMissing, markPermissionTablesMissing } from "./permissionSchemaState";
import type { ScopeRow, ScopeType } from "./scopeCatalog";

const nowIso = () => new Date().toISOString();

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code || "";
  const msg = ((err as { message?: string } | null)?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("does not exist") || msg.includes("could not find the table");
}

export type ScopeLoad = { rows: ScopeRow[]; tableMissing: boolean; error?: string };

export async function loadRoleScopes(roleId: string, tenantId: string): Promise<ScopeLoad> {
  if (!isSupabaseAvailable() || !supabase || !roleId) return { rows: [], tableMissing: false };
  if (arePermissionTablesMissing()) return { rows: [], tableMissing: true };
  const { data, error } = await supabase
    .from("custom_role_scopes")
    .select("id, scope_type, scope_value, action_scope, is_active, valid_from, valid_until")
    .eq("tenant_id", tenantId)
    .eq("custom_role_id", roleId)
    .eq("is_active", true);
  if (error) {
    if (isMissingTable(error)) { markPermissionTablesMissing(); return { rows: [], tableMissing: true }; }
    return { rows: [], tableMissing: false, error: error.message };
  }
  return { rows: (data as ScopeRow[]) || [], tableMissing: false };
}

const rowKey = (r: ScopeRow) => `${r.scope_type}|${r.scope_value}|${r.action_scope}`;

export type SaveScopesResult = { added: number; removed: number; partialError?: string };

// 선택된 범위 집합으로 역할 범위를 동기화(추가/재활성 + 해제 soft delete) + 감사로그.
export async function saveRoleScopes(
  roleId: string, tenantId: string, actorId: string, next: ScopeRow[]
): Promise<SaveScopesResult> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { data: beforeRows } = await supabase
    .from("custom_role_scopes").select("scope_type, scope_value, action_scope, is_active, valid_from, valid_until")
    .eq("tenant_id", tenantId).eq("custom_role_id", roleId);
  const before = (beforeRows as ScopeRow[]) || [];
  const beforeActive = new Map(before.filter((r) => r.is_active).map((r) => [rowKey(r), r]));
  const nextKeys = new Set(next.map(rowKey));

  let added = 0, removed = 0; let partialError: string | undefined;
  for (const r of next) {
    const k = rowKey(r);
    const exists = before.some((b) => rowKey(b) === k);
    if (beforeActive.has(k)) {
      // 유효기간만 변경될 수 있어 갱신(활성 유지).
      const { error } = await supabase.from("custom_role_scopes")
        .update({ valid_from: r.valid_from ?? null, valid_until: r.valid_until ?? null, updated_by: actorId || null, updated_at: nowIso() })
        .eq("tenant_id", tenantId).eq("custom_role_id", roleId)
        .eq("scope_type", r.scope_type).eq("scope_value", r.scope_value).eq("action_scope", r.action_scope);
      if (error) partialError = error.message;
      continue;
    }
    const payload = {
      tenant_id: tenantId, custom_role_id: roleId, scope_type: r.scope_type, scope_value: r.scope_value,
      action_scope: r.action_scope, is_active: true, deleted_at: null,
      valid_from: r.valid_from ?? null, valid_until: r.valid_until ?? null,
      updated_by: actorId || null, updated_at: nowIso(),
      ...(exists ? {} : { created_by: actorId || null }),
    };
    const { error } = await supabase.from("custom_role_scopes").upsert(payload, { onConflict: "tenant_id,custom_role_id,scope_type,scope_value,action_scope" });
    if (error) { partialError = error.message; continue; }
    added++;
  }
  for (const [k, r] of beforeActive) {
    if (!nextKeys.has(k)) {
      const { error } = await supabase.from("custom_role_scopes")
        .update({ is_active: false, deleted_at: nowIso(), updated_by: actorId || null, updated_at: nowIso() })
        .eq("tenant_id", tenantId).eq("custom_role_id", roleId)
        .eq("scope_type", r.scope_type).eq("scope_value", r.scope_value).eq("action_scope", r.action_scope);
      if (error) { partialError = error.message; continue; }
      removed++;
    }
  }
  if (added || removed) {
    await writeAudit(tenantId, actorId, roleId, "update",
      { scopes: Array.from(beforeActive.keys()) }, { scopes: Array.from(nextKeys), added, removed });
  }
  return { added, removed, partialError };
}

// 여러 역할의 활성 데이터 범위를 한 번에 조회(역할별 미리보기용). role_id → ScopeRow[].
export async function loadRolesScopesMap(roleIds: string[], tenantId: string): Promise<Record<string, ScopeRow[]>> {
  const out: Record<string, ScopeRow[]> = {};
  if (!isSupabaseAvailable() || !supabase || roleIds.length === 0) return out;
  const { data, error } = await supabase
    .from("custom_role_scopes")
    .select("custom_role_id, scope_type, scope_value, action_scope, is_active, valid_from, valid_until")
    .eq("tenant_id", tenantId).in("custom_role_id", roleIds).eq("is_active", true);
  if (error) return out;
  ((data as Array<ScopeRow & { custom_role_id: string }>) || []).forEach((r) => {
    (out[r.custom_role_id] ||= []).push(r);
  });
  return out;
}

export type MyScopeRow = ScopeRow & { source_role_id: string };

// 로그인 사용자의 유효 범위(내 활성 배정 역할들의 활성·유효기간 내 범위). 병합/미리보기 재료.
export async function loadMyScopes(userId: string, tenantId: string): Promise<MyScopeRow[]> {
  if (!isSupabaseAvailable() || !supabase || !userId) return [];
  try {
    const { data: ucr, error: e1 } = await supabase
      .from("user_custom_roles").select("custom_role_id")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_active", true);
    if (e1) return [];
    const roleIds = ((ucr as { custom_role_id: string }[]) || []).map((r) => r.custom_role_id);
    if (roleIds.length === 0) return [];
    const { data, error: e2 } = await supabase
      .from("custom_role_scopes")
      .select("custom_role_id, scope_type, scope_value, action_scope, valid_from, valid_until")
      .eq("tenant_id", tenantId).in("custom_role_id", roleIds).eq("is_active", true);
    if (e2) return [];
    const now = Date.now();
    return ((data as Array<ScopeRow & { custom_role_id: string }>) || [])
      .filter((r) => (!r.valid_from || Date.parse(r.valid_from) <= now) && (!r.valid_until || Date.parse(r.valid_until) >= now))
      .map((r) => ({ ...r, source_role_id: r.custom_role_id }));
  } catch {
    return [];
  }
}

export type ScopeSummary = Partial<Record<ScopeType, string[]>>;
export function summarizeScopes(rows: ScopeRow[]): ScopeSummary {
  const out: ScopeSummary = {};
  rows.forEach((r) => { (out[r.scope_type] ||= []).push(r.scope_value); });
  return out;
}
