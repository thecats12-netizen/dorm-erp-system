// 시험관리 자동화 작업 이력 — 기존 exam_audit_logs 구조 재사용(별도 테이블 없음).
//  target_type="exam_automation", action_type=실행 유형, after_value(jsonb)=집계 요약.
//  개인정보/JWT/API key 는 저장하지 않는다(집계 건수 + 일반 근거/오류 메시지만 기록).
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";

export type AutomationLogInput = {
  runType: string;   // 실행 유형(예: 선택 직원 재계산 / 전체 검증 / 재시험 후보 자동생성)
  module: string;    // 대상 모듈(예: 응시관리 / D.M 인증 / 재시험 / 월간실적)
  total: number; success: number; failed: number; needCheck: number;
  reasons?: string[];  // 계산 근거(일반 문구 — PII 제외)
  errors?: string[];   // 오류 내용(메시지 — PII 제외)
  beforeValue?: unknown; // 변경 전 값(선택)
  afterValue?: unknown;  // 변경 후 값(선택)
};

export type AutomationLogRow = Record<string, unknown> & {
  id?: string; action_type?: string; target_id?: string; changed_by?: string; created_at?: string;
  before_value?: unknown; after_value?: unknown; memo?: string;
};

// JWT/토큰/키/이메일/연락처 등으로 보이는 문자열은 로그에서 제외(안전장치).
const PII_RE = /eyJ[\w-]+\.|bearer\s|sk-|api[_-]?key|password|@[\w.-]+\.\w+|\d{3}-?\d{3,4}-?\d{4}/i;
const sanitizeList = (arr?: string[]): string[] => (arr || []).slice(0, 30).map((s) => String(s)).filter((s) => !PII_RE.test(s));
const sanitizeVal = (v: unknown): unknown => {
  if (v == null) return null;
  const s = JSON.stringify(v);
  return PII_RE.test(s) ? "(민감정보 제외)" : v;
};

export const automationLogReady = () => isSupabaseAvailable();

// 자동화 실행 이력 기록(best-effort — 실패해도 본 작업은 유지).
export async function writeAutomationLog(tenantId: string, userId: string, input: AutomationLogInput): Promise<void> {
  if (!supabase) return;
  const after = {
    module: input.module,
    total: input.total, success: input.success, failed: input.failed, needCheck: input.needCheck,
    reasons: sanitizeList(input.reasons),
    errors: sanitizeList(input.errors),
    afterValue: sanitizeVal(input.afterValue),
  };
  try {
    await supabase.from("exam_audit_logs").insert({
      tenant_id: tenantId,
      target_type: "exam_automation",
      target_id: input.module,
      action_type: input.runType,
      changed_by: userId || null,
      before_value: sanitizeVal(input.beforeValue) as never,
      after_value: after as never,
      memo: `${input.runType} · 대상 ${input.total} 성공 ${input.success} 실패 ${input.failed} 확인 ${input.needCheck}`,
      created_by: userId || null,
    });
  } catch (e) {
    console.warn("[automationLog] 기록 실패(무시):", (e as { message?: string })?.message || e);
  }
}

// 자동화 실행 이력 목록(최신순). 필터는 호출부에서 클라이언트 측 적용.
export async function listAutomationLogs(tenantId: string): Promise<AutomationLogRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase
    .from("exam_audit_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("target_type", "exam_automation")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(translateSupabaseError(error.message || String(error)));
  return (data as AutomationLogRow[]) || [];
}
