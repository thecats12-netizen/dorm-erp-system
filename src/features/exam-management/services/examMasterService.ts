// 시험관리 기준정보/인증기준 CRUD 서비스 — 공통 supabase-js client 재사용(직접 fetch 없음).
// tenant_id 격리 + soft delete(deleted_at) + is_active. 변경이력은 exam_audit_logs 에 기록.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";

export type ExamMasterTable =
  | "exam_categories"
  | "exam_groups"
  | "exam_parts"
  | "exam_processes"
  | "exam_levels"
  | "exam_equipment"
  | "exam_rules"
  | "exam_personnel"
  | "exam_applications"
  | "pm_certifications"
  | "dm_certifications"
  | "exam_annual_targets"
  | "exam_monthly_results";

// 직원 상세(더블클릭)에서 조회하는 시험/인증 관련 테이블.
export type ExamPersonnelChildTable = "exam_applications" | "exam_results" | "pm_certifications" | "dm_certifications";

export type ExamRow = Record<string, unknown> & { id?: string };

const nowIso = () => new Date().toISOString();

export const examSupabaseReady = () => isSupabaseAvailable();

// 테이블별 정렬 컬럼(실제 운영 DB 컬럼 기준).
//  - sort_order 컬럼은 기준정보(카테고리/그룹/파트/공정/설비)에만 존재한다.
//  - 나머지 테이블(levels/rules/personnel/applications/pm·dm_certifications/annual·monthly)에는 sort_order 가 없어
//    `.order("sort_order")` 를 붙이면 400(column "sort_order" does not exist)이 발생한다 → 존재하는 컬럼만 정렬에 사용.
//  - tenant_id(text), deleted_at 은 모든 시험 테이블에 존재하므로 공통 적용한다.
const EXAM_TABLE_ORDER: Record<ExamMasterTable, string[]> = {
  exam_categories: ["sort_order", "created_at"],
  exam_groups: ["sort_order", "created_at"],
  exam_parts: ["sort_order", "created_at"],
  exam_processes: ["sort_order", "created_at"],
  exam_equipment: ["sort_order", "created_at"],
  exam_levels: ["rank_order", "created_at"],
  exam_rules: ["created_at"],
  exam_personnel: ["employee_no", "created_at"],
  exam_applications: ["created_at"],
  pm_certifications: ["created_at"],
  dm_certifications: ["created_at"],
  exam_annual_targets: ["created_at"],
  exam_monthly_results: ["created_at"],
};

// 목록 조회(미삭제). 실패 시 예외(상위에서 안내). 존재하지 않는 컬럼으로 정렬/필터하지 않는다.
export async function listExamRows(table: ExamMasterTable, tenantId: string): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const orderCols = EXAM_TABLE_ORDER[table] || ["created_at"];
  let q = supabase
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId)   // tenant_id: text (기존 데이터 기본값 'default') — 앱의 실제 tenantId 재사용
    .is("deleted_at", null);     // deleted_at 은 모든 시험 테이블에 존재
  for (const col of orderCols) q = q.order(col, { ascending: true, nullsFirst: true });
  const { data, error } = await q;
  if (error) {
    // [진단용] 실제 Supabase 응답(code/message/details/hint)을 개발 콘솔에 남긴다. 사용자 UI 는 상위에서 안내.
    console.error("[examMasterService] listExamRows 실패:", {
      table, tenantId, orderColumns: orderCols,
      code: (error as { code?: unknown })?.code ?? "(unknown)",
      message: error.message,
      details: (error as { details?: unknown })?.details ?? "(none)",
      hint: (error as { hint?: unknown })?.hint ?? "(none)",
    });
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
  return (data as ExamRow[]) || [];
}

// 참조 선택용 경량 목록({ id, label }). name(+code) 로 라벨 구성.
export async function listExamRefOptions(table: ExamMasterTable, tenantId: string): Promise<Array<{ id: string; label: string }>> {
  const rows = await listExamRows(table, tenantId);
  return rows
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      id: String(r.id),
      label: [r.code, r.name].filter(Boolean).join(" · ") || String(r.name || r.id),
    }));
}

// 등록/수정 upsert(id 없으면 신규). created_by/updated_by/시각 자동 세팅.
export async function upsertExamRow(table: ExamMasterTable, row: ExamRow, tenantId: string, userId: string): Promise<ExamRow> {
  if (!supabase) throw new Error("Supabase 미설정");
  const isNew = !row.id;
  const id = row.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const payload: ExamRow = {
    ...row,
    id,
    tenant_id: tenantId,
    updated_by: userId,
    updated_at: nowIso(),
    ...(isNew ? { created_by: userId, created_at: nowIso() } : {}),
  };
  // 저장 직전 세션 확인 — 세션이 없으면 어차피 403 이므로 요청을 보내지 않고 즉시 안내(불필요한 403 제거).
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session?.access_token) {
    console.error("[examMasterService] upsertExamRow 중단: 유효한 세션 없음", { table, action: isNew ? "insert" : "update", tenantId, userId });
    throw new Error("로그인 세션이 만료되었습니다.\n다시 로그인한 후 저장해주세요.");
  }

  const { data, error } = await supabase.from(table).upsert(payload, { onConflict: "id" }).select().single();
  if (error) {
    // [진단] 실제 Supabase 응답을 개발 콘솔에 그대로 남긴다. access_token/anon key 등 민감정보는 출력하지 않는다.
    // 권한/인증(401·403) 오류는 자동 재시도하지 않고 즉시 실패시킨다.
    const e = error as { code?: unknown; message?: string; details?: unknown; hint?: unknown; status?: unknown };
    console.error("[examMasterService] upsertExamRow 실패:", {
      table, action: isNew ? "insert(upsert)" : "update(upsert)", method: "POST",
      request: `POST /rest/v1/${table}?on_conflict=id&select=*`,
      code: e?.code ?? "(unknown)", status: e?.status ?? "(unknown)",
      message: e?.message, details: e?.details ?? "(none)", hint: e?.hint ?? "(none)",
      userId, tenantId, rowId: id,
      payloadKeys: Object.keys(payload),        // 값이 아닌 key 목록만 출력
      hasSession: true, sessionUserId: sess.session.user?.id ?? "(none)",
    });
    throw new Error(translateExamWriteError(error));
  }
  return data as ExamRow;
}

// 저장 오류 → 사용자 메시지. 세션만료 / 권한부족 / tenant 불일치 / 일반 실패를 구분한다.
// 브라우저 alert 미사용 — 호출부의 기존 오류 배너·Toast 로 표시된다.
export function translateExamWriteError(error: unknown): string {
  const e = error as { code?: unknown; message?: string; details?: unknown; hint?: unknown; status?: unknown };
  const code = String(e?.code ?? "");
  const status = Number(e?.status ?? 0);
  const msg = `${e?.message ?? ""} ${e?.details ?? ""} ${e?.hint ?? ""}`.toLowerCase();

  // 세션 만료/토큰 무효(PGRST301 = JWT 검증 실패)
  if (status === 401 || code === "PGRST301" || /jwt expired|invalid jwt|token is expired/.test(msg)) {
    return "로그인 세션이 만료되었습니다.\n다시 로그인한 후 저장해주세요.";
  }
  // tenant 불일치(정책의 tenant 조건 위반이 명시된 경우)
  if (/tenant/.test(msg)) {
    return "현재 회사 정보와 저장 대상 회사 정보가 일치하지 않습니다.";
  }
  // 권한 부족(RLS 위반 42501 / GRANT 누락 / 403)
  if (status === 403 || code === "42501" || /row-level security|permission denied|insufficient privilege|not authorized/.test(msg)) {
    return "인증 기준정보를 저장할 권한이 없습니다.\n로그인 상태와 관리자 권한을 확인해주세요.";
  }
  // 중복(23505 unique_violation)
  if (code === "23505" || /duplicate key|unique constraint/.test(msg)) {
    return "이미 같은 응시 신청이 등록되어 있습니다.\n중복 등록은 할 수 없습니다.";
  }
  // 필수값 누락(23502 not_null_violation) — DB 컬럼 설정 문제일 수 있어 관리자 안내를 함께 제공.
  if (code === "23502" || /not-null constraint|null value in column/.test(msg)) {
    return "시험 응시 데이터를 저장할 수 없습니다.\n필수 항목이 누락되었거나 데이터베이스 설정을 확인해야 합니다.\n관리자에게 문의해주세요.";
  }
  // 참조 무결성(23503 foreign_key_violation)
  if (code === "23503" || /foreign key constraint/.test(msg)) {
    return "연결된 기준 정보를 찾을 수 없습니다.\n대상자·공정·설비 정보를 확인해주세요.";
  }
  // 존재하지 않는 컬럼/스키마 캐시(PGRST204) — 마이그레이션 미적용 가능성.
  if (code === "PGRST204" || /could not find the .* column|schema cache/.test(msg)) {
    return "시험 응시 데이터를 저장할 수 없습니다.\n데이터베이스 설정(컬럼)이 최신이 아닐 수 있습니다.\n관리자에게 확인을 요청해주세요.";
  }
  return `시험관리 데이터를 저장하지 못했습니다.\n잠시 후 다시 시도해주세요.\n(${translateSupabaseError(e?.message || String(error))})`;
}

// 소프트 삭제(원본 보존): deleted_at 세팅 + is_active=false.
export async function softDeleteExamRow(table: ExamMasterTable, id: string, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from(table).update({ deleted_at: nowIso(), is_active: false, updated_by: userId, updated_at: nowIso() }).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}

// 사용/미사용 토글.
export async function setExamRowActive(table: ExamMasterTable, id: string, isActive: boolean, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from(table).update({ is_active: isActive, updated_by: userId, updated_at: nowIso() }).eq("id", id);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
}

// 변경이력 기록(best-effort — 실패해도 본 작업은 유지).
export async function writeExamAudit(
  tenantId: string,
  userId: string,
  targetType: ExamMasterTable,
  targetId: string,
  actionType: "create" | "update" | "delete" | "import" | "toggle" | "approve" | "reject",
  before: unknown,
  after: unknown,
  memo?: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("exam_audit_logs").insert({
      tenant_id: tenantId,
      target_type: targetType,
      target_id: targetId,
      action_type: actionType,
      changed_by: userId,
      before_value: (before ?? null) as never,
      after_value: (after ?? null) as never,
      memo: memo || null,
      created_by: userId,
    });
  } catch (e) {
    console.warn("[examAudit] 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}

// ── Excel 인력현황 → exam_personnel 동기화(사번 기준 upsert · 변경필드만 · 빈값 덮어쓰기 금지) ──
export type PersonnelSyncOutcome = { total: number; newCount: number; updateCount: number; unchangedCount: number; errors: Array<{ ref: string; reason: string }> };

// exam_personnel 에 실제 존재하는 동기화 대상 필드(사번 제외). process_id/part_name 병행 저장.
const PERSONNEL_SYNC_FIELDS = [
  "name", "group_name", "product_group", "part_name", "process_id", "position", "hire_date",
  "employment_status", "career_type", "current_pm_level", "pm_capable_rate",
  "single_job", "m1", "m2", "m3", "m4", "dm", "cert_level", "dual_multi", "notes",
] as const;

const syncIsEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

// rows: 검증 완료된 인력행(process_id 는 호출부에서 공정 매핑으로 해석). canWrite: 공정 권한 판정(관리자=항상 true).
export async function syncExamPersonnel(
  rows: Array<ExamRow>,
  tenantId: string,
  userId: string,
  canWrite: (processId: string | null | undefined, action: "create" | "update") => boolean
): Promise<PersonnelSyncOutcome> {
  if (!supabase) throw new Error("Supabase 미설정");
  const out: PersonnelSyncOutcome = { total: rows.length, newCount: 0, updateCount: 0, unchangedCount: 0, errors: [] };

  // 기존 인력(사번 기준). listExamRows 는 RLS 적용 → 접근 가능한 데이터만.
  const existing = await listExamRows("exam_personnel", tenantId);
  const byEmp = new Map<string, ExamRow>();
  for (const r of existing) { const e = String(r.employee_no ?? "").trim(); if (e) byEmp.set(e, r); }

  for (const row of rows) {
    const emp = String(row.employee_no ?? "").trim(); // 앞자리 0 보존(문자열 그대로)
    const ref = emp || String(row.name ?? "?");
    try {
      if (!emp) { out.errors.push({ ref, reason: "사번 없음" }); continue; }         // 이름만으로 판정 금지
      const prev = byEmp.get(emp);
      const incomingPid = (row.process_id ?? null) as string | null;

      if (!prev) {
        // 신규 등록
        if (!canWrite(incomingPid, "create")) { out.errors.push({ ref, reason: "권한 없는 공정(신규 차단)" }); continue; }
        const payload: ExamRow = { employee_no: emp };
        for (const f of PERSONNEL_SYNC_FIELDS) if (!syncIsEmpty(row[f])) payload[f] = row[f]; // 빈값은 넣지 않음
        const saved = await upsertExamRow("exam_personnel", payload, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_personnel", String(saved.id), "create", null, saved, "Excel 인력현황 동기화(신규)");
        out.newCount++;
      } else {
        // 기존 → 변경된 "비어있지 않은" 필드만 수정. 퇴사=상태 변경(삭제 아님).
        const scopePid = (prev.process_id ?? incomingPid) as string | null; // 타 공정 수정 금지: 기존 공정 기준
        if (!canWrite(scopePid, "update")) { out.errors.push({ ref, reason: "권한 없는 공정(수정 차단)" }); continue; }
        const patch: ExamRow = {};
        for (const f of PERSONNEL_SYNC_FIELDS) {
          if (syncIsEmpty(row[f])) continue;                                   // 빈값으로 기존 정상값 덮어쓰기 금지
          if (String(row[f]) !== String(prev[f] ?? "")) patch[f] = row[f];      // 실제 변경분만
        }
        if (Object.keys(patch).length === 0) { out.unchangedCount++; continue; } // 변경 없음
        const saved = await upsertExamRow("exam_personnel", { ...prev, ...patch, id: prev.id }, tenantId, userId);
        await writeExamAudit(tenantId, userId, "exam_personnel", String(saved.id), "update", prev, saved, "Excel 인력현황 동기화(수정)");
        out.updateCount++;
      }
    } catch (e) {
      // 부분 실패: 한 행 오류가 다른 행 저장을 막지 않는다(오류 행 임의 저장도 하지 않음).
      out.errors.push({ ref, reason: (e as { message?: string })?.message || "저장 실패" });
    }
  }
  return out;
}

// 직원 상세: personnel_id 로 연결된 시험/인증 레코드 조회(미삭제, 최신순).
export async function listByPersonnel(table: ExamPersonnelChildTable, tenantId: string, personnelId: string): Promise<ExamRow[]> {
  if (!supabase || !personnelId) return [];
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("personnel_id", personnelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as ExamRow[]) || [];
}

// 사번 중복 확인(미삭제, 본인 제외). true = 중복.
export async function isDuplicateEmployeeNo(tenantId: string, employeeNo: string, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim()) return false;
  let q = supabase.from("exam_personnel").select("id").eq("tenant_id", tenantId).eq("employee_no", employeeNo).is("deleted_at", null).limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// 시험 응시 중복 확인(미삭제, 본인 제외): 동일 사원번호 + 동일 구분코드. true = 중복.
export async function isDuplicateApplication(tenantId: string, employeeNo: string, categoryCode: string, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim() || !String(categoryCode || "").trim()) return false;
  let q = supabase.from("exam_applications").select("id")
    .eq("tenant_id", tenantId).eq("employee_no", employeeNo).eq("category_code", categoryCode)
    .is("deleted_at", null).limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// D.M 인증 중복 확인(미삭제, 본인 제외): 동일 사원번호 + D.M 단계 + 취득일. true = 중복.
export async function isDuplicateDm(tenantId: string, employeeNo: string, dmStage: string, acquiredDate: string | null, excludeId?: string): Promise<boolean> {
  if (!supabase || !String(employeeNo || "").trim() || !String(dmStage || "").trim()) return false;
  let q = supabase.from("dm_certifications").select("id")
    .eq("tenant_id", tenantId).eq("employee_no", employeeNo).eq("dm_stage", dmStage)
    .is("deleted_at", null).limit(1);
  q = acquiredDate ? q.eq("acquired_date", acquiredDate) : q.is("acquired_date", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data?.length || 0) > 0;
}

// Excel 가져오기 작업 기록(best-effort). 반영 건수/오류 건수 집계용. job id 반환.
export async function writeImportJob(
  tenantId: string, userId: string, fileName: string, targetTable: string,
  total: number, success: number, errorRows: number
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("exam_import_jobs").insert({
      tenant_id: tenantId, file_name: fileName, target_table: targetTable, status: "done",
      total_rows: total, success_rows: success, error_rows: errorRows,
      started_at: nowIso(), finished_at: nowIso(), created_by: userId, updated_by: userId,
    }).select("id").single();
    if (error) return null;
    return (data as { id?: string })?.id || null;
  } catch { return null; }
}

// Excel 가져오기 오류 상세 기록(best-effort).
export async function writeImportErrors(
  tenantId: string, userId: string, jobId: string,
  errs: Array<{ row: number; column?: string; message: string; raw?: unknown }>
): Promise<void> {
  if (!supabase || !jobId || !errs.length) return;
  try {
    await supabase.from("exam_import_errors").insert(errs.slice(0, 500).map((e) => ({
      tenant_id: tenantId, job_id: jobId, row_no: e.row, column_name: e.column || null,
      message: e.message, raw_data: (e.raw ?? null) as never, created_by: userId,
    })));
  } catch { /* 무시 */ }
}

// 특정 대상의 변경이력 조회(최신순).
export async function listExamAudit(tenantId: string, targetType: ExamMasterTable, targetId: string): Promise<ExamRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("exam_audit_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as ExamRow[]) || [];
}
