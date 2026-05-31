import { supabase, isSupabaseAvailable } from "./supabaseService";
import type {
  CleaningReport,
  DefectRequest,
  InventoryItem,
  SettlementRecord,
  AuditLog,
} from "../types/domain";

type SettlementItem = {
  id: string;
  settlementYear: string;
  settlementMonth: string;
  dormId: string;
  category: string;
  details: string;
  amount: number;
  burdenType: string;
  targetName: string;
  memo: string;
  createdAt: string;
  updatedAt?: string;
};

export type OperationalModuleState = {
  tenantId: string;
  cleaningReports: CleaningReport[];
  defects: DefectRequest[];
  inventory: InventoryItem[];
  settlementRecords: SettlementRecord[];
  settlementItems: SettlementItem[];
  auditLogs: AuditLog[];
};

const tsOrNow = (v?: string) => (v && v !== "" ? v : new Date().toISOString());

const toDbCleaningReport = (report: CleaningReport, tenantId: string, userId: string) => ({
  id: report.id,
  tenant_id: tenantId,
  report_date: report.reportDate,
  site: report.site,
  dorm_id: report.dormId,
  building_name: report.buildingName,
  address: report.address,
  dong: report.dong,
  room_ho: report.roomHo,
  shared_entry: report.공동현관,
  unit_entry: report.세대현관,
  manager_user_id: report.managerUserId,
  manager_name: report.managerName,
  cleaner_name: report.cleanerName,
  week_label: report.weekLabel,
  month_label: report.monthLabel,
  clean_status: report.cleanStatus,
  check_result: report.checkResult,
  score: report.score,
  memo: report.memo,
  before_photo_data_urls: report.beforePhotoDataUrls,
  after_photo_data_urls: report.afterPhotoDataUrls,
  reporter_user_id: report.reporterUserId,
  reporter_name: report.reporterName,
  confirmed_by: report.confirmedBy,
  confirmed_at: report.confirmedAt,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(report.createdAt),
  updated_at: tsOrNow(report.updatedAt),
  is_deleted: report.isDeleted ?? false,
  deleted_at: report.deletedAt,
  deleted_by: report.deletedBy,
});

const toDomainCleaningReport = (row: any): CleaningReport => ({
  id: row.id,
  reportDate: row.report_date || "",
  site: row.site,
  dormId: row.dorm_id || "",
  buildingName: row.building_name || "",
  address: row.address || "",
  dong: row.dong || "",
  roomHo: row.room_ho || "",
  공동현관: row.shared_entry || "",
  세대현관: row.unit_entry || "",
  managerUserId: row.manager_user_id || "",
  managerName: row.manager_name || "",
  cleanerName: row.cleaner_name || "",
  weekLabel: row.week_label || "",
  monthLabel: row.month_label || "",
  cleanStatus: row.clean_status || "미제출",
  checkResult: row.check_result || "-",
  score: row.score ?? 0,
  memo: row.memo || "",
  beforePhotoDataUrls: row.before_photo_data_urls || [],
  afterPhotoDataUrls: row.after_photo_data_urls || [],
  reporterUserId: row.reporter_user_id || "",
  reporterName: row.reporter_name || "",
  confirmedBy: row.confirmed_by || undefined,
  confirmedAt: row.confirmed_at || undefined,
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
});

const toDbDefectRequest = (defect: DefectRequest, tenantId: string, userId: string) => ({
  id: defect.id,
  tenant_id: tenantId,
  receipt_date: defect.receiptDate,
  site: defect.site,
  dorm_id: defect.dormId,
  inspector_name: defect.inspectorName,
  dorm_manager_name: defect.dormManagerName,
  manager_user_id: defect.managerUserId,
  building_name: defect.buildingName,
  dong: defect.dong,
  ho: defect.ho,
  shared_entry: defect.공동현관,
  unit_entry: defect.세대현관,
  road_address: defect.roadAddress,
  detail_address: defect.detailAddress,
  defect_status: defect.defectStatus,
  request_text: defect.requestText,
  complete_text: defect.completeText,
  reporter_user_id: defect.reporterUserId,
  reporter_name: defect.reporterName,
  request_photo_data_urls: defect.requestPhotoDataUrls,
  completion_photo_data_urls: defect.completionPhotoDataUrls,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(defect.createdAt),
  updated_at: tsOrNow(defect.updatedAt || defect.createdAt),
  completed_at: defect.completedAt,
  is_deleted: defect.isDeleted ?? false,
  deleted_at: defect.deletedAt,
  deleted_by: defect.deletedBy,
});

const toDomainDefectRequest = (row: any): DefectRequest => ({
  id: row.id,
  receiptDate: row.receipt_date || "",
  site: row.site,
  dormId: row.dorm_id || "",
  inspectorName: row.inspector_name || "",
  dormManagerName: row.dorm_manager_name || "",
  managerUserId: row.manager_user_id || "",
  buildingName: row.building_name || "",
  dong: row.dong || "",
  ho: row.ho || "",
  공동현관: row.shared_entry || "",
  세대현관: row.unit_entry || "",
  roadAddress: row.road_address || "",
  detailAddress: row.detail_address || "",
  defectStatus: row.defect_status || "접수",
  requestText: row.request_text || "",
  completeText: row.complete_text || "",
  reporterUserId: row.reporter_user_id || "",
  reporterName: row.reporter_name || "",
  requestPhotoDataUrls: row.request_photo_data_urls || [],
  completionPhotoDataUrls: row.completion_photo_data_urls || [],
  createdAt: row.created_at || "",
  completedAt: row.completed_at || undefined,
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
});

const toDbInventoryItem = (item: InventoryItem, tenantId: string, userId: string) => ({
  id: item.id,
  tenant_id: tenantId,
  dorm_id: item.dormId,
  site: item.site,
  dorm_address: item.dormAddress,
  building_name: item.buildingName,
  dong: item.dong,
  room_ho: item.roomHo,
  manager_name: item.managerName,
  item_name: item.itemName,
  quantity: item.quantity,
  model_name: item.modelName,
  maker: item.maker,
  status: item.status,
  installation_location: item.installationLocation,
  purchase_date: item.purchaseDate,
  purchase_amount: item.purchaseAmount,
  issued_date: item.issuedDate,
  proof_file: item.proofFile,
  sold_date: item.soldDate,
  sold_amount: item.soldAmount,
  disposal_date: item.disposalDate,
  disposal_reason: item.disposalReason,
  notes: item.notes,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(item.createdAt),
  updated_at: tsOrNow(item.updatedAt),
  is_deleted: item.isDeleted ?? false,
  deleted_at: item.deletedAt,
  deleted_by: item.deletedBy,
});

const toDomainInventoryItem = (row: any): InventoryItem => ({
  id: row.id,
  dormId: row.dorm_id || "",
  site: row.site,
  dormAddress: row.dorm_address || "",
  buildingName: row.building_name || "",
  dong: row.dong || "",
  roomHo: row.room_ho || "",
  managerName: row.manager_name || "",
  itemName: row.item_name || "",
  quantity: row.quantity ?? 0,
  modelName: row.model_name || "",
  maker: row.maker || "",
  status: row.status || "정상",
  installationLocation: row.installation_location || "",
  purchaseDate: row.purchase_date || "",
  purchaseAmount: row.purchase_amount ?? 0,
  issuedDate: row.issued_date || "",
  proofFile: row.proof_file || "",
  soldDate: row.sold_date || "",
  soldAmount: row.sold_amount ?? 0,
  disposalDate: row.disposal_date || "",
  disposalReason: row.disposal_reason || "",
  notes: row.notes || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
});

const toDbSettlementRecord = (record: SettlementRecord, tenantId: string, userId: string) => ({
  id: record.id,
  tenant_id: tenantId,
  settlement_year: record.settlementYear,
  settlement_month: record.settlementMonth,
  dorm_id: record.dormId,
  misc_cost: record.miscCost,
  notes: record.notes,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(record.createdAt),
  updated_at: tsOrNow(record.updatedAt),
});

const toDomainSettlementRecord = (row: any): SettlementRecord => ({
  id: row.id,
  settlementYear: row.settlement_year || "",
  settlementMonth: row.settlement_month || "",
  dormId: row.dorm_id || "",
  miscCost: row.misc_cost ?? 0,
  notes: row.notes || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
});

const toDbSettlementItem = (item: SettlementItem, tenantId: string, userId: string) => ({
  id: item.id,
  tenant_id: tenantId,
  settlement_year: item.settlementYear,
  settlement_month: item.settlementMonth,
  dorm_id: item.dormId,
  category: item.category,
  details: item.details,
  amount: item.amount,
  burden_type: item.burdenType,
  target_name: item.targetName,
  memo: item.memo,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(item.createdAt),
  updated_at: tsOrNow(item.updatedAt),
});

const toDomainSettlementItem = (row: any): SettlementItem => ({
  id: row.id,
  settlementYear: row.settlement_year || "",
  settlementMonth: row.settlement_month || "",
  dormId: row.dorm_id || "",
  category: row.category || "",
  details: row.details || "",
  amount: row.amount ?? 0,
  burdenType: row.burden_type || "",
  targetName: row.target_name || "",
  memo: row.memo || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
});

const toDbAuditLog = (log: AuditLog, tenantId: string, userId: string) => ({
  id: log.id,
  tenant_id: tenantId,
  target_type: log.targetType,
  target_id: log.targetId,
  action_type: log.actionType,
  changed_by: log.changedBy,
  changed_at: log.changedAt,
  before_value: log.beforeValue,
  after_value: log.afterValue,
  memo: log.memo,
  changes: log.changes || [],
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(log.changedAt),
  updated_at: tsOrNow(log.changedAt),
});

const toDomainAuditLog = (row: any): AuditLog => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  actionType: row.action_type,
  changedBy: row.changed_by,
  changedAt: row.changed_at || row.created_at || "",
  beforeValue: row.before_value || "",
  afterValue: row.after_value || "",
  memo: row.memo || undefined,
  changes: row.changes || undefined,
});

export const loadOperationalModule = async (tenantId: string): Promise<OperationalModuleState | null> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping operational module load.");
    return null;
  }

  try {
    const [cleaningResult, defectsResult, inventoryResult, settlementRecordsResult, settlementItemsResult, auditLogsResult] =
      await Promise.all([
        supabase!.from("cleaning_reports").select("*").eq("tenant_id", tenantId),
        supabase!.from("defect_requests").select("*").eq("tenant_id", tenantId),
        supabase!.from("inventory_items").select("*").eq("tenant_id", tenantId),
        supabase!.from("settlement_records").select("*").eq("tenant_id", tenantId),
        supabase!.from("settlement_items").select("*").eq("tenant_id", tenantId),
        supabase!.from("audit_logs").select("*").eq("tenant_id", tenantId),
      ]);

    if (cleaningResult.error || defectsResult.error || inventoryResult.error || settlementRecordsResult.error || settlementItemsResult.error || auditLogsResult.error) {
      console.error("Supabase operational module load error:",
        cleaningResult.error || defectsResult.error || inventoryResult.error || settlementRecordsResult.error || settlementItemsResult.error || auditLogsResult.error);
      return null;
    }

    return {
      tenantId,
      cleaningReports: (cleaningResult.data || []).map(toDomainCleaningReport),
      defects: (defectsResult.data || []).map(toDomainDefectRequest),
      inventory: (inventoryResult.data || []).map(toDomainInventoryItem),
      settlementRecords: (settlementRecordsResult.data || []).map(toDomainSettlementRecord),
      settlementItems: (settlementItemsResult.data || []).map(toDomainSettlementItem),
      auditLogs: (auditLogsResult.data || []).map(toDomainAuditLog),
    };
  } catch (error) {
    console.error("Supabase operational module load exception:", error);
    return null;
  }
};

export const saveOperationalModule = async (payload: OperationalModuleState, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping operational module save.");
    return;
  }

  try {
    console.debug("saveOperationalModule: upserting counts", {
      cleaning: payload.cleaningReports?.length || 0,
      defects: payload.defects?.length || 0,
      inventory: payload.inventory?.length || 0,
      settlementRecords: payload.settlementRecords?.length || 0,
      settlementItems: payload.settlementItems?.length || 0,
      auditLogs: payload.auditLogs?.length || 0,
    });
    const [cleaningResult, defectsResult, inventoryResult, settlementRecordsResult, settlementItemsResult, auditLogsResult] =
      await Promise.all([
        supabase!
          .from("cleaning_reports")
          .upsert(payload.cleaningReports.map((report) => toDbCleaningReport(report, payload.tenantId, userId)), { onConflict: "id" }),
        supabase!
          .from("defect_requests")
          .upsert(payload.defects.map((defect) => toDbDefectRequest(defect, payload.tenantId, userId)), { onConflict: "id" }),
        supabase!
          .from("inventory_items")
          .upsert(payload.inventory.map((item) => toDbInventoryItem(item, payload.tenantId, userId)), { onConflict: "id" }),
        supabase!
          .from("settlement_records")
          .upsert(payload.settlementRecords.map((record) => toDbSettlementRecord(record, payload.tenantId, userId)), { onConflict: "id" }),
        supabase!
          .from("settlement_items")
          .upsert(payload.settlementItems.map((item) => toDbSettlementItem(item, payload.tenantId, userId)), { onConflict: "id" }),
        supabase!
          .from("audit_logs")
          .upsert(payload.auditLogs.map((log) => toDbAuditLog(log, payload.tenantId, userId)), { onConflict: "id" }),
      ]);

    if (cleaningResult.error || defectsResult.error || inventoryResult.error || settlementRecordsResult.error || settlementItemsResult.error || auditLogsResult.error) {
      const err = cleaningResult.error || defectsResult.error || inventoryResult.error || settlementRecordsResult.error || settlementItemsResult.error || auditLogsResult.error;
      // provide more helpful logging if RLS/permission issue
      if (err && /permission|row level security|RLS/i.test(JSON.stringify(err))) {
        console.error("Supabase permission/RLS error detected:", err);
      }
      throw err;
    }
  } catch (error) {
    console.error("Supabase operational module save error:", error);
    throw error;
  }
};
