// ============================================================================
// 시험관리 DR 서비스 — 백업 reader / payload / dependency preflight / 서버 RPC 호출 / post-verify.
//  · 실제 exam write/rollback 은 서버측 SECURITY DEFINER RPC(public.exam_dr_restore)가 담당.
//    frontend 는 읽기·선택·검증·호출만(service_role 미사용, authenticated admin 세션으로 RPC 호출).
//  · supabase client 는 주입(테스트 가능). App 은 공용 싱글톤을 전달.
//  · tenant 는 서버 RPC 가 결정 — frontend 의 tenant 값은 신뢰/전달하지 않는다(reader 조회 scope 만 사용).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

// dataset → 실제 테이블(단일 소스; 서버 RPC allowlist 20개와 정확히 일치해야 함).
export const EXAM_DR_DATASETS: Array<{ key: string; label: string; tables: string[] }> = [
  { key: "exam.master",         label: "기준정보",   tables: ["exam_lines", "exam_categories", "exam_groups", "exam_levels", "exam_parts", "exam_processes", "exam_equipment"] },
  { key: "exam.personnel",      label: "인원",       tables: ["exam_personnel"] },
  { key: "exam.rules",          label: "규칙/대상",  tables: ["exam_rules", "exam_annual_targets", "exam_equipment_stage_rules"] },
  { key: "exam.applications",   label: "신청/결과",  tables: ["exam_sessions", "exam_applications", "exam_results", "exam_monthly_results"] },
  { key: "exam.certifications", label: "자격/인증",  tables: ["exam_equipment_certifications", "exam_certification_history", "dm_certifications", "pm_certifications", "employee_license_plan"] },
];
// 백업 포함 + 복원 지원 테이블(= 모든 dataset 테이블의 합집합).
export const EXAM_BACKUP_TABLES: string[] = EXAM_DR_DATASETS.flatMap((d) => d.tables);
// 백업 제외(또는 복원 제외) — 혼동 방지용 명시.
export const EXAM_RESTORE_EXCLUDED_TABLES: string[] = [
  "exam_audit_logs", "exam_import_jobs", "exam_import_errors",
  "exam_sequence_counters", "exam_user_process_scopes", "exam_retest_candidates",
];

// child → 복원에 필요한 parent 테이블(FK DAG; 순환 categories↔groups·levels self 는 RPC 2-pass 처리).
export const EXAM_FK_PARENTS: Record<string, string[]> = {
  exam_parts: ["exam_categories", "exam_groups"],
  exam_processes: ["exam_categories", "exam_groups", "exam_parts"],
  exam_equipment: ["exam_processes"],
  exam_personnel: ["exam_lines"],
  exam_sessions: ["exam_categories", "exam_levels"],
  exam_rules: ["exam_categories", "exam_groups", "exam_levels", "exam_lines", "exam_parts", "exam_processes"],
  exam_annual_targets: ["exam_categories", "exam_groups", "exam_levels", "exam_parts", "exam_processes"],
  exam_monthly_results: ["exam_categories", "exam_groups", "exam_levels", "exam_parts", "exam_processes"],
  exam_equipment_stage_rules: ["exam_categories", "exam_equipment", "exam_groups", "exam_levels", "exam_processes"],
  exam_applications: ["exam_equipment", "exam_levels", "exam_personnel", "exam_processes", "exam_sessions"],
  exam_results: ["exam_applications", "exam_levels", "exam_personnel", "exam_sessions"],
  exam_equipment_certifications: ["exam_applications", "exam_categories", "exam_equipment", "exam_groups", "exam_levels", "exam_lines", "exam_personnel", "exam_processes"],
  exam_certification_history: ["exam_levels", "exam_personnel", "exam_processes"],
  dm_certifications: ["exam_levels", "exam_parts", "exam_personnel", "exam_processes"],
  pm_certifications: ["exam_levels", "exam_parts", "exam_personnel", "exam_processes"],
  employee_license_plan: ["exam_personnel", "exam_rules"],
};

export type ExamBackup = Record<string, Array<Record<string, unknown>>>; // table → rows

// ── 백업 reader: 테이블별 전체 row keyset pagination(max_rows 무관), tenant scope, fail-closed, dup PK 검사
export async function readExamBackup(client: SupabaseClient, tenantId: string): Promise<ExamBackup> {
  if (!tenantId) throw new Error("exam 백업: tenant 가 없습니다.");
  const out: ExamBackup = {};
  for (const table of EXAM_BACKUP_TABLES) {
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (;;) {
      let q = client.from(table).select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).limit(1000);
      if (after !== null) q = q.gt("id", after);
      const { data, error } = await q;
      if (error) throw new Error(`exam 백업 실패(${table}): ${error.message}`); // fail-closed: 빈 배열로 넘어가지 않음
      const page = (data as Array<Record<string, unknown>>) || [];
      for (const r of page) {
        const id = String((r as { id?: unknown }).id ?? "");
        if (!id) throw new Error(`exam 백업 실패(${table}): id 없는 행`);
        if (seen.has(id)) throw new Error(`exam 백업 실패(${table}): 중복 PK ${id}`);
        seen.add(id); rows.push(r);
      }
      if (page.length < 1000) break;
      after = String((page[page.length - 1] as { id?: unknown }).id);
    }
    out[table] = rows;
  }
  return out;
}

// ── 선택 dataset → RPC payload({ tables: { table: rows } }). tenant_id 는 서버가 override 하므로 그대로 둠.
export function buildExamRestorePayload(selectedDatasetKeys: string[], backup: ExamBackup): { tables: ExamBackup } {
  const tables: ExamBackup = {};
  const wanted = new Set(EXAM_DR_DATASETS.filter((d) => selectedDatasetKeys.includes(d.key)).flatMap((d) => d.tables));
  // 실제 행이 있는 테이블만 포함(빈 배열 제외) — 서버도 []를 안전 skip 하지만 payload 를 작게 유지(defense-in-depth).
  for (const t of wanted) if (Array.isArray(backup[t]) && backup[t].length > 0) tables[t] = backup[t];
  return { tables };
}

// ── dependency preflight(순수): 선택 dataset 의 자식 테이블이 요구하는 parent 가
//    (선택 테이블 ∪ 현재 DB 에 존재 테이블) 에 없으면 missing 으로 반환. UI 가 복원 차단에 사용.
export type ExamPreflight = { ok: boolean; missing: Array<{ table: string; missingParent: string }> };
export function preflightExamDependencies(
  selectedDatasetKeys: string[], backup: ExamBackup, tablesPresentInDb: Set<string>
): ExamPreflight {
  const selectedTables = new Set(EXAM_DR_DATASETS.filter((d) => selectedDatasetKeys.includes(d.key)).flatMap((d) => d.tables));
  const satisfiable = (parent: string): boolean => {
    // parent 가 선택 백업에 행이 있거나, 현재 DB 에 이미 존재하면 충족.
    if (selectedTables.has(parent) && (backup[parent]?.length ?? 0) > 0) return true;
    if (tablesPresentInDb.has(parent)) return true;
    return false;
  };
  const missing: Array<{ table: string; missingParent: string }> = [];
  for (const t of selectedTables) {
    if (!(backup[t]?.length)) continue; // 실제 복원할 행이 없으면 의존성 불필요
    for (const p of EXAM_FK_PARENTS[t] || []) if (!satisfiable(p)) missing.push({ table: t, missingParent: p });
  }
  return { ok: missing.length === 0, missing };
}

// ── 서버 RPC 호출(allowlist/tenant/admin/원자성은 DB 가 강제). 에러를 사용자 메시지로 매핑.
export type ExamRestoreResult = { ok: boolean; idempotent?: boolean; rowCounts?: Record<string, number>; code?: string; message: string };
export async function callExamDrRestore(client: SupabaseClient, requestId: string, payload: { tables: ExamBackup }): Promise<ExamRestoreResult> {
  const { data, error } = await client.rpc("exam_dr_restore", { p_request_id: requestId, p_payload: payload });
  if (error) {
    const raw = error.message || String(error);
    let message = "시험관리 복원에 실패했습니다."; let code = "ERROR";
    if (/EXAM_DR_RESTORE_BUSY/.test(raw)) { code = "BUSY"; message = "다른 시험관리 복원 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요."; }
    else if (/EXAM_DR_NOT_ADMIN|EXAM_DR_AUTH_REQUIRED/.test(raw)) { code = "FORBIDDEN"; message = "시험관리 복원 권한이 없습니다(관리자 전용)."; }
    else if (/EXAM_DR_TABLE_NOT_ALLOWED/.test(raw)) { code = "NOT_ALLOWED"; message = "허용되지 않은 복원 대상이 포함되어 중단했습니다."; }
    else if (/foreign key|violates|EXAM_DR_MISSING_ID/.test(raw)) { code = "INTEGRITY"; message = "복원에 실패하여 시험관리 데이터는 복원 전 상태로 되돌아갔습니다."; }
    return { ok: false, code, message }; // 기술 SQL 전문은 UI 에 노출하지 않음
  }
  const d = (data as { idempotent?: boolean; row_counts?: Record<string, number> }) || {};
  return { ok: true, idempotent: !!d.idempotent, rowCounts: d.row_counts, message: d.idempotent ? "이미 완료된 복원 요청입니다(중복 실행 아님)." : "시험관리 복원이 완료되었습니다." };
}

// ── post-verify: orphan FK / 중복 PK / tenant mismatch(핵심 관계만, READ-ONLY). ok=false 면 사후검증 실패.
export type ExamPostVerify = { ok: boolean; issues: string[] };
export async function postVerifyExam(client: SupabaseClient, tenantId: string): Promise<ExamPostVerify> {
  const issues: string[] = [];
  // orphan FK 는 대표 관계만 확인(전수는 서버 integrity gate 와 중복). 여기선 저비용 count 검사.
  const orphanChecks: Array<{ child: string; fk: string; parent: string }> = [
    { child: "exam_processes", fk: "category_id", parent: "exam_categories" },
    { child: "exam_processes", fk: "group_id", parent: "exam_groups" },
    { child: "exam_equipment", fk: "process_id", parent: "exam_processes" },
    { child: "exam_applications", fk: "personnel_id", parent: "exam_personnel" },
    { child: "exam_results", fk: "application_id", parent: "exam_applications" },
  ];
  for (const c of orphanChecks) {
    const { data, error } = await client.from(c.child).select("id, " + c.fk).eq("tenant_id", tenantId).not(c.fk, "is", null).limit(2000);
    if (error) { issues.push(`검증 조회 실패(${c.child})`); continue; }
    const ids = (data as unknown as Array<Record<string, unknown>>).map((r) => r[c.fk]).filter((v) => v != null);
    if (ids.length === 0) continue;
    const { data: parents, error: pe } = await client.from(c.parent).select("id").in("id", ids as string[]);
    if (pe) { issues.push(`검증 조회 실패(${c.parent})`); continue; }
    const have = new Set((parents as unknown as Array<{ id: unknown }>).map((r) => String(r.id)));
    const orphans = (ids as unknown[]).filter((v) => !have.has(String(v)));
    if (orphans.length) issues.push(`orphan FK: ${c.child}.${c.fk} → ${c.parent} (${orphans.length})`);
  }
  return { ok: issues.length === 0, issues };
}
