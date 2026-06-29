import { supabase, isSupabaseAvailable, translateSupabaseError } from "./supabaseService";
import type { Dorm, Occupant, DormContract, NewHireEmployee } from "../types/domain";

export type DormModuleState = {
  tenantId: string;
  dorms: Dorm[];
  occupants: Occupant[];
  dormContracts: DormContract[];
  newHires: NewHireEmployee[];
};

const toDbDorm = (dorm: Dorm, tenantId: string, userId: string) => {
  const payload = {
    id: dorm.id,
    tenant_id: tenantId,
    site: dorm.site,
    gender: dorm.gender,
    building_name: dorm.buildingName,
    address: dorm.address,
    dong: dorm.dong,
    room_ho: dorm.roomHo,
    pyeong: dorm.pyeong,
    capacity: safeNumberOrNull(dorm.capacity) ?? 0,
    manager_user_id: safeUuidOrNull(dorm.managerUserId),
    contract_start: safeDateOrNull(dorm.contractStart),
    contract_end: safeDateOrNull(dorm.contractEnd),
    contract_amount: safeNumberOrNull(dorm.contractAmount),
    lease_status: dorm.leaseStatus,
    shared_entry: dorm["공동현관"] || null,
    unit_entry: dorm["세대현관"] || null,
    prepayment_deposit: safeNumberOrNull(dorm.prepaymentDeposit) ?? 0,
    real_estate_name: dorm.realEstateName || null,
    balance_date: safeDateOrNull(dorm.balanceDate),
    notes: dorm.notes || null,
    is_deleted: dorm.isDeleted ?? false,
    deleted_at: safeDateOrNull(dorm.deletedAt),
    deleted_by: safeUuidOrNull(dorm.deletedBy),
    is_permanent_deleted: dorm.isPermanentDeleted ?? false,
    permanent_deleted_at: safeDateOrNull(dorm.permanentDeletedAt),
    permanent_deleted_by: dorm.permanentDeletedBy || null,
    created_by: userId,
    updated_by: userId,
    created_at: dorm.createdAt || new Date().toISOString(),
    updated_at: dorm.updatedAt || new Date().toISOString(),
  };
  return payload;
};

const toDomainDorm = (row: any): Dorm => ({
  id: row.id,
  site: row.site,
  gender: row.gender,
  buildingName: row.building_name || "",
  address: row.address || "",
  dong: row.dong || "",
  roomHo: row.room_ho || "",
  pyeong: row.pyeong || "",
  capacity: row.capacity ?? 0,
  managerUserId: row.manager_user_id || undefined,
  contractStart: row.contract_start || "",
  contractEnd: row.contract_end || "",
  contractAmount: row.contract_amount || "",
  leaseStatus: row.lease_status || "사용중",
  공동현관: row.shared_entry || "",
  세대현관: row.unit_entry || "",
  prepaymentDeposit: row.prepayment_deposit ?? 0,
  realEstateName: row.real_estate_name || "",
  balanceDate: row.balance_date || "",
  notes: row.notes || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
});

const toDbOccupant = (occupant: Occupant, tenantId: string, userId: string) => ({
  id: occupant.id,
  tenant_id: tenantId,
  dorm_id: occupant.dormId,
  site: occupant.site,
  employee_name: occupant.employeeName,
  gender: occupant.gender,
  department: occupant.department,
  phone: occupant.phone,
  move_in_date: safeDateOrNull(occupant.moveInDate),
  move_out_due_date: safeDateOrNull(occupant.moveOutDueDate),
  status: occupant.status,
  is_new_hire_assignment: occupant.isNewHireAssignment ?? false,
  notes: occupant.notes,
  expected_move_in_date: safeDateOrNull(occupant.expectedMoveInDate),
  expected_move_out_date: safeDateOrNull(occupant.expectedMoveOutDate),
  actual_move_out_date: safeDateOrNull(occupant.actualMoveOutDate),
  source_new_hire_id: safeUuidOrNull(occupant.sourceNewHireId),
  is_deleted: occupant.isDeleted ?? false,
  deleted_at: safeDateOrNull(occupant.deletedAt),
  deleted_by: safeUuidOrNull(occupant.deletedBy),
  is_permanent_deleted: occupant.isPermanentDeleted ?? false,
  permanent_deleted_at: safeDateOrNull(occupant.permanentDeletedAt),
  permanent_deleted_by: occupant.permanentDeletedBy || null,
  created_by: userId,
  updated_by: userId,
  created_at: occupant.createdAt || new Date().toISOString(),
  updated_at: occupant.updatedAt || new Date().toISOString(),
});

const toDomainOccupant = (row: any): Occupant => ({
  id: row.id,
  dormId: row.dorm_id || "",
  site: row.site,
  employeeName: row.employee_name || "",
  gender: row.gender || "남",
  department: row.department || "",
  phone: row.phone || "",
  moveInDate: row.move_in_date || "",
  moveOutDueDate: row.move_out_due_date || "",
  status: row.status || "거주중",
  isNewHireAssignment: row.is_new_hire_assignment ?? false,
  notes: row.notes || "",
  expectedMoveInDate: row.expected_move_in_date || "",
  expectedMoveOutDate: row.expected_move_out_date || "",
  actualMoveOutDate: row.actual_move_out_date || "",
  sourceNewHireId: row.source_new_hire_id || undefined,
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
});

const toDbDormContract = (contract: DormContract, tenantId: string, userId: string) => ({
  id: contract.id,
  tenant_id: tenantId,
  site: contract.site,
  address: contract.address,
  building_name: contract.buildingName,
  dong: contract.dong,
  room_ho: contract.roomHo,
  pyeong: safeNumberOrNull(contract.pyeong),
  landlord_name: contract.landlordName,
  landlord_phone: contract.landlordPhone,
  real_estate_name: contract.realEstateName,
  real_estate_phone: contract.realEstatePhone,
  management_office_phone: contract.managementOfficePhone || null,
  shared_entry: contract["공동현관"] || null,
  unit_entry: contract["세대현관"] || null,
  contract_start: safeDateOrNull(contract.contractStart),
  contract_end: safeDateOrNull(contract.contractEnd),
  contract_status: contract.contractStatus,
  contract_amount: safeNumberOrNull(contract.contractAmount),
  prepayment_deposit: safeNumberOrNull(contract.prepaymentDeposit),
  deposit: safeNumberOrNull(contract.deposit),
  monthly_rent_or_maintenance: safeNumberOrNull(contract.monthlyRentOrMaintenance),
  contract_type: contract.contractType,
  gender: contract.gender,
  notes: contract.notes,
  registered_by: safeUuidOrNull(contract.registeredBy),
  modified_by: safeUuidOrNull(contract.modifiedBy),
  is_deleted: contract.isDeleted ?? false,
  deleted_at: safeDateOrNull(contract.deletedAt),
  deleted_by: safeUuidOrNull(contract.deletedBy),
  is_permanent_deleted: contract.isPermanentDeleted ?? false,
  permanent_deleted_at: safeDateOrNull(contract.permanentDeletedAt),
  permanent_deleted_by: contract.permanentDeletedBy || null,
  created_by: userId,
  updated_by: userId,
  created_at: contract.createdAt || new Date().toISOString(),
  updated_at: contract.updatedAt || new Date().toISOString(),
});

const toDomainDormContract = (row: any): DormContract => ({
  id: row.id,
  site: row.site,
  address: row.address || "",
  buildingName: row.building_name || "",
  dong: row.dong || "",
  roomHo: row.room_ho || "",
  pyeong: row.pyeong || "",
  landlordName: row.landlord_name || "",
  landlordPhone: row.landlord_phone || "",
  realEstateName: row.real_estate_name || "",
  realEstatePhone: row.real_estate_phone || "",
  managementOfficePhone: row.management_office_phone || "",
  공동현관: row.shared_entry || "",
  세대현관: row.unit_entry || "",
  contractStart: row.contract_start || "",
  contractEnd: row.contract_end || "",
  contractStatus: row.contract_status || "진행중",
  contractAmount: row.contract_amount || "",
  prepaymentDeposit: row.prepayment_deposit || "",
  deposit: row.deposit || "",
  monthlyRentOrMaintenance: row.monthly_rent_or_maintenance || "",
  contractType: row.contract_type || "",
  gender: row.gender || "남",
  notes: row.notes || "",
  registeredBy: row.registered_by || "",
  modifiedBy: row.modified_by || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
});

const safeNumberOrNull = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "-") return null;
  const normalized = trimmed.replace(/,/g, "");
  if (/^[+-]?(?:\d+|\d*\.\d+)$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const safeDateOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "-") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed;
  }
  return null;
};

const safeUuidOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "-") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
};

const toDbNewHire = (hire: NewHireEmployee, tenantId: string, userId: string) => ({
  id: hire.id,
  tenant_id: tenantId,
  site: hire.site,
  gender: hire.gender,
  name: hire.name,
  phone: hire.phone,
  department: hire.department,
  dorm_id: safeUuidOrNull(hire.dormId),
  address: hire.address,
  building_name: hire.buildingName,
  dong: hire.dong,
  room_ho: hire.roomHo,
  shared_entry: hire["공동현관"] || null,
  unit_entry: hire["세대현관"] || null,
  expected_move_in_date: safeDateOrNull(hire.expectedMoveInDate),
  move_in_date: safeDateOrNull(hire.moveInDate),
  expected_move_out_date: safeDateOrNull(hire.expectedMoveOutDate),
  move_out_date: safeDateOrNull(hire.moveOutDate),
  actual_move_out_date: safeDateOrNull(hire.actualMoveOutDate),
  cheonan_move_date: safeDateOrNull(hire.cheonanMoveDate),
  residence_status: hire.residenceStatus,
  move_in_type: hire.moveInType,
  extension_reason: hire.extensionReason,
  notes: hire.notes,
  manager_user_id: safeUuidOrNull(hire.managerUserId),
  is_deleted: hire.isDeleted ?? false,
  deleted_at: safeDateOrNull(hire.deletedAt),
  deleted_by: safeUuidOrNull(hire.deletedBy),
  is_permanent_deleted: hire.isPermanentDeleted ?? false,
  permanent_deleted_at: safeDateOrNull(hire.permanentDeletedAt),
  permanent_deleted_by: hire.permanentDeletedBy || null,
  created_by: userId,
  updated_by: userId,
  created_at: hire.createdAt || new Date().toISOString(),
  updated_at: hire.updatedAt || new Date().toISOString(),
});

const toDomainNewHire = (row: any): NewHireEmployee => ({
  id: row.id,
  site: row.site,
  gender: row.gender || "남",
  name: row.name || "",
  phone: row.phone || "",
  department: row.department || "",
  dormId: row.dorm_id || "",
  address: row.address || "",
  buildingName: row.building_name || "",
  dong: row.dong || "",
  roomHo: row.room_ho || "",
  공동현관: row.shared_entry || "",
  세대현관: row.unit_entry || "",
  expectedMoveInDate: row.expected_move_in_date || "",
  moveInDate: row.move_in_date || "",
  expectedMoveOutDate: row.expected_move_out_date || "",
  moveOutDate: row.move_out_date || "",
  actualMoveOutDate: row.actual_move_out_date || "",
  cheonanMoveDate: row.cheonan_move_date || "",
  residenceStatus: row.residence_status || "대기중",
  moveInType: row.move_in_type || "대기자",
  extensionReason: row.extension_reason || "",
  notes: row.notes || "",
  managerUserId: row.manager_user_id || undefined,
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || "",
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
});

export const loadDormModule = async (tenantId: string): Promise<DormModuleState | null> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping dorm module load.");
    return null;
  }

  try {
    // tenant_id 호환 조회: 단일 테넌트 운영이지만 기존 행의 tenant_id 가 "default"/"기본"/NULL 등으로
    // 섞여 있어 .eq("tenant_id", ...) 로는 누락되는 문제가 있었다(데이터가 있는데 화면에 안 보임).
    // → 테넌트 필터 없이 전체 조회(RLS 로 접근 범위 제한). 저장은 계속 tenant_id 를 기록해 점진적으로 정규화.
    const [dormsResult, occupantsResult, dormContractsResult, newHiresResult] = await Promise.all([
      supabase!.from("dorms").select("*"),
      supabase!.from("occupants").select("*"),
      supabase!.from("dorm_contracts").select("*"),
      supabase!.from("new_hires").select("*"),
    ]);

    if (dormsResult.error || occupantsResult.error || dormContractsResult.error || newHiresResult.error) {
      console.error("Supabase dorm module load error:", dormsResult.error || occupantsResult.error || dormContractsResult.error || newHiresResult.error);
      return null;
    }

    return {
      tenantId,
      dorms: (dormsResult.data || []).map(toDomainDorm),
      occupants: (occupantsResult.data || []).map(toDomainOccupant),
      dormContracts: (dormContractsResult.data || []).map(toDomainDormContract),
      newHires: (newHiresResult.data || []).map(toDomainNewHire),
    };
  } catch (error) {
    console.error("Supabase dorm module load exception:", error);
    return null;
  }
};

export const saveDormModule = async (
  payload: DormModuleState,
  userId: string
): Promise<void> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping dorm module save.");
    return;
  }

  console.debug("[SAVE] saveDormModule payload lengths", {
    dorms: payload.dorms.length,
    occupants: payload.occupants.length,
    dormContracts: payload.dormContracts.length,
    newHires: payload.newHires.length,
  });

  const errors: string[] = [];
  let dormsPayload: any[] = [];
  let successfulTables = 0;

  // Save each table independently so one failure doesn't abort the whole save
  try {
    dormsPayload = payload.dorms.map((d) => toDbDorm(d, payload.tenantId, userId));
    console.debug("[DORM_SAVE_PAYLOAD] dorms upsert payload count:", dormsPayload.length);
    if (dormsPayload.length > 0) {
      console.debug("[DORM_SAVE_PAYLOAD] first dorm:", JSON.stringify(dormsPayload[0], null, 2));
    }
    const { error } = await supabase!.from("dorms").upsert(dormsPayload, { onConflict: "id" });
    if (error) {
      console.error("[DORM_ERROR] Dorms upsert error code:", error.code);
      console.error("[DORM_ERROR] Dorms upsert error message:", error.message);
      console.error("[DORM_ERROR] Dorms upsert error details:", error.details);
      console.error("[DORM_ERROR] Dorms upsert error hint:", error.hint);
      console.error("[DORM_ERROR] Dorms upsert error full:", error);
      console.error("[DORM_ERROR] Dorms upsert payload:", JSON.stringify(dormsPayload, null, 2));
      errors.push(`dorms:${error.message || error}`);
    } else {
      successfulTables += 1;
    }
  } catch (e: any) {
    console.error("[DORM_ERROR] Dorms upsert exception:", e);
    console.error("[DORM_ERROR] Exception details - payload length:", dormsPayload.length);
    console.error("[DORM_ERROR] First dorm in payload:", dormsPayload[0]);
    errors.push(`dorms:${e.message || String(e)}`);
  }

  try {
    const occupantsPayload = payload.occupants.map((o) => toDbOccupant(o, payload.tenantId, userId));
    const { error } = await supabase!.from("occupants").upsert(occupantsPayload, { onConflict: "id" });
    if (error) {
      console.error("[OCCUPANT_ERROR] Occupants upsert error code:", error.code);
      console.error("[OCCUPANT_ERROR] Occupants upsert error message:", error.message);
      console.error("[OCCUPANT_ERROR] Occupants upsert error details:", error.details);
      console.error("[OCCUPANT_ERROR] Occupants upsert error hint:", error.hint);
      console.error("[OCCUPANT_ERROR] Occupants upsert error full:", error);
      console.error("[OCCUPANT_ERROR] Occupants payload:", JSON.stringify(occupantsPayload, null, 2));
      errors.push(`occupants:${error.message || error}`);
    } else {
      successfulTables += 1;
    }
  } catch (e: any) {
    console.error("[OCCUPANT_ERROR] Occupants upsert exception:", e);
    console.error("[OCCUPANT_ERROR] Occupants payload length:", payload.occupants.length);
    errors.push(`occupants:${e.message || String(e)}`);
  }

  try {
    const dormContractPayload = payload.dormContracts.map((c) => toDbDormContract(c, payload.tenantId, userId));
    console.debug("[SAVE] dorm_contracts upsert payload count:", dormContractPayload.length);
    if (dormContractPayload.length > 0) {
      console.debug("[SAVE] dorm_contracts first payload:", JSON.stringify(dormContractPayload[0], null, 2));
    }
    const { error } = await supabase!.from("dorm_contracts").upsert(dormContractPayload, { onConflict: "id" });
    if (error) {
      console.error("[DORMCONTRACT_ERROR] DormContracts upsert error code:", error.code);
      console.error("[DORMCONTRACT_ERROR] DormContracts upsert error message:", error.message);
      console.error("[DORMCONTRACT_ERROR] DormContracts upsert error details:", error.details);
      console.error("[DORMCONTRACT_ERROR] DormContracts upsert error hint:", error.hint);
      console.error("[DORMCONTRACT_ERROR] DormContracts upsert error full:", error);
      console.error("[DORMCONTRACT_ERROR] DormContracts payload:", JSON.stringify(dormContractPayload, null, 2));
      errors.push(`dorm_contracts:${error.message || error}`);
    } else {
      successfulTables += 1;
    }
  } catch (e: any) {
    console.error("[DORMCONTRACT_ERROR] DormContracts upsert exception:", e);
    console.error("[DORMCONTRACT_ERROR] DormContracts payload length:", payload.dormContracts.length);
    errors.push(`dorm_contracts:${e.message || String(e)}`);
  }

  try {
    const newHiresPayload = payload.newHires.map((h) => toDbNewHire(h, payload.tenantId, userId));
    const { error } = await supabase!.from("new_hires").upsert(newHiresPayload, { onConflict: "id" });
    if (error) {
      console.error("[NEWHIRE_ERROR] NewHires upsert error code:", error.code);
      console.error("[NEWHIRE_ERROR] NewHires upsert error message:", error.message);
      console.error("[NEWHIRE_ERROR] NewHires upsert error details:", error.details);
      console.error("[NEWHIRE_ERROR] NewHires upsert error hint:", error.hint);
      console.error("[NEWHIRE_ERROR] NewHires upsert error full:", error);
      console.error("[NEWHIRE_ERROR] NewHires payload:", JSON.stringify(newHiresPayload, null, 2));
      errors.push(`new_hires:${error.message || error}`);
    } else {
      successfulTables += 1;
    }
  } catch (e: any) {
    console.error("[NEWHIRE_ERROR] NewHires upsert exception:", e);
    console.error("[NEWHIRE_ERROR] NewHires payload length:", payload.newHires.length);
    errors.push(`new_hires:${e.message || String(e)}`);
  }

  if (errors.length) {
    const msg = `Some Supabase dorm module upserts failed: ${errors.join("; ")}`;
    console.error(msg);
    if (successfulTables === 0) {
      throw new Error(translateSupabaseError(msg));
    }
  }
};

export const upsertDorm = async (dorm: Dorm, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("dorms")
    .upsert(toDbDorm(dorm, tenantId, userId), { onConflict: "id" });
  if (error) {
    console.error("Dorm upsert error:", error);
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
};

export const upsertOccupant = async (occupant: Occupant, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("occupants")
    .upsert(toDbOccupant(occupant, tenantId, userId), { onConflict: "id" });
  if (error) {
    console.error("Occupant upsert error:", error);
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
};

export const upsertDormContract = async (contract: DormContract, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("dorm_contracts")
    .upsert(toDbDormContract(contract, tenantId, userId), { onConflict: "id" });
  if (error) {
    console.error("Dorm contract upsert error:", error);
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
};

export const upsertNewHire = async (hire: NewHireEmployee, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("new_hires")
    .upsert(toDbNewHire(hire, tenantId, userId), { onConflict: "id" });
  if (error) {
    console.error("New hire upsert error:", error);
    throw new Error(translateSupabaseError(error.message || String(error)));
  }
};
