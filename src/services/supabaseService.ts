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
  const { error } = await supabase!
    .from(MILITARY_MODULE_TABLE)
    .upsert(
      {
        tenant_id: payload.tenantId,
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" }
    );

  if (error) {
    console.error("Supabase save error:", error);
    throw error;
  }
};
