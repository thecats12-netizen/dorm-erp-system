// 월별 TO 시뮬레이션 시나리오 저장/불러오기/복제 서비스(Supabase). base forecast/원본 데이터는 저장하지 않고 adjustments 만 저장.
//  ⚠ RLS(tenant_id + created_by/admin)로 서버에서 격리. 테이블 미적용(migration 미실행) 시 throw 없이 안전 폴백([]/null).
import { supabase, isSupabaseAvailable } from "./supabaseService";

const SCN = "operation_simulation_scenarios";
const ADJ = "operation_simulation_adjustments";

export type OpSimScenario = { id: string; name: string; base_year: number; description: string | null; is_default: boolean; created_by: string | null };
export type OpSimAdjustment = {
  target_year: number; target_month: number; region: string | null; gender: string | null;
  dormitory_id: string | null; adjustment_type: string; quantity: number;
  repeat_until_year: number | null; repeat_until_month: number | null; notes: string | null;
};

const ok = () => isSupabaseAvailable() && !!supabase;

export async function listScenarios(tenantId: string, baseYear?: number): Promise<OpSimScenario[]> {
  if (!ok() || !tenantId) return [];
  let q = supabase!.from(SCN).select("id,name,base_year,description,is_default,created_by").eq("tenant_id", tenantId).eq("is_active", true);
  if (baseYear != null) q = q.eq("base_year", baseYear);
  const { data, error } = await q.order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  if (error) { console.warn("[opsim] listScenarios:", error.message); return []; }
  return (data as OpSimScenario[]) || [];
}

export async function createScenario(tenantId: string, userId: string, p: { name: string; baseYear: number; description?: string }): Promise<OpSimScenario | null> {
  if (!ok() || !tenantId) return null;
  const { data, error } = await supabase!.from(SCN).insert({ tenant_id: tenantId, name: p.name, base_year: p.baseYear, description: p.description ?? null, created_by: userId, updated_by: userId }).select("id,name,base_year,description,is_default,created_by").single();
  if (error) { console.warn("[opsim] createScenario:", error.message); return null; }
  return data as OpSimScenario;
}

export async function renameScenario(id: string, name: string, userId: string): Promise<boolean> {
  if (!ok()) return false;
  const { error } = await supabase!.from(SCN).update({ name, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { console.warn("[opsim] renameScenario:", error.message); return false; }
  return true;
}

export async function deleteScenario(id: string): Promise<boolean> {
  if (!ok()) return false;
  const { error } = await supabase!.from(SCN).delete().eq("id", id); // adjustments 는 on delete cascade
  if (error) { console.warn("[opsim] deleteScenario:", error.message); return false; }
  return true;
}

// 기본안 설정: 같은 tenant+연도의 기존 기본안 해제 후 대상 설정(부분 유니크 위반 방지).
export async function setDefaultScenario(tenantId: string, baseYear: number, id: string, userId: string): Promise<boolean> {
  if (!ok() || !tenantId) return false;
  const now = new Date().toISOString();
  const un = await supabase!.from(SCN).update({ is_default: false, updated_by: userId, updated_at: now }).eq("tenant_id", tenantId).eq("base_year", baseYear).eq("is_default", true);
  if (un.error) { console.warn("[opsim] clearDefault:", un.error.message); return false; }
  const { error } = await supabase!.from(SCN).update({ is_default: true, updated_by: userId, updated_at: now }).eq("id", id);
  if (error) { console.warn("[opsim] setDefault:", error.message); return false; }
  return true;
}

export async function listAdjustments(scenarioId: string): Promise<OpSimAdjustment[]> {
  if (!ok() || !scenarioId) return [];
  const { data, error } = await supabase!.from(ADJ).select("target_year,target_month,region,gender,dormitory_id,adjustment_type,quantity,repeat_until_year,repeat_until_month,notes").eq("scenario_id", scenarioId);
  if (error) { console.warn("[opsim] listAdjustments:", error.message); return []; }
  return (data as OpSimAdjustment[]) || [];
}

// 저장: 해당 시나리오의 조정값을 통째로 교체(현재 화면 adjustments 반영). 원본/base 미변경.
export async function replaceAdjustments(tenantId: string, userId: string, scenarioId: string, adjs: OpSimAdjustment[]): Promise<boolean> {
  if (!ok() || !tenantId || !scenarioId) return false;
  const del = await supabase!.from(ADJ).delete().eq("scenario_id", scenarioId);
  if (del.error) { console.warn("[opsim] replace(del):", del.error.message); return false; }
  if (adjs.length) {
    const rows = adjs.map((a) => ({ ...a, tenant_id: tenantId, scenario_id: scenarioId, created_by: userId }));
    const { error } = await supabase!.from(ADJ).insert(rows);
    if (error) { console.warn("[opsim] replace(ins):", error.message); return false; }
  }
  await supabase!.from(SCN).update({ updated_by: userId, updated_at: new Date().toISOString() }).eq("id", scenarioId);
  return true;
}

// 복제: 시나리오 + 조정값 복사.
export async function duplicateScenario(tenantId: string, userId: string, srcId: string, newName: string): Promise<OpSimScenario | null> {
  if (!ok() || !tenantId) return null;
  const src = await supabase!.from(SCN).select("base_year,description").eq("id", srcId).single();
  if (src.error || !src.data) { console.warn("[opsim] duplicate(src):", src.error?.message); return null; }
  const created = await createScenario(tenantId, userId, { name: newName, baseYear: (src.data as { base_year: number }).base_year, description: (src.data as { description?: string }).description ?? undefined });
  if (!created) return null;
  const adjs = await listAdjustments(srcId);
  if (adjs.length) await replaceAdjustments(tenantId, userId, created.id, adjs);
  return created;
}
