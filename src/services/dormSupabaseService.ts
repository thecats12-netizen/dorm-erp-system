import { supabase, isSupabaseAvailable } from "./supabaseService";
import type { Dorm, Occupant, DormContract, NewHireEmployee } from "../types/domain";

export type DormModuleState = {
  tenantId: string;
  dorms: Dorm[];
  occupants: Occupant[];
  dormContracts: DormContract[];
  newHires: NewHireEmployee[];
};

const toDbDorm = (dorm: Dorm, tenantId: string, userId: string) => ({
  id: dorm.id,
  tenant_id: tenantId,
  site: dorm.site,
  gender: dorm.gender,
  building_name: dorm.buildingName,
  address: dorm.address,
  dong: dorm.dong,
  room_ho: dorm.roomHo,
  pyeong: dorm.pyeong,
  capacity: dorm.capacity,
  manager_user_id: dorm.managerUserId || null,
  contract_start: dorm.contractStart || null,
  contract_end: dorm.contractEnd || null,
  contract_amount: dorm.contractAmount,
  lease_status: dorm.leaseStatus,
  shared_entry: dorm["공동현관"] || null,
  unit_entry: dorm["세대현관"] || null,
  prepayment_deposit: dorm.prepaymentDeposit ?? null,
  real_estate_name: dorm.realEstateName,
  balance_date: dorm.balanceDate,
  notes: dorm.notes,
  is_deleted: dorm.isDeleted ?? false,
  deleted_at: dorm.deletedAt || null,
  deleted_by: dorm.deletedBy || null,
  created_by: userId,
  updated_by: userId,
  created_at: dorm.createdAt || new Date().toISOString(),
  updated_at: dorm.updatedAt || new Date().toISOString(),
});

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
  move_in_date: occupant.moveInDate || null,
  move_out_due_date: occupant.moveOutDueDate || null,
  status: occupant.status,
  is_new_hire_assignment: occupant.isNewHireAssignment ?? false,
  notes: occupant.notes,
  expected_move_in_date: occupant.expectedMoveInDate || null,
  expected_move_out_date: occupant.expectedMoveOutDate || null,
  actual_move_out_date: occupant.actualMoveOutDate || null,
  source_new_hire_id: occupant.sourceNewHireId || null,
  is_deleted: occupant.isDeleted ?? false,
  deleted_at: occupant.deletedAt || null,
  deleted_by: occupant.deletedBy || null,
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
});

const toDbDormContract = (contract: DormContract, tenantId: string, userId: string) => ({
  id: contract.id,
  tenant_id: tenantId,
  site: contract.site,
  address: contract.address,
  building_name: contract.buildingName,
  dong: contract.dong,
  room_ho: contract.roomHo,
  pyeong: contract.pyeong,
  landlord_name: contract.landlordName,
  landlord_phone: contract.landlordPhone,
  real_estate_name: contract.realEstateName,
  real_estate_phone: contract.realEstatePhone,
  shared_entry: contract["공동현관"] || null,
  unit_entry: contract["세대현관"] || null,
  contract_start: contract.contractStart || null,
  contract_end: contract.contractEnd || null,
  contract_status: contract.contractStatus,
  contract_amount: contract.contractAmount,
  prepayment_deposit: contract.prepaymentDeposit,
  deposit: contract.deposit,
  monthly_rent_or_maintenance: contract.monthlyRentOrMaintenance,
  contract_type: contract.contractType,
  gender: contract.gender,
  notes: contract.notes,
  registered_by: contract.registeredBy,
  modified_by: contract.modifiedBy,
  is_deleted: contract.isDeleted ?? false,
  deleted_at: contract.deletedAt || null,
  deleted_by: contract.deletedBy || null,
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
});

const toDbNewHire = (hire: NewHireEmployee, tenantId: string, userId: string) => ({
  id: hire.id,
  tenant_id: tenantId,
  site: hire.site,
  name: hire.name,
  phone: hire.phone,
  department: hire.department,
  dorm_id: hire.dormId,
  address: hire.address,
  building_name: hire.buildingName,
  dong: hire.dong,
  room_ho: hire.roomHo,
  shared_entry: hire["공동현관"] || null,
  unit_entry: hire["세대현관"] || null,
  expected_move_in_date: hire.expectedMoveInDate || null,
  move_in_date: hire.moveInDate || null,
  expected_move_out_date: hire.expectedMoveOutDate || null,
  move_out_date: hire.moveOutDate || null,
  actual_move_out_date: hire.actualMoveOutDate || null,
  cheonan_move_date: hire.cheonanMoveDate || null,
  residence_status: hire.residenceStatus,
  move_in_type: hire.moveInType,
  extension_reason: hire.extensionReason,
  notes: hire.notes,
  manager_user_id: hire.managerUserId || null,
  is_deleted: hire.isDeleted ?? false,
  deleted_at: hire.deletedAt || null,
  deleted_by: hire.deletedBy || null,
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
});

export const loadDormModule = async (tenantId: string): Promise<DormModuleState | null> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping dorm module load.");
    return null;
  }

  try {
    const [dormsResult, occupantsResult, dormContractsResult, newHiresResult] = await Promise.all([
      supabase!.from("dorms").select("*").eq("tenant_id", tenantId),
      supabase!.from("occupants").select("*").eq("tenant_id", tenantId),
      supabase!.from("dorm_contracts").select("*").eq("tenant_id", tenantId),
      supabase!.from("new_hires").select("*").eq("tenant_id", tenantId),
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

  try {
    console.debug("[SAVE] saveDormModule payload lengths", {
      dorms: payload.dorms.length,
      occupants: payload.occupants.length,
      dormContracts: payload.dormContracts.length,
      newHires: payload.newHires.length,
    });

    const [dormsResult, occupantsResult, dormContractsResult, newHiresResult] = await Promise.all([
      supabase!
        .from("dorms")
        .upsert(payload.dorms.map((dorm) => toDbDorm(dorm, payload.tenantId, userId)), { onConflict: "id" }),
      supabase!
        .from("occupants")
        .upsert(payload.occupants.map((occupant) => toDbOccupant(occupant, payload.tenantId, userId)), { onConflict: "id" }),
      supabase!
        .from("dorm_contracts")
        .upsert(payload.dormContracts.map((contract) => toDbDormContract(contract, payload.tenantId, userId)), { onConflict: "id" }),
      supabase!
        .from("new_hires")
        .upsert(payload.newHires.map((hire) => toDbNewHire(hire, payload.tenantId, userId)), { onConflict: "id" }),
    ]);

    if (dormsResult.error || occupantsResult.error || dormContractsResult.error || newHiresResult.error) {
      console.error("Supabase dorm module upsert result errors:", {
        dormsResult: dormsResult.error,
        occupantsResult: occupantsResult.error,
        dormContractsResult: dormContractsResult.error,
        newHiresResult: newHiresResult.error,
      });
      throw dormsResult.error || occupantsResult.error || dormContractsResult.error || newHiresResult.error;
    }
  } catch (error) {
    console.error("Supabase dorm module save error:", error);
    throw error;
  }
};

export const upsertDorm = async (dorm: Dorm, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("dorms")
    .upsert(toDbDorm(dorm, tenantId, userId), { onConflict: "id" });
  if (error) throw error;
};

export const upsertOccupant = async (occupant: Occupant, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("occupants")
    .upsert(toDbOccupant(occupant, tenantId, userId), { onConflict: "id" });
  if (error) throw error;
};

export const upsertDormContract = async (contract: DormContract, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("dorm_contracts")
    .upsert(toDbDormContract(contract, tenantId, userId), { onConflict: "id" });
  if (error) throw error;
};

export const upsertNewHire = async (hire: NewHireEmployee, tenantId: string, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    return;
  }
  const { error } = await supabase!
    .from("new_hires")
    .upsert(toDbNewHire(hire, tenantId, userId), { onConflict: "id" });
  if (error) throw error;
};
