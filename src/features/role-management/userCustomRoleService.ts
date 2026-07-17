// 계정 ↔ 사용자 정의 권한(user_custom_roles) 연결 서비스.
//  - 저장소: user_custom_roles (20260719000000_user_custom_roles.sql).
//  - 접근 제어는 RLS(admin + 동일 tenant)가 서버에서 강제. 프론트는 방어적 UX.
//  - service_role_key 미사용. add-only 오버레이(System Role 무변경).
//  - 마이그레이션 미적용 환경에서도 죽지 않고 tableMissing 신호를 돌려준다.
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";
import { writeAudit } from "./customRoleService";
import { arePermissionTablesMissing, markPermissionTablesMissing } from "./permissionSchemaState";
import type { CustomRole } from "./types";

const nowIso = () => new Date().toISOString();

export type UserCustomRoleRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  custom_role_id: string;
  is_active: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export type UserAssignments = {
  rows: UserCustomRoleRow[];
  tableMissing: boolean;
  error?: string;
};

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code || "";
  const msg = ((err as { message?: string } | null)?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("does not exist") || msg.includes("could not find the table");
}

// 특정 계정에 배정된 연결 행(활성/비활성 모두 — 비활성은 읽기전용 배지 표시용).
export async function getUserCustomRoles(userId: string, tenantId: string): Promise<UserAssignments> {
  if (!isSupabaseAvailable() || !supabase || !userId) return { rows: [], tableMissing: false };
  if (arePermissionTablesMissing()) return { rows: [], tableMissing: true };
  const { data, error } = await supabase
    .from("user_custom_roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingTable(error)) { markPermissionTablesMissing(); return { rows: [], tableMissing: true }; }
    return { rows: [], tableMissing: false, error: error.message };
  }
  return { rows: (data as UserCustomRoleRow[]) || [], tableMissing: false };
}

// 전체 계정의 활성 배정을 (user_id → custom_role_id[]) 로 집계(목록 요약용).
export async function getAssignmentSummary(tenantId: string): Promise<{ map: Record<string, string[]>; tableMissing: boolean }> {
  if (!isSupabaseAvailable() || !supabase) return { map: {}, tableMissing: false };
  if (arePermissionTablesMissing()) return { map: {}, tableMissing: true };
  const { data, error } = await supabase
    .from("user_custom_roles")
    .select("user_id, custom_role_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error) {
    if (isMissingTable(error)) { markPermissionTablesMissing(); return { map: {}, tableMissing: true }; }
    return { map: {}, tableMissing: false };
  }
  const map: Record<string, string[]> = {};
  ((data as { user_id: string; custom_role_id: string }[]) || []).forEach((r) => {
    (map[r.user_id] ||= []).push(r.custom_role_id);
  });
  return { map, tableMissing: false };
}

// 특정 사용자 정의 권한을 배정받은 활성 계정 수(미리보기용).
export async function countUsersForRole(roleId: string, tenantId: string): Promise<number> {
  if (!isSupabaseAvailable() || !supabase || !roleId) return 0;
  const { count, error } = await supabase
    .from("user_custom_roles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("custom_role_id", roleId)
    .eq("is_active", true);
  if (error) return 0;
  return count || 0;
}

export type SaveAssignmentsResult = {
  added: string[];    // custom_role_id
  removed: string[];
  kept: string[];
  partialError?: string;
};

// 화면에서 선택된 custom_role_id 집합으로 동기화한다.
//  - 신규 선택 → upsert(is_active=true). 해제된 것 → is_active=false + deleted_at(soft).
//  - 유지된 것은 건드리지 않는다. 감사로그(before/after) 기록.
//  - assignableIds: 현재 관리자가 배정 가능한 custom_role_id 화이트리스트(활성·미삭제·권한상한 이내).
export async function saveUserCustomRoles(
  userId: string, tenantId: string, actorId: string,
  selectedIds: string[], assignableIds: Set<string>
): Promise<SaveAssignmentsResult> {
  if (!supabase) throw new Error("Supabase 미설정");
  if (!userId) throw new Error("먼저 계정을 저장한 후 추가 권한을 지정해주세요.");

  const before = (await getUserCustomRoles(userId, tenantId)).rows;
  const beforeActive = new Set(before.filter((r) => r.is_active).map((r) => r.custom_role_id));

  // 신규 활성 대상은 배정 가능 화이트리스트 안에 있어야 한다(서버 RLS 가 최종 방어).
  const nextActive = new Set(selectedIds.filter((id) => beforeActive.has(id) || assignableIds.has(id)));

  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let partialError: string | undefined;

  // 추가/재활성
  for (const id of nextActive) {
    if (beforeActive.has(id)) { kept.push(id); continue; }
    const existing = before.find((r) => r.custom_role_id === id);
    const payload = {
      tenant_id: tenantId, user_id: userId, custom_role_id: id, is_active: true,
      deleted_at: null, updated_by: actorId || null, updated_at: nowIso(),
      ...(existing ? {} : { assigned_by: actorId || null, assigned_at: nowIso() }),
    };
    const { error } = await supabase.from("user_custom_roles").upsert(payload, { onConflict: "tenant_id,user_id,custom_role_id" });
    if (error) { partialError = error.message; continue; }
    added.push(id);
  }

  // 해제(soft)
  for (const r of before) {
    if (r.is_active && !nextActive.has(r.custom_role_id)) {
      const { error } = await supabase.from("user_custom_roles")
        .update({ is_active: false, deleted_at: nowIso(), updated_by: actorId || null, updated_at: nowIso() })
        .eq("tenant_id", tenantId).eq("user_id", userId).eq("custom_role_id", r.custom_role_id);
      if (error) { partialError = error.message; continue; }
      removed.push(r.custom_role_id);
    }
  }

  // 감사로그(변경이 있을 때만). custom_role_audit_logs 재사용(role_id=null, 대상 user 는 after 에 포함).
  if (added.length || removed.length) {
    await writeAudit(tenantId, actorId, null, "update",
      { user_id: userId, active: Array.from(beforeActive) },
      { user_id: userId, active: Array.from(nextActive), added, removed });
  }
  return { added, removed, kept, partialError };
}

// 배정 가능 여부: 활성·미삭제 custom role 만. 관리자 상한(admin 이 최상위이므로 admin 이면 모두 가능).
//  super_admin 이 없는 프로젝트라 admin 이 배정 상한. base_system_role='admin' 도 admin 은 배정 가능.
export function computeAssignable(activeRoles: CustomRole[]): Set<string> {
  return new Set(activeRoles.filter((r) => r.is_active && !r.is_deleted).map((r) => r.id));
}
