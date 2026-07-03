import { supabase, isSupabaseAvailable, translateSupabaseError } from "./supabaseService";
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
  memo: row.memo || "",
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
      ...toPhotoArray(row?.before_photo_data_urls), ...toPhotoArray(row?.before_photos),
      ...toPhotoArray(row?.photo_urls), ...toPhotoArray(row?.photos),
      ...toPhotoArray(row?.image_urls), ...toPhotoArray(row?.images),
      ...toPhotoArray(row?.attachments), ...toPhotoArray(row?.files),
      ...toPhotoArray(row?.photoFiles), ...toPhotoArray(row?.uploadedPhotos), ...toPhotoArray(row?.cleaning_photos),
      ...toPhotoArray(row?.preview_url), ...toPhotoArray(row?.thumbnail_url),
    ].map(toPhotoUrl)
  );
  const afterAll = dedupe([...toPhotoArray(row?.after_photo_data_urls), ...toPhotoArray(row?.after_photos)].map(toPhotoUrl));
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
        console.log("[청소사진 디버그] 사진 0장 report:", {
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
      (data || []).forEach((r: any) => out.push({ id: r.id, ...extractCleaningReportPhotos(r) }));
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
      console.log("[청소사진 디버그] 수정 조회 0장 report:", {
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

export const saveOperationalModule = async (payload: OperationalModuleState, userId: string): Promise<void> => {
  if (!isSupabaseAvailable()) {
    console.warn("Supabase environment variables are not configured. Skipping operational module save.");
    return;
  }

  try {
    // 변경 행이 있는 테이블만 upsert(빈 배열은 네트워크 요청 생략 → 속도 개선). 하나라도 실패하면 throw.
    const ops: any[] = [];
    if (payload.cleaningReports.length) ops.push(supabase!.from("cleaning_reports").upsert(payload.cleaningReports.map((r) => toDbCleaningReport(r, payload.tenantId, userId)), { onConflict: "id" }));
    if (payload.defects.length) ops.push(supabase!.from("defect_requests").upsert(payload.defects.map((d) => toDbDefectRequest(d, payload.tenantId, userId)), { onConflict: "id" }));
    if (payload.inventory.length) ops.push(supabase!.from("inventory_items").upsert(payload.inventory.map((i) => toDbInventoryItem(i, payload.tenantId, userId)), { onConflict: "id" }));
    if (payload.settlementRecords.length) ops.push(supabase!.from("settlement_records").upsert(payload.settlementRecords.map((r) => toDbSettlementRecord(r, payload.tenantId, userId)), { onConflict: "id" }));
    if (payload.settlementItems.length) ops.push(supabase!.from("settlement_items").upsert(payload.settlementItems.map((i) => toDbSettlementItem(i, payload.tenantId, userId)), { onConflict: "id" }));

    if (ops.length > 0) {
      const results = await Promise.all(ops);
      const firstErr = (results as Array<{ error: any }>).find((r) => r.error)?.error;
      if (firstErr) {
        if (/permission|row level security|RLS/i.test(JSON.stringify(firstErr))) {
          console.error("Supabase permission/RLS error detected:", firstErr);
        }
        throw new Error(translateSupabaseError((firstErr as any)?.message || String(firstErr)));
      }
    }

    // 부가기능: 변경이력(audit_logs)은 실패해도 전체 저장을 실패로 처리하지 않음(경고만).
    // upsert(on_conflict=id) 대신 plain insert 사용 — id unique/PK 미설정 환경의 500 회피.
    await insertAuditLogsScoped(payload.auditLogs, payload.tenantId, userId);
  } catch (error) {
    console.error("Supabase operational module save error:", error);
    throw new Error(translateSupabaseError((error as any)?.message || String(error)));
  }
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
