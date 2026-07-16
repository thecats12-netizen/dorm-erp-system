// 시험관리 공정별 담당자 권한 서비스.
//  - 실제 접근 제어는 Supabase RLS(20260717000000_exam_process_scopes.sql)가 서버에서 강제한다.
//    (프론트는 관리 UI + 방어적 UX 용도. 버튼 숨김만으로 권한을 처리하지 않는다.)
//  - service_role_key 를 사용하지 않고 공통 anon/authenticated client 만 사용한다.
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";

export type ExamRole = "super" | "admin" | "process_owner" | "viewer" | null;

export type ExamProcessScope = {
  id?: string;
  user_id: string;
  process_id: string;
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_approve: boolean;
  can_export: boolean;
  is_active: boolean;
};

export type MyExamPermissions = {
  examRole: ExamRole;
  isSuper: boolean;
  isAdmin: boolean;   // super 포함
  isViewerAll: boolean;
  scopes: ExamProcessScope[];               // 내 담당 공정(활성)
  can: (processId: string | null | undefined, perm: "view" | "create" | "update" | "approve" | "export") => boolean;
};

const nowIso = () => new Date().toISOString();

// 현재 로그인 사용자의 프로필 exam_role + 내 스코프를 읽어 권한 판정 헬퍼를 만든다.
export async function loadMyExamPermissions(tenantId: string): Promise<MyExamPermissions> {
  const empty: MyExamPermissions = { examRole: null, isSuper: false, isAdmin: false, isViewerAll: false, scopes: [], can: () => false };
  if (!isSupabaseAvailable() || !supabase) return empty;
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) return empty;

  // exam_role 은 profiles 에서. role='admin' → super, role='viewer' 이고 exam_role 없음 → viewer(레거시 유지).
  // select("*") 로 읽어 exam_role 컬럼 미적용(마이그레이션 전) 환경에서도 오류 없이 role 기반으로 동작(무회귀).
  const { data: prof } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  const role = (prof as { role?: string } | null)?.role;
  const explicit = ((prof as { exam_role?: ExamRole } | null)?.exam_role ?? null) as ExamRole;
  const examRole: ExamRole = role === "admin" ? "super" : (explicit ?? (role === "viewer" ? "viewer" : null));

  let scopes: ExamProcessScope[] = [];
  if (examRole === "process_owner") {
    try {
      const { data } = await supabase
        .from("exam_user_process_scopes")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("user_id", uid)
        .eq("is_active", true);
      scopes = (data as ExamProcessScope[]) || [];
    } catch { scopes = []; } // 스코프 테이블 미적용 시 안전 처리
  }

  const isSuper = examRole === "super";
  const isAdmin = examRole === "super" || examRole === "admin";
  const isViewerAll = examRole === "viewer";
  const can: MyExamPermissions["can"] = (processId, perm) => {
    if (isAdmin) return true;                         // super/admin 전권
    if (perm === "view" && isViewerAll) return true;  // viewer 전체 읽기
    if (!processId) return false;
    const s = scopes.find((x) => x.process_id === processId && x.is_active);
    if (!s) return false;
    return perm === "view" ? (s.can_view || s.can_create || s.can_update || s.can_approve)
      : perm === "create" ? s.can_create
      : perm === "update" ? s.can_update
      : perm === "approve" ? s.can_approve
      : perm === "export" ? s.can_export : false;
  };
  return { examRole, isSuper, isAdmin, isViewerAll, scopes, can };
}

// 특정 사용자의 스코프 조회(관리 화면용 — RLS 상 super 만 타인 스코프 조회 가능).
export async function getUserProcessScopes(userId: string, tenantId: string): Promise<ExamProcessScope[]> {
  if (!isSupabaseAvailable() || !supabase || !userId) return [];
  const { data, error } = await supabase
    .from("exam_user_process_scopes")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) { console.error("[examPermission] getUserProcessScopes 실패:", { code: (error as { code?: unknown }).code, message: error.message }); return []; }
  return (data as ExamProcessScope[]) || [];
}

// exam_role 저장(계정 등록/수정 반영). role='admin' 사용자는 super 자동 → 저장 불필요하지만 명시 저장도 허용.
export async function setUserExamRole(userId: string, examRole: ExamRole, actingUserId: string, tenantId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const { error } = await supabase.from("profiles").update({ exam_role: examRole }).eq("id", userId);
  if (error) throw new Error(error.message);
  await writeExamPermissionAudit(tenantId, actingUserId, userId, "exam_role", null, { exam_role: examRole });
}

// 스코프 저장: 화면의 목록을 upsert 하고, 화면에서 빠진 기존 행은 is_active=false 로 비활성(물리삭제 없음).
export async function saveUserProcessScopes(
  userId: string, tenantId: string, actingUserId: string, next: ExamProcessScope[]
): Promise<void> {
  if (!supabase) throw new Error("Supabase 미설정");
  const before = await getUserProcessScopes(userId, tenantId);
  const nextIds = new Set(next.map((s) => s.process_id));

  // upsert (tenant_id,user_id,process_id) 유니크 기준
  for (const s of next) {
    const payload = {
      tenant_id: tenantId, user_id: userId, process_id: s.process_id,
      can_view: s.can_view, can_create: s.can_create, can_update: s.can_update,
      can_approve: s.can_approve, can_export: s.can_export, is_active: true,
      updated_by: actingUserId, updated_at: nowIso(),
      ...(before.find((b) => b.process_id === s.process_id) ? {} : { created_by: actingUserId }),
    };
    const { error } = await supabase.from("exam_user_process_scopes").upsert(payload, { onConflict: "tenant_id,user_id,process_id" });
    if (error) throw new Error(error.message);
  }
  // 제외된 기존 행 비활성화(soft)
  for (const b of before) {
    if (b.is_active && !nextIds.has(b.process_id)) {
      const { error } = await supabase.from("exam_user_process_scopes")
        .update({ is_active: false, updated_by: actingUserId, updated_at: nowIso() })
        .eq("tenant_id", tenantId).eq("user_id", userId).eq("process_id", b.process_id);
      if (error) throw new Error(error.message);
    }
  }
  await writeExamPermissionAudit(tenantId, actingUserId, userId, "process_scopes", before, next);
}

// 권한 변경 감사로그(기존 exam_audit_logs 재사용 — 별도 테이블 생성 없음).
export async function writeExamPermissionAudit(
  tenantId: string, actingUserId: string, targetUserId: string, kind: string, before: unknown, after: unknown
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("exam_audit_logs").insert({
      tenant_id: tenantId,
      target_type: "exam_user_process_scopes",
      target_id: targetUserId,
      action_type: "update",
      changed_by: actingUserId,
      before_value: (before ?? null) as never,
      after_value: (after ?? null) as never,
      memo: `권한 변경(${kind})`,
      created_by: actingUserId,
    });
  } catch (e) {
    console.warn("[examPermission] 감사로그 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}
