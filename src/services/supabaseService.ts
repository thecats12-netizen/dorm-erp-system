import { createClient } from "@supabase/supabase-js";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice, MilitaryReport } from "../types/domain";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseAvailable = (): boolean => Boolean(supabaseUrl && supabaseKey);

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
