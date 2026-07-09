// 입주전 점검(pre_move_in_inspections) Supabase 연동 — 단일 테이블 전용(기존 운영 저장 흐름과 독립).
// 기존 operationalSupabaseService 의 toDb/toDomain 패턴을 그대로 따른다.
// service_role_key 는 사용하지 않으며(클라이언트 anon key + RLS), tenant_id 로 데이터 분리.
import { supabase, isSupabaseAvailable, translateSupabaseError } from "./supabaseService";
import type { PreMoveInInspection } from "../types/preMoveInInspection";

const tsOrNow = (v?: string) => (v && v !== "" ? v : new Date().toISOString());

const toDb = (r: PreMoveInInspection, tenantId: string, userId: string) => ({
  id: r.id,
  tenant_id: tenantId,
  dorm_id: r.dormId || null,
  contract_id: r.contractId || null,
  occupant_id: r.occupantId || null,
  inspection_date: r.inspectionDate || null,
  region: r.site || "",
  gender: r.gender || "",
  building_name: r.buildingName || "",
  dong: r.dong || "",
  room: r.roomHo || "",
  address: r.address || "",
  contract_start_date: r.contractStartDate || null,
  contract_end_date: r.contractEndDate || null,
  landlord_name: r.landlordName || "",
  expected_move_in_name: r.expectedMoveInName || "",
  expected_move_in_phone: r.expectedMoveInPhone || "",
  expected_move_in_dept: r.expectedMoveInDept || "",
  expected_move_in_date: r.expectedMoveInDate || null,
  inspector_name: r.inspectorName || "",
  inspection_status: r.inspectionStatus || "",
  cleaning_status: r.cleaningStatus || "",
  facility_status: r.facilityStatus || "",
  supply_status: r.supplyStatus || "",
  has_defect: r.hasDefect === "있음",
  defect_description: r.defectDescription || "",
  action_required: r.actionRequired || "",
  memo: r.memo || "",
  photos: r.photos || [],
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(r.createdAt),
  updated_at: tsOrNow(r.updatedAt),
  is_deleted: r.isDeleted ?? false,
  deleted_at: r.deletedAt || null,
  deleted_by: r.deletedBy || null,
  is_permanent_deleted: r.isPermanentDeleted ?? false,
  permanent_deleted_at: r.permanentDeletedAt || null,
  permanent_deleted_by: r.permanentDeletedBy || null,
});

// Realtime 구독 등 외부에서도 동일 매핑을 쓰도록 export.
export const rowToPreMoveInInspection = (row: any): PreMoveInInspection => ({
  id: row.id,
  inspectionDate: row.inspection_date || "",
  site: row.region || row.site || "",
  gender: row.gender || "",
  dormId: row.dorm_id || "",
  contractId: row.contract_id || "",
  occupantId: row.occupant_id || "",
  buildingName: row.building_name || "",
  dong: row.dong || "",
  roomHo: row.room || row.room_ho || "",
  address: row.address || "",
  contractStartDate: row.contract_start_date || "",
  contractEndDate: row.contract_end_date || "",
  landlordName: row.landlord_name || "",
  expectedMoveInName: row.expected_move_in_name || "",
  expectedMoveInPhone: row.expected_move_in_phone || "",
  expectedMoveInDept: row.expected_move_in_dept || "",
  expectedMoveInDate: row.expected_move_in_date || "",
  inspectorName: row.inspector_name || "",
  inspectionStatus: row.inspection_status || "점검대기",
  cleaningStatus: row.cleaning_status || "양호",
  facilityStatus: row.facility_status || "양호",
  supplyStatus: row.supply_status || "양호",
  hasDefect: row.has_defect ? "있음" : "없음",
  defectDescription: row.defect_description || "",
  actionRequired: row.action_required || "",
  memo: row.memo || "",
  photos: Array.isArray(row.photos) ? row.photos : [],
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
});

// 전체 조회(tenant_id 필터 없이 — 기존 테이블처럼 default/NULL 혼재 대비). 실패 시 null 반환(로컬 유지).
export const loadPreMoveInInspections = async (_tenantId: string): Promise<PreMoveInInspection[] | null> => {
  if (!isSupabaseAvailable()) return null;
  try {
    const { data, error } = await supabase!.from("pre_move_in_inspections").select("*");
    if (error) {
      console.warn("[pre_move_in_inspections] 조회 실패(로컬 유지):", error.message || error);
      return null;
    }
    return (data || []).map(rowToPreMoveInInspection);
  } catch (e) {
    console.warn("[pre_move_in_inspections] 조회 예외(로컬 유지):", (e as { message?: string })?.message || e);
    return null;
  }
};

// [7] 본문 저장 성공 후 사진(photos, base64)만 별도 update. 실패해도 throw 하지 않고 1회 재시도 + warn(본문 저장 유지).
//     사진 배열이 "비어있지 않을 때만" 전송 → 사진 미변경/미로드 시 기존 photos 를 []로 덮어쓰지 않음.
const savePreInspectionPhotosOptional = async (rows: PreMoveInInspection[]): Promise<void> => {
  const jobs = rows.filter((r) => r.id && Array.isArray(r.photos) && r.photos.length > 0);
  if (jobs.length === 0) return;
  const run = async (r: PreMoveInInspection): Promise<{ r: PreMoveInInspection; error: any }> => {
    try {
      const { error } = await supabase!.from("pre_move_in_inspections").update({ photos: r.photos }).eq("id", r.id);
      return { r, error: error ?? null };
    } catch (e) {
      return { r, error: e };
    }
  };
  let results = await Promise.all(jobs.map(run));
  const failed = results.filter((x) => x.error);
  if (failed.length > 0) {
    await new Promise((res) => setTimeout(res, 1500)); // 1회 자동 재시도
    const retried = await Promise.all(failed.map((x) => run(x.r)));
    const byId = new Map(retried.map((x) => [x.r.id, x]));
    results = results.map((x) => byId.get(x.r.id) ?? x);
  }
  results.filter((x) => x.error).forEach((x) => {
    const err = x.error as { code?: unknown; message?: string };
    console.error("[입주전점검 사진 저장 실패 - 본문은 저장됨]", {
      table: "pre_move_in_inspections", action: "photo-update", id: x.r.id,
      code: err?.code ?? "(unknown)", message: err?.message ?? String(x.error), imageCount: x.r.photos?.length ?? 0,
    });
  });
};

// 변경분(또는 전체) upsert. 빈 배열이면 요청 생략. 본문 오류는 상위에서 처리하도록 throw(사진 실패는 본문 실패로 보지 않음).
export const savePreMoveInInspections = async (
  rows: PreMoveInInspection[],
  tenantId: string,
  userId: string
): Promise<void> => {
  if (!isSupabaseAvailable()) return;
  if (!rows || rows.length === 0) return;
  // [7] 본문(텍스트) 먼저 upsert — 대용량 base64 사진(photos)을 제외해 회사망 보안 프록시 차단 회피. 공통 supabase client 사용.
  const bodyRows = rows.map((r) => { const db = toDb(r, tenantId, userId) as Record<string, any>; delete db.photos; return db; });
  const { error } = await supabase!
    .from("pre_move_in_inspections")
    .upsert(bodyRows, { onConflict: "id" });
  if (error) {
    throw new Error(translateSupabaseError((error as { message?: string })?.message || String(error)));
  }
  // 본문 저장 성공 후 사진만 별도 저장(실패해도 본문 유지).
  await savePreInspectionPhotosOptional(rows);
};
