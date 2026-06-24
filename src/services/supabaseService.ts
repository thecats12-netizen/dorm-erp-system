import { createClient } from "@supabase/supabase-js";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice, MilitaryReport } from "../types/domain";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseAvailable = (): boolean => Boolean(supabaseUrl && supabaseKey);

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export const translateSupabaseError = (errorMessage: string | null | undefined): string => {
  const message = String(errorMessage || "").trim();
  if (!message) {
    return "Supabase에서 오류가 발생했습니다. 관리자에게 문의하세요.";
  }

  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(message)) {
    return message;
  }

  const lower = message.toLowerCase();
  if (/permission denied|forbidden|denied/i.test(lower)) {
    return "권한이 없습니다. 관리자에게 문의하세요.";
  }
  if (/row level security|rls/i.test(lower)) {
    return "행 수준 보안(RLS) 정책으로 인해 액세스할 수 없습니다.";
  }
  if (/duplicate key value violates unique constraint|unique constraint|duplicate/i.test(lower)) {
    return "중복된 항목이 있어 저장할 수 없습니다.";
  }
  if (/invalid input syntax/i.test(lower)) {
    return "입력 형식이 잘못되었습니다.";
  }
  if (/invalid login credentials|invalid email or password|invalid password|wrong password/i.test(lower)) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (/user not found/i.test(lower)) {
    return "사용자를 찾을 수 없습니다.";
  }
  if (/network request failed|failed to fetch/i.test(lower)) {
    return "네트워크 요청에 실패했습니다. 인터넷 연결을 확인해주세요.";
  }
  if (/jwt|token/i.test(lower)) {
    return "인증 토큰이 만료되었거나 유효하지 않습니다.";
  }
  if (/not found/i.test(lower)) {
    return "요청한 항목을 찾을 수 없습니다.";
  }
  if (/cannot insert|cannot update|cannot delete|invalid/i.test(lower)) {
    return "요청을 처리할 수 없습니다. 입력값을 확인해주세요.";
  }

  return "Supabase에서 오류가 발생했습니다. 관리자에게 문의하세요.";
};

export const MILITARY_MODULE_TABLE = "military_module_data";

export type MilitaryModuleState = {
  tenantId: string;
  militaryPersonnel: MilitaryPersonnel[];
  militaryTrainingRecords: TrainingRecord[];
  militaryNotices: MilitaryNotice[];
  militaryReports: MilitaryReport[];
  militarySettings: Record<string, any>;
  militaryTrainingRules: any[];
  militaryCodeValues: any;
  militaryTrainingAutoConfig: { enabled: boolean; targetStatuses: string[] };
};

export const loadMilitaryModule = async (tenantId: string): Promise<MilitaryModuleState | null> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Falling back to local storage.");
    return null;
  }
  const { data, error } = await supabase!
    .from(MILITARY_MODULE_TABLE)
    .select("data")
    .eq("tenant_id", tenantId)
    .single();

  if (error) {
    if (error.message?.includes("No rows")) return null;
    console.error("Supabase load error:", error);
    throw error;
  }
  return data?.data ?? null;
};

export const saveMilitaryModule = async (payload: MilitaryModuleState): Promise<void> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping Supabase save.");
    return;
  }
  const row = {
    tenant_id: payload.tenantId,
    data: payload,
    updated_at: new Date().toISOString(),
  };
  // military_module_data 는 테넌트당 1행 구조이지만 tenant_id 에 unique 제약이 없을 수 있어
  // onConflict:"tenant_id" upsert 가 400(no unique constraint)을 유발한다.
  // → 제약 유무와 무관하게 동작하도록 "존재 여부 확인 후 update/insert"로 처리.
  const payloadBytes = (() => { try { return JSON.stringify(payload).length; } catch { return -1; } })();
  const logErr = (operation: string, error: unknown) => {
    const e = error as { code?: unknown; message?: string; details?: unknown; hint?: unknown };
    console.error(`[saveMilitaryModule] ${operation} 실패`, {
      table: MILITARY_MODULE_TABLE,
      operation,
      tenantId: payload.tenantId,
      code: e?.code ?? "(unknown)",
      message: e?.message ?? String(error),
      details: e?.details,
      hint: e?.hint,
      payloadBytes,
    });
  };

  const { data: existing, error: selErr } = await supabase!
    .from(MILITARY_MODULE_TABLE)
    .select("tenant_id")
    .eq("tenant_id", payload.tenantId)
    .limit(1);
  if (selErr) {
    logErr("select", selErr);
    throw selErr;
  }

  if (existing && existing.length > 0) {
    const { error } = await supabase!.from(MILITARY_MODULE_TABLE).update(row).eq("tenant_id", payload.tenantId);
    if (error) { logErr("update", error); throw error; }
  } else {
    // created_at default 가 없는 배포 스키마에서도 안전하도록 명시(있으면 무시됨)
    const { error } = await supabase!.from(MILITARY_MODULE_TABLE).insert({ ...row, created_at: new Date().toISOString() });
    if (error) { logErr("insert", error); throw error; }
  }
};

// ============================================================================
// 운영 설정(operational/app settings) — 테넌트당 1행 JSON 블롭.
// 운영시뮬레이션(월 예상 운영비/공실 손실) 등 관리자 설정을 모든 기기에서 즉시 공유.
// ============================================================================
export const APP_SETTINGS_TABLE = "app_settings";

export const loadAppSettings = async (tenantId: string): Promise<Record<string, any> | null> => {
  if (!isSupabaseAvailable()) return null;
  const { data, error } = await supabase!
    .from(APP_SETTINGS_TABLE)
    .select("data")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (error) {
    // 테이블 미생성(42P01) 등은 조용히 null 반환(로컬 폴백) — 콘솔 경고만.
    console.warn("[loadAppSettings] 로드 실패(로컬 설정 사용):", error.message);
    return null;
  }
  return (Array.isArray(data) && data[0]?.data) || null;
};

export const saveAppSettings = async (tenantId: string, data: Record<string, any>): Promise<void> => {
  if (!isSupabaseAvailable()) return;
  const row = { tenant_id: tenantId, data, updated_at: new Date().toISOString() };
  const { data: existing, error: selErr } = await supabase!
    .from(APP_SETTINGS_TABLE)
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (selErr) throw selErr;
  if (existing && existing.length > 0) {
    const { error } = await supabase!.from(APP_SETTINGS_TABLE).update(row).eq("tenant_id", tenantId);
    if (error) throw error;
  } else {
    const { error } = await supabase!.from(APP_SETTINGS_TABLE).insert({ ...row, created_at: new Date().toISOString() });
    if (error) throw error;
  }
};
