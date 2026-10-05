// ============================================================================
// RBAC(사용자·권한) DR 서비스 — 백업 reader / payload / preflight / 서버 RPC 호출 / post-verify.
//  · 실제 쓰기/롤백/관리자 보호는 서버 SECURITY DEFINER RPC(public.rbac_dr_restore)가 담당.
//    frontend 는 읽기·선택·검증·호출만(service_role 미사용).
//  · 비밀번호/토큰/세션/auth 자격은 백업하지 않는다(profiles 는 비밀 미보유).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const RBAC_DR_DATASETS: Array<{ key: string; label: string; tables: string[] }> = [
  { key: "rbac.profiles",    label: "사용자 프로필",          tables: ["profiles"] },
  { key: "rbac.roles",       label: "사용자 정의 역할·권한",  tables: ["custom_roles", "custom_role_permissions", "custom_role_scopes"] },
  { key: "rbac.assignments", label: "사용자 역할 배정",        tables: ["user_custom_roles"] },
];
export const RBAC_BACKUP_TABLES: string[] = RBAC_DR_DATASETS.flatMap((d) => d.tables);
// child → 필요한 parent(복원 순서/의존 판단). profiles 는 독립(서버가 auth 존재 guard).
export const RBAC_FK_PARENTS: Record<string, string[]> = {
  custom_role_permissions: ["custom_roles"],
  custom_role_scopes: ["custom_roles"],
  user_custom_roles: ["custom_roles"],
};

export type RbacBackup = Record<string, Array<Record<string, unknown>>>;

export async function readRbacBackup(client: SupabaseClient, tenantId: string): Promise<RbacBackup> {
  if (!tenantId) throw new Error("RBAC 백업: tenant 가 없습니다.");
  const out: RbacBackup = {};
  for (const table of RBAC_BACKUP_TABLES) {
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (;;) {
      let q = client.from(table).select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).limit(1000);
      if (after !== null) q = q.gt("id", after);
      const { data, error } = await q;
      if (error) throw new Error(`RBAC 백업 실패(${table}): ${error.message}`); // fail-closed
      const page = (data as Array<Record<string, unknown>>) || [];
      for (const r of page) {
        const id = String((r as { id?: unknown }).id ?? "");
        if (!id) throw new Error(`RBAC 백업 실패(${table}): id 없는 행`);
        if (seen.has(id)) throw new Error(`RBAC 백업 실패(${table}): 중복 PK ${id}`);
        seen.add(id); rows.push(r);
      }
      if (page.length < 1000) break;
      after = String((page[page.length - 1] as { id?: unknown }).id);
    }
    out[table] = rows;
  }
  return out;
}

export function buildRbacRestorePayload(selectedDatasetKeys: string[], backup: RbacBackup): { tables: RbacBackup } {
  const tables: RbacBackup = {};
  const wanted = new Set(RBAC_DR_DATASETS.filter((d) => selectedDatasetKeys.includes(d.key)).flatMap((d) => d.tables));
  for (const t of wanted) if (Array.isArray(backup[t]) && backup[t].length > 0) tables[t] = backup[t];
  return { tables };
}

export type RbacPreflight = { ok: boolean; missing: Array<{ table: string; missingParent: string }> };
export function preflightRbacDependencies(selectedDatasetKeys: string[], backup: RbacBackup, tablesPresentInDb: Set<string>): RbacPreflight {
  const selectedTables = new Set(RBAC_DR_DATASETS.filter((d) => selectedDatasetKeys.includes(d.key)).flatMap((d) => d.tables));
  const satisfiable = (p: string) => (selectedTables.has(p) && (backup[p]?.length ?? 0) > 0) || tablesPresentInDb.has(p);
  const missing: Array<{ table: string; missingParent: string }> = [];
  for (const t of selectedTables) {
    if (!(backup[t]?.length)) continue;
    for (const p of RBAC_FK_PARENTS[t] || []) if (!satisfiable(p)) missing.push({ table: t, missingParent: p });
  }
  return { ok: missing.length === 0, missing };
}

export type RbacRestoreResult = { ok: boolean; idempotent?: boolean; rowCounts?: Record<string, number>; skippedCounts?: Record<string, number>; code?: string; message: string };
export async function callRbacDrRestore(client: SupabaseClient, requestId: string, payload: { tables: RbacBackup }): Promise<RbacRestoreResult> {
  const { data, error } = await client.rpc("rbac_dr_restore", { p_request_id: requestId, p_payload: payload });
  if (error) {
    const raw = error.message || String(error);
    let message = "사용자·권한 복원에 실패했습니다."; let code = "ERROR";
    if (/RBAC_DR_RESTORE_BUSY/.test(raw)) { code = "BUSY"; message = "다른 사용자·권한 복원 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요."; }
    else if (/RBAC_DR_NOT_ADMIN|RBAC_DR_AUTH_REQUIRED/.test(raw)) { code = "FORBIDDEN"; message = "사용자·권한 복원 권한이 없습니다(관리자 전용)."; }
    else if (/RBAC_DR_TABLE_NOT_ALLOWED/.test(raw)) { code = "NOT_ALLOWED"; message = "허용되지 않은 복원 대상이 포함되어 중단했습니다."; }
    else if (/RBAC_DR_EXECUTOR_ADMIN_LOST|RBAC_DR_NO_ACTIVE_ADMIN/.test(raw)) { code = "ADMIN_GUARD"; message = "복원이 관리자 권한을 침해할 수 있어 중단했습니다(관리자 보호)."; }
    else if (/RBAC_DR_ORPHAN_USER_ROLE|foreign key|violates|RBAC_DR_MISSING_ID|RBAC_DR_INVALID_TABLE_PAYLOAD/.test(raw)) { code = "INTEGRITY"; message = "복원에 실패하여 사용자·권한 데이터는 복원 전 상태로 되돌아갔습니다."; }
    return { ok: false, code, message };
  }
  const d = (data as { idempotent?: boolean; row_counts?: Record<string, number>; skipped_counts?: Record<string, number> }) || {};
  return { ok: true, idempotent: !!d.idempotent, rowCounts: d.row_counts, skippedCounts: d.skipped_counts, message: d.idempotent ? "이미 완료된 복원 요청입니다(중복 실행 아님)." : "사용자·권한 복원이 완료되었습니다." };
}

export type RbacPostVerify = { ok: boolean; issues: string[] };
export async function postVerifyRbac(client: SupabaseClient, tenantId: string): Promise<RbacPostVerify> {
  const issues: string[] = [];
  // custom_role_permissions / scopes 의 custom_role_id 가 custom_roles 에 존재하는지(FK 보강 확인).
  for (const child of ["custom_role_permissions", "custom_role_scopes", "user_custom_roles"]) {
    const { data, error } = await client.from(child).select("id, custom_role_id").eq("tenant_id", tenantId).limit(5000);
    if (error) { issues.push(`검증 조회 실패(${child})`); continue; }
    const ids = (data as Array<Record<string, unknown>>).map((r) => r.custom_role_id).filter((v) => v != null);
    if (!ids.length) continue;
    const { data: roles, error: re } = await client.from("custom_roles").select("id").in("id", ids as string[]);
    if (re) { issues.push(`검증 조회 실패(custom_roles)`); continue; }
    const have = new Set((roles as Array<{ id: unknown }>).map((r) => String(r.id)));
    const orphan = (ids as unknown[]).filter((v) => !have.has(String(v)));
    if (orphan.length) issues.push(`orphan ${child}.custom_role_id → custom_roles (${orphan.length})`);
  }
  // 활성 admin ≥ 1 (사후 확인)
  const { count, error: ae } = await client.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("role", "admin").eq("is_active", true);
  if (ae) issues.push("관리자 수 확인 실패"); else if ((count ?? 0) < 1) issues.push("활성 관리자 0");
  return { ok: issues.length === 0, issues };
}
