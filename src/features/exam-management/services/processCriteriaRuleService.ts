// 공정별 달성기준(exam_rules, rule_type="달성 기준") CRUD 서비스.
//  criteria(jsonb) 기반 · 적용기간은 criteria.effective_from/to 에 저장(스키마에 별도 컬럼 없음).
//  그룹/제품군 컬럼은 exam_rules 에 없어 공정에서 파생(저장하지 않음). tenant 강제 · soft delete · 감사.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "../../../services/supabaseService";
import { writeExamAudit, type ExamRow } from "./examMasterService";
import { isCriteriaEffective, normalizeCriteria } from "../engines/criteriaEvaluator";
import type { Criteria } from "../types/certificationCriteria";

const TABLE = "exam_rules";
// 신규 저장 rule_type(기존 인증 규칙 CRUD select 값과 동일). 조회는 공백 무시로 "달성기준"도 포함.
export const ACHIEVE_RULE_TYPE = "달성 기준";
// canonical 판별자: "달성기준"(공백무시) 여부. 인증 규칙 범위는 !isAchieveType 로 정의(취득/유효/목표).
export const isAchieveType = (rt: unknown) => String(rt ?? "").replace(/\s/g, "") === "달성기준";
const nowIso = () => new Date().toISOString();

function toUserError(err: { code?: string; message?: string } | null): string {
  const code = err?.code;
  if (code === "PGRST205" || code === "42P01") return "달성기준 기능을 사용하려면 시험관리 DB 설정이 필요합니다.";
  if (code === "42501") return "이 작업을 수행할 권한이 없습니다.";
  return translateSupabaseError(err?.message || "저장하지 못했습니다.");
}

// exam_rules 실제 컬럼만 저장(존재하지 않는 컬럼 금지). effective_date 는 criteria.effective_from 과 동기화.
const FIELDS = ["rule_type", "process_id", "level_id", "part_id", "criteria", "effective_date", "notes", "is_active"] as const;

export async function listProcessCriteriaRules(tenantId: string): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase.from(TABLE).select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false });
  if (error) { console.warn("[processCriteriaRuleService] list 실패(미적용?):", (error as { code?: unknown }).code); return []; }
  return ((data as ExamRow[]) || []).filter((r) => isAchieveType(r.rule_type));
}

export async function getProcessCriteriaRule(id: string, tenantId: string): Promise<ExamRow | null> {
  if (!isSupabaseAvailable() || !supabase) return null;
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).eq("tenant_id", tenantId).limit(1);
  if (error || !data?.[0]) return null;
  return data[0] as ExamRow;
}

// 동일 tenant·공정·인증단계·유효기간 겹침(활성·미삭제) 조회 → 앱 레벨 중복 검증(DB exclusion 없음).
export async function findOverlappingCriteriaRules(
  tenantId: string, processId: string, levelId: string, criteria: Criteria, excludeId?: string,
): Promise<ExamRow[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase.from(TABLE).select("*").eq("tenant_id", tenantId).eq("process_id", processId).eq("level_id", levelId).is("deleted_at", null).eq("is_active", true);
  if (error) return [];
  const from = criteria.effective_from || null, to = criteria.effective_to || null;
  const overlaps = (o: Criteria) => {
    const of = o.effective_from || null, ot = o.effective_to || null;
    return (from == null || ot == null || from <= ot) && (to == null || of == null || of <= to); // 개구간 겹침(경계 포함)
  };
  return ((data as ExamRow[]) || []).filter((r) => isAchieveType(r.rule_type) && String(r.id) !== (excludeId ?? "") && overlaps(normalizeCriteria(r.criteria)));
}

// 등록/수정. row.criteria 는 Criteria 객체(상위에서 formStateToCriteria 로 생성). 동시성: 저장 직전 재검증.
export async function upsertProcessCriteriaRule(
  row: ExamRow, tenantId: string, userId: string, opts?: { reason?: string },
): Promise<ExamRow> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const isNew = !row.id;
  const id = row.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const criteria = normalizeCriteria(row.criteria);
  const processId = String(row.process_id ?? ""), levelId = String(row.level_id ?? "");
  const dup = await findOverlappingCriteriaRules(tenantId, processId, levelId, criteria, isNew ? undefined : String(id));
  if (dup.length) throw new Error("같은 공정·인증단계에 적용기간이 겹치는 달성기준이 이미 존재합니다.");
  const before = isNew ? null : await getProcessCriteriaRule(String(id), tenantId);
  const payload: ExamRow = {
    id, tenant_id: tenantId, rule_type: ACHIEVE_RULE_TYPE, updated_by: userId, updated_at: nowIso(),
    ...(isNew ? { created_by: userId, created_at: nowIso() } : {}),
  };
  for (const f of FIELDS) if (row[f] !== undefined) payload[f] = row[f];
  payload.criteria = criteria as unknown as ExamRow[keyof ExamRow];
  payload.effective_date = criteria.effective_from || null;   // 단일 컬럼은 시작일로 동기화
  const { data, error } = await supabase.from(TABLE).upsert(payload, { onConflict: "id" }).select().single();
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, TABLE, id, isNew ? "create" : "update", before, data as ExamRow, opts?.reason ? `달성기준: ${opts.reason}` : "공정별 달성기준");
  return data as ExamRow;
}

export async function softDeleteProcessCriteriaRule(id: string, tenantId: string, userId: string, opts?: { reason?: string }): Promise<void> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const before = await getProcessCriteriaRule(id, tenantId);
  const { error } = await supabase.from(TABLE).update({ deleted_at: nowIso(), is_active: false, updated_by: userId, updated_at: nowIso() }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, TABLE, id, "delete", before, null, opts?.reason ? `달성기준 삭제: ${opts.reason}` : "공정별 달성기준 삭제(soft)");
}

// 복구 — 겹침 재검증(충돌 시 차단). deleted_at null · is_active true.
export async function restoreProcessCriteriaRule(id: string, tenantId: string, userId: string): Promise<void> {
  if (!isSupabaseAvailable() || !supabase) throw new Error("Supabase 미설정");
  const before = await getProcessCriteriaRule(id, tenantId);
  if (!before) throw new Error("복구 대상을 찾을 수 없습니다.");
  const dup = await findOverlappingCriteriaRules(tenantId, String(before.process_id ?? ""), String(before.level_id ?? ""), normalizeCriteria(before.criteria), id);
  if (dup.length) throw new Error("같은 공정·인증단계에 적용기간이 겹치는 활성 달성기준이 있어 복구할 수 없습니다.");
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null, is_active: true, updated_by: userId, updated_at: nowIso() }).eq("id", id).eq("tenant_id", tenantId).select().single();
  if (error) throw new Error(toUserError(error as { code?: string; message?: string }));
  await writeExamAudit(tenantId, userId, TABLE, id, "update", before, data as ExamRow, "공정별 달성기준 복구");
}

export { isCriteriaEffective };
