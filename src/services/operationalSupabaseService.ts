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

// 보완 청소보고서 원본연결(parentReportId)을 전용 컬럼 없이 memo 에 인코딩/디코딩(기존 스키마 유지).
//  형식: "<사용자 메모>␞보완:<원본id>" — ␞(RS)는 사용자 입력에 나타나지 않는 제어문자.
const SUP_TAG = "␞보완:";
const encodeCleaningMemo = (memo: string, parentReportId?: string): string =>
  parentReportId ? `${memo || ""}${SUP_TAG}${parentReportId}` : (memo || "");
const decodeCleaningMemo = (raw: string): { memo: string; parentReportId?: string } => {
  const s = raw || "";
  const i = s.indexOf(SUP_TAG);
  if (i < 0) return { memo: s };
  return { memo: s.slice(0, i), parentReportId: s.slice(i + SUP_TAG.length).trim() || undefined };
};

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
  memo: encodeCleaningMemo(report.memo, report.parentReportId),
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
  is_permanent_deleted: report.isPermanentDeleted ?? false,
  permanent_deleted_at: report.permanentDeletedAt,
  permanent_deleted_by: report.permanentDeletedBy,
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
  memo: decodeCleaningMemo(row.memo || "").memo,
  parentReportId: decodeCleaningMemo(row.memo || "").parentReportId,
  beforePhotoDataUrls: row.before_photo_data_urls || row.before_photos || row.images || row.photos || row.imageUrls || row.attachments || [],
  afterPhotoDataUrls: row.after_photo_data_urls || row.after_photos || row.attachments || [],
  reporterUserId: row.reporter_user_id || "",
  reporterName: row.reporter_name || "",
  confirmedBy: row.confirmed_by || undefined,
  confirmedAt: row.confirmed_at || undefined,
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
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
  is_permanent_deleted: defect.isPermanentDeleted ?? false,
  permanent_deleted_at: defect.permanentDeletedAt,
  permanent_deleted_by: defect.permanentDeletedBy,
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
  requestPhotoDataUrls: row.request_photo_data_urls || row.request_photos || row.images || row.photos || row.imageUrls || row.attachments || [],
  completionPhotoDataUrls: row.completion_photo_data_urls || row.completion_photos || row.attachments || [],
  createdAt: row.created_at || "",
  completedAt: row.completed_at || undefined,
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
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
  manager_phone: item.managerPhone,
  item_name: item.itemName,
  quantity: item.quantity,
  model_name: item.modelName,
  maker: item.maker,
  status: item.status,
  installation_location: item.installationLocation,
  purchase_date: item.purchaseDate,
  purchase_amount: item.purchaseAmount,
  purchase_vendor: item.purchaseVendor ?? null, // 구매업체(신규 컬럼 — 아래 SQL 실행 필요)
  issued_date: item.issuedDate,
  proof_file: item.proofFile,
  sold_date: item.soldDate,
  sold_amount: item.soldAmount,
  disposal_date: item.disposalDate,
  disposal_reason: item.disposalReason,
  disposal_vendor: item.disposalVendor ?? null, // 매각/폐기 업체(신규 컬럼)
  notes: item.notes,
  created_by: userId,
  updated_by: userId,
  created_at: tsOrNow(item.createdAt),
  updated_at: tsOrNow(item.updatedAt),
  is_deleted: item.isDeleted ?? false,
  deleted_at: item.deletedAt,
  deleted_by: item.deletedBy,
  is_permanent_deleted: item.isPermanentDeleted ?? false,
  permanent_deleted_at: item.permanentDeletedAt,
  permanent_deleted_by: item.permanentDeletedBy,
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
  managerPhone: row.manager_phone || "",
  itemName: row.item_name || "",
  quantity: row.quantity ?? 0,
  modelName: row.model_name || "",
  maker: row.maker || "",
  status: row.status || "정상",
  installationLocation: row.installation_location || "",
  purchaseDate: row.purchase_date || "",
  purchaseAmount: row.purchase_amount ?? 0,
  purchaseVendor: row.purchase_vendor || "",
  issuedDate: row.issued_date || "",
  proofFile: row.proof_file || "",
  soldDate: row.sold_date || "",
  soldAmount: row.sold_amount ?? 0,
  disposalDate: row.disposal_date || "",
  disposalReason: row.disposal_reason || "",
  disposalVendor: row.disposal_vendor || "",
  notes: row.notes || "",
  createdAt: row.created_at || "",
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  isDeleted: row.is_deleted ?? false,
  deletedAt: row.deleted_at || undefined,
  deletedBy: row.deleted_by || undefined,
  isPermanentDeleted: row.is_permanent_deleted ?? false,
  permanentDeletedAt: row.permanent_deleted_at || undefined,
  permanentDeletedBy: row.permanent_deleted_by || undefined,
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
  // id 없으면 생성(테이블에 PK/unique 없거나 누락 시에도 insert 가능하도록).
  id: log.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
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
    // tenant_id 호환 조회(필터 없이 전체 조회 — 기존 행의 tenant_id 가 default/기본/NULL 로 섞여도 누락 방지).
    // 또한 테이블 하나가 실패(타임아웃 등)해도 나머지는 표시되도록 allSettled + 개별 폴백([]) 처리.
    // ⚠️ cleaning_reports 는 초기 로딩에서 제외(사진 base64 대량 → statement timeout/500 유발).
    //    → 청소관리 메뉴 진입 시 loadCleaningReportsModule() 로 지연 조회한다.
    // ⚠️ audit_logs(변경이력)도 초기 로딩에서 제외(statement timeout/500 원인).
    //    → 휴지통관리(변경이력) 화면 진입 시 loadAuditLogsModule() 로 지연 조회한다.
    const [defectsResult, inventoryResult, settlementRecordsResult, settlementItemsResult] =
      await Promise.allSettled([
        supabase!.from("defect_requests").select("*"),
        supabase!.from("inventory_items").select("*"),
        supabase!.from("settlement_records").select("*"),
        supabase!.from("settlement_items").select("*"),
      ]);

    // 각 테이블 결과를 안전하게 추출(실패/에러 시 빈 배열). 하나가 실패해도 전체를 null 로 만들지 않는다.
    const rowsOf = (res: PromiseSettledResult<any>, label: string): any[] => {
      if (res.status === "rejected") {
        console.warn(`[loadOperationalModule] ${label} 조회 실패(빈 값으로 처리):`, (res.reason as { message?: string })?.message || res.reason);
        return [];
      }
      const { data, error } = res.value as { data: any[] | null; error: { message?: string } | null };
      if (error) {
        console.warn(`[loadOperationalModule] ${label} 조회 오류(빈 값으로 처리):`, error.message || error);
        return [];
      }
      return data || [];
    };

    return {
      tenantId,
      // 초기 로딩 제외 — 청소관리 메뉴 진입 시 loadCleaningReportsModule() 로 지연 조회.
      cleaningReports: [],
      defects: rowsOf(defectsResult, "defect_requests").map(toDomainDefectRequest),
      inventory: rowsOf(inventoryResult, "inventory_items").map(toDomainInventoryItem),
      settlementRecords: rowsOf(settlementRecordsResult, "settlement_records").map(toDomainSettlementRecord),
      settlementItems: rowsOf(settlementItemsResult, "settlement_items").map(toDomainSettlementItem),
      // 초기 로딩 제외 — 변경이력 화면 진입 시 loadAuditLogsModule() 로 지연 조회.
      auditLogs: [],
    };
  } catch (error) {
    console.error("Supabase operational module load exception:", error);
    return null;
  }
};

// 청소관리 메뉴 진입 시에만 호출하는 지연 로더 (1단계: 메타데이터만).
// ⚠️ 사진 base64(before/after_photo_data_urls)는 목록 조회에서 제외 → 모바일/태블릿에서
//    대용량 payload 로 인한 지연/타임아웃 방지. 사진은 2단계(loadCleaningReportsPhotosModule)
//    또는 클릭/수정/PDF 시 loadCleaningReportPhotos 로 온디맨드 조회한다.
// - 최신순 + limit 로 statement timeout 방지(인덱스: idx_cleaning_reports_tenant_created_at).
// - 실패 시 null 반환 → 호출부에서 기존 목록 유지(빈 배열로 덮어쓰지 않음).
const CLEANING_LIST_COLUMNS =
  "id, tenant_id, report_date, site, dorm_id, building_name, address, dong, room_ho, shared_entry, unit_entry, manager_user_id, manager_name, cleaner_name, week_label, month_label, clean_status, check_result, score, memo, reporter_user_id, reporter_name, confirmed_by, confirmed_at, created_at, updated_at, is_deleted, deleted_at, deleted_by, is_permanent_deleted, permanent_deleted_at, permanent_deleted_by";

export const loadCleaningReportsModule = async (
  _tenantId: string,
  limit = 300
): Promise<CleaningReport[] | null> => {
  if (!isSupabaseAvailable()) return null;
  try {
    // tenant_id 는 legacy(NULL/혼재) 데이터 누락 방지를 위해 필터하지 않음(기존 loadOperationalModule 정책과 동일).
    // 인덱스는 (tenant_id, created_at) / (created_at) 모두 제공 → 최신순 정렬+limit 가 인덱스를 탄다.
    const { data, error } = await supabase!
      .from("cleaning_reports")
      .select(CLEANING_LIST_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[cleaning_reports] 조회 실패(기존 목록 유지):", error.message || error);
      return null;
    }
    return (data || []).map(toDomainCleaningReport); // 사진 컬럼 없음 → before/after 는 [] 로 매핑
  } catch (e) {
    console.warn("[cleaning_reports] 조회 예외(기존 목록 유지):", (e as { message?: string })?.message || e);
    return null;
  }
};

// ── 청소보고서 사진 통합 추출(구/신 저장구조 호환) ─────────────────────────────
// 값 형태(배열/JSON문자열/객체/URL/base64/단일값) 모두 배열로 변환.
const toPhotoArray = (v: any): any[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try { const p = JSON.parse(s); return Array.isArray(p) ? p : (p ? [p] : []); } catch { return [s]; }
  }
  if (typeof v === "object") return [v];
  return [];
};
// 항목(문자열 또는 객체)에서 표시용 URL/경로 추출.
const toPhotoUrl = (item: any): string => {
  if (!item) return "";
  if (typeof item === "string") return item;
  return (
    item.url || item.publicUrl || item.public_url || item.signedUrl || item.signed_url ||
    item.previewUrl || item.preview_url || item.thumbnailUrl || item.thumbnail_url ||
    item.src || item.path || item.storagePath || item.storage_path || item.filePath || item.file_path || ""
  );
};
// 한 행(row)에서 모든 사진 컬럼/형태를 합쳐 before/after 배열로 반환(중복 제거). 구조 달라도 사진 복구.
export const extractCleaningReportPhotos = (row: any): { before: string[]; after: string[] } => {
  const dedupe = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));
  const before = dedupe(
    [
      // snake_case(DB) + camelCase(도메인/백업) 모두 지원.
      ...toPhotoArray(row?.before_photo_data_urls), ...toPhotoArray(row?.beforePhotoDataUrls), ...toPhotoArray(row?.before_photos),
      ...toPhotoArray(row?.photo_urls), ...toPhotoArray(row?.photoUrls), ...toPhotoArray(row?.photos),
      ...toPhotoArray(row?.image_urls), ...toPhotoArray(row?.imageUrls), ...toPhotoArray(row?.images),
      ...toPhotoArray(row?.attachments), ...toPhotoArray(row?.files),
      ...toPhotoArray(row?.photoFiles), ...toPhotoArray(row?.uploadedPhotos), ...toPhotoArray(row?.cleaning_photos),
      ...toPhotoArray(row?.preview_url), ...toPhotoArray(row?.thumbnail_url),
    ].map(toPhotoUrl)
  );
  const afterAll = dedupe([...toPhotoArray(row?.after_photo_data_urls), ...toPhotoArray(row?.afterPhotoDataUrls), ...toPhotoArray(row?.after_photos)].map(toPhotoUrl));
  const after = afterAll.filter((u) => !before.includes(u)); // before 에 이미 포함된 값은 after 에서 제외
  return { before, after };
};

// 2단계: 목록 표시 직후 백그라운드로 사진을 조회해 썸네일/개수를 채운다(구/신 저장구조 모두 지원).
// select("*") 로 사진이 어느 컬럼에 있든 읽어온다. 실패/타임아웃해도 목록(메타데이터)은 이미 표시된 상태.
export const loadCleaningReportsPhotosModule = async (
  limit = 300
): Promise<Array<{ id: string; before: string[]; after: string[] }> | null> => {
  if (!isSupabaseAvailable()) return null;
  try {
    const { data, error } = await supabase!
      .from("cleaning_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[cleaning_reports 사진 일괄 조회 실패]", error.message || error);
      return null;
    }
    const rows = data || [];
    let dbg = 0;
    return rows.map((r: any) => {
      const photos = extractCleaningReportPhotos(r);
      // ── 디버그: 사진 0장으로 판정된 보고서의 실제 컬럼/값을 출력(원인 분석용, base64는 앞부분만).
      //    최근 등록은 정상인데 예전 것만 0장이면, 여기 출력으로 "예전 데이터가 어느 컬럼/형태인지" 확인.
      if (photos.before.length + photos.after.length === 0 && dbg < 8) {
        dbg++;
        const photoish: Record<string, unknown> = {};
        Object.keys(r).forEach((k) => {
          if (/photo|image|url|path|file|attach|thumb|preview/i.test(k)) {
            const v = r[k];
            photoish[k] = typeof v === "string" && v.length > 100 ? `${v.slice(0, 100)}…(len=${v.length})` : v;
          }
        });
        import.meta.env.DEV && console.log("[청소사진 디버그] 사진 0장 report:", {
          id: r.id,
          photo_count: r.photo_count,
          allColumns: Object.keys(r),
          photoColumns: photoish,
        });
      }
      return { id: r.id, ...photos };
    });
  } catch (e) {
    console.warn("[cleaning_reports 사진 일괄 조회 예외]", (e as { message?: string })?.message || e);
    return null;
  }
};

// 목록에 표시된 "정확한 보고서 id" 들의 사진만 조회(구/신 저장구조 모두). 최신 300건 제한이 아니라
// id 기준이므로, 오래된 보고서/캐시로 표시된 보고서도 사진이 채워진다("사진없음" 근본 해결).
// id 목록을 청크(50개)로 나눠 .in() 조회 → URL 길이 초과 방지.
export const loadCleaningReportsPhotosByIds = async (
  ids: string[]
): Promise<Array<{ id: string; before: string[]; after: string[] }> | null> => {
  if (!isSupabaseAvailable() || !ids || ids.length === 0) return null;
  try {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    const out: Array<{ id: string; before: string[]; after: string[] }> = [];
    const CHUNK = 50;
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const part = uniq.slice(i, i + CHUNK);
      const { data, error } = await supabase!.from("cleaning_reports").select("*").in("id", part);
      if (error) { console.warn("[cleaning_reports 사진 id조회 실패]", error.message || error); continue; }
      (data || []).forEach((r: any) => {
        const photos = extractCleaningReportPhotos(r);
        // ── 디버그: 사진 0장으로 판정된 보고서의 실제 컬럼/값 출력(원인 분석용, base64는 앞부분만).
        if (photos.before.length + photos.after.length === 0) {
          const photoish: Record<string, unknown> = {};
          Object.keys(r).forEach((k) => {
            if (/photo|image|url|path|file|attach|thumb|preview/i.test(k)) {
              const v = r[k];
              photoish[k] = typeof v === "string" && v.length > 100 ? `${v.slice(0, 100)}…(len=${v.length})` : v;
            }
          });
          import.meta.env.DEV && console.log("[청소사진 디버그] 리스트 사진 0장 report:", { id: r.id, allColumns: Object.keys(r), photoColumns: photoish });
        }
        out.push({ id: r.id, ...photos });
      });
    }
    return out;
  } catch (e) {
    console.warn("[cleaning_reports 사진 id조회 예외]", (e as { message?: string })?.message || e);
    return null;
  }
};

// 청소보고서 사진 상세(원본 base64) 지연 조회 — 리스트가 아닌, 사진 클릭/뷰어 열 때만 1건 조회.
// 목록에서 원본 사진을 미리 가져오지 않기 위한 온디맨드 로더.
export const loadCleaningReportPhotos = async (
  reportId: string
): Promise<{ beforePhotoDataUrls: string[]; afterPhotoDataUrls: string[] } | null> => {
  if (!isSupabaseAvailable() || !reportId) return null;
  try {
    // select("*") 로 사진이 어느 컬럼/형태로 저장돼 있든(구/신 저장구조) 읽어온다. maybeSingle 로 0행에도 안전.
    const { data, error } = await supabase!
      .from("cleaning_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (error) {
      console.warn("[cleaning_reports 사진 조회 실패]", error.message || error);
      return null;
    }
    if (!data) return null;
    const { before, after } = extractCleaningReportPhotos(data);
    // ── 디버그: 수정 클릭 시에도 0장이면 실제 컬럼/값 출력(예전 데이터 저장구조/버킷 확인용).
    if (before.length + after.length === 0) {
      const photoish: Record<string, unknown> = {};
      Object.keys(data).forEach((k) => {
        if (/photo|image|url|path|file|attach|thumb|preview/i.test(k)) {
          const v = (data as any)[k];
          photoish[k] = typeof v === "string" && v.length > 100 ? `${v.slice(0, 100)}…(len=${v.length})` : v;
        }
      });
      import.meta.env.DEV && console.log("[청소사진 디버그] 수정 조회 0장 report:", {
        id: (data as any).id,
        photo_count: (data as any).photo_count,
        allColumns: Object.keys(data),
        photoColumns: photoish,
      });
    }
    return { beforePhotoDataUrls: before, afterPhotoDataUrls: after };
  } catch (e) {
    console.warn("[cleaning_reports 사진 조회 예외]", (e as { message?: string })?.message || e);
    return null;
  }
};

// 변경이력(감사로그) 지연 로더 — 휴지통관리(변경이력) 화면 진입 시에만 호출.
// tenant 필터 + 최신순 + 50건 제한(인덱스: idx_audit_logs_tenant_created_at). 실패 시 null(기존 유지).
export const loadAuditLogsModule = async (tenantId: string, limit = 50): Promise<AuditLog[] | null> => {
  if (!isSupabaseAvailable()) return null;
  try {
    const { data, error } = await supabase!
      .from("audit_logs")
      .select("id, target_type, target_id, action_type, changed_by, changed_at, before_value, after_value, memo, changes, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[audit_logs] 조회 실패(기존 목록 유지):", error.message || error);
      return null;
    }
    return (data || []).map(toDomainAuditLog);
  } catch (e) {
    console.warn("[audit_logs] 조회 예외(기존 목록 유지):", (e as { message?: string })?.message || e);
    return null;
  }
};

// 운영 모듈 저장 결과 — 테이블별로 성공/실패를 분리해 반환.
// (회사망에서 청소는 되는데 하자만 실패하는 등, 한 테이블 실패가 다른 테이블 저장/커밋을 막지 않도록)
export type OperationalSaveResult = {
  savedTables: string[];                              // 본문 저장 성공한 테이블
  failed: Array<{ table: string; error: any }>;       // 본문 저장 실패한 테이블 + 원인
  photoFailedTables: string[];                        // 본문은 저장됐으나 "사진 저장"만 실패한 테이블(재업로드 안내용)
};

// 대용량 사진(base64) 컬럼 — 본문(텍스트) 저장 payload 에서 제외하고 별도 update 로 저장한다.
// (회사망 보안 프록시가 대용량 base64 요청을 차단해 No API key/CORS/Failed to fetch 가 나는 문제 회피)
const CLEANING_PHOTO_KEYS = ["before_photo_data_urls", "after_photo_data_urls"];
const DEFECT_PHOTO_KEYS = ["request_photo_data_urls", "completion_photo_data_urls"];
const stripKeys = (obj: Record<string, any>, keys: string[]) => { const c = { ...obj }; keys.forEach((k) => delete c[k]); return c; };

// DB 스키마 불일치(존재하지 않는 컬럼/테이블/캐시 미갱신) — 재시도해도 동일하게 실패하므로 즉시 중단한다.
// (PGRST204: 컬럼 캐시 없음, 42703: undefined column, 42P01: undefined table)
const isSchemaMismatchError = (err: any): boolean => {
  const code = String(err?.code ?? "");
  const msg = `${err?.message ?? ""} ${err?.details ?? ""} ${err?.hint ?? ""}`.toLowerCase();
  return code === "PGRST204" || code === "42703" || code === "42P01" ||
    /could not find the .* column|column .* does not exist|relation .* does not exist|schema cache/.test(msg);
};
// 재시도해도 결과가 달라지지 않는 오류(사진 저장 경로 전용).
//  인증/권한/중복/제약/요청형식 오류는 1.5초 뒤 재시도해도 동일하게 실패하며 요청 수만 2배가 된다.
//  네트워크 일시 오류·타임아웃(5xx 중 timeout 류)만 재시도 대상으로 남긴다.
const isNonRetryablePhotoError = (err: any): boolean => {
  if (isSchemaMismatchError(err)) return true;
  const status = Number(err?.status);
  if ([400, 401, 403, 404, 409, 413, 422].includes(status)) return true;
  const code = String(err?.code ?? "");
  if (/^(2[23]\d{3}|42\d{3})$/.test(code)) return true; // Postgres 제약/권한/구문 오류(23502/23503/23505/42501 등)
  const msg = `${err?.message ?? ""} ${err?.details ?? ""} ${err?.hint ?? ""}`.toLowerCase();
  return /row-level security|violates .* constraint|payload too large|permission denied|invalid input syntax/.test(msg);
};
const base64Len = (arr?: string[]) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (typeof x === "string" ? x.length : 0), 0) : 0);

// ── [9] 장기 개선: 현재는 DB base64 저장 유지. 추후 Supabase Storage 업로드로 전환할 수 있도록
//        "본문 저장(saveBodyRows)"과 "사진 저장(savePhotosOptional)"을 함수로 분리해 둔다. ──
type PhotoJob = { table: string; id: string; data: Record<string, any>; imageCount: number; base64Size: number };

// 사진만 별도 update(본문 저장 성공 후 호출). 실패해도 본문 저장은 유지 — 실패 테이블 목록만 반환.
const savePhotosOptional = async (photoJobs: PhotoJob[]): Promise<string[]> => {
  if (photoJobs.length === 0) return [];
  const run = async (pj: PhotoJob): Promise<{ pj: PhotoJob; error: any }> => {
    try {
      const { error } = await supabase!.from(pj.table).update(pj.data).eq("id", pj.id);
      return { pj, error: error ?? null };
    } catch (e) {
      return { pj, error: e };
    }
  };
  let results = await Promise.all(photoJobs.map(run));
  // [7] 사진 저장 실패 시 1회 자동 재시도(1.5초 후). 단, 스키마 불일치(존재하지 않는 컬럼 등)는 재시도 무의미 → 즉시 중단.
  const failedOnce = results.filter((r) => r.error && !isNonRetryablePhotoError(r.error));
  if (failedOnce.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const retried = await Promise.all(failedOnce.map((r) => run(r.pj)));
    const byId = new Map(retried.map((r) => [`${r.pj.table}|${r.pj.id}`, r]));
    results = results.map((r) => byId.get(`${r.pj.table}|${r.pj.id}`) ?? r);
  }
  const failedTables = new Set<string>();
  for (const r of results) {
    if (!r.error) continue;
    failedTables.add(r.pj.table);
    // [8][16] 오류 로그: 실제 Supabase Response(code/message/details/hint/status) + 이미지 수/총 base64 크기.
    //   cleaning_reports PATCH 500 등의 실제 원인(트리거/제약/형식/용량)을 콘솔에서 그대로 확인할 수 있게 남긴다.
    const err = r.error as { code?: unknown; message?: string; name?: unknown; details?: unknown; hint?: unknown; status?: unknown };
    console.error("[photo save] 사진 저장 실패(본문은 저장됨):", {
      table: r.pj.table,
      action: "photo-update",
      id: r.pj.id,
      code: err?.code ?? "(unknown)",
      status: err?.status ?? "(unknown)",
      name: err?.name ?? "(unknown)",
      message: err?.message ?? String(r.error),
      details: err?.details ?? "(none)",
      hint: err?.hint ?? "(none)",
      imageCount: r.pj.imageCount,
      totalBase64Size: r.pj.base64Size,
    });
  }
  return Array.from(failedTables);
};

export const saveOperationalModule = async (payload: OperationalModuleState, userId: string): Promise<OperationalSaveResult> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping operational module save.");
    return { savedTables: [], failed: [], photoFailedTables: [] };
  }

  // [1][2] 본문(텍스트) 저장 payload — 청소/하자는 대용량 사진 컬럼을 제외하고 저장한다.
  const jobs: Array<{ table: string; rows: any[] }> = [
    { table: "cleaning_reports", rows: payload.cleaningReports.map((r) => stripKeys(toDbCleaningReport(r, payload.tenantId, userId), CLEANING_PHOTO_KEYS)) },
    { table: "defect_requests", rows: payload.defects.map((d) => stripKeys(toDbDefectRequest(d, payload.tenantId, userId), DEFECT_PHOTO_KEYS)) },
    // [4] 비품 증빙파일: 큰 base64면 본문에서 제외(별도 저장). 비었으면(삭제/없음) 본문에 그대로 둬서 "삭제"가 반영되게 한다.
    { table: "inventory_items", rows: payload.inventory.map((i) => {
      const db = toDbInventoryItem(i, payload.tenantId, userId) as Record<string, any>;
      if (typeof db.proof_file === "string" && db.proof_file.length > 0) delete db.proof_file;
      return db;
    }) },
    { table: "settlement_records", rows: payload.settlementRecords.map((r) => toDbSettlementRecord(r, payload.tenantId, userId)) },
    { table: "settlement_items", rows: payload.settlementItems.map((i) => toDbSettlementItem(i, payload.tenantId, userId)) },
  ].filter((j) => j.rows.length > 0);

  const upsertOne = async (j: { table: string; rows: any[] }): Promise<{ table: string; error: any }> => {
    try {
      const { error } = await supabase!.from(j.table).upsert(j.rows, { onConflict: "id" });
      return { table: j.table, error: error ?? null };
    } catch (e) {
      return { table: j.table, error: e };
    }
  };

  const logFailure = (action: "upsert" | "retry-upsert", s: { table: string; error: any }) => {
    const err = s.error as { code?: unknown; message?: string; details?: unknown; hint?: unknown; status?: unknown; name?: unknown };
    const count = jobs.find((j) => j.table === s.table)?.rows.length ?? 0;
    console.error("[operational save] 본문 저장 실패:", {
      table: s.table, action,
      code: err?.code ?? "(unknown)", status: err?.status ?? "(unknown)", name: err?.name ?? "(unknown)",
      message: err?.message ?? String(s.error), details: err?.details, hint: err?.hint, payloadRows: count,
    });
  };

  let settled = await Promise.all(jobs.map(upsertOne));

  // 실패 테이블 1.5초 후 1회 자동 재시도. 단, 스키마 불일치(PGRST204 등)는 재시도해도 동일 실패 → 즉시 중단.
  const firstFailed = settled.filter((s) => s.error);
  if (firstFailed.length > 0) {
    firstFailed.forEach((s) => logFailure("upsert", s));
    const retriable = firstFailed.filter((s) => !isSchemaMismatchError(s.error));
    if (retriable.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const retryJobs = jobs.filter((j) => retriable.some((f) => f.table === j.table));
      const retried = await Promise.all(retryJobs.map(upsertOne));
      const retriedByTable = new Map(retried.map((r) => [r.table, r]));
      settled = settled.map((s) => retriedByTable.get(s.table) ?? s);
    }
  }

  const savedTables: string[] = [];
  const failed: Array<{ table: string; error: any }> = [];
  for (const s of settled) {
    if (s.error) { failed.push({ table: s.table, error: s.error }); logFailure("retry-upsert", s); }
    else savedTables.push(s.table);
  }

  // [4][5][6] 본문 저장 성공한 테이블만 사진을 별도 update. 사진 컬럼은 "비어있지 않을 때만" 전송
  //  → 글만 수정(사진 미변경) 시 기존 사진을 [] 로 덮어쓰지 않음. 삭제로 줄어든 배열은 그대로 반영.
  const savedSet = new Set(savedTables);
  const photoJobs: PhotoJob[] = [];
  if (savedSet.has("cleaning_reports")) {
    payload.cleaningReports.forEach((r) => {
      const data: Record<string, string[]> = {};
      if (Array.isArray(r.beforePhotoDataUrls) && r.beforePhotoDataUrls.length) data.before_photo_data_urls = r.beforePhotoDataUrls;
      if (Array.isArray(r.afterPhotoDataUrls) && r.afterPhotoDataUrls.length) data.after_photo_data_urls = r.afterPhotoDataUrls;
      if (Object.keys(data).length && r.id) {
        photoJobs.push({ table: "cleaning_reports", id: r.id, data, imageCount: (r.beforePhotoDataUrls?.length || 0) + (r.afterPhotoDataUrls?.length || 0), base64Size: base64Len(r.beforePhotoDataUrls) + base64Len(r.afterPhotoDataUrls) });
      }
    });
  }
  if (savedSet.has("defect_requests")) {
    payload.defects.forEach((d) => {
      const data: Record<string, string[]> = {};
      if (Array.isArray(d.requestPhotoDataUrls) && d.requestPhotoDataUrls.length) data.request_photo_data_urls = d.requestPhotoDataUrls;
      if (Array.isArray(d.completionPhotoDataUrls) && d.completionPhotoDataUrls.length) data.completion_photo_data_urls = d.completionPhotoDataUrls;
      if (Object.keys(data).length && d.id) {
        photoJobs.push({ table: "defect_requests", id: d.id, data, imageCount: (d.requestPhotoDataUrls?.length || 0) + (d.completionPhotoDataUrls?.length || 0), base64Size: base64Len(d.requestPhotoDataUrls) + base64Len(d.completionPhotoDataUrls) });
      }
    });
  }
  // [4] 비품 증빙파일(proof_file)도 본문 저장 성공 후 별도 update. "값이 있을 때만" → 새 파일 없으면 기존 파일 유지(빈값 덮어쓰기 금지).
  if (savedSet.has("inventory_items")) {
    payload.inventory.forEach((i) => {
      if (i.id && typeof i.proofFile === "string" && i.proofFile.length > 0) {
        photoJobs.push({ table: "inventory_items", id: i.id, data: { proof_file: i.proofFile }, imageCount: 1, base64Size: i.proofFile.length });
      }
    });
  }
  const photoFailedTables = await savePhotosOptional(photoJobs);

  // 부가기능: 변경이력(audit_logs)은 실패해도 본 저장을 실패로 처리하지 않음(내부에서 warn 만, throw 없음).
  await insertAuditLogsScoped(payload.auditLogs, payload.tenantId, userId);

  return { savedTables, failed, photoFailedTables };
};

/**
 * 감사로그 INSERT 전용 동기화 (비admin 용).
 * - upsert + ignoreDuplicates:true → 신규 행만 INSERT, 기존 행은 DO NOTHING (UPDATE 미발생)
 * - audit_logs 의 INSERT 전용 RLS 정책과 호환 (UPDATE 정책 없어도 403 없음)
 */
// 변경이력(audit_logs) 저장 — 부가기능. 실패해도 throw 하지 않고 console.warn 만 남긴다.
// upsert(on_conflict=id, ignoreDuplicates) 사용 → 이미 저장된 id 를 다시 보내도
// "INSERT ... ON CONFLICT DO NOTHING" 으로 처리되어 409 duplicate key / 500 오류가 발생하지 않는다.
// (기존: plain insert 로 누적 감사로그 전체를 매 저장마다 재전송 → 409/500 콘솔 스팸의 원인)
let auditWarnedOnce = false; // timeout/실패 경고는 1회만 출력(콘솔 반복 방지)
export const insertAuditLogsScoped = async (
  auditLogs: AuditLog[],
  tenantId: string,
  userId: string
): Promise<void> => {
  if (!isSupabaseAvailable()) return;
  if (!auditLogs || auditLogs.length === 0) return;
  try {
    // 8초 타임아웃: 감사로그 저장이 지연돼도 전체 저장 흐름을 막지 않는다(부가기능).
    const upsertPromise = supabase!
      .from("audit_logs")
      .upsert(auditLogs.map((log) => toDbAuditLog(log, tenantId, userId)), { onConflict: "id", ignoreDuplicates: true });
    const timeout = new Promise<{ error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ error: { message: "timeout" } }), 8000)
    );
    const { error } = (await Promise.race([upsertPromise, timeout])) as { error: { message?: string } | null };
    if (error && !auditWarnedOnce) {
      auditWarnedOnce = true;
      // 감사로그 저장 실패/타임아웃은 실제 데이터 저장과 무관 → 1회만 경고(이후 조용히 무시).
      console.warn("[audit_logs] 변경이력 저장 실패/지연(무시, 1회만 표시):", (error as { message?: string })?.message || error);
    }
  } catch (e) {
    if (!auditWarnedOnce) {
      auditWarnedOnce = true;
      console.warn("[audit_logs] 변경이력 저장 예외(무시, 1회만 표시):", (e as { message?: string })?.message || e);
    }
  }
};
