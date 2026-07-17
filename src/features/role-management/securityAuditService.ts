// 보안 감사로그(security_audit_logs) 기록.
//  - 민감정보/access token 저장 금지. IP 는 클라이언트에서 신뢰 불가 → 저장하지 않음(user_agent 만).
//  - 테이블 미적용/실패 시 조용히 무시(본 작업 흐름을 막지 않음).
import { supabase, isSupabaseAvailable } from "../../services/supabaseService";

export type SecurityAction =
  | "role_assign" | "role_change" | "escalation_blocked" | "access_denied"
  | "download_blocked" | "last_admin_blocked" | "approve" | "reject";

export async function writeSecurityAudit(input: {
  tenantId: string;
  actorUserId: string;
  action: SecurityAction;
  result: "allowed" | "blocked";
  targetUserId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  permissionKey?: string | null;
  reason?: string | null;
}): Promise<void> {
  if (!isSupabaseAvailable() || !supabase) return;
  try {
    await supabase.from("security_audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId || null,
      target_user_id: input.targetUserId || null,
      action: input.action,
      resource_type: input.resourceType || null,
      resource_id: input.resourceId || null,
      permission_key: input.permissionKey || null,
      result: input.result,
      reason: input.reason || null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
    });
  } catch (e) {
    console.warn("[securityAudit] 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}

// 표준 권한 오류 메시지(브라우저 alert 금지 → 앱 Toast/모달로 표시).
export const PERMISSION_ERRORS = {
  noPermission: "이 작업을 수행할 권한이 없습니다.",
  outOfScope: "접근 가능한 데이터 범위를 벗어났습니다.",
  sessionExpired: "로그인 세션이 만료되었습니다. 다시 로그인해주세요.",
  fileBlocked: "이 파일을 열거나 다운로드할 권한이 없습니다.",
  lastAdmin: "마지막 관리자 계정은 비활성화하거나 권한을 변경할 수 없습니다.",
} as const;
