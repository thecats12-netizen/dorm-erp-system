export type Gender = "남" | "여" | "기타";
export type UserRole = "admin" | "viewer" | "dorm_manager" | "maintenance_reporter";
export type Site = "평택" | "천안" | "전체";

export type LoginUser = {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  phone?: string;
  isActive: boolean;
  siteAccess: Site | "전체";
  genderAccess?: "남" | "여" | "전체";
  roadAddress?: string;
  buildingName?: string;
  dong?: string;
  roomHo?: string;
  공동현관?: string;
  세대현관?: string;
  manualActiveOverride?: boolean;
  dormId?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
  createdAt: string;
};

export type Dorm = {
  id: string;
  site: Site;
  gender: "남" | "여";
  buildingName: string;
  address: string;
  dong: string;
  roomHo: string;
  pyeong: string;
  capacity: number;
  managerUserId?: string;
  contractStart: string;
  contractEnd: string;
  contractAmount: string;
  leaseStatus: "사용중" | "만료예정" | "해지" | "공실";
  공동현관: string;
  세대현관: string;
  prepaymentDeposit: number;
  realEstateName: string;
  managementOfficePhone?: string;
  balanceDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type OperationalDorm = Dorm;

export type Occupant = {
  id: string;
  dormId: string;
  site: Site;
  employeeName: string;
  gender: Gender;
  department: string;
  phone: string;
  moveInDate: string;
  moveOutDueDate: string;
  status: "거주중" | "만료예정" | "퇴실" | "천안이동" | "신규입주" | "대기중" | "미배정";
  isNewHireAssignment: boolean;
  notes: string;
  expectedMoveInDate?: string;
  expectedMoveOutDate?: string;
  actualMoveOutDate?: string;
  sourceNewHireId?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type InventoryItem = {
  id: string;
  dormId: string;
  site: Site;
  dormAddress: string;
  buildingName: string;
  dong: string;
  roomHo: string;
  managerName: string;
  managerPhone: string;
  itemName: string;
  quantity: number;
  modelName: string;
  maker: string;
  status: "정상" | "고장" | "노후" | "매각" | "폐기";
  installationLocation: string;
  purchaseDate: string;
  purchaseAmount: number;
  purchaseVendor?: string;   // 구매업체
  issuedDate: string;
  proofFile: string;
  soldDate: string;
  soldAmount: number;
  disposalDate: string;
  disposalReason: string;
  disposalVendor?: string;   // 매각/폐기 업체
  notes: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type LeaseContract = {
  id: string;
  dateKey: string;
  addressName: string;
  dong: string;
  ho: string;
  pyeong: string;
  contractAmount: string;
  contractPeriod: string;
  contractDate: string;
  prepaymentDeposit: number;
  realEstateName: string;
  notes: string;
  balanceDate: string;
  site: Site;
  gender: "남" | "여";
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type DormContractStatus = "진행중" | "종료" | "연장" | "해지" | "공실" | "만료예정";
export type ContractType = "신규" | "연장" | "재계약" | "해지후신규";

export type DormContractFormState = Omit<DormContract, "id" | "contractStatus" | "contractType"> & {
  contractStatus: DormContractStatus | "자동선택";
  contractType: ContractType | "자동선택";
};

export type DormContract = {
  id: string;
  site: Site;
  address: string;
  buildingName: string;
  dong: string;
  roomHo: string;
  pyeong: string;
  capacity: number; // 기숙사 정원(동시 최대 거주 인원). 기본 6, 허용 1~99.
  landlordName: string;
  landlordPhone: string;
  realEstateName: string;
  realEstatePhone: string;
  managementOfficePhone: string;
  공동현관: string;
  세대현관: string;
  contractStart: string;
  contractEnd: string;
  contractStatus: DormContractStatus;
  contractAmount: string;
  prepaymentDeposit: string;
  deposit: string;
  monthlyRentOrMaintenance: string;
  contractType: ContractType;
  gender: Gender;
  notes: string;
  registeredBy: string;
  modifiedBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type NewHireResidenceStatus = "거주중" | "퇴실" | "연장" | "만료예정" | "대기중";
export type MoveInType = "대기자" | "신규" | "재입주" | "연장";

export type SettlementRecord = {
  id: string;
  settlementYear: string;
  settlementMonth: string;
  dormId: string;
  miscCost: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type MilitaryPersonnel = {
  id: string;
  name: string;
  rank: string;
  serviceBranch: string;
  unit: string;
  phone: string;
  birthDate: string;
  enlistmentDate: string;
  dischargeDate: string;
  calculationMode?: "auto" | "manual" | "manualAuto";
  manualCategory?: "예비군" | "민방위" | "대상아님" | "";
  manualYear?: string;
  manualBaseYear?: string; // 수동 자동증가 기준연도(이 해의 manualYear 연차에서 기준연도마다 +1)
  mobilization?: boolean;
  serviceNumber?: string; // 군번
  emergencyContact?: string; // 비상연락망
  emergencyRelation?: string; // 비상연락망(관계)
  workPhone?: string; // 직장번호
  email?: string; // E-mail
  bankName?: string; // 은행명
  accountNumber?: string; // 계좌번호
  status: string;
  notes: string;
  isDeleted?: boolean;
  deletedAt?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingRecord = {
  id: string;
  personnelId: string;
  subject: string;
  trainingType?: string;
  trainingRound?: string;
  trainingYear?: string;
  trainingDate: string;
  completionDate?: string;
  trainingHours?: number;
  location: string;
  attendees: string | number;
  status: string;
  notes: string;
  isDeleted?: boolean;
  deletedAt?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type MilitaryNotice = {
  id: string;
  personnelIds: string[];
  title: string;
  category: string;
  publishedDate: string;
  expiresDate: string;
  content: string;
  sentStatus?: string;
  createdAt: string;
  updatedAt: string;
};

export type MilitaryReport = {
  id: string;
  title: string;
  reportDate: string;
  type: string;
  author: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditChange = {
  field: string;
  label: string;
  beforeValue: string;
  afterValue: string;
};

export type AuditLog = {
  id: string;
  targetType:
    | "dorm"
    | "dormContract"
    | "newHire"
    | "occupant"
    | "inventory"
    | "defect"
    | "cleaningReport"
    | "lease"
    | "militaryPersonnel"
    | "trainingRecord"
    | "militaryNotice"
    | "militaryReport"
    | "system";
  targetId: string;
  actionType: "create" | "update" | "delete" | "restore" | "statusChange";
  changedBy: string;
  changedAt: string;
  beforeValue: string;
  afterValue: string;
  memo?: string;
  changes?: AuditChange[];
};

export type NewHireEmployee = {
  id: string;
  site: Site;
  gender: Gender;
  name: string;
  phone: string;
  department: string;
  dormId: string;
  address: string;
  buildingName: string;
  dong: string;
  roomHo: string;
  공동현관: string;
  세대현관: string;
  expectedMoveInDate: string;
  moveInDate: string;
  expectedMoveOutDate: string;
  moveOutDate: string;
  actualMoveOutDate: string;
  cheonanMoveDate: string;
  residenceStatus: NewHireResidenceStatus;
  moveInType: MoveInType;
  extensionReason: string;
  notes: string;
  managerUserId?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type SaleRecord = {
  id: string;
  saleDate: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  buyerCompany: string;
  notes: string;
  site?: Site;
};

export type CustomTemplate = {
  id: string;
  name: string;
  tableType: "dormContract" | "newHire" | "dorm" | "occupant" | "inventory" | "sale" | "cleaningReport";
  headers: string[];
  fileName: string;
  fileData: string;
  createdAt: string;
};

export type TableType = CustomTemplate["tableType"];

export type DefectRequest = {
  id: string;
  receiptDate: string;
  site: Site;
  dormId: string;
  inspectorName: string;
  dormManagerName: string;
  managerUserId: string;
  buildingName: string;
  dong: string;
  ho: string;
  공동현관: string;
  세대현관: string;
  roadAddress: string;
  detailAddress: string;
  defectStatus: "접수" | "진행중" | "완료";
  requestText: string;
  completeText: string;
  reporterUserId: string;
  reporterName: string;
  requestPhotoDataUrls: string[];
  completionPhotoDataUrls: string[];
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type CleaningReport = {
  id: string;
  reportDate: string;
  site: Site;
  dormId: string;
  buildingName: string;
  address: string;
  dong: string;
  roomHo: string;
  공동현관: string;
  세대현관: string;
  managerUserId: string;
  managerName: string;
  cleanerName: string;
  weekLabel: string;
  monthLabel: string;
  cleanStatus: "미제출" | "제출완료" | "확인완료" | "불량" | "재청소요청";
  checkResult: "O" | "X" | "-";
  score: number;
  memo: string;
  beforePhotoDataUrls: string[];
  afterPhotoDataUrls: string[];
  reporterUserId: string;
  reporterName: string;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  isPermanentDeleted?: boolean;
  permanentDeletedAt?: string;
  permanentDeletedBy?: string;
};

export type ThemeSettings = {
  accentColor: string;
  brandColor: string;
  darkMode: boolean;
  statuses: string[];
  colorMap: Record<string, string>;
};

export type CleaningSettings = {
  missingReportPenalty: number;
  includeWeekendReports: boolean;
  scoreStartDate?: string;   // 점수 계산 시작일(YYYY-MM-DD). 이 날짜 이전 기록은 점수 합계에서 제외(목록/원본은 유지).
  scoreUpdatedAt?: string;   // 기준 설정 변경 시각(감사/표시용)
  scoreUpdatedBy?: string;   // 기준 설정 변경자
};

export type TabKey =
  | "dashboard"
  | "dorms"
  | "occupants"
  | "simulation"
  | "inventory"
  | "leases"
  | "sales"
  | "dormContracts"
  | "newHires"
  | "settlementManagement"
  | "notificationManagement"
  | "documentManagement"
  | "cleaningReports"
  | "preMoveInInspection"
  | "reportManagement"
  | "settings"
  | "recycleBin"
  | "defects"
  | "users"
  | "militaryDashboard"
  | "personnelManagement"
  | "trainingRecords"
  | "militaryNotices"
  | "militaryReports"
  | "militarySettings"
  | "testChecklist";

export type SettingsSubTab = "menuManagement" | "fieldManagement" | "permissionManagement" | "codeManagement" | "screenSettings";

export type MenuItem = {
  id: string;
  groupName: string;
  menuName: string;
  tabKey: TabKey;
  isVisible: boolean;
  order: number;
  requiredRoles: UserRole[];
  subMenus?: SubMenu[];
};

export type SubMenu = {
  id: string;
  name: string;
  isVisible: boolean;
  order: number;
};

export type FieldConfig = {
  id: string;
  tabKey: TabKey;
  fieldName: string;
  fieldKey: string;
  isVisible: boolean;
  isRequired: boolean;
  isReadOnly: boolean;
  adminOnlyEdit: boolean;
  order: number;
};

export type PermissionConfig = {
  role: UserRole;
  tabKey: TabKey;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type CodeValue = {
  id: string;
  codeType: "dormStatus" | "residenceStatus" | "cleaningStatus" | "defectStatus" | "site" | "gender" | "contractStatus";
  codeKey: string;
  codeName: string;
  order: number;
  isActive: boolean;
  colorCode?: string;
};

export type ScreenSettings = {
  id: string;
  tabKey: TabKey;
  visibleColumns: string[];
  columnOrder: string[];
  defaultFilter?: Record<string, string>;
};

export type SystemSettings = {
  menus: MenuItem[];
  fields: FieldConfig[];
  permissions: PermissionConfig[];
  codeValues: CodeValue[];
  screenSettings: ScreenSettings[];
  updatedAt: string;
};