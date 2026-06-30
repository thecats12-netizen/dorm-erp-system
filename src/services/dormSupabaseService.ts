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
  // dorm 참조 컬럼명이 섞여 있어도(dorm_id / assigned_dorm_id / contract_id 등) 정상 매핑.
  dormId: row.dorm_id || row.assigned_dorm_id || row.assignedDormId || row.contract_id || row.contractId || row.dormId || "",
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

  if (import.meta.env.DEV) console.debug("[SAVE] saveDormModule changed rows", {
    dorms: payload.dorms.length,
    occupants: payload.occupants.length,
    dormContracts: payload.dormContracts.length,
    newHires: payload.newHires.length,
  });

  const errors: string[] = [];
  let dormsPayload: any[] = [];
  let successfulTables = 0;

  // 변경 행이 하나도 없으면 해당 테이블 upsert 자체를 건너뜀(불필요한 네트워크 요청 제거).
  if (payload.dorms.length + payload.occupants.length + payload.dormContracts.length + payload.newHires.length === 0) {
    return;
  }

  // 테이블별 독립 저장(한 테이블 실패가 다른 테이블/본 저장을 중단시키지 않음).
  // 변경 행이 없으면 upsert 호출 없이 성공 처리(불필요한 네트워크 요청 제거 → 속도 개선).
  const upsertTable = async (table: string, rows: any[]) => {
    if (rows.length === 0) { successfulTables += 1; return; }
    try {
      const { error } = await supabase!.from(table).upsert(rows, { onConflict: "id" });
      if (error) {
        console.error(`[${table}] upsert 실패`, { code: error.code, message: error.message, details: error.details, hint: error.hint });
        errors.push(`${table}:${error.message || error}`);
      } else {
        successfulTables += 1;
      }
    } catch (e: any) {
      console.error(`[${table}] upsert 예외`, e?.message || e);
      errors.push(`${table}:${e?.message || String(e)}`);
    }
  };

  dormsPayload = payload.dorms.map((d) => toDbDorm(d, payload.tenantId, userId));
  await upsertTable("dorms", dormsPayload);
  await upsertTable("occupants", payload.occupants.map((o) => toDbOccupant(o, payload.tenantId, userId)));
  await upsertTable("dorm_contracts", payload.dormContracts.map((c) => toDbDormContract(c, payload.tenantId, userId)));
  await upsertTable("new_hires", payload.newHires.map((h) => toDbNewHire(h, payload.tenantId, userId)));

  // 변경 행이 있는 테이블 중 하나라도 실패하면 저장 실패로 처리(throw) → 호출부에서 해시 미커밋 → 다음 저장에 재시도.
  // (upsert 는 멱등이라 성공한 테이블을 다시 보내도 안전하므로 부분 실패 시 전체 재시도가 안전하다.)
  if (errors.length) {
    const first = errors[0];
    console.error("[saveDormModule] 변경 행 저장 실패:", errors.join("; "));
    throw new Error(translateSupabaseError(first));
  }
  void successfulTables; // (참고용)
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
