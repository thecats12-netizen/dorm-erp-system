import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bell,
  Building2,
  Camera,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  FileSpreadsheet,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Wrench,
  Save,
} from "lucide-react";
import {
  AUDIT_LOGS_KEY,
  AUTH_KEY,
  CLEANING_REPORTS_KEY,
  CLEANING_SETTINGS_KEY,
  DEFECTS_KEY,
  DORMS_KEY,
  DORM_CONTRACTS_KEY,
  INVENTORY_KEY,
  LEASES_KEY,
  MILITARY_NOTICES_KEY,
  MILITARY_PERSONNEL_KEY,
  MILITARY_REPORTS_KEY,
  MILITARY_SETTINGS_KEY,
  MILITARY_TRAINING_KEY,
  MILITARY_TRAINING_RULES_KEY,
  MILITARY_CODE_VALUES_KEY,
  MILITARY_TRAINING_AUTOCREATE_KEY,
  NEW_HIRES_KEY,
  OCCUPANTS_KEY,
  SALES_KEY,
  SETTLEMENT_RECORDS_KEY,
  SYSTEM_SETTINGS_KEY,
  THEME_KEY,
  USERS_KEY,
  CUSTOM_TEMPLATES_KEY,
  loadJson,
  migrateLocalStorageKeys,
  removeJson,
  saveJson,
} from "./services/storageService";
import {
  isSupabaseAvailable,
  loadMilitaryModule,
  saveMilitaryModule,
  type MilitaryModuleState,
} from "./services/supabaseService";
import {
  loadDormModule,
  saveDormModule,
} from "./services/dormSupabaseService";
import {
  loadOperationalModule,
  saveOperationalModule,
} from "./services/operationalSupabaseService";
import {
  signInWithEmail,
  signOut as supabaseSignOut,
  getCurrentSession,
  getCurrentAuthUser,
  getProfile,
  updateProfileOnly,
  createUserViaEdgeFunction,
  type Profile,
} from "./services/authService";
import { createAuditLogEntry, getChangedFields } from "./services/auditService";
import { usePersistedState } from "./hooks/usePersistedState";
import { DateFilter } from "./components";
import { themeDefault } from "./constants/defaultData";
import {
  getDefaultSystemSettings,
  mergeMenus,
  useSavedOrDefaultArray,
} from "./constants/systemSettings";
import { TABLE_TYPE_BY_TAB } from "./constants/excelHeaders";
import { formatDong, formatRoomHo, stripDongHoSuffix } from "./utils/formatUtils";
import {
  normalizeExcelRow,
  getWorksheetHeaders,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "./utils/excelUtils";
import { mapRowToTemplateHeaders, parseExcelDate } from "./services/excelService";
import type {
  AuditLog,
  CleaningReport,
  CleaningSettings,
  CodeValue,
  ContractType,
  CustomTemplate,
  DefectRequest,
  Dorm,
  DormContract,
  DormContractFormState,
  DormContractStatus,
  FieldConfig,
  Gender,
  LeaseContract,
  MilitaryNotice,
  MilitaryPersonnel,
  MilitaryReport,
  MoveInType,
  NewHireEmployee,
  NewHireResidenceStatus,
  Occupant,
  PermissionConfig,
  SaleRecord,
  SettlementRecord,
  ScreenSettings,
  SettingsSubTab,
  Site,
  SystemSettings,
  TableType,
  TabKey,
  ThemeSettings,
  TrainingRecord,
  UserRole,
  LoginUser,
  InventoryItem,
  OperationalDorm,
} from "./types";

declare global {
  interface Window {
    daum: any;
  }
}

function mapProfileToLoginUser(profile: Profile, authUserEmail?: string): LoginUser {
  return {
    id: profile.id,
    username: profile.email || profile.display_name || authUserEmail || profile.id,
    password: "",
    role: (profile.role || "viewer") as UserRole,
    displayName: profile.display_name || profile.email || "",
    isActive: profile.is_active ?? true,
    siteAccess: profile.site_access || "전체",
    genderAccess: profile.gender_access || "전체",
    createdAt: profile.created_at || new Date().toISOString(),
    dormId: profile.dorm_id || undefined,
  } as LoginUser;
}

function openAddressSearch(onSelected: (roadAddress: string) => void) {
  if (!window.daum?.Postcode) {
    alert("주소검색 스크립트가 아직 로드되지 않았습니다.");
    return;
  }

  new window.daum.Postcode({
    oncomplete: function (data: any) {
      onSelected(data.roadAddress || "");
    },
  }).open();
}

/**
 * v4 통합 운영 대시보드
 *
 * 구현 범위
 * - 관리자 / 조회전용 / 기숙사관리자 / 하자접수 전용 계정
 * - 기숙사별 관리자 1명 설정
 * - 기숙사당 최대 6명 제한
 * - 기숙사 기본정보 / 입주자 / 입실일 관리
 * - 연도별 임차현황 / 비품현황 / 신규계약 / 비품매각 / 하자접수 / 운영시뮬레이션 탭
 * - 만료일 근접 주소 TOP 10
 * - 하자접수 텍스트 + 사진 첨부(base64)
 * - localStorage 저장
 */

const parseSafeDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
};

const getRoleLabel = (role: UserRole) => {
  switch (role) {
    case "admin": return "관리자";
    case "viewer": return "뷰어";
    case "dorm_manager": return "하자처리 담당자";
    case "maintenance_reporter": return "기숙사 관리자";
  }
};

const getRoleValue = (label: string): UserRole => {
  switch (label) {
    case "관리자": return "admin";
    case "뷰어": return "viewer";
    case "하자처리 담당자": return "dorm_manager";
    case "기숙사 관리자": return "maintenance_reporter";
    default: return "viewer";
  }
};

const getTabLabel = (tabKey: TabKey) => {
  switch (tabKey) {
    case "dashboard": return "대시보드";
    case "dorms": return "기숙사";
    case "occupants": return "입주자";
    case "simulation": return "운영시뮬레이션";
    case "inventory": return "비품현황";
    case "leases": return "임차현황";
    case "sales": return "비품매각";
    case "dormContracts": return "신규계약";
    case "newHires": return "신입사원";
    case "settlementManagement": return "정산관리";
    case "notificationManagement": return "알림관리";
    case "documentManagement": return "문서관리";
    case "cleaningReports": return "청소관리";
    case "reportManagement": return "보고서";
    case "settings": return "시스템설정";
    case "defects": return "하자접수";
    case "users": return "사용자관리";
    case "militaryDashboard": return "군인대시보드";
    case "personnelManagement": return "인사관리";
    case "trainingRecords": return "훈련기록";
    case "militaryNotices": return "공지사항";
    case "militaryReports": return "군대보고서";
    case "militarySettings": return "군대설정";
    case "testChecklist": return "테스트체크리스트";
    default: return tabKey;
  }
};

const getDormKey = (site: string, buildingName: string, dong: string, roomHo: string) =>
  `${site.trim().toLowerCase()}|${buildingName.trim().toLowerCase()}|${stripDongHoSuffix(dong).toLowerCase()}|${stripDongHoSuffix(roomHo).toLowerCase()}`;

const SETTLEMENT_ITEMS_KEY = "settlementItems";

type SettlementItemCategory = "장충금" | "홈클린" | "하자복구" | "비품구매" | "비품매각" | "시설파손" | "기타";
type SettlementBurdenType = "회사지급" | "거주자부담" | "회사환급" | "거주자환급";

type SettlementItem = {
  id: string;
  settlementYear: string;
  settlementMonth: string;
  dormId: string;
  category: SettlementItemCategory;
  details: string;
  amount: number;
  burdenType: SettlementBurdenType;
  targetName: string;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

type SettlementItemFormState = {
  dormId: string;
  category: SettlementItemCategory;
  details: string;
  amount: string;
  burdenType: SettlementBurdenType;
  targetName: string;
  memo: string;
};

const settlementItemCategories: SettlementItemCategory[] = ["장충금", "홈클린", "하자복구", "비품구매", "비품매각", "시설파손", "기타"];
const settlementBurdenTypes: SettlementBurdenType[] = ["회사지급", "거주자부담", "회사환급", "거주자환급"];

function settlementItemTemplate(): SettlementItemFormState {
  return {
    dormId: "",
    category: "장충금",
    details: "",
    amount: "",
    burdenType: "회사지급",
    targetName: "",
    memo: "",
  };
}

function loadSystemSettings(raw?: string | null, tenantId = "default"): SystemSettings {
  const defaults = getDefaultSystemSettings();
  if (!raw) {
    saveJson(SYSTEM_SETTINGS_KEY, defaults, tenantId);
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SystemSettings> | null;
    if (!parsed || typeof parsed !== "object") {
      saveJson(SYSTEM_SETTINGS_KEY, defaults, tenantId);
      return defaults;
    }

    const merged: SystemSettings = {
      menus: mergeMenus(parsed.menus, defaults.menus),
      fields: useSavedOrDefaultArray<FieldConfig>(parsed.fields, defaults.fields),
      permissions: useSavedOrDefaultArray<PermissionConfig>(parsed.permissions, defaults.permissions),
      codeValues: useSavedOrDefaultArray<CodeValue>(parsed.codeValues, defaults.codeValues),
      screenSettings: useSavedOrDefaultArray<ScreenSettings>(parsed.screenSettings, defaults.screenSettings),
      updatedAt: new Date().toISOString(),
    };

    saveJson(SYSTEM_SETTINGS_KEY, merged, tenantId);
    return merged;
  } catch {
    saveJson(SYSTEM_SETTINGS_KEY, defaults, tenantId);
    return defaults;
  }
}

function runLegacyLocalStorageMigration(tenantId = "default"): void {
  migrateLocalStorageKeys([
    { oldKey: "military-personnel-v1", newKey: MILITARY_PERSONNEL_KEY },
    { oldKey: "military-training-v1", newKey: MILITARY_TRAINING_KEY },
    { oldKey: "military-notices-v1", newKey: MILITARY_NOTICES_KEY },
    { oldKey: "military-reports-v1", newKey: MILITARY_REPORTS_KEY },
    { oldKey: "military-settings-v1", newKey: MILITARY_SETTINGS_KEY },
    { oldKey: "dorm-system-settings-v1", newKey: SYSTEM_SETTINGS_KEY },
  ], tenantId);
}

function getSafeUsers(): LoginUser[] {
  try {
    const parsed = loadJson<LoginUser[]>(USERS_KEY, []);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const valid = parsed.filter(
      (u: any) =>
        u &&
        typeof u.username === "string" &&
        typeof u.password === "string" &&
        typeof u.role === "string"
    );

    return valid;
  } catch {
    return [];
  }
}


function occupantTemplate(): Omit<Occupant, "id" | "createdAt" | "updatedAt"> {
  return {
    dormId: "",
    site: "평택",
    employeeName: "",
    gender: "남",
    department: "",
    phone: "",
    moveInDate: "",
    moveOutDueDate: "",
    status: "대기중",
    isNewHireAssignment: false,
    notes: "",
    expectedMoveInDate: "",
    expectedMoveOutDate: "",
    actualMoveOutDate: "",
    sourceNewHireId: undefined,
  };
}

function dormContractTemplate(): DormContractFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    site: "평택",
    address: "",
    buildingName: "",
    dong: "",
    roomHo: "",
    pyeong: "",
    landlordName: "",
    landlordPhone: "",
    realEstateName: "",
    realEstatePhone: "",
    공동현관: "",
    세대현관: "",
    contractStart: "",
    contractEnd: "",
    contractStatus: "자동선택",
    contractAmount: "",
    prepaymentDeposit: "",
    deposit: "",
    monthlyRentOrMaintenance: "",
    contractType: "자동선택",
    gender: "남",
    notes: "",
    registeredBy: "",
    modifiedBy: "",
    createdAt: today,
    updatedAt: today,
  };
}

type NewHireFormState = Omit<NewHireEmployee, "id" | "residenceStatus" | "moveInType"> & {
  residenceStatus: NewHireResidenceStatus | "자동선택";
  moveInType: MoveInType | "자동선택";
};

type DormContractFormLike = Omit<Partial<DormContract>, "contractStatus" | "contractType"> & {
  contractStatus?: DormContractStatus | "자동선택";
  contractType?: ContractType | "자동선택";
};

type NewHireFormLike = Omit<Partial<NewHireEmployee>, "residenceStatus" | "moveInType"> & {
  residenceStatus?: NewHireResidenceStatus | "자동선택";
  moveInType?: MoveInType | "자동선택";
};

function newHireTemplate(): NewHireFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    site: "평택",
    gender: "남",
    name: "",
    phone: "",
    department: "",
    dormId: "",
    address: "",
    buildingName: "",
    dong: "",
    roomHo: "",
    공동현관: "",
    세대현관: "",
    expectedMoveInDate: "",
    moveInDate: "",
    expectedMoveOutDate: "",
    moveOutDate: "",
    actualMoveOutDate: "",
    cheonanMoveDate: "",
    residenceStatus: "대기중",
    moveInType: "대기자",
    extensionReason: "",
    notes: "",
    createdAt: today,
    updatedAt: today,
  };
}

function dormTemplate(): Omit<Dorm, "id" | "createdAt" | "updatedAt"> {
  return {
    site: "평택",
    gender: "남",
    buildingName: "",
    address: "",
    dong: "",
    roomHo: "",
    pyeong: "",
    capacity: 6,
    managerUserId: "",
    contractStart: "",
    contractEnd: "",
    contractAmount: "",
    leaseStatus: "사용중",
    공동현관: "",
    세대현관: "",
    prepaymentDeposit: 0,
    realEstateName: "",
    balanceDate: "",
    notes: "",
  };
}

function inventoryTemplate(): Omit<InventoryItem, "id" | "createdAt"> {
  return {
    dormId: "",
    site: "평택",
    dormAddress: "",
    buildingName: "",
    dong: "",
    roomHo: "",
    managerName: "",
    itemName: "",
    quantity: 1,
    modelName: "",
    maker: "",
    status: "정상",
    installationLocation: "",
    purchaseDate: "",
    purchaseAmount: 0,
    issuedDate: "",
    proofFile: "",
    soldDate: "",
    soldAmount: 0,
    disposalDate: "",
    disposalReason: "",
    notes: "",
    updatedAt: "",
  };
}

function leaseTemplate(): Omit<LeaseContract, "id"> {
  return {
    dateKey: "",
    addressName: "",
    dong: "",
    ho: "",
    pyeong: "",
    contractAmount: "",
    contractPeriod: "",
    contractDate: "",
    prepaymentDeposit: 0,
    realEstateName: "",
    notes: "",
    balanceDate: "",
    site: "평택",
    gender: "남",
    updatedAt: "",
  };
}

function saleTemplate(): Omit<SaleRecord, "id"> {
  return {
    saleDate: "",
    itemName: "",
    unitPrice: 0,
    quantity: 1,
    totalAmount: 0,
    buyerCompany: "",
    notes: "",
  };
}

function defectTemplate(): Omit<DefectRequest, "id" | "createdAt"> {
  return {
    receiptDate: new Date().toISOString().slice(0, 10),
    site: "평택",
    dormId: "",
    inspectorName: "",
    dormManagerName: "",
    managerUserId: "",
    buildingName: "",
    dong: "",
    ho: "",
    공동현관: "",
    세대현관: "",
    roadAddress: "",
    detailAddress: "",
    defectStatus: "접수",
    requestText: "",
    completeText: "",
    reporterUserId: "",
    reporterName: "",
    requestPhotoDataUrls: [],
    completionPhotoDataUrls: [],
    completedAt: undefined,
  };
}

function cleaningReportTemplate(): Omit<CleaningReport, "id" | "createdAt" | "updatedAt"> {
  const today = new Date().toISOString().slice(0, 10);
  const weekLabel = `${new Date().getFullYear()}-${String(Math.ceil((new Date().getDate() + 6) / 7)).padStart(2, "0")}`;
  const monthLabel = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  return {
    reportDate: today,
    site: "평택",
    dormId: "",
    buildingName: "",
    address: "",
    dong: "",
    roomHo: "",
    공동현관: "",
    세대현관: "",
    managerUserId: "",
    managerName: "",
    cleanerName: "",
    weekLabel,
    monthLabel,
    cleanStatus: "미제출",
    checkResult: "-",
    score: 0,
    memo: "",
    beforePhotoDataUrls: [],
    afterPhotoDataUrls: [],
    reporterUserId: "",
    reporterName: "",
    confirmedBy: undefined,
    confirmedAt: undefined,
  };
}

function userTemplate(): Omit<LoginUser, "id" | "createdAt"> {
  return {
    username: "",
    password: "",
    role: "viewer",
    displayName: "",
    isActive: true,
    siteAccess: "전체",
    genderAccess: "전체",
    roadAddress: "",
    buildingName: "",
    dong: "",
    roomHo: "",
    공동현관: "",
    세대현관: "",
    manualActiveOverride: false,
    dormId: "",
  };
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR").format(n || 0);
}

function formatDateOnly(value: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function clearWorksheetRowsAfterHeader(worksheet: XLSX.WorkSheet, headerRowIndex = 0) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  for (let row = headerRowIndex + 1; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      delete worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
    }
  }
}

function daysDiff(dateText: string) {
  if (!dateText) return Number.POSITIVE_INFINITY;
  const target = new Date(dateText).getTime();
  const now = new Date().getTime();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function getAge(birthDate: string, referenceDate?: Date) {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = referenceDate ? new Date(referenceDate) : new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) {
    age -= 1;
  }
  return age;
}

function getMilitaryCategory(person: MilitaryPersonnel, referenceYear?: number) {
  if (person.calculationMode === "manual" && person.manualCategory) {
    return person.manualCategory as "예비군" | "민방위" | "대상아님";
  }
  const branch = person.serviceBranch?.toLowerCase() || "";
  const status = person.status?.toLowerCase() || "";
  const referenceDate = referenceYear ? new Date(referenceYear, 11, 31) : new Date();
  const age = getAge(person.birthDate || "", referenceDate);

  const dischargeDate = person.dischargeDate ? new Date(person.dischargeDate) : null;

  if (!dischargeDate || Number.isNaN(dischargeDate.getTime())) {
    if (/민방위|civil/i.test(branch) || /민방위|civil/i.test(status)) {
      return "민방위" as const;
    }
    return "대상아님" as const;
  }

  if (dischargeDate > referenceDate) {
    return "대상아님" as const;
  }

  const serviceYear = referenceDate.getFullYear() - dischargeDate.getFullYear() + 1;
  if (serviceYear >= 1 && serviceYear <= 8) {
    return "예비군" as const;
  }

  if (serviceYear > 8) {
    if (age !== null && age >= 19 && age <= 59) {
      return "민방위" as const;
    }
    return "대상아님" as const;
  }

  if (/민방위|civil/i.test(branch) || /민방위|civil/i.test(status)) {
    return "민방위" as const;
  }

  return "대상아님" as const;
}

function getTrainingYear(person: MilitaryPersonnel, referenceYear?: number) {
  if (person.calculationMode === "manual" && person.manualYear) {
    return Number(person.manualYear) || 0;
  }
  if (!person.dischargeDate) return 0;
  const dischargeDate = new Date(person.dischargeDate);
  if (Number.isNaN(dischargeDate.getTime())) return 0;
  const effectiveYear = referenceYear ?? new Date().getFullYear();
  return effectiveYear - dischargeDate.getFullYear() + 1;
}

function getReserveAnnualLeave(person: MilitaryPersonnel, referenceYear?: number) {
  if (getMilitaryCategory(person, referenceYear) !== "예비군") return 0;
  const years = getTrainingYear(person, referenceYear);
  if (!years) return 0;
  return Math.max(1, Math.min(15 + (years - 1), 25));
}

function getCivilDefenseAnnualLeave(person: MilitaryPersonnel, referenceYear?: number) {
  if (getMilitaryCategory(person, referenceYear) !== "민방위") return 0;
  const age = getAge(person.birthDate || "", referenceYear ? new Date(referenceYear, 11, 31) : undefined);
  if (age === null) return 0;
  return Math.max(1, age - 18);
}

function getRequiredTraining(person: MilitaryPersonnel, referenceYear?: number) {
  const category = getMilitaryCategory(person, referenceYear);
  if (category === "예비군") {
    const serviceYear = getTrainingYear(person, referenceYear);
    if (!serviceYear) {
      return { label: "자동판정불가", hours: 0 };
    }
    if (serviceYear >= 1 && serviceYear <= 4) {
      return { label: "동원훈련 또는 동미참훈련", hours: 28 };
    }
    if (serviceYear >= 5 && serviceYear <= 6) {
      return { label: "기본훈련 + 작계훈련", hours: 14 };
    }
    if (serviceYear >= 7 && serviceYear <= 8) {
      return { label: "훈련없음", hours: 0 };
    }
    return { label: "예비군 대상아님", hours: 0 };
  }
  if (category === "민방위") {
    return { label: "민방위교육", hours: 4 };
  }
  return { label: "교육대상아님", hours: 0 };
}

function calculateDormContractStatus(contract: DormContractFormLike, dorms: Dorm[], occupants: Occupant[]): DormContractStatus {
  const today = new Date().toISOString().slice(0, 10);
  const contractStart = contract.contractStart || "";
  const contractEnd = contract.contractEnd || "";

  const dorm = dorms.find(
    (d) =>
      d.address === contract.address &&
      d.buildingName === contract.buildingName &&
      d.dong === contract.dong &&
      d.roomHo === contract.roomHo
  );

  const occupantCount = dorm
    ? occupants.filter(
        (o) =>
          o.dormId === dorm.id && ["거주중", "만료예정", "신규입주"].includes(o.status)
      ).length
    : 0;

  if (contract.contractStatus === "해지") return "해지";
  if (contract.contractStatus === "종료") return "종료";
  if (contractEnd && contractEnd < today) return "연장";
  if (contractEnd && daysDiff(contractEnd) <= 30) return "만료예정";
  if (contractStart && contractStart <= today) return occupantCount > 0 ? "진행중" : "공실";
  return "공실";
}

function getDormContractDisplayStatus(contract: DormContract, _dorms: Dorm[], _occupants: Occupant[]): DormContractStatus {
  if ((contract as any).contractStatus === "자동선택") {
    return calculateDormContractStatus(contract as any, _dorms, _occupants);
  }
  return contract.contractStatus;
}

function calculateNewHireResidenceStatus(employee: NewHireFormLike): NewHireResidenceStatus {
  const today = new Date().toISOString().slice(0, 10);
  const moveInDate = employee.moveInDate || "";
  const moveOutDate = employee.moveOutDate || "";
  const expectedMoveOutDate = employee.expectedMoveOutDate || "";
  const actualMoveOutDate = employee.actualMoveOutDate || "";
  const hasAddressInfo = Boolean(employee.buildingName?.trim() && employee.dong?.trim() && employee.roomHo?.trim());

  const endDate = moveOutDate || expectedMoveOutDate;

  if (!hasAddressInfo || !moveInDate) return "대기중";
  if (actualMoveOutDate && actualMoveOutDate <= today) return "퇴실";
  if (endDate && endDate < today && !actualMoveOutDate) return "연장";
  if (endDate && daysDiff(endDate) <= 30) return "만료예정";
  if (moveInDate && moveInDate <= today) return "거주중";
  return "대기중";
}

function calculateMoveInType(
  employee: NewHireFormLike,
  allEmployees: NewHireEmployee[]
): MoveInType {
  const hasAddressInfo = Boolean(employee.buildingName?.trim() && employee.dong?.trim() && employee.roomHo?.trim());
  if (!hasAddressInfo) return "대기자";

  const previousRecords = allEmployees
    .filter((e) => e.id !== employee.id && e.name === employee.name && e.phone === employee.phone)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (previousRecords.length === 0) return "신규";

  const last = previousRecords[previousRecords.length - 1];
  const currentMoveInDate = employee.moveInDate || "";
  const lastEndDate = last.moveOutDate || last.expectedMoveOutDate || "";

  if (!currentMoveInDate) return "재입주";
  if (
    lastEndDate &&
    currentMoveInDate === addDays(lastEndDate, 1) &&
    employee.buildingName === last.buildingName &&
    employee.dong === last.dong &&
    employee.roomHo === last.roomHo
  ) {
    return "연장";
  }

  return "재입주";
}

function addDays(dateText: string, days: number) {
  if (!dateText) return "";
  const date = new Date(dateText);
  if (Number.isNaN(date.valueOf())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function calculateDormContractType(
  contract: DormContractFormLike,
  dormContracts: DormContract[],
  editingId: string | null
): ContractType {
  const sameContracts = dormContracts
    .filter(
      (c) =>
        c.id !== editingId &&
        c.address === contract.address &&
        c.buildingName === contract.buildingName &&
        c.dong === contract.dong &&
        c.roomHo === contract.roomHo
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (sameContracts.length === 0) return "신규";
  const last = sameContracts[sameContracts.length - 1];
  if (!contract.contractStart) return "신규";
  const lastEnd = last.contractEnd || "";

  if (last.contractStatus === "해지" && contract.contractStart > lastEnd) return "해지후신규";

  const sameTerms =
    last.landlordName === contract.landlordName &&
    last.landlordPhone === contract.landlordPhone &&
    last.realEstateName === contract.realEstateName &&
    last.realEstatePhone === contract.realEstatePhone &&
    last.contractAmount === contract.contractAmount &&
    last.prepaymentDeposit === contract.prepaymentDeposit &&
    last.deposit === contract.deposit &&
    last.monthlyRentOrMaintenance === contract.monthlyRentOrMaintenance;

  const contiguous = contract.contractStart === addDays(lastEnd, 1);
  if (contiguous && sameTerms) return "연장";
  if (!sameTerms) return "재계약";
  return "재계약";
}

function daysBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

function badgeColor(theme: ThemeSettings, value: string) {
  return theme.colorMap[value] || "#E5E7EB";
}

type MilitaryTrainingRule = {
  id: string;
  year: string;
  currentCategory: string;
  yearMin: string;
  yearMax: string;
  mobilizationOnly: boolean;
  trainingType: string;
  requiredHours: string;
  mandatory: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  enabled: boolean;
};

type MilitaryCodeValues = {
  departments: string[];
  employmentStatus: string[];
  militaryCategory: string[];
  mobilizationStatus: string[];
  trainingType: string[];
  trainingRound: string[];
  trainingStatus: string[];
};

const defaultMilitaryTrainingRules: MilitaryTrainingRule[] = [
  {
    id: "rule-reserve-1-4-mobilized",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "1",
    yearMax: "4",
    mobilizationOnly: true,
    trainingType: "동원훈련",
    requiredHours: "28",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
  {
    id: "rule-reserve-1-4-nonmobilized",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "1",
    yearMax: "4",
    mobilizationOnly: false,
    trainingType: "동미참훈련",
    requiredHours: "32",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
  {
    id: "rule-reserve-5-6-basic",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "5",
    yearMax: "6",
    mobilizationOnly: false,
    trainingType: "기본훈련",
    requiredHours: "8",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
  {
    id: "rule-reserve-5-6-plan",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "5",
    yearMax: "6",
    mobilizationOnly: false,
    trainingType: "작계훈련",
    requiredHours: "6",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
  {
    id: "rule-reserve-7-8-none",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "7",
    yearMax: "8",
    mobilizationOnly: false,
    trainingType: "훈련없음",
    requiredHours: "0",
    mandatory: false,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
  {
    id: "rule-civil-defense",
    year: new Date().getFullYear().toString(),
    currentCategory: "민방위",
    yearMin: "1",
    yearMax: "99",
    mobilizationOnly: false,
    trainingType: "민방위교육",
    requiredHours: "4",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  },
];

const defaultMilitaryCodeValues: MilitaryCodeValues = {
  departments: [
    "F-P&C/Photo",
    "F-CVD",
    "D-CVD",
    "D-CMP",
    "F-Metal",
    "F-IMP",
    "F-P&C/Clean",
    "F-CMP",
    "D-IMP",
    "D-Metal",
    "D-DIFF",
    "F-DIFF",
    "D-P&C/Clean",
    "D-P&C/Photo",
    "F-ETCH/LAM",
    "F-ETCH/TAS",
    "D-Etch/LA",
    "D-ETCH/TS",
    "CLEAN",
    "DIFF",
    "CVD",
    "METAL",
    "CMP",
    "IMP",
    "지원",
  ],
  employmentStatus: ["재직", "신규입사", "전배", "복직", "전출", "휴직", "퇴사"],
  militaryCategory: ["예비군", "민방위", "대상아님"],
  mobilizationStatus: ["동원", "동원미지정"],
  trainingType: ["동원훈련", "동미참훈련", "기본훈련", "작계훈련", "민방위교육"],
  trainingRound: ["1차", "2차", "3차", "4차"],
  trainingStatus: ["완료", "미이수", "진행중", "예정"],
};

const legacyMilitaryDepartments = ["경영지원", "운영", "보안", "시설"];

function normalizeMilitaryDepartments(departments: string[] = []) {
  const loaded = Array.isArray(departments) ? departments : [];
  const customDepartments = loaded.filter((dept) => !legacyMilitaryDepartments.includes(dept));
  return Array.from(new Set([...defaultMilitaryCodeValues.departments, ...customDepartments]));
}

function canEditData(user: LoginUser | null) {
  return !!user && user.role === "admin";
}

function canManageUsers(user: LoginUser | null) {
  return !!user && user.role === "admin";
}

function canFileDefect(user: LoginUser | null) {
  return !!user && ["admin", "maintenance_reporter"].includes(user.role);
}

export default function App() {
  const [theme, setTheme] = useState<ThemeSettings>(themeDefault);
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [dorms, setDorms] = useState<Dorm[]>([]);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [leases, setLeases] = useState<LeaseContract[]>([]);
  const [dormContracts, setDormContracts] = useState<DormContract[]>([]);
  const [cleaningReports, setCleaningReports] = useState<CleaningReport[]>([]);
  const [newHires, setNewHires] = useState<NewHireEmployee[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [defects, setDefects] = useState<DefectRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [militaryPersonnel, setMilitaryPersonnel] = useState<MilitaryPersonnel[]>([]);
  const [militaryTrainingRecords, setMilitaryTrainingRecords] = useState<TrainingRecord[]>([]);
  const [militaryNotices, setMilitaryNotices] = useState<MilitaryNotice[]>([]);
  const [militaryReports, setMilitaryReports] = useState<MilitaryReport[]>([]);
  const [militarySettings, setMilitarySettings] = useState<Record<string, string>>({});
  const [militaryTrainingRules, setMilitaryTrainingRules] = useState<any[]>([]);
  const [militaryCodeValues, setMilitaryCodeValues] = useState<MilitaryCodeValues>(defaultMilitaryCodeValues);
  const [militaryTrainingAutoConfig, setMilitaryTrainingAutoConfig] = useState<{ enabled: boolean; targetStatuses: string[] }>({ enabled: true, targetStatuses: ["재직"] });
  const militaryReferenceYear = Number(militarySettings["기준연도"]);
  const effectiveMilitaryReferenceYear = Number.isInteger(militaryReferenceYear) && militaryReferenceYear > 0 ? militaryReferenceYear : undefined;
  const [militaryTrainingRuleForm, setMilitaryTrainingRuleForm] = useState<MilitaryTrainingRule>({
    id: "",
    year: new Date().getFullYear().toString(),
    currentCategory: "예비군",
    yearMin: "1",
    yearMax: "4",
    mobilizationOnly: false,
    trainingType: "동원훈련",
    requiredHours: "28",
    mandatory: true,
    effectiveFrom: "",
    effectiveTo: "",
    enabled: true,
  });
  const [editingMilitaryTrainingRuleId, setEditingMilitaryTrainingRuleId] = useState<string | null>(null);
  const [codeValueCategory, setCodeValueCategory] = useState<keyof MilitaryCodeValues>("departments");
  const [codeValueInput, setCodeValueInput] = useState("");
  const [currentUser, setCurrentUser] = useState<LoginUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [expandedMenu, setExpandedMenu] = useState<string | null>("dashboard");
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [statsSectionExpanded, setStatsSectionExpanded] = useState(true);
  const [settlementYear, setSettlementYear] = useState(() => new Date().getFullYear().toString());
  const [settlementMonth, setSettlementMonth] = useState(() => (new Date().getMonth() + 1).toString().padStart(2, "0"));
  const currentSettlementYear = new Date().getFullYear().toString();
  const currentSettlementMonth = (new Date().getMonth() + 1).toString().padStart(2, "0");
  const [settlementSiteFilter, setSettlementSiteFilter] = useState<Site | "전체">("전체");
  const [settlementGenderFilter, setSettlementGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [settlementSearch, setSettlementSearch] = useState("");
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [settlementItems, setSettlementItems] = useState<SettlementItem[]>([]);
  const [settlementSubTab, setSettlementSubTab] = useState<"monthly" | "dormReport" | "itemEntry">("monthly");
  const [selectedSettlementItemId, setSelectedSettlementItemId] = useState<string | null>(null);
  const [settlementItemForm, setSettlementItemForm] = useState<SettlementItemFormState>(settlementItemTemplate());
  const [settlementShowUnpaid, setSettlementShowUnpaid] = useState(false);
  const [inventorySubTab, setInventorySubTab] = useState<"status" | "manage" | "history">("status");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin1234" });
  const [loginError, setLoginError] = useState("");
  const [_search, _setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [_siteFilter, _setSiteFilter] = useState<Site | "전체">("전체");
  const [selectedDormId, setSelectedDormId] = useState<string>("");
  const [selectedDormDetailId, setSelectedDormDetailId] = useState<string>("");
  const clickTimerRef = useRef<number | null>(null);
  const [selectedDormIds, setSelectedDormIds] = useState<string[]>([]);
  const [selectedOccupantIds, setSelectedOccupantIds] = useState<string[]>([]);
  const [selectedDormContractIds, setSelectedDormContractIds] = useState<string[]>([]);
  const [selectedNewHireIds, setSelectedNewHireIds] = useState<string[]>([]);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<string[]>([]);
  const [selectedLeaseIds, setSelectedLeaseIds] = useState<string[]>([]);
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);
  const [selectedDefectIds, setSelectedDefectIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [dormSearch, setDormSearch] = useState("");
  const [dormSiteFilter, setDormSiteFilter] = useState<Site | "전체">("전체");
  const [dormGenderFilter, setDormGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [occupantSearch, setOccupantSearch] = useState("");
  const [occupantSiteFilter, setOccupantSiteFilter] = useState<Site | "전체">("전체");
  const [occupantGenderFilter, setOccupantGenderFilter] = useState<Gender | "전체">("전체");
  const [occupantStatusFilter, setOccupantStatusFilter] = useState<string>("전체");
  const [occupantMenuFilterSite, setOccupantMenuFilterSite] = useState<Site | "전체">("전체");
  const [occupantMenuFilterGender, setOccupantMenuFilterGender] = useState<"남" | "여" | "전체">("전체");
  const [occupantMenuFilterStatus, setOccupantMenuFilterStatus] = useState<"전체" | "배정완료" | "퇴실자" | "미배정">("전체");
  const [occupantMenuFilterSearch, setOccupantMenuFilterSearch] = useState("");

  useEffect(() => {
    if (false) {
      setOccupantSearch(occupantSearch);
      setOccupantSiteFilter(occupantSiteFilter);
      setOccupantGenderFilter(occupantGenderFilter);
      setOccupantStatusFilter(occupantStatusFilter);
    }
  }, [occupantSearch, occupantSiteFilter, occupantGenderFilter, occupantStatusFilter]);

  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryYearFilter, setInventoryYearFilter] = useState<string>("전체");
  const [inventoryMonthFilter, setInventoryMonthFilter] = useState<string>("전체");
  const [inventoryDayFilter, setInventoryDayFilter] = useState<string>("전체");
  const [leaseSearch, setLeaseSearch] = useState("");
  const [leaseYearFilter, setLeaseYearFilter] = useState<string>("전체");
  const [leaseMonthFilter, setLeaseMonthFilter] = useState<string>("전체");
  const [leaseDayFilter, setLeaseDayFilter] = useState<string>("전체");
  const [saleSearch, setSaleSearch] = useState("");
  const [saleYear, setSaleYear] = useState("");
  const [saleMonth, setSaleMonth] = useState("");
  const [defectSearch, setDefectSearch] = useState("");
  const [defectStatusFilter, setDefectStatusFilter] = useState<"전체" | "접수" | "진행중" | "완료">("전체");
  const [cleaningYear, setCleaningYear] = useState(new Date().getFullYear().toString());
  const [cleaningMonth, setCleaningMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [cleaningDormSiteFilter, setCleaningDormSiteFilter] = useState<Site | "전체">("전체");
  const [cleaningDormSearch, setCleaningDormSearch] = useState("");
  const [cleaningManagerFilter, setCleaningManagerFilter] = useState<string>("전체");
  const [cleaningStatusFilter, setCleaningStatusFilter] = useState<string>("전체");
  const [cleaningSettings, setCleaningSettings] = useState<CleaningSettings>({
    missingReportPenalty: -5,
    includeWeekendReports: false,
  });
  const [showCleaningReportForm, setShowCleaningReportForm] = useState(false);
  const [editingCleaningReportId, setEditingCleaningReportId] = useState<string | null>(null);
  const [cleaningReportForm, setCleaningReportForm] = useState<Omit<CleaningReport, "id" | "createdAt" | "updatedAt">>(cleaningReportTemplate());
  const [dashboardSearch, _setDashboardSearch] = useState("");
  const [dashboardSiteFilter, _setDashboardSiteFilter] = useState<Site | "전체">("전체");
  const [dashboardStatusFilter, _setDashboardStatusFilter] = useState<string>("전체");
  const [_simulationBaseDate, _setSimulationBaseDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [simulationYear, setSimulationYear] = useState<string>(new Date().getFullYear().toString());
  const [simulationMonth, setSimulationMonth] = useState<string>((new Date().getMonth() + 1).toString().padStart(2, "0"));
  const [dormContractSearch, setDormContractSearch] = useState("");
  const [dormContractSiteFilter, setDormContractSiteFilter] = useState<Site | "전체">("전체");
  const [dormContractStatusFilter, setDormContractStatusFilter] = useState<DormContractStatus | "전체">("전체");
  const [newHireSearch, setNewHireSearch] = useState("");
  const [newHireSiteFilter, setNewHireSiteFilter] = useState<Site | "전체">("전체");
  const [newHireGenderFilter, setNewHireGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [newHireAssignmentFilter, setNewHireAssignmentFilter] = useState<"전체" | "배정완료" | "미배정">("전체");
  const [simulationSearch, setSimulationSearch] = useState("");
  const [simulationSiteFilter, setSimulationSiteFilter] = useState<Site | "전체">("전체");
  const [simulationGenderFilter, setSimulationGenderFilter] = useState<"남" | "여" | "전체">("전체");
  // Reports filters (연도/월/지역/성별)
  const [reportYear, setReportYear] = useState<string>(new Date().getFullYear().toString());
  const [reportMonth, setReportMonth] = useState<string>(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [reportSiteFilter, setReportSiteFilter] = useState<Site | "전체">("전체");
  const [reportGenderFilter, setReportGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [militaryPersonnelSearch, setMilitaryPersonnelSearch] = useState("");
  const [militaryPersonnelStatusFilter, setMilitaryPersonnelStatusFilter] = useState<"전체" | string>("전체");
  const [militaryTrainingSearch, setMilitaryTrainingSearch] = useState("");
  const [militaryTrainingStatusFilter, setMilitaryTrainingStatusFilter] = useState<"전체" | string>("전체");
  const [militaryTrainingYearFilter, setMilitaryTrainingYearFilter] = useState<string>("전체");
  const [militaryTrainingPersonFilter, setMilitaryTrainingPersonFilter] = useState<string>("전체");
  const [militaryTrainingTypeFilter, setMilitaryTrainingTypeFilter] = useState<string>("전체");
  const [militaryTrainingRoundFilter, setMilitaryTrainingRoundFilter] = useState<string>("전체");
  const [militaryTrainingDepartmentFilter, setMilitaryTrainingDepartmentFilter] = useState<string>("전체");
  const [militaryNoticeSearch, setMilitaryNoticeSearch] = useState("");
  const [militaryReportSearch, setMilitaryReportSearch] = useState("");

  useEffect(() => {
    if (militaryTrainingYearFilter === "전체" && militarySettings["기준연도"]) {
      setMilitaryTrainingYearFilter(String(militarySettings["기준연도"]));
    }
  }, [militarySettings, militaryTrainingYearFilter]);

  const saveMilitaryTrainingAutoSettings = () => {
    saveJson(MILITARY_TRAINING_AUTOCREATE_KEY, militaryTrainingAutoConfig, tenantId);
    alert("자동생성 설정을 저장했습니다.");
  };

  const toggleMilitaryAutoTargetStatus = (status: string) => {
    setMilitaryTrainingAutoConfig((prev) => {
      const nextStatuses = prev.targetStatuses?.includes(status)
        ? prev.targetStatuses.filter((item) => item !== status)
        : [...(prev.targetStatuses || []), status];
      return { ...prev, targetStatuses: nextStatuses };
    });
  };

  const [showDormForm, setShowDormForm] = useState(false);
  const [showOccupantForm, setShowOccupantForm] = useState(false);
  const [showDormContractForm, setShowDormContractForm] = useState(false);
  const [showNewHireForm, setShowNewHireForm] = useState(false);
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [showLeaseForm, setShowLeaseForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showMilitaryPersonnelForm, setShowMilitaryPersonnelForm] = useState(false);
  const [showMilitaryTrainingForm, setShowMilitaryTrainingForm] = useState(false);
  const [showMilitaryNoticeForm, setShowMilitaryNoticeForm] = useState(false);
  const [showMilitaryReportForm, setShowMilitaryReportForm] = useState(false);
  const [expandedMilitaryPersonnelIds, setExpandedMilitaryPersonnelIds] = useState<string[]>([]);
  const [showExcelTemplate, setShowExcelTemplate] = useState(false);

  const [editingMilitaryPersonnelId, setEditingMilitaryPersonnelId] = useState<string | null>(null);
  const [editingMilitaryTrainingId, setEditingMilitaryTrainingId] = useState<string | null>(null);
  const [editingMilitaryNoticeId, setEditingMilitaryNoticeId] = useState<string | null>(null);
  const [editingMilitaryReportId, setEditingMilitaryReportId] = useState<string | null>(null);

  const [militaryPersonnelForm, setMilitaryPersonnelForm] = useState<MilitaryPersonnel>({
    id: "",
    name: "",
    rank: "",
    serviceBranch: "",
    unit: "",
    phone: "",
    birthDate: "",
    enlistmentDate: "",
    dischargeDate: "",
    calculationMode: "auto",
    manualCategory: "",
    manualYear: "",
    status: "",
    notes: "",
    createdAt: "",
    updatedAt: "",
  });
  const [militaryTrainingForm, setMilitaryTrainingForm] = useState<TrainingRecord>({
    id: "",
    personnelId: "",
    subject: "",
    trainingDate: "",
    completionDate: "",
    trainingHours: 0,
    location: "",
    attendees: 0,
    status: "",
    notes: "",
    createdAt: "",
    updatedAt: "",
  });
  const [militaryNoticeForm, setMilitaryNoticeForm] = useState<MilitaryNotice>({
    id: "",
    personnelIds: [],
    title: "",
    category: "",
    publishedDate: "",
    expiresDate: "",
    content: "",
    createdAt: "",
    updatedAt: "",
  });
  const [militaryReportForm, setMilitaryReportForm] = useState<MilitaryReport>({
    id: "",
    title: "",
    reportDate: "",
    type: "",
    author: "",
    status: "",
    notes: "",
    createdAt: "",
    updatedAt: "",
  });

  const [showAssignDormForNewHire, setShowAssignDormForNewHire] = useState(false);
  const [assigningNewHireId, setAssigningNewHireId] = useState<string | null>(null);

  const [showNewHireAssignmentModal, setShowNewHireAssignmentModal] = useState(false);
  const [showExpiringDormsModal, setShowExpiringDormsModal] = useState(false);
  const [showUnassignedNewHiresModal, setShowUnassignedNewHiresModal] = useState(false);
  const [selectedDormForAssignment, setSelectedDormForAssignment] = useState<string>("");
  const [selectedNewHiresForAssignment, setSelectedNewHiresForAssignment] = useState<string[]>([]);
  const [assignmentSiteFilter, setAssignmentSiteFilter] = useState<Site | "전체">("전체");
  const [assignmentGenderFilter, setAssignmentGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [assignmentNewHireSearch, setAssignmentNewHireSearch] = useState("");

  // 변경이력 모달 관련 state
  const [showAuditLogModal, setShowAuditLogModal] = useState(false);
  const [selectedAuditLogId, setSelectedAuditLogId] = useState<string | null>(null);
  const [selectedAuditLogIds, setSelectedAuditLogIds] = useState<string[]>([]);
  const [showRawJson, setShowRawJson] = useState(false);
  const [supabaseSyncStatus, setSupabaseSyncStatus] = useState<string>("");
  const [isSupabaseSyncing, setIsSupabaseSyncing] = useState(false);

  useEffect(() => {
    if (activeTab !== "documentManagement") {
      setShowExcelTemplate(false);
    }
  }, [activeTab]);

  // 자동 계약상태 변경 (30일 전 자동 만료예정)
  useEffect(() => {
    if (dormContracts.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    let hasChanges = false;

    const updatedContracts = dormContracts.map((contract) => {
      if (contract.contractStatus !== "진행중") return contract;
      if (!contract.contractEnd) return contract;

      const endDate = new Date(contract.contractEnd);
      const daysLeft = Math.ceil((endDate.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft <= 30 && daysLeft > 0) {
        hasChanges = true;
        createAuditLog({
          targetType: "dormContract",
          targetId: contract.id,
          actionType: "statusChange",
          changedBy: currentUser?.displayName || "시스템",
          beforeValue: contract.contractStatus,
          afterValue: "만료예정",
          memo: `30일 이내 계약만료 자동 처리 (종료예정: ${contract.contractEnd})`,
        });
        return { ...contract, contractStatus: "만료예정" as const };
      }
      return contract;
    });

    if (hasChanges) {
      setDormContracts(updatedContracts);
      saveJson(DORM_CONTRACTS_KEY, updatedContracts);
    }
  }, [dormContracts.length, currentUser?.displayName]);

  const getValidSettlementYear = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    return /^\d{4}$/.test(digits) ? digits : "";
  };
  const getValidSettlementMonth = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 2);
    return /^(0[1-9]|1[0-2])$/.test(digits) ? digits : "";
  };

  const safeSettlementYear = getValidSettlementYear(settlementYear) || currentSettlementYear;
  const safeSettlementMonth = getValidSettlementMonth(settlementMonth) || currentSettlementMonth;

  const saveSettlementMiscCost = (dormId: string, amount: number) => {
    const validYear = getValidSettlementYear(settlementYear);
    const validMonth = getValidSettlementMonth(settlementMonth);
    if (!validYear || !validMonth) {
      alert("정산 연도와 월을 먼저 정확히 선택하세요.");
      return;
    }

    const now = new Date().toISOString();
    setSettlementRecords((prev) => {
      const existingIndex = prev.findIndex(
        (record) =>
          record.dormId === dormId &&
          record.settlementYear === validYear &&
          record.settlementMonth === validMonth
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          miscCost: amount,
          updatedAt: now,
        };
        return updated;
      }

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          dormId,
          settlementYear: validYear,
          settlementMonth: validMonth,
          miscCost: amount,
          notes: "",
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
  };

  const resetSettlementItemForm = () => {
    setSettlementItemForm(settlementItemTemplate());
    setSelectedSettlementItemId(null);
  };

  const openSettlementItemEdit = (item: SettlementItem) => {
    setSelectedSettlementItemId(item.id);
    setSettlementItemForm({
      dormId: item.dormId,
      category: item.category,
      details: item.details,
      amount: item.amount.toString(),
      burdenType: item.burdenType,
      targetName: item.targetName,
      memo: item.memo,
    });
    setSettlementSubTab("itemEntry");
  };

  const deleteSettlementItem = (itemId: string) => {
    if (!window.confirm("정산 항목을 삭제하시겠습니까?")) return;
    setSettlementItems((prev) => prev.filter((item) => item.id !== itemId));
    if (selectedSettlementItemId === itemId) {
      resetSettlementItemForm();
    }
  };

  const saveSettlementItem = () => {
    if (!canEditData(currentUser)) return;
    if (!settlementYear || !settlementMonth) {
      alert("정산 연도와 월을 먼저 선택하세요.");
      return;
    }
    if (!settlementItemForm.dormId) {
      alert("기숙사를 선택하세요.");
      return;
    }
    if (!settlementItemForm.amount.trim() || Number.isNaN(Number(settlementItemForm.amount))) {
      alert("유효한 금액을 입력하세요.");
      return;
    }

    const amount = Number(settlementItemForm.amount);
    const now = new Date().toISOString();
    const payload: SettlementItem = {
      id: selectedSettlementItemId || crypto.randomUUID(),
      settlementYear,
      settlementMonth,
      dormId: settlementItemForm.dormId,
      category: settlementItemForm.category,
      details: settlementItemForm.details,
      amount,
      burdenType: settlementItemForm.burdenType,
      targetName: settlementItemForm.targetName,
      memo: settlementItemForm.memo,
      createdAt: selectedSettlementItemId
        ? settlementItems.find((item) => item.id === selectedSettlementItemId)?.createdAt || now
        : now,
      updatedAt: now,
    };

    setSettlementItems((prev) =>
      selectedSettlementItemId ? prev.map((item) => (item.id === selectedSettlementItemId ? payload : item)) : [payload, ...prev]
    );
    resetSettlementItemForm();
  };

  // 날짜 비교 함수들
  const getMonthEnd = (year: number, month: number) => new Date(year, month, 0);
  const isSameMonth = (date: Date, year: number, month: number) => date.getFullYear() === year && date.getMonth() + 1 === month;
  const isBeforeOrSameMonthEnd = (date: Date, year: number, month: number) => date <= getMonthEnd(year, month);
  const isBeforeMonthEnd = (date: Date, year: number, month: number) => date < getMonthEnd(year, month);
  const getUniqueDormKey = (site: string, buildingName: string, dong: string, roomHo: string) => `${site}-${buildingName}-${dong}-${roomHo}`;

  const [tenantId] = useState<string>("default");
  const [isLoading, setIsLoading] = useState(true);
  const [operationalSyncError, setOperationalSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (operationalSyncError) {
      console.warn("Operational sync error:", operationalSyncError);
    }
  }, [operationalSyncError]);
  const [customTemplates, setCustomTemplates] = usePersistedState<CustomTemplate[]>(CUSTOM_TEMPLATES_KEY, [], tenantId);
  const [templateUploadName, setTemplateUploadName] = useState("");
  const [templateUploadType, setTemplateUploadType] = useState<"dormContract" | "newHire" | "dorm" | "occupant" | "inventory" | "sale">("dormContract");

  const [editingDormId, setEditingDormId] = useState<string | null>(null);
  const [editingOccupantId, setEditingOccupantId] = useState<string | null>(null);
  const [editingDormContractId, setEditingDormContractId] = useState<string | null>(null);
  const [editingNewHireId, setEditingNewHireId] = useState<string | null>(null);
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null);
  const [editingLeaseId, setEditingLeaseId] = useState<string | null>(null);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editingDefectId, setEditingDefectId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [dormForm, setDormForm] = useState(dormTemplate());
  const [occupantForm, setOccupantForm] = useState(occupantTemplate());
  const [assignManagerToDorm, setAssignManagerToDorm] = useState(false);
  const [dormContractForm, setDormContractForm] = useState<DormContractFormState>(dormContractTemplate());
  const [newHireForm, setNewHireForm] = useState<NewHireFormState>(newHireTemplate());
  const [inventoryForm, setInventoryForm] = useState(inventoryTemplate());
  const [leaseForm, setLeaseForm] = useState(leaseTemplate());
  const [saleForm, setSaleForm] = useState(saleTemplate());
  const [defectForm, setDefectForm] = useState(defectTemplate());
  const [userForm, setUserForm] = useState(userTemplate());
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() =>
    loadJson<SystemSettings>(SYSTEM_SETTINGS_KEY, getDefaultSystemSettings(), tenantId)
  );
  const getFieldLabel = (key: string) => {
    try {
      const f = systemSettings.fields.find((s) => s.fieldKey === key);
      return f ? f.fieldName : key;
    } catch {
      return key;
    }
  };
  const getCodeKeyLabel = (key: string) => {
    const map: Record<string, string> = {
      employmentStatus: "재직상태",
      militaryCategory: "병역구분",
      trainingStatus: "훈련상태",
      occupantStatus: "입주상태",
      contractStatus: "계약상태",
      defectStatus: "하자상태",
      role: "권한",
      site: "지역",
      gender: "성별",
    };
    return map[key] || key;
  };
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>("menuManagement");
  const [codeTypeFilter, setCodeTypeFilter] = useState<CodeValue["codeType"] | "">("");
  const [settingsMode, setSettingsMode] = useState<"beginner" | "advanced">("beginner");
  const [settingsSavedAt, setSettingsSavedAt] = useState<string | null>(null);
  const [selectedScreenTab, setSelectedScreenTab] = useState<TabKey | "all">("all");
  const [menuSearchKeyword, setMenuSearchKeyword] = useState("");

  const permissionsByRole = useMemo(() => {
    return systemSettings.permissions.reduce((acc, perm) => {
      if (!acc[perm.role]) acc[perm.role] = [];
      acc[perm.role].push(perm);
      return acc;
    }, {} as Record<UserRole, PermissionConfig[]>);
  }, [systemSettings.permissions]);

  const currentScreenSettings =
    selectedScreenTab === "all"
      ? systemSettings.screenSettings
      : systemSettings.screenSettings.filter((screen) => screen.tabKey === selectedScreenTab);

  useEffect(() => {
    const loadInitialData = async () => {
      console.log("[LOAD] === Starting initial data load ===");
      runLegacyLocalStorageMigration(tenantId);

      try {
        const savedTheme = loadJson<ThemeSettings>(THEME_KEY, themeDefault, tenantId);

        setTheme({ ...themeDefault, ...savedTheme });
        const loadedUsers = loadJson<LoginUser[]>(USERS_KEY, [], tenantId);
        setUsers(loadedUsers);
        setDorms(loadJson<Dorm[]>(DORMS_KEY, [], tenantId));
        setOccupants(loadJson<Occupant[]>(OCCUPANTS_KEY, [], tenantId));
        setInventory(loadJson<InventoryItem[]>(INVENTORY_KEY, [], tenantId));
        setLeases(loadJson<LeaseContract[]>(LEASES_KEY, [], tenantId));
        setDormContracts(loadJson<DormContract[]>(DORM_CONTRACTS_KEY, [], tenantId));
        setCleaningReports(loadJson<CleaningReport[]>(CLEANING_REPORTS_KEY, [], tenantId));
        setAuditLogs(loadJson<AuditLog[]>(AUDIT_LOGS_KEY, [], tenantId));
        setNewHires(loadJson<NewHireEmployee[]>(NEW_HIRES_KEY, [], tenantId));
        setSales(loadJson<SaleRecord[]>(SALES_KEY, [], tenantId));
        setDefects(loadJson<DefectRequest[]>(DEFECTS_KEY, [], tenantId));
        setMilitaryPersonnel(loadJson<any[]>(MILITARY_PERSONNEL_KEY, [], tenantId));
        setMilitaryTrainingRecords(loadJson<any[]>(MILITARY_TRAINING_KEY, [], tenantId));
        setMilitaryNotices(loadJson<any[]>(MILITARY_NOTICES_KEY, [], tenantId));
        setMilitaryReports(loadJson<any[]>(MILITARY_REPORTS_KEY, [], tenantId));
        setMilitarySettings(loadJson<any>(MILITARY_SETTINGS_KEY, {}, tenantId));
        const loadedRules = loadJson<MilitaryTrainingRule[]>(MILITARY_TRAINING_RULES_KEY, [], tenantId);
        setMilitaryTrainingRules(loadedRules.length ? loadedRules : defaultMilitaryTrainingRules);
        const loadedCodeValues = loadJson<MilitaryCodeValues>(MILITARY_CODE_VALUES_KEY, defaultMilitaryCodeValues, tenantId);
        setMilitaryCodeValues({
          ...loadedCodeValues,
          departments: normalizeMilitaryDepartments(loadedCodeValues.departments),
        });
        setMilitaryTrainingAutoConfig(
          loadJson<{ enabled: boolean; targetStatuses: string[] }>(MILITARY_TRAINING_AUTOCREATE_KEY, { enabled: true, targetStatuses: ["재직"] }, tenantId)
        );
        setCleaningSettings(
          loadJson<CleaningSettings>(CLEANING_SETTINGS_KEY, { missingReportPenalty: -5, includeWeekendReports: false }, tenantId)
        );
        setSystemSettings(
          loadSystemSettings(JSON.stringify(loadJson<SystemSettings>(SYSTEM_SETTINGS_KEY, getDefaultSystemSettings(), tenantId)), tenantId)
        );
        setSettlementRecords(loadJson<SettlementRecord[]>(SETTLEMENT_RECORDS_KEY, [], tenantId));
        setSettlementItems(loadJson<SettlementItem[]>(SETTLEMENT_ITEMS_KEY, [], tenantId));
        setCurrentUser(loadJson<LoginUser | null>(AUTH_KEY, null, tenantId));

        if (isSupabaseAvailable()) {
          const session = await getCurrentSession();
          if (session?.user?.id) {
            console.log("[LOAD] Supabase session found:", session.user.id);
            const remoteDormModule = await loadDormModule(tenantId);
            console.log("[LOAD] remoteDormModule loaded:", {
              dorms: remoteDormModule?.dorms?.length || 0,
              occupants: remoteDormModule?.occupants?.length || 0,
              dormContracts: remoteDormModule?.dormContracts?.length || 0,
              newHires: remoteDormModule?.newHires?.length || 0,
            });
            if (remoteDormModule) {
              console.log("[LOAD] Setting Dorm module state...");
              setDorms(remoteDormModule.dorms);
              setOccupants(remoteDormModule.occupants);
              setDormContracts(remoteDormModule.dormContracts);
              setNewHires(remoteDormModule.newHires);
              console.log("[LOAD] Dorm module setState completed");
            }

            const remoteOperationalModule = await loadOperationalModule(tenantId);
            console.log("[LOAD] remoteOperationalModule loaded:", {
              cleaningReports: remoteOperationalModule?.cleaningReports?.length || 0,
              defects: remoteOperationalModule?.defects?.length || 0,
              inventory: remoteOperationalModule?.inventory?.length || 0,
              settlementRecords: remoteOperationalModule?.settlementRecords?.length || 0,
              settlementItems: remoteOperationalModule?.settlementItems?.length || 0,
              auditLogs: remoteOperationalModule?.auditLogs?.length || 0,
            });
            if (remoteOperationalModule) {
              console.log("[LOAD] Setting Operational module state...");
              setCleaningReports(remoteOperationalModule.cleaningReports || []);
              setDefects(remoteOperationalModule.defects || []);
              setInventory(remoteOperationalModule.inventory || []);
              setSettlementRecords(remoteOperationalModule.settlementRecords || []);
              setSettlementItems((remoteOperationalModule.settlementItems as unknown as SettlementItem[]) || []);
              setAuditLogs(remoteOperationalModule.auditLogs || []);
              console.log("[LOAD] Operational module setState completed");
              console.log("[LOAD] Syncing Supabase data to localStorage...");
              saveJson(CLEANING_REPORTS_KEY, remoteOperationalModule.cleaningReports || [], tenantId);
              saveJson(DEFECTS_KEY, remoteOperationalModule.defects || [], tenantId);
              saveJson(INVENTORY_KEY, remoteOperationalModule.inventory || [], tenantId);
              saveJson(SETTLEMENT_RECORDS_KEY, remoteOperationalModule.settlementRecords || [], tenantId);
              saveJson(SETTLEMENT_ITEMS_KEY, remoteOperationalModule.settlementItems || [], tenantId);
              saveJson(AUDIT_LOGS_KEY, remoteOperationalModule.auditLogs || [], tenantId);
              console.log("[LOAD] localStorage sync completed");
            } else {
              console.warn("[LOAD] remoteOperationalModule is null/undefined, using localStorage fallback");
            }

            const authUser = await getCurrentAuthUser();
            const profile = await getProfile(session.user.id);
            if (profile) {
              console.log("[LOAD] User profile loaded:", profile.id, profile.email);
              setCurrentUser(mapProfileToLoginUser(profile, authUser?.email ?? undefined));
              setActiveTab(profile.role === "maintenance_reporter" ? "defects" : "dashboard");
            }
          } else {
            console.warn("[LOAD] No Supabase session found");
          }
        } else {
          console.warn("[LOAD] Supabase not available");
        }
      } catch (error) {
      console.error("초기 데이터 로딩 중 오류가 발생했습니다:", error);
      setTheme(themeDefault);
      setUsers(getSafeUsers());
      setDorms([]);
      setOccupants([]);
      setInventory([]);
      setLeases([]);
      setDormContracts([]);
      setCleaningReports([]);
      setAuditLogs([]);
      setNewHires([]);
      setSales([]);
      setDefects([]);
      setMilitaryPersonnel([]);
      setMilitaryTrainingRecords([]);
      setMilitaryNotices([]);
      setMilitaryReports([]);
      setMilitarySettings({});
      setCleaningSettings({ missingReportPenalty: -5, includeWeekendReports: false });
      setSystemSettings(getDefaultSystemSettings());
      setSettlementRecords([]);
      setSettlementItems([]);
      setCurrentUser(null);
    } finally {
      console.log("[LOAD] === Initial data load completed ===");
      setIsLoading(false);
    }
  };

  loadInitialData();
}, [tenantId]);

  const saveSystemSettings = () => {
    saveJson(SYSTEM_SETTINGS_KEY, systemSettings, tenantId);
    setSettingsSavedAt(new Date().toLocaleString());
  };

  const getMilitaryModuleState = (): MilitaryModuleState => ({
    tenantId,
    militaryPersonnel,
    militaryTrainingRecords,
    militaryNotices,
    militaryReports,
    militarySettings,
    militaryTrainingRules,
    militaryCodeValues,
    militaryTrainingAutoConfig,
  });

  const loadSupabaseMilitaryModule = async () => {
    if (!isSupabaseAvailable()) {
      setSupabaseSyncStatus("Supabase 환경변수 미설정");
      return;
    }
    setIsSupabaseSyncing(true);
    setSupabaseSyncStatus("Supabase에서 군대 모듈 데이터를 불러오는 중입니다...");

    try {
      const remote = await loadMilitaryModule(tenantId);
      if (remote) {
        setMilitaryPersonnel(remote.militaryPersonnel || []);
        setMilitaryTrainingRecords(remote.militaryTrainingRecords || []);
        setMilitaryNotices(remote.militaryNotices || []);
        setMilitaryReports(remote.militaryReports || []);
        setMilitarySettings(remote.militarySettings || {});
        setMilitaryTrainingRules(remote.militaryTrainingRules || []);
        setMilitaryCodeValues({
          ...remote.militaryCodeValues,
          departments: normalizeMilitaryDepartments(remote.militaryCodeValues?.departments || []),
        });
        setMilitaryTrainingAutoConfig(remote.militaryTrainingAutoConfig || { enabled: true, targetStatuses: ["재직"] });
        setSupabaseSyncStatus("Supabase 불러오기가 완료되었습니다.");
      } else {
        setSupabaseSyncStatus("Supabase에 저장된 군대 모듈 데이터가 없습니다.");
      }
    } catch (error) {
      console.error(error);
      setSupabaseSyncStatus("Supabase 불러오기 중 오류가 발생했습니다.");
    } finally {
      setIsSupabaseSyncing(false);
    }
  };

  const saveSupabaseMilitaryModule = async () => {
    if (!isSupabaseAvailable()) {
      setSupabaseSyncStatus("Supabase 환경변수 미설정");
      return;
    }
    setIsSupabaseSyncing(true);
    setSupabaseSyncStatus("Supabase에 군대 모듈 데이터를 저장 중입니다...");

    try {
      await saveMilitaryModule(getMilitaryModuleState());
      setSupabaseSyncStatus("Supabase 저장이 완료되었습니다.");
    } catch (error) {
      console.error(error);
      setSupabaseSyncStatus("Supabase 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSupabaseSyncing(false);
    }
  };

  useEffect(() => {
    if (isSupabaseAvailable()) {
      loadSupabaseMilitaryModule();
    } else {
      setSupabaseSyncStatus("Supabase 환경변수 미설정");
    }
  }, [tenantId]);

  const restoreDefaultSystemSettings = () => {
    const defaults = getDefaultSystemSettings();
    setSystemSettings(defaults);
    saveJson(SYSTEM_SETTINGS_KEY, defaults, tenantId);
    setSettingsSavedAt(new Date().toLocaleString());
  };

  const exportLocalStorageBackup = () => {
    const payload = {
      users,
      dorms,
      occupants,
      inventory,
      leases,
      dormContracts,
      newHires,
      sales,
      defects,
      cleaningReports,
      customTemplates,
      systemSettings,
      auditLogs,
      militaryPersonnel,
      militaryTrainingRecords,
      militaryNotices,
      militaryReports,
      militarySettings,
      militaryTrainingRules,
      militaryCodeValues,
      militaryTrainingAutoConfig,
      theme,
      auth: currentUser,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dorm-erp-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importLocalStorageBackup = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== "object") throw new Error("유효하지 않은 백업 파일입니다.");

      const setJsonWithTenant = (key: string, value: any, setter: (value: any) => void) => {
        if (value !== undefined) {
          saveJson(key, value, tenantId);
          setter(value);
        }
      };

      setJsonWithTenant(USERS_KEY, payload.users, setUsers);
      setJsonWithTenant(DORMS_KEY, payload.dorms, setDorms);
      setJsonWithTenant(OCCUPANTS_KEY, payload.occupants, setOccupants);
      setJsonWithTenant(INVENTORY_KEY, payload.inventory, setInventory);
      setJsonWithTenant(LEASES_KEY, payload.leases, setLeases);
      setJsonWithTenant(DORM_CONTRACTS_KEY, payload.dormContracts, setDormContracts);
      setJsonWithTenant(NEW_HIRES_KEY, payload.newHires, setNewHires);
      setJsonWithTenant(SALES_KEY, payload.sales, setSales);
      setJsonWithTenant(DEFECTS_KEY, payload.defects, setDefects);
      setJsonWithTenant(CLEANING_REPORTS_KEY, payload.cleaningReports, setCleaningReports);
      setJsonWithTenant(CLEANING_SETTINGS_KEY, payload.cleaningSettings, setCleaningSettings);
      setJsonWithTenant(SYSTEM_SETTINGS_KEY, payload.systemSettings, setSystemSettings);
      setJsonWithTenant(AUDIT_LOGS_KEY, payload.auditLogs, setAuditLogs);
      setJsonWithTenant(MILITARY_PERSONNEL_KEY, payload.militaryPersonnel, setMilitaryPersonnel);
      setJsonWithTenant(MILITARY_TRAINING_KEY, payload.militaryTrainingRecords, setMilitaryTrainingRecords);
      setJsonWithTenant(MILITARY_NOTICES_KEY, payload.militaryNotices, setMilitaryNotices);
      setJsonWithTenant(MILITARY_REPORTS_KEY, payload.militaryReports, setMilitaryReports);
      setJsonWithTenant(MILITARY_SETTINGS_KEY, payload.militarySettings, setMilitarySettings);
      setJsonWithTenant(MILITARY_TRAINING_RULES_KEY, payload.militaryTrainingRules, setMilitaryTrainingRules);
      setJsonWithTenant(MILITARY_CODE_VALUES_KEY, payload.militaryCodeValues, setMilitaryCodeValues);
      setJsonWithTenant(MILITARY_TRAINING_AUTOCREATE_KEY, payload.militaryTrainingAutoConfig, setMilitaryTrainingAutoConfig);
      if (payload.customTemplates) {
        saveJson(CUSTOM_TEMPLATES_KEY, payload.customTemplates, tenantId);
        setCustomTemplates(payload.customTemplates);
      }
      if (payload.theme) {
        saveJson(THEME_KEY, payload.theme, tenantId);
        setTheme(payload.theme);
      }
      if (payload.auth) {
        saveJson(AUTH_KEY, payload.auth, tenantId);
        setCurrentUser(payload.auth);
      }

      setBackupImportError(null);
      setSettingsSavedAt(new Date().toLocaleString());
    } catch (error) {
      setBackupImportError(String(error));
    }
  };

  const resetAllData = () => {
    if (!canEditData(currentUser)) {
      alert("전체 데이터 초기화는 관리자만 실행할 수 있습니다.");
      return;
    }
    if (!window.confirm("전체 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    setUsers([]);
    setDorms([]);
    setOccupants([]);
    setInventory([]);
    setLeases([]);
    setDormContracts([]);
    setNewHires([]);
    setSales([]);
    setDefects([]);
    setCleaningReports([]);
    setAuditLogs([]);
    setMilitaryPersonnel([]);
    setMilitaryTrainingRecords([]);
    setMilitaryNotices([]);
    setMilitaryReports([]);
    setMilitarySettings({});
    setMilitaryTrainingRules(defaultMilitaryTrainingRules);
    setMilitaryCodeValues(defaultMilitaryCodeValues);
    setMilitaryTrainingAutoConfig({ enabled: true, targetStatuses: ["재직"] });
    setCustomTemplates([]);
    setCurrentUser(null);
    setSystemSettings(getDefaultSystemSettings());
    setTheme(themeDefault);
    [USERS_KEY, DORMS_KEY, OCCUPANTS_KEY, INVENTORY_KEY, LEASES_KEY, DORM_CONTRACTS_KEY, NEW_HIRES_KEY, SALES_KEY, DEFECTS_KEY, CLEANING_REPORTS_KEY, CLEANING_SETTINGS_KEY, AUDIT_LOGS_KEY, MILITARY_PERSONNEL_KEY, MILITARY_TRAINING_KEY, MILITARY_NOTICES_KEY, MILITARY_REPORTS_KEY, MILITARY_SETTINGS_KEY, THEME_KEY, SYSTEM_SETTINGS_KEY, CUSTOM_TEMPLATES_KEY, AUTH_KEY].forEach((key) => removeJson(key, tenantId));
    setSettingsSavedAt(new Date().toLocaleString());
  };

  const resetDemoData = () => {
    if (!canEditData(currentUser)) {
      alert("데모 데이터 초기화는 관리자만 실행할 수 있습니다.");
      return;
    }
    if (!window.confirm("데모 데이터를 로드하시겠습니까? 현재 데이터는 덮어쓰기됩니다.")) return;
    setUsers([]);
    setDorms([]);
    setOccupants([]);
    setInventory([]);
    setLeases([]);
    setDormContracts([]);
    setNewHires([]);
    setSales([]);
    setDefects([]);
    setCleaningReports([]);
    setAuditLogs([]);
    setMilitaryPersonnel([]);
    setMilitaryTrainingRecords([]);
    setMilitaryNotices([]);
    setMilitaryReports([]);
    setMilitarySettings({});
    setMilitaryTrainingRules(defaultMilitaryTrainingRules);
    setMilitaryCodeValues(defaultMilitaryCodeValues);
    setMilitaryTrainingAutoConfig({ enabled: true, targetStatuses: ["재직"] });
    setMilitaryTrainingRules(defaultMilitaryTrainingRules);
    setMilitaryCodeValues(defaultMilitaryCodeValues);
    setMilitaryTrainingAutoConfig({ enabled: true, targetStatuses: ["재직"] });
    setCustomTemplates([]);
    setSystemSettings(getDefaultSystemSettings());
    setTheme(themeDefault);
    saveJson(USERS_KEY, [], tenantId);
    saveJson(DORMS_KEY, [], tenantId);
    saveJson(OCCUPANTS_KEY, [], tenantId);
    saveJson(INVENTORY_KEY, [], tenantId);
    saveJson(LEASES_KEY, [], tenantId);
    saveJson(DORM_CONTRACTS_KEY, [], tenantId);
    saveJson(NEW_HIRES_KEY, [], tenantId);
    saveJson(SALES_KEY, [], tenantId);
    saveJson(DEFECTS_KEY, [], tenantId);
    saveJson(CLEANING_REPORTS_KEY, [], tenantId);
    saveJson(AUDIT_LOGS_KEY, [], tenantId);
    saveJson(MILITARY_PERSONNEL_KEY, [], tenantId);
    saveJson(MILITARY_TRAINING_KEY, [], tenantId);
    saveJson(MILITARY_NOTICES_KEY, [], tenantId);
    saveJson(MILITARY_REPORTS_KEY, [], tenantId);
    saveJson(MILITARY_SETTINGS_KEY, {}, tenantId);
    saveJson(CUSTOM_TEMPLATES_KEY, [], tenantId);
    saveJson(THEME_KEY, themeDefault, tenantId);
    saveJson(SYSTEM_SETTINGS_KEY, getDefaultSystemSettings(), tenantId);
    setSettingsSavedAt(new Date().toLocaleString());
  };

  const resetAdminAccount = () => {
    if (!canEditData(currentUser)) {
      alert("관리자 계정 초기화는 관리자만 실행할 수 있습니다.");
      return;
    }
    if (!window.confirm("관리자 계정을 기본값으로 초기화하시겠습니까?")) return;
    const adminUser: LoginUser = {
      id: crypto.randomUUID(),
      username: "admin",
      password: "admin1234",
      role: "admin",
      displayName: "총관리자",
      isActive: true,
      siteAccess: "전체",
      createdAt: new Date().toISOString(),
    };
    setUsers((prev) => {
      const filtered = prev.filter((u) => u.username !== "admin");
      return [adminUser, ...filtered];
    });
    const savedUsers = loadJson<LoginUser[]>(USERS_KEY, [], tenantId);
    const updatedUsers = Array.isArray(savedUsers)
      ? [{ ...adminUser }, ...savedUsers.filter((u: any) => u.username !== "admin")]
      : [adminUser];
    saveJson(USERS_KEY, updatedUsers, tenantId);
    setSettingsSavedAt(new Date().toLocaleString());
  };

  const defectRequestPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const defectCompletionPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cleaningReportBeforePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cleaningReportAfterPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const [backupImportError, setBackupImportError] = useState<string | null>(null);

  // ============================================
  // 1. operationalDorms: 운영 기준 통합 기숙사 데이터
  // 조건: dormContracts 기반, 포함(공실,진행중,만료예정,연장), 제외(종료,해지)
  // NOTE: 기존 2745줄 구현 사용 (visibleCleaningDormRows에서 필요)
  // ============================================

  // ============================================
  // 2. 권한 처리 함수
  // maintenance_reporter: 본인 기숙사만, viewer: 조회만, admin: 전체
  // ============================================
  const hasAccessToDorm = (user: LoginUser | null, dormId: string | undefined): boolean => {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.role === "viewer") return true; // 조회 권한 있음
    if (user.role === "maintenance_reporter" || user.role === "dorm_manager") {
      return user.dormId === dormId;
    }
    return false;
  };

  const hasAccessToOperationalDorm = (user: LoginUser | null, dorm: OperationalDorm): boolean => {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.role === "viewer") return true;
    if (user.role === "maintenance_reporter" || user.role === "dorm_manager") {
      return user.dormId === dorm.id;
    }
    return false;
  };

  const canEditDormData = (user: LoginUser | null, role: UserRole = "admin"): boolean => {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.role === "maintenance_reporter") {
      // 청소보고, 하자접수만 입력 가능
      return role === "maintenance_reporter";
    }
    return false;
  };

  const canConfirmCleaningReport = (user: LoginUser | null): boolean => {
    // admin만 청소보고 확인 가능
    return user?.role === "admin";
  };

  const canModifyPermission = (user: LoginUser | null): boolean => {
    // admin만 권한 수정 가능 (점수 입력, 상태 변경 등)
    return user?.role === "admin";
  };

  // ============================================
  // 6. 권한 공통 함수화 (향후 사용 예정)
  // ============================================
  // const canViewTab = (tabKey: string, user: LoginUser | null): boolean => {
  //   if (!user) return false;
  //   const permission = systemSettings.permissions.find(p => p.role === user.role && p.tabKey === tabKey);
  //   return permission?.canView ?? false;
  // };

  // const canCreateTab = (tabKey: string, user: LoginUser | null): boolean => {
  //   if (!user) return false;
  //   const permission = systemSettings.permissions.find(p => p.role === user.role && p.tabKey === tabKey);
  //   return permission?.canCreate ?? false;
  // };

  // const canEditTab = (tabKey: string, user: LoginUser | null): boolean => {
  //   if (!user) return false;
  //   const permission = systemSettings.permissions.find(p => p.role === user.role && p.tabKey === tabKey);
  //   return permission?.canEdit ?? false;
  // };

  // const canDeleteTab = (tabKey: string, user: LoginUser | null): boolean => {
  //   if (!user) return false;
  //   const permission = systemSettings.permissions.find(p => p.role === user.role && p.tabKey === tabKey);
  //   return permission?.canDelete ?? false;
  // };

  const getAccessibleOperationalDorms = (user: LoginUser | null, dormList: OperationalDorm[]): OperationalDorm[] => {
    if (!user) return [];
    if (user.role === "admin") return dormList;
    if (user.role === "viewer") return dormList;
    if (user.role === "maintenance_reporter" || user.role === "dorm_manager") {
      // 본인이 관리하는 기숙사만 접근 가능
      return dormList.filter((d) => d.managerUserId === user.id || d.id === user.dormId);
    }
    return [];
  };

  const getDormDday = (dorm: OperationalDorm): string => {
    if (!dorm.contractEnd) return "-";
    const diff = daysDiff(dorm.contractEnd);
    if (diff < 0) return `만료 ${Math.abs(diff)}일 전`;
    if (diff === 0) return "D-Day";
    return `D-${diff}`;
  };

  const getOpenDefectCount = (dormId: string): number =>
    defects.filter((d) => d.dormId === dormId && d.defectStatus !== "완료").length;

  const isCleaningMissing = (dorm: OperationalDorm): boolean => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const reportsThisMonth = cleaningReports.filter(
      (report) => report.dormId === dorm.id && report.reportDate.startsWith(currentMonth)
    );
    if (reportsThisMonth.length === 0) return true;
    const latest = reportsThisMonth.reduce((latestReport, report) =>
      report.reportDate > latestReport.reportDate ? report : latestReport,
      reportsThisMonth[0]
    );
    return latest.cleanStatus === "미제출";
  };

  const handleDormCardClick = (dormId: string) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = window.setTimeout(() => {
      setSelectedDormId((previous) => (previous === dormId ? "" : dormId));
      clickTimerRef.current = null;
    }, 200);
  };

  const openDormDetailModal = (dormId: string) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setSelectedDormDetailId(dormId);
  };

  const closeDormDetailModal = () => setSelectedDormDetailId("");

  const AUDIT_TARGET_LABEL_MAP: Record<AuditLog["targetType"], string> = {
    dorm: "기숙사",
    dormContract: "기숙사 계약",
    newHire: "신입사원",
    occupant: "입주자",
    inventory: "비품",
    defect: "하자",
    cleaningReport: "청소 보고서",
    lease: "매입계약",
    militaryPersonnel: "군인원",
    trainingRecord: "훈련 기록",
    militaryNotice: "공지",
    militaryReport: "보고서",
  };

  const getAuditTargetLabel = (targetType: AuditLog["targetType"]) => AUDIT_TARGET_LABEL_MAP[targetType] || targetType;

  // 감사 로그 필드명 한글화 맵
  const FIELD_LABEL_MAP: Record<string, string> = {
    managerUserId: "기숙사 담당자",
    sourceNewHireId: "신입사원 연결",
    dormId: "기숙사",
    personnelId: "군인",
    personnelIds: "군인 목록",
    residenceStatus: "거주 상태",
    moveInType: "입실 유형",
    buildingName: "건물명",
    roomHo: "호수",
    dong: "동",
    phone: "연락처",
    name: "이름",
    email: "이메일",
    status: "상태",
    isDeleted: "삭제 여부",
    contractStatus: "계약 상태",
    contractType: "계약 유형",
    contractStart: "계약 시작일",
    contractEnd: "계약 종료일",
    employeeName: "직원명",
    moveInDate: "입실일",
    moveOutDueDate: "예정 퇴실일",
    actualMoveOutDate: "실제 퇴실일",
    leaseStatus: "임차 상태",
    reportDate: "보고일",
    cleanStatus: "청소 상태",
    checkResult: "확인 결과",
    score: "점수",
    memo: "메모",
  };

  // 감사 로그 값 변환 함수
  const getAuditFieldLabel = (fieldName: string): string => FIELD_LABEL_MAP[fieldName] || fieldName;
  
  const getAuditDisplayValue = (fieldName: string, value: string): string => {
    if (!value) return "";
    
    // user id로 displayName 변환
    if (fieldName === "managerUserId" || fieldName === "reporterUserId" || fieldName === "confirmedBy") {
      const user = users.find(u => u.id === value);
      return user ? user.displayName : value;
    }
    
    // dormId로 기숙사명/동/호수 변환
    if (fieldName === "dormId") {
      const dorm = dorms.find(d => d.id === value) || operationalDorms.find(d => d.id === value);
      return dorm ? `${dorm.buildingName} ${formatDong(dorm.dong)}-${formatRoomHo(dorm.roomHo)}` : value;
    }
    
    // sourceNewHireId로 신입사원 이름 변환
    if (fieldName === "sourceNewHireId") {
      const hire = newHires.find(h => h.id === value);
      return hire ? hire.name : value;
    }

    // personnelId 또는 personnelIds로 군인 이름 변환
    if (fieldName === "personnelId") {
      const p = militaryPersonnel.find((m) => m.id === value);
      return p ? p.name : value;
    }
    if (fieldName === "personnelIds") {
      try {
        const ids = JSON.parse(value) as string[];
        return ids.map((id) => militaryPersonnel.find((m) => m.id === id)?.name || id).join(", ");
      } catch {
        return value;
      }
    }
    
    return value;
  };

  const getAuditTargetName = (log: AuditLog) => {
    if (log.targetType === "dormContract") {
      const item = dormContracts.find((c) => c.id === log.targetId);
      return item ? `${item.buildingName} ${formatDong(item.dong)}-${formatRoomHo(item.roomHo)}` : log.targetId;
    }
    if (log.targetType === "occupant") {
      const item = occupants.find((o) => o.id === log.targetId);
      return item ? item.employeeName : log.targetId;
    }
    if (log.targetType === "newHire") {
      const item = newHires.find((h) => h.id === log.targetId);
      return item ? item.name : log.targetId;
    }
    if (log.targetType === "defect") {
      const item = defects.find((d) => d.id === log.targetId);
      return item ? `${item.buildingName} ${formatDong(item.dong)}-${formatRoomHo(item.ho)}` : log.targetId;
    }
    if (log.targetType === "cleaningReport") {
      const item = cleaningReports.find((r) => r.id === log.targetId);
      return item ? `${item.buildingName} ${formatDong(item.dong)}-${formatRoomHo(item.roomHo)}` : log.targetId;
    }
    if (log.targetType === "lease") {
      const item = leases.find((l) => l.id === log.targetId);
      return item ? `${item.addressName} ${item.dong}-${item.ho}` : log.targetId;
    }
    if (log.targetType === "dorm") {
      const item = dorms.find((d) => d.id === log.targetId) || operationalDorms.find((d) => d.id === log.targetId);
      return item ? `${item.buildingName} ${formatDong(item.dong)}-${formatRoomHo(item.roomHo)}` : log.targetId;
    }
    return log.targetId;
  };

  // 지역/성별 기숙사 필터 함수
  const filterDormsBySiteGender = (
    dormList: OperationalDorm[],
    siteFilter: string,
    genderFilter: string,
    statusFilter: string
  ): OperationalDorm[] => {
    return dormList.filter(dorm => 
      (siteFilter === "전체" || dorm.site === siteFilter) &&
      (genderFilter === "전체" || dorm.gender === genderFilter) &&
      (statusFilter === "전체" || dorm.leaseStatus === statusFilter)
    );
  };

  // FilteredDormSelector 컴포넌트 - 지역/성별/운영중 필터를 포함한 기숙사 선택
  const FilteredDormSelector = ({ 
    value, 
    onChange, 
    currentUser: currentUserParam, 
    operationalDorms: domsParam, 
    defaultSite = "전체", 
    defaultGender = "전체", 
    label = "기숙사" 
  }: { 
    value: string; 
    onChange: (dormId: string, dorm?: OperationalDorm) => void; 
    currentUser: LoginUser | null; 
    operationalDorms: OperationalDorm[]; 
    defaultSite?: string;
    defaultGender?: string;
    label?: string;
  }) => {
    const [siteFilter, setSiteFilter] = useState(defaultSite);
    const [genderFilter, setGenderFilter] = useState(defaultGender);
    const [statusFilter, setStatusFilter] = useState<"전체" | "사용중">("전체");

    useEffect(() => {
      setSiteFilter(defaultSite);
    }, [defaultSite]);

    useEffect(() => {
      setGenderFilter(defaultGender);
    }, [defaultGender]);

    const accessibleDorms = getAccessibleOperationalDorms(currentUserParam, domsParam);
    const filteredDorms = filterDormsBySiteGender(accessibleDorms, siteFilter, genderFilter, statusFilter);

    useEffect(() => {
      if (value && !filteredDorms.find(d => d.id === value)) {
        onChange("", undefined);
      }
    }, [siteFilter, genderFilter, filteredDorms, value, onChange]);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SelectInput 
            label="지역" 
            value={siteFilter} 
            onChange={(v) => setSiteFilter(v)} 
            options={["전체", "평택", "천안"]} 
          />
          <SelectInput 
            label="성별" 
            value={genderFilter} 
            onChange={(v) => setGenderFilter(v)} 
            options={["전체", "남", "여"]} 
          />
          <SelectInput
            label="상태"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "전체" | "사용중")}
            options={["전체", "사용중"]}
          />
          <SearchableSelect
            label={label}
            value={value}
            onChange={(v) => {
              const selected = domsParam.find((d) => d.id === v);
              onChange(v, selected);
            }}
            options={["", ...filteredDorms.map((d) => d.id)]}
            displayOptions={["미배정", ...filteredDorms.map((d) => `${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)}`)]}
          />
        </div>
      </div>
    );
  };

  // ============================================
  // 3. 주차 계산 함수 (월~금 기준, 1~5주차)
  // 주차 내 1건 이상 → O, 금요일 지나면 → X, 아직 안지나면 → 예정
  // ============================================
  const getWeekOfMonth = (date: string): number => {
    const d = new Date(date);
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    
    // 첫 번째 월요일을 찾기
    let firstMonday = new Date(firstDay);
    const firstDayOfWeek = firstDay.getDay(); // 0=일, 1=월, ..., 6=토
    if (firstDayOfWeek !== 1) {
      firstMonday.setDate(firstDay.getDate() + ((1 - firstDayOfWeek + 7) % 7));
    }
    
    // 현재 날짜가 첫 번째 월요일 이전이면 week 0
    if (d < firstMonday) return 0;
    
    // 주차 계산
    const weekNumber = Math.floor((d.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return Math.min(weekNumber, 5); // 최대 5주차
  };

  const getMonthLabel = (date: string): string => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const getWeekLabel = (date: string): string => {
    const week = getWeekOfMonth(date);
    if (week === 0) return "주차외";
    return `${week}주차`;
  };

  // ============================================
  // 4. 감점 계산 함수 (계산형, DB 저장 안함)
  // X 1건당 -5점, 담당자 기준 자동 합산
  // ============================================
  const calculateCleaningScoreByManager = (managerUserId: string): number => {
    // 해당 담당자의 모든 청소보고를 찾기
    const managerReports = cleaningReports.filter(r => r.managerUserId === managerUserId);
    
    // 월별로 그룹화
    const monthReports = new Map<string, CleaningReport[]>();
    managerReports.forEach(report => {
      const month = getMonthLabel(report.reportDate);
      if (!monthReports.has(month)) {
        monthReports.set(month, []);
      }
      monthReports.get(month)!.push(report);
    });

    // 각 월별로 감점 계산
    let totalPenalty = 0;
    monthReports.forEach((reports, _month) => {
      // 주차별 요약 (1~5주)
      const weeks = new Map<number, { hasReport: boolean; status: "O" | "X" | "예정" }>();
      
      for (let week = 1; week <= 5; week++) {
        const hasReport = reports.some(r => getWeekOfMonth(r.reportDate) === week);
        weeks.set(week, {
          hasReport,
          status: hasReport ? "O" : "X",
        });
      }

      // X 개수 * 감점
      const xCount = Array.from(weeks.values()).filter(w => w.status === "X").length;
      totalPenalty += xCount * cleaningSettings.missingReportPenalty;
    });

    return totalPenalty;
  };

  const calculateTotalScore = (managerUserId: string): number => {
    // 기본 점수 100점에서 감점
    const penalty = calculateCleaningScoreByManager(managerUserId);
    return 100 + penalty; // 100 + (-5) = 95점 등
  };

  const getManagerCleaningStats = (managerUserId: string) => {
    const reports = cleaningReports.filter(r => r.managerUserId === managerUserId);
    const totalReports = reports.length;
    const completedReports = reports.filter(r => r.cleanStatus === "확인완료").length;
    const defectReports = reports.filter(r => r.cleanStatus === "불량").length;
    const score = calculateTotalScore(managerUserId);

    return {
      totalReports,
      completedReports,
      defectReports,
      score,
      penalty: calculateCleaningScoreByManager(managerUserId),
    };
  };

  // ============================================
  // 5. 관리자 자동 생성 로직
  // 입주자 등록 시 기숙사 담당자 체크박스 → users 자동 생성
  // ============================================
  const createMaintenanceReporter = (
    name: string,
    dormId: string,
    buildingName: string,
    dong: string = "",
    roomHo: string = "",
    address: string = "",
    공동현관: string = "",
    세대현관: string = ""
  ): LoginUser => {
    const newManagerId = `manager-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      id: newManagerId,
      username: `${buildingName}-manager`,
      password: "", // 임시 비밀번호 (관리자가 설정해야함)
      role: "maintenance_reporter",
      displayName: name,
      isActive: true,
      siteAccess: "전체",
      dormId: dormId,
      roadAddress: address,
      buildingName: buildingName,
      dong: dong,
      roomHo: roomHo,
      공동현관: 공동현관,
      세대현관: 세대현관,
      createdAt: new Date().toISOString(),
    };
  };

  const setupDormManager = (dormId: string, newManagerUserId: string, oldManagerUserId?: string): void => {
    // 1. dorms의 managerUserId 업데이트
    const updatedDorms = dorms.map(dorm => 
      dorm.id === dormId
        ? { ...dorm, managerUserId: newManagerUserId, updatedAt: new Date().toISOString() }
        : dorm
    );
    setDorms(updatedDorms);

    // 2. users 배열 업데이트 - 새 담당자 활성화
    const updatedUsers = users.map(u => 
      u.id === newManagerUserId && u.role === "maintenance_reporter"
        ? { ...u, isActive: true, dormId, updatedAt: new Date().toISOString() }
        : u
    );

    // 3. 기존 담당자 해제 (다른 기숙사 담당자가 아니면 비활성화)
    if (oldManagerUserId && oldManagerUserId !== newManagerUserId) {
      const isOldManagerUsedElsewhere = updatedDorms.some(d => d.id !== dormId && d.managerUserId === oldManagerUserId);
      if (!isOldManagerUsedElsewhere) {
        // manualActiveOverride가 false일 때만 비활성화
        const oldManagerIdx = updatedUsers.findIndex(u => u.id === oldManagerUserId);
        if (oldManagerIdx >= 0 && !updatedUsers[oldManagerIdx].manualActiveOverride) {
          updatedUsers[oldManagerIdx] = { ...updatedUsers[oldManagerIdx], isActive: false, updatedAt: new Date().toISOString() };
        }
      }
    }

    setUsers(updatedUsers);
  };


  const mapNewHireStatusToOccupantStatus = (
    residenceStatus: NewHireResidenceStatus
  ): Occupant["status"] => {
    if (residenceStatus === "퇴실") return "퇴실";
    if (residenceStatus === "만료예정") return "만료예정";
    if (residenceStatus === "연장" || residenceStatus === "거주중") return "거주중";
    return "신규입주";
  };

  const buildOccupantFromNewHire = (
    hire: NewHireEmployee,
    existingOccupant?: Occupant
  ): Occupant | null => {
    if (!hire.dormId) return null;

    return {
      id: existingOccupant?.id || crypto.randomUUID(),
      dormId: hire.dormId,
      site: hire.site,
      employeeName: hire.name,
      gender: hire.gender,
      department: hire.department,
      phone: hire.phone,
      moveInDate: hire.moveInDate,
      moveOutDueDate: hire.moveOutDate,
      status: mapNewHireStatusToOccupantStatus(hire.residenceStatus),
      isNewHireAssignment: true,
      notes: hire.notes,
      expectedMoveInDate: hire.expectedMoveInDate,
      expectedMoveOutDate: hire.expectedMoveOutDate,
      actualMoveOutDate: hire.actualMoveOutDate,
      sourceNewHireId: hire.id,
      createdAt: existingOccupant?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const upsertOccupantFromNewHire = (
    hire: NewHireEmployee,
    currentOccupants: Occupant[]
  ): Occupant[] => {
    const existingOccupant = currentOccupants.find((o) => o.sourceNewHireId === hire.id);
    const occupantPayload = buildOccupantFromNewHire(hire, existingOccupant);
    if (!occupantPayload) return currentOccupants;

    if (existingOccupant) {
      return currentOccupants.map((o) =>
        o.sourceNewHireId === hire.id ? occupantPayload : o
      );
    }

    return [occupantPayload, ...currentOccupants];
  };

  // ============================================
  // 6. 계정 비활성화 로직
  // 계약상태 = 종료/해지 또는 담당자 변경 시
  // 기존 관리자 isActive = false
  // ============================================
  const deactivateStaleManagers = (): void => {
    const validDormIds = new Set<string>();
    dorms.forEach((dorm) => validDormIds.add(dorm.id));

    const activeManagerIds = new Set<string>(operationalDorms.filter((dorm) => dorm.managerUserId).map((dorm) => dorm.managerUserId!));
    const activeDormIds = new Set<string>(operationalDorms.map((dorm) => dorm.id));

    const updatedUsers = users.map((user) => {
      if (user.role !== "maintenance_reporter" || !user.dormId) return user;
      if (user.manualActiveOverride) return user;
      if (!activeDormIds.has(user.dormId)) return { ...user, isActive: false };
      if (!activeManagerIds.has(user.id)) return { ...user, isActive: false };
      return user;
    });

    // 변경사항이 있으면 업데이트
    if (updatedUsers.some((u, i) => u.isActive !== users[i].isActive)) {
      setUsers(updatedUsers);
    }
  };

  // ============================================
  // 7. 청소보고 입력 최소화 함수
  // 자동 입력: 보고일, 기숙사, 담당자
  // 자동 채움: 주소, 건물명, 동/호수, 관리자
  // 입력만: 사진, 메모
  // ============================================
  const initializeCleaningReportForm = (
    user: LoginUser | null,
    selectedDorm?: OperationalDorm
  ): Omit<CleaningReport, "id" | "createdAt" | "updatedAt"> => {
    const today = new Date().toISOString().slice(0, 10);
    const month = getMonthLabel(today);
    
    const baseForm = cleaningReportTemplate();
    
    if (!user) return baseForm;
    
    // 기본값 설정
    const form: Omit<CleaningReport, "id" | "createdAt" | "updatedAt"> = {
      ...baseForm,
      reportDate: today, // 자동입력, 수정불가
      site: user.siteAccess === "전체" ? "평택" : user.siteAccess,
      managerUserId: user.dormId || "", // 기숙사 담당자 자동
      managerName: user.displayName || user.username, // 담당자명 자동
      reporterUserId: user.id,
      reporterName: user.displayName || user.username,
      weekLabel: getWeekLabel(today),
      monthLabel: month,
    };
    
    // Dorm이 선택되면 추가 정보 자동 채움
    if (selectedDorm) {
      form.dormId = selectedDorm.id;
      form.buildingName = selectedDorm.buildingName;
      form.address = selectedDorm.address;
      form.dong = stripDongHoSuffix(selectedDorm.dong);
      form.roomHo = stripDongHoSuffix(selectedDorm.roomHo);
      form.공동현관 = selectedDorm.공동현관;
      form.세대현관 = selectedDorm.세대현관;
      
      // 해당 기숙사의 관리자 정보
      if (selectedDorm.managerUserId) {
        const dormManager = users.find(u => u.id === selectedDorm.managerUserId);
        if (dormManager) {
          form.managerUserId = dormManager.id;
          form.managerName = dormManager.displayName || dormManager.username;
        }
      }
    }
    
    return form;
  };

  // ============================================
  // 1단계: 자동화 Helper 함수 & useMemo
  // ============================================

  // 기숙사별 현재 거주중 인원 계산
  const getCurrentResidentCount = (dormId: string): number => {
    return occupants.filter(
      (occ) => occ.dormId === dormId && occ.status === "거주중"
    ).length;
  };

  // 계약 자동 상태 결정 (30일 기준)

  // 기숙사 공실 여부 판단
  const getVacancyStatus = (dormId: string): "사용중" | "공실" => {
    const residentCount = getCurrentResidentCount(dormId);
    return residentCount === 0 ? "공실" : "사용중";
  };

  // 주차별 청소보고 상태 계산
  const getCleaningWeekStatus = (
    managerUserId: string,
    weekNumber: number,
    month: string
  ): "O" | "X" | "예정" | "사진누락" => {
    const report = cleaningReports.find(
      (r) =>
        !r.isDeleted &&
        r.managerUserId === managerUserId &&
        r.weekLabel === `${weekNumber}주차` &&
        r.monthLabel === month
    );

    if (!report) {
      const today = new Date();
      const currentWeek = Math.ceil(today.getDate() / 7);
      const currentMonth = `${today.getMonth() + 1}월`;
      
      if (month === currentMonth && weekNumber > currentWeek) {
        return "예정";
      }
      
      // 금요일 기준으로 미제출 판정
      const weekEndDate = new Date(today.getFullYear(), today.getMonth(), weekNumber * 7 + 5);
      if (today > weekEndDate) {
        return "X";
      }
      return "예정";
    }

    if (report.cleanStatus === "불량") {
      return "X";
    }

    if (
      (!report.beforePhotoDataUrls || report.beforePhotoDataUrls.length === 0) ||
      (!report.afterPhotoDataUrls || report.afterPhotoDataUrls.length === 0)
    ) {
      return "사진누락";
    }

    return "O";
  };

  // 자동 생성된 알림 항목들
  const autoNotifications = useMemo(() => {
    const notifications: typeof dashboardAlerts = [];
    const today = new Date().toISOString().slice(0, 10);

    // 1. 계약 만료 30일 이내
    dormContracts.forEach((contract) => {
      if (!contract.contractEnd) return;
      const daysLeft = Math.ceil(
        (new Date(contract.contractEnd).getTime() - new Date(today).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysLeft >= 0 && daysLeft <= 30) {
        notifications.push({
          id: `contract-${contract.id}`,
          type: "contract",
          title: `계약 만료 예정: ${contract.buildingName}`,
          detail: `${contract.contractEnd}에 계약 종료`,
          when: `${daysLeft}일`,
        });
      }
      if (contract.contractStatus === "종료" || contract.contractStatus === "해지") {
        notifications.push({
          id: `contract-status-${contract.id}`,
          type: "contract",
          title: `${contract.buildingName} 계약 ${contract.contractStatus}`,
          detail: `계약 상태가 ${contract.contractStatus}입니다.`,
          when: "주의",
        });
      }
    });

    // 2. 퇴실 예정
    occupants.forEach((occ) => {
      if (!occ.moveOutDueDate) return;
      const daysLeft = Math.ceil(
        (new Date(occ.moveOutDueDate).getTime() - new Date(today).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysLeft >= 0 && daysLeft <= 14 && occ.status !== "퇴실") {
        notifications.push({
          id: `moveout-${occ.id}`,
          type: "occupant",
          title: `${occ.employeeName} 퇴실 예정`,
          detail: `${occ.moveOutDueDate} 거주기한 만료`,
          when: `${daysLeft}일`,
        });
      }
    });

    occupants.forEach((occ) => {
      if (["퇴실", "천안이동", "만료예정"].includes(occ.status)) {
        notifications.push({
          id: `occupant-status-${occ.id}`,
          type: "occupant",
          title: `${occ.employeeName} ${occ.status}`,
          detail: `${occ.status} 상태입니다.`,
          when: "주의",
        });
      }
    });

    // 3. 청소 미제출 (당월)
    const currentMonth = `${new Date().getMonth() + 1}월`;
    users
      .filter((u) => u.role === "maintenance_reporter" && u.dormId)
      .forEach((manager) => {
        let allSubmitted = true;
        for (let week = 1; week <= 5; week++) {
          const status = getCleaningWeekStatus(manager.id, week, currentMonth);
          if (status === "X") {
            allSubmitted = false;
            break;
          }
        }
        if (!allSubmitted) {
          notifications.push({
            id: `cleaning-${manager.id}`,
            type: "cleaning",
            title: `${manager.displayName} 청소보고 미제출`,
            detail: `금주 청소보고서 제출 필요`,
            when: "긴급",
          });
        }
      });

    // 3-1. 청소 불량/재청소요청 상태
    cleaningReports.forEach((report) => {
      if (report.cleanStatus === "불량" || report.cleanStatus === "재청소요청") {
        notifications.push({
          id: `cleaning-status-${report.id}`,
          type: "cleaning",
          title: `${report.buildingName} 청소 불량`,
          detail: `${report.cleanStatus} 상태 - 재청소 필요`,
          when: "주의",
        });
      }
    });

    // 4. 미완료 하자
    defects.forEach((defect) => {
      if (defect.defectStatus !== "완료") {
        notifications.push({
          id: `defect-${defect.id}`,
          type: "defect",
          title: `미완료 하자: ${defect.buildingName} ${formatDong(defect.dong)}-${formatRoomHo(defect.ho)}`,
          detail: defect.requestText || "상세 정보 없음",
          when: "진행중",
        });
      }
    });

    // 5. 비품 저수량
    inventory.forEach((item) => {
      if (item.quantity <= 2) {
        notifications.push({
          id: `inventory-${item.id}`,
          type: "inventory",
          title: `저수량: ${item.itemName}`,
          detail: `현재 수량: ${item.quantity}개`,
          when: "경고",
        });
      }
    });

    // 6. 정원초과
    dorms.forEach((dorm) => {
      const occupantCount = occupants.filter(
        (o) => o.dormId === dorm.id && !["퇴실", "천안이동"].includes(o.status) && !o.isDeleted
      ).length;
      if (occupantCount > (dorm.capacity || 6)) {
        notifications.push({
          id: `overcrowded-${dorm.id}`,
          type: "occupant",
          title: `정원초과: ${dorm.buildingName} ${dorm.dong}-${dorm.roomHo}`,
          detail: `정원 ${dorm.capacity || 6}명 > 현재 ${occupantCount}명`,
          when: "주의",
        });
      }
    });

    return notifications;
  }, [dormContracts, occupants, dorms, users, cleaningReports, defects, inventory]);

  // ============================================
  // 8. 자동화 연결 부분
  // 주차 자동계산, 담당자 기반 필터링, 권한 기반 접근 제어
  // ============================================
  
  // 8-1) 계약 상태 변경 시 매니저 비활성화 자동 체크
  useEffect(() => {
    deactivateStaleManagers();
  }, [dorms, users]);

  // 8-3) 청소보고에서 기숙사 선택 시 주소/담당자 자동 채움
  const handleCleaningReportDormChange = (dorm: OperationalDorm | null) => {
    if (!dorm || !currentUser) return;
    
    const updated = initializeCleaningReportForm(currentUser, dorm);
    setCleaningReportForm(updated);
  };

  // 8-4) 주차 자동 계산 useMemo
  // 8-5) 권한 기반 UI 요소 표시/숨김 (각 섹션에서 사용)
  const shouldShowMaintenanceControls = (user: LoginUser | null) => {
    return user?.role === "maintenance_reporter" || user?.role === "admin";
  };

  // 8-6) 데이터 저장 시 권한 확인 후 자동 연결
  const addCleaningReportWithAutoFill = (
    user: LoginUser | null,
    form: Omit<CleaningReport, "id" | "createdAt" | "updatedAt">
  ) => {
    if (!user || !canEditDormData(user, "maintenance_reporter")) {
      alert("청소보고를 작성할 권한이 없습니다.");
      return;
    }
    
    // 주차/월 자동 계산
    const week = getWeekOfMonth(form.reportDate);
    const month = getMonthLabel(form.reportDate);
    
    const autoFilledForm: CleaningReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...form,
      weekLabel: `${week}주차`,
      monthLabel: month,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    setCleaningReports((prev) => [autoFilledForm, ...prev]);
    createAuditLog({
      targetType: "cleaningReport",
      targetId: autoFilledForm.id,
      actionType: "create",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: "",
      afterValue: JSON.stringify(autoFilledForm),
    });
  };

  // 8-7) 삭제된 기숙사 관리자 계정 비활성화 자동 감지
  useEffect(() => {
    // 주기적으로 stale managers 확인 (변경이 있을 때)
    if (dorms.length > 0 && users.length > 0) {
      deactivateStaleManagers();
    }
  }, [dorms, users]);

  useEffect(() => {
    saveJson(CUSTOM_TEMPLATES_KEY, customTemplates, tenantId);
  }, [customTemplates, tenantId]);

  useEffect(() => saveJson(THEME_KEY, theme, tenantId), [theme, tenantId]);
  useEffect(() => saveJson(USERS_KEY, users, tenantId), [users, tenantId]);
  useEffect(() => saveJson(DORMS_KEY, dorms, tenantId), [dorms, tenantId]);
  useEffect(() => saveJson(OCCUPANTS_KEY, occupants, tenantId), [occupants, tenantId]);
  useEffect(() => saveJson(INVENTORY_KEY, inventory, tenantId), [inventory, tenantId]);
  useEffect(() => saveJson(LEASES_KEY, leases, tenantId), [leases, tenantId]);
  useEffect(() => saveJson(DORM_CONTRACTS_KEY, dormContracts, tenantId), [dormContracts, tenantId]);
  useEffect(() => saveJson(CLEANING_REPORTS_KEY, cleaningReports, tenantId), [cleaningReports, tenantId]);
  useEffect(() => saveJson(CLEANING_SETTINGS_KEY, cleaningSettings, tenantId), [cleaningSettings, tenantId]);
  useEffect(() => saveJson(NEW_HIRES_KEY, newHires, tenantId), [newHires, tenantId]);

  useEffect(() => {
    if (!isSupabaseAvailable()) return;

    const timer = setTimeout(async () => {
      const session = await getCurrentSession();
      if (!session?.user?.id) return;

      try {
        await saveDormModule(
          {
            tenantId,
            dorms,
            occupants,
            dormContracts,
            newHires,
          },
          session.user.id
        );
      } catch (error) {
        console.error("Supabase dorm module sync failed:", error);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [dorms, occupants, dormContracts, newHires, tenantId]);

  useEffect(() => {
    if (!isSupabaseAvailable()) return;

    const timer = setTimeout(async () => {
      const session = await getCurrentSession();
      if (!session?.user?.id) return;

      try {
        console.debug("Operational sync: saving", {
          cleaningReports: cleaningReports.length,
          defects: defects.length,
          inventory: inventory.length,
          settlementRecords: settlementRecords.length,
          settlementItems: settlementItems.length,
          auditLogs: auditLogs.length,
        });
        setOperationalSyncError(null);
        await saveOperationalModule(
          {
            tenantId,
            cleaningReports,
            defects,
            inventory,
            settlementRecords,
            settlementItems,
            auditLogs,
          },
          session.user.id
        );
        // clear any previous error on success
        setOperationalSyncError(null);
      } catch (error) {
        console.error("Supabase operational module sync failed:", error);
        const msg = (error && (error as any).message) || String(error);
        setOperationalSyncError(msg);
        // show immediate visible feedback so QA can notice failures
        try {
          // eslint-disable-next-line no-alert
          alert(`Supabase operational module sync failed: ${msg}`);
        } catch {}
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [cleaningReports, defects, inventory, settlementRecords, settlementItems, auditLogs, tenantId]);

  useEffect(() => saveJson(SETTLEMENT_RECORDS_KEY, settlementRecords, tenantId), [settlementRecords, tenantId]);
  useEffect(() => saveJson(SETTLEMENT_ITEMS_KEY, settlementItems, tenantId), [settlementItems, tenantId]);

  useEffect(() => {
    if (!newHires.length) return;
    setOccupants((prevOccupants) =>
      newHires.reduce((acc, newHire) => upsertOccupantFromNewHire(newHire, acc), prevOccupants)
    );
  }, [newHires]);

  useEffect(() => saveJson(SALES_KEY, sales, tenantId), [sales, tenantId]);
  useEffect(() => saveJson(DEFECTS_KEY, defects, tenantId), [defects, tenantId]);
  useEffect(() => saveJson(AUDIT_LOGS_KEY, auditLogs, tenantId), [auditLogs, tenantId]);
  useEffect(() => saveJson(MILITARY_PERSONNEL_KEY, militaryPersonnel, tenantId), [militaryPersonnel, tenantId]);
  useEffect(() => saveJson(MILITARY_TRAINING_KEY, militaryTrainingRecords, tenantId), [militaryTrainingRecords, tenantId]);
  useEffect(() => saveJson(MILITARY_NOTICES_KEY, militaryNotices, tenantId), [militaryNotices, tenantId]);
  useEffect(() => saveJson(MILITARY_REPORTS_KEY, militaryReports, tenantId), [militaryReports, tenantId]);
  useEffect(() => saveJson(MILITARY_SETTINGS_KEY, militarySettings, tenantId), [militarySettings, tenantId]);
  useEffect(() => saveJson(MILITARY_TRAINING_RULES_KEY, militaryTrainingRules, tenantId), [militaryTrainingRules, tenantId]);
  useEffect(() => saveJson(MILITARY_CODE_VALUES_KEY, militaryCodeValues, tenantId), [militaryCodeValues, tenantId]);
  useEffect(() => saveJson(MILITARY_TRAINING_AUTOCREATE_KEY, militaryTrainingAutoConfig, tenantId), [militaryTrainingAutoConfig, tenantId]);

  const computeRequiredTraining = (person: MilitaryPersonnel) => {
    try {
      const category = getMilitaryCategory(person, effectiveMilitaryReferenceYear);
      const personYear = getTrainingYear(person, effectiveMilitaryReferenceYear);
      const applicable = militaryTrainingRules.filter((r) => {
        if (r.category && r.category !== category) return false;
        if (r.yearMin != null && personYear < Number(r.yearMin)) return false;
        if (r.yearMax != null && personYear > Number(r.yearMax)) return false;
        if (r.mobilizationOnly && !person.mobilization) return false;
        return true;
      });

      if (!applicable || applicable.length === 0) {
        return getRequiredTraining(person, effectiveMilitaryReferenceYear);
      }

      if (applicable.length === 1) {
        const r = applicable[0];
        return { label: r.name || r.trainingType || "정의된훈련", hours: Number(r.requiredHours) || 0 };
      }

      // multiple applicable rules - prefer mobilization-specific when person.mobilization is true
      if (person.mobilization) {
        const mr = applicable.find((x) => x.mobilizationOnly);
        if (mr) return { label: mr.name || mr.trainingType, hours: Number(mr.requiredHours) || 0 };
      }
      // otherwise prefer a non-mobilization rule
      const nr = applicable.find((x) => !x.mobilizationOnly) || applicable[0];
      return { label: nr.name || nr.trainingType, hours: Number(nr.requiredHours) || 0 };
    } catch (err) {
      return getRequiredTraining(person, effectiveMilitaryReferenceYear);
    }
  };

  const computeTrainingStatus = (person: MilitaryPersonnel) => {
    const training = computeRequiredTraining(person);
    if (training.hours === 0) {
      return training.label === "훈련없음" ? "해당없음" : "대상아님";
    }
    const personRecords = militaryTrainingRecords.filter((record) => record.personnelId === person.id);
    const completedRecords = personRecords.filter((record) => /(완료|이수|completed)/i.test(record.status));
    const completedHours = completedRecords.reduce((sum, record) => sum + (record.trainingHours || 0), 0);

    if (completedRecords.length > 0 && (completedHours >= training.hours || completedHours === 0)) {
      return "완료";
    }
    if (personRecords.length > 0) return "미이수";
    const status = person.status?.toLowerCase() || "";
    if (/(완료|이수|completed)/i.test(status)) return "완료";
    return "미이수";
  };
  useEffect(() => saveJson(SYSTEM_SETTINGS_KEY, systemSettings, tenantId), [systemSettings, tenantId]);
  useEffect(() => {
    if (currentUser) {
      const { password: _p, ...safeUser } = currentUser;
      saveJson(AUTH_KEY, safeUser, tenantId);
    } else {
      removeJson(AUTH_KEY, tenantId);
    }
  }, [currentUser, tenantId]);

  const operationalDorms = useMemo<OperationalDorm[]>(() => {
    const latestContractByDorm = new Map<string, DormContract>();
    dormContracts.forEach((contract) => {
      const key = getDormKey(contract.site, contract.buildingName, contract.dong, contract.roomHo);
      const existing = latestContractByDorm.get(key);
      const currentUpdatedAt = contract.updatedAt ? Date.parse(contract.updatedAt) : 0;
      const existingUpdatedAt = existing?.updatedAt ? Date.parse(existing.updatedAt) : 0;
      if (!existing || currentUpdatedAt >= existingUpdatedAt) {
        latestContractByDorm.set(key, contract);
      }
    });

    return Array.from(latestContractByDorm.values())
      .filter((contract) => !contract.isDeleted)
      .filter((contract) => contract.contractStatus !== "종료" && contract.contractStatus !== "해지")
      .filter((contract) => ["공실", "진행중", "만료예정", "연장"].includes(contract.contractStatus))
      .map((contract) => {
        const key = getDormKey(contract.site, contract.buildingName, contract.dong, contract.roomHo);
        const matchedDorm = dorms.find((d) => getDormKey(d.site, d.buildingName, d.dong, d.roomHo) === key && !d.isDeleted);
        return {
          id: matchedDorm?.id || contract.id,
          site: contract.site,
          gender: contract.gender,
          buildingName: contract.buildingName,
          address: matchedDorm?.address || contract.address || "",
          dong: contract.dong,
          roomHo: contract.roomHo,
          pyeong: contract.pyeong,
          capacity: matchedDorm?.capacity ?? 6,
          managerUserId: matchedDorm?.managerUserId || "",
          contractStart: contract.contractStart,
          contractEnd: contract.contractEnd,
          contractAmount: contract.contractAmount,
          leaseStatus: contract.contractStatus === "공실" ? "공실" : contract.contractStatus === "만료예정" ? "만료예정" : "사용중",
          공동현관: contract.공동현관 || matchedDorm?.공동현관 || "",
          세대현관: contract.세대현관 || matchedDorm?.세대현관 || "",
          prepaymentDeposit: matchedDorm?.prepaymentDeposit ?? Number(contract.prepaymentDeposit || 0),
          realEstateName: contract.realEstateName || matchedDorm?.realEstateName || "",
          balanceDate: matchedDorm?.balanceDate || "",
          notes: matchedDorm?.notes || "",
          createdAt: matchedDorm?.createdAt || contract.createdAt || new Date().toISOString(),
          updatedAt: matchedDorm?.updatedAt || contract.updatedAt || new Date().toISOString(),
          isDeleted: false,
        } as Dorm;
      });
  }, [dormContracts, dorms]);

  const reportPeriod = `${reportYear}-${reportMonth}`;

  const reportFilteredOperationalDorms = useMemo(() => {
    return operationalDorms.filter((dorm) => {
      if (reportSiteFilter !== "전체" && dorm.site !== reportSiteFilter) return false;
      if (reportGenderFilter !== "전체" && dorm.gender !== reportGenderFilter) return false;
      return true;
    });
  }, [operationalDorms, reportSiteFilter, reportGenderFilter]);

  const reportData = useMemo(() => {
    const totalDorms = reportFilteredOperationalDorms.length;
    const vacantDorms = reportFilteredOperationalDorms.filter((dorm) => getVacancyStatus(dorm.id) === "공실").length;
    const vacancyRate = totalDorms > 0 ? ((vacantDorms / totalDorms) * 100).toFixed(1) : "0";
    const vacancyDormCount = vacantDorms;
    const totalDormCount = totalDorms;

    const relatedDormIds = new Set(reportFilteredOperationalDorms.map((d) => d.id));
    const relatedDormKeys = new Set(
      reportFilteredOperationalDorms.map((d) => getDormKey(d.site, d.buildingName, d.dong, d.roomHo))
    );

    const periodCleaningReports = cleaningReports.filter(
      (r) => !r.isDeleted && r.reportDate.startsWith(reportPeriod) && relatedDormIds.has(r.dormId)
    );
    const totalSubmitted = periodCleaningReports.length;
    const requiredCleaningCount = reportFilteredOperationalDorms.length * 5;
    const cleaningSubmissionRate =
      requiredCleaningCount > 0
        ? ((totalSubmitted / requiredCleaningCount) * 100).toFixed(1)
        : "0";
    const submittedCleaningCount = totalSubmitted;

    const periodDefects = defects.filter(
      (d) => !d.isDeleted && d.receiptDate.startsWith(reportPeriod) && relatedDormIds.has(d.dormId)
    );
    const completedDefects = periodDefects.filter((d) => d.defectStatus === "완료").length;
    const defectCompletionRate =
      periodDefects.length > 0 ? ((completedDefects / periodDefects.length) * 100).toFixed(1) : "0";
    const completedDefectCount = completedDefects;
    const totalDefectCount = periodDefects.length;

    const expiringContractCount = dormContracts.filter(
      (c) =>
        !c.isDeleted &&
        c.contractEnd.startsWith(reportPeriod) &&
        relatedDormKeys.has(getDormKey(c.site, c.buildingName, c.dong, c.roomHo))
    ).length;

    return {
      vacancyRate,
      defectCompletionRate,
      vacancyDormCount,
      totalDormCount,
      cleaningSubmissionRate,
      requiredCleaningCount,
      submittedCleaningCount,
      completedDefectCount,
      totalDefectCount,
      expiringContractCount,
    };
  }, [reportFilteredOperationalDorms, reportPeriod, cleaningReports, defects, dormContracts]);

  const filteredUnassignedNewHires = useMemo(() => {
    return newHires.filter((hire) => {
      const isUnassigned = !hire.dormId || hire.dormId.trim() === "";
      const siteMatched =
        assignmentSiteFilter === "전체" || hire.site === assignmentSiteFilter;
      const genderMatched =
        assignmentGenderFilter === "전체" || hire.gender === assignmentGenderFilter;
      const searchMatched = !assignmentNewHireSearch ||
        hire.name.toLowerCase().includes(assignmentNewHireSearch.toLowerCase()) ||
        hire.department.toLowerCase().includes(assignmentNewHireSearch.toLowerCase()) ||
        hire.phone.toLowerCase().includes(assignmentNewHireSearch.toLowerCase());

      return !hire.isDeleted && isUnassigned && siteMatched && genderMatched && searchMatched;
    });
  }, [newHires, assignmentSiteFilter, assignmentGenderFilter, assignmentNewHireSearch]);

  const filteredDormsForAssignment = useMemo(() => {
    return operationalDorms.filter((d) => {
      if (assignmentSiteFilter !== "전체" && d.site !== assignmentSiteFilter) return false;
      if (assignmentGenderFilter !== "전체" && d.gender !== assignmentGenderFilter) return false;
      return true;
    });
  }, [operationalDorms, assignmentSiteFilter, assignmentGenderFilter]);

  const resolveOperationalDormId = (
    item: { dormId: string; site?: Site; buildingName?: string; dong?: string; roomHo?: string },
    operationalDorms: OperationalDorm[],
    dorms: Dorm[]
  ): string => {
    if (operationalDorms.some((d) => d.id === item.dormId)) return item.dormId;

    const dorm = dorms.find((d) => d.id === item.dormId);
    if (dorm) {
      const key = getDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo);
      const opDorm = operationalDorms.find((d) => getDormKey(d.site, d.buildingName, d.dong, d.roomHo) === key);
      if (opDorm) return opDorm.id;
    }

    if (item.site && item.buildingName && item.dong && item.roomHo) {
      const key = getDormKey(item.site, item.buildingName, item.dong, item.roomHo);
      const opDorm = operationalDorms.find((d) => getDormKey(d.site, d.buildingName, d.dong, d.roomHo) === key);
      if (opDorm) return opDorm.id;
    }

    return item.dormId;
  };

  const updateDormIdToOperational = <T extends { dormId: string }>(items: T[], operationalDorms: OperationalDorm[], dorms: Dorm[]): T[] => {
    return items.map((item) => {
      const resolvedDormId = resolveOperationalDormId(item, operationalDorms, dorms);
      return resolvedDormId !== item.dormId ? { ...item, dormId: resolvedDormId } : item;
    });
  };

  useEffect(() => {
    if (defectForm.dormId) {
      const selectedDorm = operationalDorms.find((d) => d.id === defectForm.dormId);
      if (selectedDorm) {
        setDefectForm((prev) => ({
          ...prev,
          roadAddress: selectedDorm.address,
          buildingName: selectedDorm.buildingName,
          dong: selectedDorm.dong,
          ho: selectedDorm.roomHo,
        }));
      }
    }
  }, [defectForm.dormId, operationalDorms]);

  // ============================================
  // 동기화 4: 퇴실 → 청소관리 (자동 생성)
  // 동기화 5: 퇴실 → 하자점검 (자동 생성)
  // ============================================
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().slice(0, 10);
    
    const recentlyExitedOccupants = occupants.filter(
      o => o.status === "퇴실" && o.actualMoveOutDate && 
           o.actualMoveOutDate >= sevenDaysAgo && 
           !o.isDeleted
    );

    recentlyExitedOccupants.forEach(occupant => {
      // 4. 퇴실 → 청소관리: 자동 청소레포트 신규 생성 (중복 방지)
      const existingCleaning = cleaningReports.find(
        r => r.dormId === occupant.dormId && 
             !r.isDeleted &&
             r.reportDate >= (occupant.actualMoveOutDate || today) &&
             r.memo && r.memo.includes(occupant.employeeName)
      );
      
      if (!existingCleaning && occupant.dormId && occupant.actualMoveOutDate) {
        const dorm = operationalDorms.find(d => d.id === occupant.dormId);
        if (dorm) {
          const newCleaning: CleaningReport = {
            id: crypto.randomUUID(),
            reportDate: occupant.actualMoveOutDate,
            site: occupant.site,
            dormId: occupant.dormId,
            buildingName: dorm.buildingName,
            address: dorm.address,
            dong: dorm.dong,
            roomHo: dorm.roomHo,
            공동현관: dorm.공동현관,
            세대현관: dorm.세대현관,
            managerUserId: dorm.managerUserId || "",
            managerName: dorm.managerUserId ? (users.find(u => u.id === dorm.managerUserId)?.displayName || "") : "",
            cleanerName: "",
            weekLabel: `${Math.ceil(new Date(occupant.actualMoveOutDate).getDate() / 7)}주차`,
            monthLabel: `${new Date(occupant.actualMoveOutDate).getMonth() + 1}월`,
            cleanStatus: "미제출",
            checkResult: "-",
            score: 0,
            memo: `[자동] ${occupant.employeeName} 퇴실 후 청소`,
            beforePhotoDataUrls: [],
            afterPhotoDataUrls: [],
            reporterUserId: currentUser?.id || "",
            reporterName: currentUser?.displayName || "",
            createdAt: today,
            updatedAt: today,
          };
          setCleaningReports(prev => [newCleaning, ...prev]);
        }
      }

      // 5. 퇴실 → 하자점검: 자동 하자점검 레코드 신규 생성 (중복 방지)
      const existingDefect = defects.find(
        d => d.dormId === occupant.dormId && 
             !d.isDeleted &&
             d.createdAt >= (occupant.actualMoveOutDate || today) &&
             d.requestText && d.requestText.includes(occupant.employeeName)
      );
      
      if (!existingDefect && occupant.dormId && occupant.actualMoveOutDate) {
        const dorm = operationalDorms.find(d => d.id === occupant.dormId);
        if (dorm) {
          const newDefect: DefectRequest = {
            id: crypto.randomUUID(),
            receiptDate: occupant.actualMoveOutDate,
            site: occupant.site,
            dormId: occupant.dormId,
            inspectorName: currentUser?.displayName || "",
            dormManagerName: dorm.managerUserId ? (users.find(u => u.id === dorm.managerUserId)?.displayName || "") : "",
            managerUserId: dorm.managerUserId || "",
            buildingName: dorm.buildingName,
            dong: dorm.dong,
            ho: dorm.roomHo,
            공동현관: dorm.공동현관,
            세대현관: dorm.세대현관,
            roadAddress: dorm.address,
            detailAddress: "",
            requestText: `[자동] ${occupant.employeeName} 퇴실 후 사전 점검`,
            defectStatus: "접수",
            completeText: "",
            reporterUserId: currentUser?.id || "",
            reporterName: currentUser?.displayName || "",
            requestPhotoDataUrls: [],
            completionPhotoDataUrls: [],
            createdAt: today,
          };
          setDefects(prev => [newDefect, ...prev]);
        }
      }
    });
  }, [occupants, cleaningReports, defects, operationalDorms, users, currentUser]);

  useEffect(() => {
    const updatedOccupants = updateDormIdToOperational(occupants, operationalDorms, dorms);
    if (updatedOccupants.some((o, i) => o.dormId !== occupants[i].dormId)) {
      setOccupants(updatedOccupants);
    }

    const updatedInventory = updateDormIdToOperational(inventory, operationalDorms, dorms);
    if (updatedInventory.some((o, i) => o.dormId !== inventory[i].dormId)) {
      setInventory(updatedInventory);
    }

    const updatedDefects = updateDormIdToOperational(defects, operationalDorms, dorms);
    if (updatedDefects.some((o, i) => o.dormId !== defects[i].dormId)) {
      setDefects(updatedDefects);
    }

    const updatedCleaningReports = updateDormIdToOperational(cleaningReports, operationalDorms, dorms);
    if (updatedCleaningReports.some((o, i) => o.dormId !== cleaningReports[i].dormId)) {
      setCleaningReports(updatedCleaningReports);
    }

    const updatedNewHires = updateDormIdToOperational(newHires, operationalDorms, dorms);
    if (updatedNewHires.some((o, i) => o.dormId !== newHires[i].dormId)) {
      setNewHires(updatedNewHires);
    }

    if (currentUser && currentUser.dormId) {
      const operationalDorm = operationalDorms.find((d) => d.id === currentUser.dormId);
      if (!operationalDorm) {
        const dorm = dorms.find((d) => d.id === currentUser.dormId);
        if (dorm) {
          const key = getDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo);
          const opDorm = operationalDorms.find((d) => getDormKey(d.site, d.buildingName, d.dong, d.roomHo) === key);
          if (opDorm) {
            setCurrentUser({ ...currentUser, dormId: opDorm.id });
          }
        }
      }
    }
  }, [operationalDorms, occupants, inventory, defects, cleaningReports, newHires, currentUser, dorms]);

  // ============================================
  // 동기화 7: 기숙사 정원 ↔ 배정 가능 여부
  // (파생 상태: dormCapacityInfo)
  // ============================================
  const dormCapacityInfo = useMemo(() => {
    return operationalDorms.map(dorm => ({
      dormId: dorm.id,
      capacity: dorm.capacity || 6,
      currentResidents: getCurrentResidentCount(dorm.id),
      vacancy: Math.max((dorm.capacity || 6) - getCurrentResidentCount(dorm.id), 0),
      available: (dorm.capacity || 6) - getCurrentResidentCount(dorm.id) > 0,
    }));
  }, [operationalDorms, occupants]);

  const visibleDorms = useMemo(() => {
    return operationalDorms.filter((dorm) => {
      if (!hasAccessToDorm(currentUser, dorm.id)) return false;
      if (dormSiteFilter !== "전체" && dorm.site !== dormSiteFilter) return false;
      if (dormGenderFilter !== "전체" && dorm.gender !== dormGenderFilter) return false;
      if (dormSearch) {
        const text = `${dorm.site} ${dorm.gender} ${dorm.buildingName} ${dorm.address} ${dorm.dong} ${dorm.roomHo} ${dorm.pyeong} ${dorm.realEstateName}`.toLowerCase();
        if (!text.includes(dormSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [operationalDorms, currentUser, dormSearch, dormSiteFilter, dormGenderFilter]);

  const visibleDormContracts = useMemo(() => {
    return dormContracts.filter((c) => {
      if (c.isDeleted) return false;
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        // maintenance_reporter는 자신의 site 데이터만 볼 수 있음
        const userDorm = operationalDorms.find(d => d.id === currentUser.dormId);
        if (!userDorm || c.site !== userDorm.site) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      if (dormContractSiteFilter !== "전체" && c.site !== dormContractSiteFilter) return false;
      const status = getDormContractDisplayStatus(c, dorms, occupants);
      if (dormContractStatusFilter !== "전체" && status !== dormContractStatusFilter) return false;
      if (dormContractSearch) {
        const text = `${c.site} ${c.address} ${c.buildingName} ${c.dong} ${c.roomHo} ${c.pyeong} ${c.landlordName} ${c.landlordPhone} ${c.realEstateName} ${c.realEstatePhone} ${c.contractStart} ${c.contractEnd} ${status} ${c.contractAmount} ${c.prepaymentDeposit} ${c.deposit} ${c.monthlyRentOrMaintenance} ${c.contractType} ${c.notes} ${c.registeredBy} ${c.modifiedBy}`.toLowerCase();
        return text.includes(dormContractSearch.toLowerCase());
      }
      return true;
    });
  }, [dormContracts, dormContractSearch, dormContractSiteFilter, dormContractStatusFilter, dorms, occupants, currentUser, operationalDorms]);

  const visibleNewHires = useMemo(() => {
    return newHires.filter((h) => {
      if (h.isDeleted) return false;
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        if (h.dormId !== currentUser.dormId) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      const dorm =
        operationalDorms.find((d) => d.id === h.dormId) ||
        dorms.find((d) => d.id === h.dormId);
      const site = dorm?.site || h.site;
      if (newHireSiteFilter !== "전체" && site !== newHireSiteFilter) return false;
      if (newHireGenderFilter !== "전체" && h.gender !== newHireGenderFilter) return false;
      const isUnassigned = !h.dormId || !h.buildingName || !h.address;
      if (newHireAssignmentFilter === "배정완료" && isUnassigned) return false;
      if (newHireAssignmentFilter === "미배정" && !isUnassigned) return false;
      if (newHireSearch) {
        const text = `${site} ${h.gender} ${h.name} ${h.phone} ${h.department} ${h.dormId} ${h.buildingName} ${h.dong} ${h.roomHo} ${h.expectedMoveInDate} ${h.moveInDate} ${h.expectedMoveOutDate} ${h.moveOutDate} ${h.actualMoveOutDate} ${h.cheonanMoveDate} ${h.residenceStatus} ${h.moveInType} ${h.extensionReason} ${h.notes}`.toLowerCase();
        return text.includes(newHireSearch.toLowerCase());
      }
      return true;
    });
  }, [newHires, newHireSearch, newHireSiteFilter, newHireGenderFilter, newHireAssignmentFilter, currentUser]);

  const visibleOccupants = useMemo(() => {
    return occupants.filter((o) => {
      if (o.isDeleted) return false;
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        if (o.dormId !== currentUser.dormId) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      const dorm =
        operationalDorms.find((d) => d.id === o.dormId) ||
        dorms.find((d) => d.id === o.dormId);
      if (!dorm) return false;
      if (occupantSiteFilter !== "전체" && dorm.site !== occupantSiteFilter) return false;
      if (occupantGenderFilter !== "전체" && o.gender !== occupantGenderFilter) return false;
      if (occupantStatusFilter !== "전체") {
        if (occupantStatusFilter === "거주중") {
          if (!["거주중", "만료예정", "신규입주"].includes(o.status)) return false;
        } else {
          if (o.status !== occupantStatusFilter) return false;
        }
      }
      const text = `${dorm.site} ${dorm.buildingName} ${dorm.dong} ${dorm.roomHo} ${o.employeeName} ${o.department} ${o.phone} ${o.status}`.toLowerCase();
      return !occupantSearch || text.includes(occupantSearch.toLowerCase());
    });
  }, [occupants, dorms, operationalDorms, occupantSearch, occupantSiteFilter, occupantGenderFilter, occupantStatusFilter, currentUser]);

  const selectedDetailDorm = operationalDorms.find((dorm) => dorm.id === selectedDormDetailId) || null;
  const selectedDetailOccupants = selectedDetailDorm
    ? visibleOccupants.filter((occupant) => occupant.dormId === selectedDormDetailId)
    : [];
  const selectedDetailInventory = selectedDetailDorm
    ? inventory.filter((item) => item.dormId === selectedDormDetailId && !item.isDeleted)
    : [];

  const filteredDormsForOccupantMenu = useMemo(() => {
    return visibleDorms.filter((dorm) => {
      if (occupantMenuFilterSite !== "전체" && dorm.site !== occupantMenuFilterSite) return false;
      if (occupantMenuFilterGender !== "전체" && dorm.gender !== occupantMenuFilterGender) return false;
      if (occupantMenuFilterSearch) {
        const text = `${dorm.buildingName} ${dorm.address} ${dorm.dong} ${dorm.roomHo}`.toLowerCase();
        if (!text.includes(occupantMenuFilterSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [visibleDorms, occupantMenuFilterSite, occupantMenuFilterGender, occupantMenuFilterSearch]);

  const visibleUsers = useMemo(() => {
    return users.filter((u) => {
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        // maintenance_reporter는 자신만 볼 수 있음
        if (u.id !== currentUser.id) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      const text = `${u.displayName} ${u.username}`.toLowerCase();
      return !userSearch || text.includes(userSearch.toLowerCase());
    });
  }, [users, userSearch, currentUser]);

  const visibleInventory = useMemo(() => {
    return inventory.filter((i) => {
      if (i.isDeleted) return false;
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        if (i.dormId !== currentUser.dormId) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      // 날짜 필터링
      if (inventoryYearFilter !== "전체" && i.issuedDate) {
        const year = new Date(i.issuedDate).getFullYear().toString();
        if (year !== inventoryYearFilter) return false;
      }
      if (inventoryMonthFilter !== "전체" && i.issuedDate) {
        const month = (new Date(i.issuedDate).getMonth() + 1).toString().padStart(2, '0');
        if (month !== inventoryMonthFilter) return false;
      }
      if (inventoryDayFilter !== "전체" && i.issuedDate) {
        const day = new Date(i.issuedDate).getDate().toString().padStart(2, '0');
        if (day !== inventoryDayFilter) return false;
      }

      const text = `${i.site} ${i.dormAddress} ${i.buildingName} ${i.dong} ${i.roomHo} ${i.managerName} ${i.itemName} ${i.quantity} ${i.modelName} ${i.maker} ${i.status} ${i.installationLocation} ${i.purchaseDate} ${i.purchaseAmount} ${i.issuedDate} ${i.proofFile} ${i.soldDate} ${i.soldAmount} ${i.disposalDate} ${i.disposalReason} ${i.notes}`.toLowerCase();
      return !inventorySearch || text.includes(inventorySearch.toLowerCase());
    });
  }, [inventory, inventorySearch, inventoryYearFilter, inventoryMonthFilter, inventoryDayFilter, currentUser]);

  const visibleLeases = useMemo(() => {
    return leases.filter((lease) => {
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        // maintenance_reporter는 자신의 site 데이터만 볼 수 있음
        const userDorm = operationalDorms.find(d => d.id === currentUser.dormId);
        if (!userDorm || lease.site !== userDorm.site) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      // 날짜 필터링
      if (leaseYearFilter !== "전체" && lease.contractDate) {
        const year = new Date(lease.contractDate).getFullYear().toString();
        if (year !== leaseYearFilter) return false;
      }
      if (leaseMonthFilter !== "전체" && lease.contractDate) {
        const month = (new Date(lease.contractDate).getMonth() + 1).toString().padStart(2, '0');
        if (month !== leaseMonthFilter) return false;
      }
      if (leaseDayFilter !== "전체" && lease.contractDate) {
        const day = new Date(lease.contractDate).getDate().toString().padStart(2, '0');
        if (day !== leaseDayFilter) return false;
      }

      const validSettlementYear = getValidSettlementYear(settlementYear);
      const validSettlementMonth = getValidSettlementMonth(settlementMonth);
      const contractDate = parseSafeDate(lease.contractDate);
      const matchesYearMonth =
        !validSettlementYear || !validSettlementMonth ||
        (contractDate &&
         contractDate.getFullYear() === Number(validSettlementYear) &&
         contractDate.getMonth() + 1 === Number(validSettlementMonth));
      const matchesSite = settlementSiteFilter === "전체" || lease.site === settlementSiteFilter;
      const matchesSearch =
        !settlementSearch ||
        `${lease.addressName} ${lease.dong}-${lease.ho} ${lease.realEstateName} ${lease.site}`
          .toLowerCase()
          .includes(settlementSearch.toLowerCase());

      const text = `${lease.addressName} ${lease.dong} ${lease.ho} ${lease.pyeong} ${lease.contractAmount} ${lease.contractPeriod} ${lease.contractDate} ${lease.prepaymentDeposit} ${lease.realEstateName} ${lease.balanceDate} ${lease.notes}`.toLowerCase();
      return (!lease.isDeleted) && (!leaseSearch || text.includes(leaseSearch.toLowerCase())) && matchesYearMonth && matchesSite && matchesSearch;
    });
  }, [leases, leaseSearch, leaseYearFilter, leaseMonthFilter, leaseDayFilter, settlementYear, settlementMonth, settlementSiteFilter, settlementSearch, currentUser, operationalDorms]);

  const visibleSales = useMemo(() => {
    return sales.filter((sale) => {
      // 권한 필터링
      if (currentUser?.role === "maintenance_reporter") {
        // maintenance_reporter는 자신의 site 데이터만 볼 수 있음
        const userDorm = operationalDorms.find(d => d.id === currentUser.dormId);
        if (!userDorm || sale.site !== userDorm.site) return false;
      } else if (currentUser?.role === "viewer") {
        // viewer는 조회만 가능 (필터링 없음)
      } else if (!currentUser?.role || currentUser.role !== "admin") {
        return false;
      }

      const validSettlementYear = getValidSettlementYear(settlementYear);
      const validSettlementMonth = getValidSettlementMonth(settlementMonth);
      const saleDate = parseSafeDate(sale.saleDate);
      
      // Settlement filter (for settlement tab)
      const matchesSettlementYearMonth =
        !validSettlementYear || !validSettlementMonth ||
        (saleDate &&
         saleDate.getFullYear() === Number(validSettlementYear) &&
         saleDate.getMonth() + 1 === Number(validSettlementMonth));
      const matchesSettlementSite = settlementSiteFilter === "전체" || sale.site === settlementSiteFilter;
      const matchesSettlementSearch =
        !settlementSearch ||
        `${sale.itemName} ${sale.buyerCompany} ${sale.site}`
          .toLowerCase()
          .includes(settlementSearch.toLowerCase());
      
      // Sales filter (for sales tab)
      const matchesSalesYearMonth =
        !saleYear || !saleMonth ||
        (saleDate &&
         saleDate.getFullYear() === Number(saleYear) &&
         saleDate.getMonth() + 1 === Number(saleMonth));
      
      const text = `${sale.saleDate} ${sale.itemName} ${sale.unitPrice} ${sale.quantity} ${sale.totalAmount} ${sale.buyerCompany} ${sale.notes}`.toLowerCase();
      const matchesSalesSearch = !saleSearch || text.includes(saleSearch.toLowerCase());
      
      // Use settlement filters OR sales filters
      const settleMatches = matchesSettlementYearMonth && matchesSettlementSite && matchesSettlementSearch;
      const salesMatches = matchesSalesYearMonth && matchesSalesSearch;
      
      return (settleMatches || salesMatches);
    });
  }, [sales, saleSearch, saleYear, saleMonth, settlementYear, settlementMonth, settlementSiteFilter, settlementSearch, currentUser, operationalDorms]);

  const visibleDefects = useMemo(() => {
    const filterDefects = (d: DefectRequest) => {
      if (d.isDeleted) return false;
      const defectDorm = findOperationalDormForDefect(d);
      const text = `${d.receiptDate} ${d.inspectorName} ${d.dormManagerName} ${defectDorm?.buildingName || d.buildingName} ${defectDorm?.dong || d.dong} ${defectDorm?.roomHo || d.ho} ${d["공동현관"]} ${d["세대현관"]} ${d.roadAddress} ${d.defectStatus} ${d.requestText} ${d.completeText} ${d.reporterName}`.toLowerCase();
      const matchesStatus = defectStatusFilter === "전체" || d.defectStatus === defectStatusFilter;
      return matchesStatus && (!defectSearch || text.includes(defectSearch.toLowerCase()));
    };

    if (currentUser?.role === "maintenance_reporter") {
      return defects.filter((d) => d.reporterUserId === currentUser.id && filterDefects(d));
    }
    return defects.filter(filterDefects);
  }, [defects, currentUser, defectSearch, defectStatusFilter]);

  // Settlement Management Calculations


  const visibleCleaningReports = useMemo(() => {
    return cleaningReports.filter((report) => {
      if (report.isDeleted) return false;
      const reportDate = parseSafeDate(report.reportDate);
      const reportDorm = findOperationalDormForCleaningReport(report);
      const matchesYearMonth =
        reportDate &&
        reportDate.getFullYear() === Number(cleaningYear) &&
        reportDate.getMonth() + 1 === Number(cleaningMonth);
      const matchesSite =
        cleaningDormSiteFilter === "전체" ||
        (reportDorm?.site || report.site) === cleaningDormSiteFilter;
      const matchesDormSearch =
        !cleaningDormSearch ||
        `${reportDorm?.buildingName || report.buildingName} ${reportDorm?.dong || report.dong} ${reportDorm?.roomHo || report.roomHo} ${reportDorm?.address || report.address}`
          .toLowerCase()
          .includes(cleaningDormSearch.toLowerCase());
      const managerName =
        users.find((u) => u.id === report.managerUserId)?.displayName || report.managerName;
      const matchesManager =
        cleaningManagerFilter === "전체" ||
        cleaningManagerFilter === "" ||
        managerName === cleaningManagerFilter;
      const matchesStatus = cleaningStatusFilter === "전체" || report.cleanStatus === cleaningStatusFilter;
      const matchesPermission =
        currentUser?.role === "admin" ||
        report.reporterUserId === currentUser?.id ||
        report.managerUserId === currentUser?.id;
      const onlyOwnReports = currentUser?.role === "maintenance_reporter";
      return (
        Boolean(matchesYearMonth) &&
        matchesSite &&
        matchesDormSearch &&
        matchesManager &&
        matchesStatus &&
        (onlyOwnReports ? report.reporterUserId === currentUser?.id : matchesPermission)
      );
    });
  }, [cleaningReports, cleaningYear, cleaningMonth, cleaningDormSiteFilter, cleaningDormSearch, cleaningManagerFilter, cleaningStatusFilter, users, currentUser]);

  const deletedDorms = useMemo(() => dorms.filter((d) => d.isDeleted), [dorms]);
  const deletedDormContracts = useMemo(() => dormContracts.filter((c) => c.isDeleted), [dormContracts]);
  const deletedNewHires = useMemo(() => newHires.filter((h) => h.isDeleted), [newHires]);
  const deletedOccupants = useMemo(() => occupants.filter((o) => o.isDeleted), [occupants]);
  const deletedInventory = useMemo(() => inventory.filter((i) => i.isDeleted), [inventory]);
  const deletedLeases = useMemo(() => leases.filter((l) => l.isDeleted), [leases]);
  const deletedDefects = useMemo(() => defects.filter((d) => d.isDeleted), [defects]);
  const deletedCleaningReports = useMemo(() => cleaningReports.filter((report) => report.isDeleted), [cleaningReports]);

  

  const getStayMonths = (startDate: Date | null, endDate: Date | null) => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    return (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1;
  };

  const isWeekend = (value: string) => {
    const date = parseSafeDate(value);
    if (!date) return false;
    const day = date.getDay();
    return day === 0 || day === 6;
  };

  const getWeekRange = (year: string, month: string, weekNo: number) => {
    const monthIndex = Number(month) - 1;
    const first = new Date(Number(year), monthIndex, 1);
    const offset = (first.getDay() + 6) % 7;
    const startDay = 1 + (weekNo - 1) * 7 - offset;
    const start = new Date(Number(year), monthIndex, Math.max(1, startDay));
    const end = new Date(start);
    end.setDate(start.getDate() + 4);
    return { start, end };
  };

  function matchDormKey(site: string, buildingName: string, dong: string, roomHo: string) {
    return `${site.trim().toLowerCase()}|${buildingName.trim().toLowerCase()}|${stripDongHoSuffix(dong).toLowerCase()}|${stripDongHoSuffix(roomHo).toLowerCase()}`;
  }

  function findOperationalDormByKey(
    site: string,
    buildingName: string,
    dong: string,
    roomHo: string
  ): OperationalDorm | undefined {
    return operationalDorms.find(
      (d) =>
        matchDormKey(d.site, d.buildingName, d.dong, d.roomHo) ===
        matchDormKey(site, buildingName, dong, roomHo)
    );
  }

  function findOperationalDormForDefect(defect: DefectRequest): OperationalDorm | undefined {
    if (defect.dormId) {
      return (
        operationalDorms.find((d) => d.id === defect.dormId) ||
        findOperationalDormByKey(defect.site, defect.buildingName, defect.dong, defect.ho)
      );
    }
    return findOperationalDormByKey(defect.site, defect.buildingName, defect.dong, defect.ho);
  }

  function findOperationalDormForCleaningReport(
    report: CleaningReport
  ): OperationalDorm | undefined {
    if (report.dormId) {
      return (
        operationalDorms.find((d) => d.id === report.dormId) ||
        findOperationalDormByKey(report.site, report.buildingName, report.dong, report.roomHo)
      );
    }
    return findOperationalDormByKey(report.site, report.buildingName, report.dong, report.roomHo);
  }


  const getCleaningWeeklyStatus = (dorm: Dorm, weekNo: number) => {
    const range = getWeekRange(cleaningYear, cleaningMonth, weekNo);
    const dormKey = matchDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo);
    const reports = cleaningReports.filter((report) => {
      const reportDate = parseSafeDate(report.reportDate);
      if (!reportDate) return false;
      if (reportDate < range.start || reportDate > range.end) return false;
      if (!cleaningSettings.includeWeekendReports && isWeekend(report.reportDate)) return false;
      const reportKey = matchDormKey(report.site, report.buildingName, report.dong, report.roomHo);
      return report.dormId === dorm.id || reportKey === dormKey;
    });

    if (reports.length === 0) {
      const now = new Date();
      if (now > range.end) return "X";
      return "예정";
    }

    if (reports.some((report) => report.cleanStatus === "불량")) return "불량";
    if (reports.some((report) => report.beforePhotoDataUrls.length === 0 || report.afterPhotoDataUrls.length === 0)) return "사진누락";
    return "O";
  };

  const getManagerCleaningPenalty = (managerUserId: string) => {
    if (!managerUserId) return 0;
    return calculateCleaningScoreByManager(managerUserId);
  };

  useEffect(() => {
    if (currentUser?.role === "maintenance_reporter" && currentUser?.dormId) {
      const selectedDorm = operationalDorms.find((d) => d.id === currentUser.dormId);
      setCleaningReportForm(initializeCleaningReportForm(currentUser, selectedDorm));
    }
  }, [currentUser, operationalDorms]);

  const visibleCleaningDormRows = useMemo(() => {
    return operationalDorms.filter((dorm) => {
      if (currentUser?.role === "maintenance_reporter" && currentUser.dormId) {
        if (dorm.id !== currentUser.dormId) return false;
      }
      if (cleaningDormSiteFilter !== "전체" && dorm.site !== cleaningDormSiteFilter) return false;
      if (cleaningDormSearch) {
        const text = `${dorm.site} ${dorm.gender} ${dorm.buildingName} ${dorm.address} ${dorm.dong} ${dorm.roomHo} ${dorm.공동현관} ${dorm.세대현관}`.toLowerCase();
        if (!text.includes(cleaningDormSearch.toLowerCase())) return false;
      }
      if (cleaningManagerFilter && dorm.managerUserId) {
        const manager = users.find((u) => u.id === dorm.managerUserId);
        if (!manager || manager.displayName !== cleaningManagerFilter) return false;
      }
      return true;
    });
  }, [operationalDorms, cleaningDormSiteFilter, cleaningDormSearch, cleaningManagerFilter, users, currentUser]);

  const managerFilterOptions = useMemo(() => {
    const names = new Set<string>();
    operationalDorms.forEach((dorm) => {
      if (dorm.managerUserId) {
        const manager = users.find((u) => u.id === dorm.managerUserId);
        if (manager) names.add(manager.displayName);
      }
    });
    return Array.from(names).sort();
  }, [operationalDorms, users]);

  const cleaningOverview = useMemo(() => {
    const summary = {
      totalDorms: visibleCleaningDormRows.length,
      submitted: 0,
      missing: 0,
      bad: 0,
      photoMissing: 0,
      penaltyTotal: 0,
    };
    visibleCleaningDormRows.forEach((dorm) => {
      for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
        const status = getCleaningWeeklyStatus(dorm, weekNo);
        if (status === "O") summary.submitted += 1;
        if (status === "X") summary.missing += 1;
        if (status === "불량") summary.bad += 1;
        if (status === "사진누락") summary.photoMissing += 1;
      }
      summary.penaltyTotal += getManagerCleaningPenalty(dorm.managerUserId || "");
    });
    return summary;
  }, [visibleCleaningDormRows, cleaningSettings, getCleaningWeeklyStatus, getManagerCleaningPenalty]);

  const occupancyCountByDorm = useMemo(() => {
    const map = new Map<string, number>();
    occupants.forEach((o) => {
      if (["거주중", "만료예정", "신규입주"].includes(o.status)) {
        map.set(o.dormId, (map.get(o.dormId) || 0) + 1);
      }
    });
    return map;
  }, [occupants]);

  const expiringDormsTop10 = useMemo(() => {
    return [...operationalDorms]
      .filter((d) => d.contractEnd && daysDiff(d.contractEnd) >= 0)
      .sort((a, b) => daysDiff(a.contractEnd) - daysDiff(b.contractEnd))
      .slice(0, 10);
  }, [operationalDorms]);

  const parseDateValue = (value: string | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  };

  const simulationMonthlyStats = useMemo(() => {
    const year = Number(simulationYear);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const groups: Array<{ site: Site; gender: "남" | "여" }> = [
      { site: "평택", gender: "남" },
      { site: "평택", gender: "여" },
      { site: "천안", gender: "남" },
      { site: "천안", gender: "여" },
    ];

    // 고유 기숙사 키 맵 생성 (중복 제거)
    const uniqueDormMap = new Map<string, DormContract>();
    dormContracts.forEach((contract) => {
      if (contract.isDeleted) return;
      const key = getUniqueDormKey(contract.site, contract.buildingName, contract.dong, contract.roomHo);
      const existing = uniqueDormMap.get(key);
      if (!existing || (contract.updatedAt && existing.updatedAt && new Date(contract.updatedAt) > new Date(existing.updatedAt))) {
        uniqueDormMap.set(key, contract);
      }
    });

    const uniqueDorms = Array.from(uniqueDormMap.values());

    const calculateForGroupAndMonth = (site: Site, gender: "남" | "여", month: number) => {
      // 1. 기숙사수: 계약시작일이 해당 월 말일 이전, 계약종료일/해지일이 없거나 해당 월 이후, 계약상태가 종료/해지 제외
      const activeDorms = uniqueDorms.filter((d) => {
        if (d.site !== site || d.gender !== gender) return false;
        if (["종료", "해지"].includes(d.contractStatus)) return false;
        const startDate = parseDateValue(d.contractStart);
        if (!startDate || !isBeforeOrSameMonthEnd(startDate, year, month)) return false;
        const endDate = parseDateValue(d.contractEnd);
        if (endDate && isBeforeMonthEnd(endDate, year, month)) return false;
        return true;
      });

      // 2. 거주자 TO: 기숙사수 × 6, capacity 우선
      const residentTo = activeDorms.reduce((sum, d) => {
        const dorm = dorms.find((dm) => getUniqueDormKey(dm.site, dm.buildingName, dm.dong, dm.roomHo) === getUniqueDormKey(d.site, d.buildingName, d.dong, d.roomHo));
        return sum + (dorm?.capacity || 6);
      }, 0);

      // 입주자 데이터: occupants + newHires(occupants에 아직 반영되지 않은 배정된 신입사원)
      const allOccupants = [
        ...occupants.filter((o) => !o.isDeleted),
        ...newHires
          .filter(
            (h) =>
              !h.isDeleted &&
              h.dormId &&
              !occupants.some((o) => o.sourceNewHireId === h.id)
          )
          .map((h) => ({
            ...h,
            status: h.residenceStatus as Occupant["status"],
            moveInDate: h.moveInDate,
            moveOutDueDate: h.moveOutDate,
            actualMoveOutDate: h.actualMoveOutDate,
            expectedMoveInDate: h.expectedMoveInDate,
            expectedMoveOutDate: h.expectedMoveOutDate,
            buildingName: h.buildingName,
            dong: h.dong,
            roomHo: h.roomHo,
          } as unknown as Occupant)),
      ];

      const groupOccupants = allOccupants.filter((o) => {
        const occupantDorm = operationalDorms.find((d) => d.id === o.dormId);
        return occupantDorm && occupantDorm.site === site && occupantDorm.gender === gender;
      });

      // 3. 현 거주자: 입실일이 해당 월 말일 이전, 실제퇴실일/퇴실일이 없거나 해당 월 이후, 상태가 퇴실이 아닌 사람
      const currentResidents = groupOccupants.filter((o) => {
        if (!["거주중", "만료예정", "신규입주"].includes(o.status)) return false;
        const moveInDate = parseDateValue(o.moveInDate);
        if (!moveInDate || !isBeforeOrSameMonthEnd(moveInDate, year, month)) return false;
        const actualOutDate = parseDateValue(o.actualMoveOutDate || "");
        if (actualOutDate && isBeforeMonthEnd(actualOutDate, year, month)) return false;
        return true;
      }).length;

      // 4. 만료자: 예상퇴실일 또는 퇴실예정일이 해당 월인 인원
      const expiredResidents = groupOccupants.filter((o) => {
        const dueDate = parseDateValue(o.moveOutDueDate);
        return dueDate && isSameMonth(dueDate, year, month);
      }).length;

      // 5. 중도퇴거: 실제퇴실일이 있고, 실제퇴실일 < 예상퇴실일, 실제퇴실일이 해당 월인 인원
      const earlyDepartures = groupOccupants.filter((o) => {
        const actualOutDate = parseDateValue(o.actualMoveOutDate || "");
        if (!actualOutDate || !isSameMonth(actualOutDate, year, month)) return false;
        const dueDate = parseDateValue(o.moveOutDueDate);
        return dueDate && actualOutDate < dueDate;
      }).length;

      // 6. 천안이동: 천안이동일이 해당 월인 인원 또는 상태가 천안이동인 인원
      const cheonanMove = groupOccupants.filter((o) => {
        if (o.status === "천안이동") return true;
        const moveDate = parseDateValue(o.actualMoveOutDate || o.moveOutDueDate);
        return moveDate && isSameMonth(moveDate, year, month);
      }).length;

      // 7. 신규입주: 입실일이 해당 월에 포함되는 인원
      const newMoveIn = groupOccupants.filter((o) => {
        const moveInDate = parseDateValue(o.moveInDate);
        return moveInDate && isSameMonth(moveInDate, year, month);
      }).length;

      // 8. 과부족: 거주자 TO - 현 거주자
      const shortage = residentTo - currentResidents;

      // 9. 임차만기: 계약종료일이 해당 월인 고유 기숙사 수
      const expireBuildings = activeDorms.filter((d) => {
        const endDate = parseDateValue(d.contractEnd);
        return endDate && isSameMonth(endDate, year, month);
      }).length;

      // 10. 해지: 계약상태가 해지 또는 종료이고, 계약종료일이 해당 월인 고유 기숙사 수
      const terminated = uniqueDorms.filter((d) => {
        if (d.site !== site || d.gender !== gender) return false;
        if (!["종료", "해지"].includes(d.contractStatus)) return false;
        const endDate = parseDateValue(d.contractEnd);
        return endDate && isSameMonth(endDate, year, month);
      }).length;

      // 11. 추가임차: 계약시작일이 해당 월인 고유 기숙사 수
      const addLease = uniqueDorms.filter((d) => {
        if (d.site !== site || d.gender !== gender) return false;
        const startDate = parseDateValue(d.contractStart);
        return startDate && isSameMonth(startDate, year, month);
      }).length;

      return {
        site,
        gender,
        month,
        dormCount: activeDorms.length,
        residentTo,
        currentResidents,
        expiredResidents,
        earlyDepartures,
        cheonanMove,
        newMoveIn,
        shortage,
        expireBuildings,
        terminated,
        addLease,
      };
    };

    const results = [];
    for (const { site, gender } of groups) {
      for (const month of months) {
        results.push(calculateForGroupAndMonth(site, gender, month));
      }
    }

    // 전체 합계 행 추가
    for (const month of months) {
      const monthData: typeof results = results.filter((r) => r.month === month);
      results.push({
        site: "전체" as Site,
        gender: "합계" as "남" | "여",
        month,
        dormCount: monthData.reduce((sum, r) => sum + r.dormCount, 0),
        residentTo: monthData.reduce((sum, r) => sum + r.residentTo, 0),
        currentResidents: monthData.reduce((sum, r) => sum + r.currentResidents, 0),
        expiredResidents: monthData.reduce((sum, r) => sum + r.expiredResidents, 0),
        earlyDepartures: monthData.reduce((sum, r) => sum + r.earlyDepartures, 0),
        cheonanMove: monthData.reduce((sum, r) => sum + r.cheonanMove, 0),
        newMoveIn: monthData.reduce((sum, r) => sum + r.newMoveIn, 0),
        shortage: monthData.reduce((sum, r) => sum + r.shortage, 0),
        expireBuildings: monthData.reduce((sum, r) => sum + r.expireBuildings, 0),
        terminated: monthData.reduce((sum, r) => sum + r.terminated, 0),
        addLease: monthData.reduce((sum, r) => sum + r.addLease, 0),
      });
    }

    return results;
  }, [dormContracts, dorms, occupants, newHires, simulationYear]);

  const simulationRows = useMemo(() => {
    const month = Number(simulationMonth);
    return simulationMonthlyStats.filter((s) => s.month === month && s.site !== "전체").map((s) => ({
      ...s,
      key: `${s.site}-${s.gender}`,
      usageRate: s.residentTo ? Math.round((s.currentResidents / s.residentTo) * 100) : 0,
      estimatedOperatingCost: 0, // 임시 값
      vacancyLossEstimate: 0, // 임시 값
      expireRiskCount: 0, // 임시 값
    }));
  }, [simulationMonthlyStats, simulationYear, simulationMonth]);

  const simulationTotal = useMemo(() => {
    const month = Number(simulationMonth);
    const currentMonthStats = simulationMonthlyStats.filter((s) => s.month === month && s.site !== "전체");

    const dormCount = currentMonthStats.reduce((sum, r) => sum + r.dormCount, 0);
    const residentTo = currentMonthStats.reduce((sum, r) => sum + r.residentTo, 0);
    const currentResidents = currentMonthStats.reduce((sum, r) => sum + r.currentResidents, 0);
    const expiredResidents = currentMonthStats.reduce((sum, r) => sum + r.expiredResidents, 0);
    const earlyDepartures = currentMonthStats.reduce((sum, r) => sum + r.earlyDepartures, 0);
    const cheonanMove = currentMonthStats.reduce((sum, r) => sum + r.cheonanMove, 0);
    const newMoveIn = currentMonthStats.reduce((sum, r) => sum + r.newMoveIn, 0);
    const shortage = currentMonthStats.reduce((sum, r) => sum + r.shortage, 0);
    const expireBuildings = currentMonthStats.reduce((sum, r) => sum + r.expireBuildings, 0);
    const terminated = currentMonthStats.reduce((sum, r) => sum + r.terminated, 0);
    const addLease = currentMonthStats.reduce((sum, r) => sum + r.addLease, 0);

    const maleCount = currentMonthStats.filter((r) => r.gender === "남").reduce((sum, r) => sum + r.currentResidents, 0);
    const femaleCount = currentMonthStats.filter((r) => r.gender === "여").reduce((sum, r) => sum + r.currentResidents, 0);
    const usageRate = residentTo ? Math.round((currentResidents / residentTo) * 100) : 0;
    const vacancyRate = residentTo ? Math.round(((residentTo - currentResidents) / residentTo) * 100) : 0;
    
    // 지역별 부족 TO
    const siteShortage = {
      평택: currentMonthStats
        .filter((s) => s.site === "평택")
        .reduce((sum, s) => sum + Math.max(0, s.shortage), 0),
      천안: currentMonthStats
        .filter((s) => s.site === "천안")
        .reduce((sum, s) => sum + Math.max(0, s.shortage), 0),
    };

    const totalOperatingCost = residentTo > 0 ? dormCount * 2000000 : 0;
    const totalVacancyLoss = (residentTo - currentResidents) * 500000;
    const totalExpireRisk = expireBuildings;

    return { 
      dormCount, 
      residentTo, 
      currentResidents, 
      expiredResidents, 
      earlyDepartures, 
      cheonanMove, 
      newMoveIn, 
      shortage,
      expireBuildings, 
      terminated, 
      addLease, 
      maleCount, 
      femaleCount, 
      usageRate, 
      vacancyRate,
      siteShortage,
      totalOperatingCost, 
      totalVacancyLoss, 
      totalExpireRisk,
    };
  }, [simulationMonthlyStats, simulationYear, simulationMonth]);

  const visibleDashboard = useMemo(() => {
    return expiringDormsTop10.filter((d) => {
      if (dashboardSiteFilter !== "전체" && d.site !== dashboardSiteFilter) return false;
      if (dashboardStatusFilter !== "전체" && d.leaseStatus !== dashboardStatusFilter) return false;
      const daysUntilExpiry = daysDiff(d.contractEnd);
      const text = `${d.site} ${d.buildingName} ${d.address} ${d.contractEnd} ${daysUntilExpiry}`.toLowerCase();
      return !dashboardSearch || text.includes(dashboardSearch.toLowerCase());
    });
  }, [expiringDormsTop10, dashboardSearch, dashboardSiteFilter, dashboardStatusFilter]);

  const visibleSimulationRows = useMemo(() => {
    return simulationRows.filter((r) => {
      if (simulationSiteFilter !== "전체" && r.site !== simulationSiteFilter) return false;
      if (simulationGenderFilter !== "전체" && r.gender !== simulationGenderFilter) return false;
      const text = `${r.site} ${r.gender} ${r.dormCount} ${r.residentTo} ${r.currentResidents} ${r.expiredResidents} ${r.earlyDepartures} ${r.cheonanMove} ${r.newMoveIn} ${r.shortage} ${r.expireBuildings} ${r.terminated} ${r.addLease}`.toLowerCase();
      return !simulationSearch || text.includes(simulationSearch.toLowerCase());
    });
  }, [simulationRows, simulationSearch, simulationSiteFilter, simulationGenderFilter]);

  const reportSummaryRows = useMemo(() => {
    return visibleSimulationRows.filter((r) => {
      if (reportSiteFilter !== "전체" && r.site !== reportSiteFilter) return false;
      if (reportGenderFilter !== "전체" && r.gender !== reportGenderFilter) return false;
      return true;
    });
  }, [visibleSimulationRows, reportSiteFilter, reportGenderFilter]);

  const militaryTrainingNotCompletedCount = useMemo(
    () => militaryPersonnel.filter((person) => {
      // Only count personnel with auto-create target status
      if (!militaryTrainingAutoConfig.targetStatuses?.includes(person.status)) return false;
      const training = computeRequiredTraining(person);
      return training.hours > 0 && computeTrainingStatus(person) === "미이수";
    }).length,
    [militaryPersonnel, militaryTrainingRecords, militaryTrainingRules, militaryTrainingAutoConfig]
  );

  const militaryPendingNoticeCount = useMemo(
    () => {
      const targetPersonnelIds = militaryPersonnel
        .filter((p) => militaryTrainingAutoConfig.targetStatuses?.includes(p.status))
        .map((p) => p.id);
      return militaryNotices.filter((n) => {
        if (n.publishedDate) return false;
        // Only count if has target personnel in recipients
        return n.personnelIds?.some((pid) => targetPersonnelIds.includes(pid));
      }).length;
    },
    [militaryNotices, militaryPersonnel, militaryTrainingAutoConfig]
  );

  const militaryUpcomingDischargeCount = useMemo(
    () => militaryPersonnel.filter((p) => p.dischargeDate && daysDiff(p.dischargeDate) >= 0 && daysDiff(p.dischargeDate) <= 30).length,
    [militaryPersonnel]
  );

  const militaryCategoryCounts = useMemo(() => {
    const counts = { reserve: 0, civilDefense: 0, none: 0 };
    militaryPersonnel.forEach((person) => {
      const category = getMilitaryCategory(person, effectiveMilitaryReferenceYear);
      if (category === "예비군") counts.reserve += 1;
      else if (category === "민방위") counts.civilDefense += 1;
      else counts.none += 1;
    });
    return counts;
  }, [militaryPersonnel, effectiveMilitaryReferenceYear]);

  const militaryPersonnelSummary = useMemo(() => {
    const today = new Date();
    return militaryPersonnel.map((person) => {
      const enlistDate = person.enlistmentDate ? new Date(person.enlistmentDate) : null;
      const daysOfService = enlistDate ? Math.max(0, Math.floor((today.getTime() - enlistDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;
      const years = Math.floor(daysOfService / 365);
      const months = Math.floor((daysOfService % 365) / 30);
      const accruedAnnualLeave = years >= 1 ? Math.min(15 + (years - 1), 25) : 0;
      const serviceDuration = enlistDate ? `${years}년 ${months}개월` : "-";
      const dischargeDue = person.dischargeDate ? daysDiff(person.dischargeDate) : null;
      const currentCategory = getMilitaryCategory(person, effectiveMilitaryReferenceYear);
      const reserveAnnualLeave = getReserveAnnualLeave(person, effectiveMilitaryReferenceYear);
      const civilDefenseAnnualLeave = getCivilDefenseAnnualLeave(person, effectiveMilitaryReferenceYear);
      const requiredTraining = computeRequiredTraining(person);
      const requiredTrainingStatus = computeTrainingStatus(person);
      const trainingYear = getTrainingYear(person, effectiveMilitaryReferenceYear);
      const personTrainingRecords = militaryTrainingRecords.filter((record) => record.personnelId === person.id);
      const personNotices = militaryNotices.filter((notice) => notice.personnelIds?.includes(person.id));
      return {
        ...person,
        serviceDuration,
        accruedAnnualLeave,
        dischargeDue,
        currentCategory,
        reserveAnnualLeave,
        civilDefenseAnnualLeave,
        requiredTrainingLabel: requiredTraining.label,
        requiredTrainingHours: requiredTraining.hours,
        trainingStatus: requiredTrainingStatus,
        trainingYear,
        trainingRecordsCount: personTrainingRecords.length,
        trainingCompletedCount: personTrainingRecords.filter((record) => /(완료|이수|completed)/i.test(record.status)).length,
        noticeCount: personNotices.length,
        noticeSent: personNotices.length > 0,
      };
    });
  }, [militaryPersonnel, militaryTrainingRecords, militaryNotices]);

  const filteredMilitaryPersonnel = useMemo(
    () => militaryPersonnelSummary.filter((person) => {
      if (militaryPersonnelStatusFilter !== "전체" && person.status !== militaryPersonnelStatusFilter) return false;
      const query = `${person.name} ${person.rank} ${person.serviceBranch} ${person.unit} ${person.phone} ${person.birthDate} ${person.currentCategory}`.toLowerCase();
      return !militaryPersonnelSearch || query.includes(militaryPersonnelSearch.toLowerCase());
    }),
    [militaryPersonnelSummary, militaryPersonnelSearch, militaryPersonnelStatusFilter]
  );

  const militaryTrainingYearOptions = useMemo(() => {
    const years = new Set<string>();
    if (militarySettings["기준연도"]) years.add(String(militarySettings["기준연도"]));
    militaryTrainingRecords.forEach((record) => {
      if (record.trainingYear) years.add(String(record.trainingYear));
      [record.trainingDate, record.completionDate, record.createdAt].forEach((value) => {
        if (typeof value === "string" && value.length >= 4) years.add(value.slice(0, 4));
      });
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [militaryTrainingRecords, militarySettings]);

  const militaryTrainingTypeOptions = useMemo(
    () => Array.from(new Set(["전체", ...militaryTrainingRecords.map((record) => record.trainingType || record.subject)])).filter(Boolean) as string[],
    [militaryTrainingRecords]
  );

  const militaryTrainingRoundOptions = useMemo(
    () => Array.from(new Set(["전체", ...militaryTrainingRecords.map((record) => record.trainingRound || "1차")])) as string[],
    [militaryTrainingRecords]
  );

  const militaryTrainingDepartmentOptions = useMemo(
    () => Array.from(new Set(["전체", ...militaryPersonnel.map((person) => person.unit || "").filter(Boolean)])) as string[],
    [militaryPersonnel]
  );

  const filteredMilitaryTrainingRecords = useMemo(
    () => militaryTrainingRecords.filter((record) => {
      if (militaryTrainingStatusFilter !== "전체" && record.status !== militaryTrainingStatusFilter) return false;
      if (militaryTrainingPersonFilter !== "전체" && record.personnelId !== militaryTrainingPersonFilter) return false;
      if (militaryTrainingTypeFilter !== "전체" && (record.trainingType || record.subject) !== militaryTrainingTypeFilter) return false;
      if (militaryTrainingRoundFilter !== "전체" && record.trainingRound !== militaryTrainingRoundFilter) return false;
      if (militaryTrainingDepartmentFilter !== "전체") {
        const person = militaryPersonnel.find((p) => p.id === record.personnelId);
        if ((person?.unit || "") !== militaryTrainingDepartmentFilter) return false;
      }
      if (militaryTrainingYearFilter !== "전체") {
        const year = militaryTrainingYearFilter;
        const recordYear =
          String(record.trainingYear || "") ||
          String(record.trainingDate || "").slice(0, 4) ||
          String(record.completionDate || "").slice(0, 4) ||
          String(record.createdAt || "").slice(0, 4);
        if (recordYear !== year) return false;
      }
      const query = `${record.subject} ${record.location} ${record.status} ${record.notes}`.toLowerCase();
      return !militaryTrainingSearch || query.includes(militaryTrainingSearch.toLowerCase());
    }),
    [militaryTrainingRecords, militaryTrainingSearch, militaryTrainingStatusFilter, militaryTrainingYearFilter, militaryTrainingPersonFilter, militaryTrainingTypeFilter, militaryTrainingRoundFilter, militaryTrainingDepartmentFilter, militaryPersonnel]
  );

  const filteredMilitaryNotices = useMemo(
    () => militaryNotices.filter((notice) => {
      const query = `${notice.title} ${notice.category} ${notice.content}`.toLowerCase();
      return !militaryNoticeSearch || query.includes(militaryNoticeSearch.toLowerCase());
    }),
    [militaryNotices, militaryNoticeSearch]
  );

  const filteredMilitaryReports = useMemo(
    () => militaryReports.filter((report) => {
      const query = `${report.title} ${report.type} ${report.author} ${report.status} ${report.notes}`.toLowerCase();
      return !militaryReportSearch || query.includes(militaryReportSearch.toLowerCase());
    }),
    [militaryReports, militaryReportSearch]
  );

  const dashboardAlerts = useMemo(() => {
    const items: { id: string; title: string; detail: string; when: string; type: string }[] = [];
    operationalDorms.forEach((d) => {
      const due = d.contractEnd;
      const days = daysDiff(due);
      if (due && days >= 0 && days <= 30) {
        items.push({ id: d.id, title: "계약 만료 예정", detail: `${d.site} ${d.buildingName} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`, when: `D-${days}`, type: "contract" });
      }
    });
    defects.filter((d) => d.defectStatus !== "완료").forEach((d) => {
      items.push({ id: d.id, title: "미완료 하자", detail: `${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.ho)}`, when: d.receiptDate, type: "defect" });
    });

    militaryNotices.filter((n) => !n.publishedDate).forEach((n) => {
      items.push({ id: n.id, title: "미발송 통보서", detail: n.title, when: "미발송", type: "militaryNotice" });
    });

    militaryTrainingRecords.filter((r) => !/(완료|completed)/i.test(r.status)).forEach((r) => {
      items.push({ id: r.id, title: "미이수 교육", detail: r.subject, when: r.trainingDate || "미정", type: "training" });
    });

    return items.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 5);
  }, [operationalDorms, defects, militaryNotices, militaryTrainingRecords]);

  const dormSummary = useMemo(() => {
    return operationalDorms
      .filter((d) => {
        if (dashboardSiteFilter !== "전체" && d.site !== dashboardSiteFilter) return false;
        if (dashboardStatusFilter !== "전체" && d.leaseStatus !== dashboardStatusFilter) return false;
        const managerName = users.find((u) => u.id === d.managerUserId)?.displayName || "미지정";
        const searchableText = `${d.site} ${d.gender} ${d.buildingName} ${d.dong} ${d.roomHo} ${d.address} ${managerName}`.toLowerCase();
        return !dashboardSearch || searchableText.includes(dashboardSearch.toLowerCase());
      })
      .map((d) => {
        const currentResidents = occupancyCountByDorm.get(d.id) || 0;
        const vacancy = Math.max((d.capacity || 0) - currentResidents, 0);
        const usageRate = d.capacity ? Math.round((currentResidents / d.capacity) * 100) : 0;
        const managerName = users.find((u) => u.id === d.managerUserId)?.displayName || "미지정";
        const dDayValue = daysDiff(d.contractEnd);
        return {
          id: d.id,
          site: d.site,
          gender: d.gender,
          buildingName: d.buildingName,
          dong: d.dong,
          roomHo: d.roomHo,
          managerName,
          leaseStatus: d.leaseStatus,
          contractEnd: d.contractEnd,
          dDay: d.contractEnd ? (dDayValue >= 0 ? `D-${dDayValue}` : `D+${Math.abs(dDayValue)}`) : "-",
          currentResidents,
          capacity: d.capacity,
          vacancy,
          usageRate,
          address: d.address,
        };
      });
  }, [operationalDorms, occupancyCountByDorm, users, dashboardSiteFilter, dashboardStatusFilter, dashboardSearch]);

  // 대시보드 요약 통계
  const dashboardSummaryStats = useMemo(() => {
    // 1. 미배정 신입사원 수
    const unassignedCount = newHires.filter(h =>
      !h.dormId && (h.residenceStatus === "대기중" || h.moveInType === "대기자")
    ).length;

    // 2. 계약 만료 예정 수 (30일 이내)
    const expiringCount = dormContracts.filter(c => {
      if (c.isDeleted) return false;
      const days = daysDiff(c.contractEnd);
      return days >= 0 && days <= 30;
    }).length;

    // 3. 공실률
    const totalCapacity = dorms.reduce((sum, d) => sum + (d.capacity || 6), 0);
    const totalOccupied = occupants.filter(o =>
      !o.isDeleted && ["거주중", "신규입주", "만료예정", "연장"].includes(o.status)
    ).length;
    const vacancyRate = totalCapacity > 0 ? Math.round((totalCapacity - totalOccupied) / totalCapacity * 100) : 0;

    // 4. 미처리 하자 수
    const unprocessedDefects = defects.filter(d =>
      !d.isDeleted && (d.defectStatus === "접수" || d.defectStatus === "진행중")
    ).length;

    // 5. 청소 미보고 수
    const unreportedCleaning = occupants.filter(o =>
      !o.isDeleted && o.status === "퇴실" && o.actualMoveOutDate &&
      !cleaningReports.find(r => r.dormId === o.dormId && r.reportDate >= (o.actualMoveOutDate || ""))
    ).length;

    // 6. 비품 노후/부족 수
    const outdatedInventory = inventory.filter(i =>
      !i.isDeleted && (i.status === "고장" || i.quantity === 0)
    ).length;

    return {
      unassignedCount,
      expiringCount,
      vacancyRate,
      unprocessedDefects,
      unreportedCleaning,
      outdatedInventory,
    };
  }, [newHires, dormContracts, dorms, occupants, defects, cleaningReports, inventory]);

  const login = async () => {
    if (isSupabaseAvailable()) {
      const raw = loginForm.username.trim();
      const usernamePattern = /^[A-Za-z0-9._-]+$/;
      if (!raw.includes("@") && !usernamePattern.test(raw)) {
        setLoginError("로그인 아이디는 영문, 숫자, 점(.), 언더바(_), 하이픈(-)만 사용할 수 있습니다.");
        return;
      }
      const authEmail = raw.includes("@") ? raw : `${raw}@dormerpsystem.com`;
      const { session, error } = await signInWithEmail(authEmail, loginForm.password);
      if (error) {
        const message = (error && (error as any).message) || "Supabase 로그인에 실패했습니다.";
        console.error("Supabase sign-in failed:", error);
        setLoginError(message);
      } else if (session?.user?.id) {
        const profile = await getProfile(session.user.id);
        const authUser = await getCurrentAuthUser();
        if (!profile) {
          setLoginError("Supabase 로그인은 성공했으나 profiles에 계정 정보가 없습니다.");
          return;
        }
        if (profile.is_active === false) {
          setLoginError("계정이 비활성화되어 있습니다.");
          return;
        }
        setCurrentUser(mapProfileToLoginUser(profile, authUser?.email ?? undefined));
        setActiveTab(profile.role === "maintenance_reporter" ? "defects" : "dashboard");
        setLoginError("");
        return;
      }
    }

    const found = users.find(
      (u) =>
        u.username === loginForm.username.trim() &&
        u.password === loginForm.password &&
        u.isActive
    );

    if (!found) {
      setLoginError("아이디 또는 비밀번호가 맞지 않거나 비활성 계정입니다.");
      return;
    }

    setCurrentUser(found);
    setActiveTab(found.role === "maintenance_reporter" ? "defects" : "dashboard");
    setLoginError("");
  };

  const logout = async () => {
    if (isSupabaseAvailable()) {
      await supabaseSignOut();
    }
    setCurrentUser(null);
  };

  const saveDorm = () => {
    if (!canEditData(currentUser)) return;
    if (!dormForm.address.trim() || !dormForm.buildingName.trim()) {
      alert("기숙사명과 주소는 필수입니다.");
      return;
    }
    const payload: Dorm = {
      id: editingDormId || crypto.randomUUID(),
      ...dormForm,
      capacity: 6,
      managerUserId: dormForm.managerUserId || undefined,
      createdAt: editingDormId ? dorms.find((d) => d.id === editingDormId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDorms((prev) => (editingDormId ? prev.map((d) => (d.id === editingDormId ? payload : d)) : [payload, ...prev]));
    setupDormManager(payload.id, payload.managerUserId || "");
    setDormForm(dormTemplate());
    setEditingDormId(null);
    setShowDormForm(false);
  };

  const saveOccupant = () => {
    if (!canEditData(currentUser)) return;
    if (!occupantForm.employeeName.trim()) {
      alert("이름은 필수입니다.");
      return;
    }
    const dorm = occupantForm.dormId ? dorms.find((d) => d.id === occupantForm.dormId) : null;
    if (occupantForm.dormId && !dorm) return;
    if (occupantForm.status === "거주중" && !occupantForm.dormId) {
      const confirmed = window.confirm("기숙사가 배정되지 않았습니다. 미배정 상태로 등록하시겠습니까?");
      if (!confirmed) return;
    }
    const count = dorm ? (occupancyCountByDorm.get(dorm.id) || 0) : 0;
    const editingCurrent = editingOccupantId ? occupants.find((o) => o.id === editingOccupantId) : null;
    const adjust = editingCurrent && editingCurrent.dormId === occupantForm.dormId && ["거주중", "만료예정", "신규입주"].includes(editingCurrent.status) ? -1 : 0;
    const willCount = ["거주중", "만료예정", "신규입주"].includes(occupantForm.status);
    if (dorm && willCount && count + adjust >= 6) {
      alert("이 기숙사는 최대 6명까지만 배정할 수 있습니다.");
      return;
    }
    const payload: Occupant = {
      id: editingOccupantId || crypto.randomUUID(),
      ...occupantForm,
      site: dorm?.site || "평택",
      createdAt: editingOccupantId ? occupants.find((o) => o.id === editingOccupantId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setOccupants((prev) => (editingOccupantId ? prev.map((o) => (o.id === editingOccupantId ? payload : o)) : [payload, ...prev]));
    if (assignManagerToDorm && payload.status === "거주중" && payload.dormId) {
      const targetDorm = dorms.find((d) => d.id === payload.dormId);
      if (targetDorm) {
        const existingManagerId = targetDorm.managerUserId;
        const existingManagerUser = existingManagerId ? users.find((u) => u.id === existingManagerId) : null;
        
        // 기존 담당자가 있으면 confirm 표시
        if (existingManagerId && existingManagerUser) {
          const confirmed = window.confirm(
            `현재 해당 기숙사는 ${existingManagerUser.displayName}님이 담당자로 지정되어 있습니다.\n${payload.employeeName}님으로 변경하시겠습니까?`
          );
          if (!confirmed) {
            setAssignManagerToDorm(false);
            setOccupantForm(occupantTemplate());
            setEditingOccupantId(null);
            setShowOccupantForm(false);
            return;
          }
        }
        
        // 새 담당자 계정 생성 또는 기존 계정 재사용
        let newManagerId: string = existingManagerId || "";
        let updatedUsers = users;
        
        if (!existingManagerId) {
          // 새 담당자 계정 생성
          const manager = createMaintenanceReporter(
            payload.employeeName,
            targetDorm.id,
            targetDorm.buildingName,
            targetDorm.dong,
            targetDorm.roomHo,
            targetDorm.address,
            targetDorm.공동현관,
            targetDorm.세대현관
          );
          newManagerId = manager.id;
          updatedUsers = [...users, manager];
          setUsers(updatedUsers);
        }
        
        // 담당자 지정 (기존 담당자 자동 해제)
        setupDormManager(targetDorm.id, newManagerId, existingManagerId);
      }
    }
    
    // ============================================
    // 2단계: 퇴실 자동화 연결
    // ============================================
    if (payload.status === "퇴실" && payload.actualMoveOutDate) {
      const dormId = payload.dormId;
      
      // 2-1. 해당 기숙사 거주중 인원 재계산 (변경 후 기준)
      const updatedOccupants = editingOccupantId 
        ? occupants.map((o) => (o.id === editingOccupantId ? payload : o))
        : [payload, ...occupants];
      
      const residentCount = updatedOccupants.filter(
        (o) => o.dormId === dormId && o.status === "거주중"
      ).length;
      
      // 2-2. 거주중 인원 = 0 이면 기숙사 상태 자동 공실
      if (residentCount === 0 && dormId) {
        const dorm = dorms.find((d) => d.id === dormId);
        if (dorm) {
          setDorms((prev) =>
            prev.map((d) =>
              d.id === dormId
                ? { ...d, leaseStatus: "공실", updatedAt: new Date().toISOString() }
                : d
            )
          );
        }
      }
      
      // 2-3. 청소 요청 자동 생성
      if (dormId) {
        const dorm = dorms.find((d) => d.id === dormId);
        if (dorm) {
          const today = new Date().toISOString().slice(0, 10);
          const cleaningReport: CleaningReport = {
            id: `cleaning-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            reportDate: today,
            site: dorm.site,
            dormId: dormId,
            buildingName: dorm.buildingName,
            address: dorm.address,
            dong: dorm.dong,
            roomHo: dorm.roomHo,
            공동현관: dorm.공동현관 || "",
            세대현관: dorm.세대현관 || "",
            managerUserId: dorm.managerUserId || "",
            managerName: dorm.managerUserId 
              ? users.find((u) => u.id === dorm.managerUserId)?.displayName || ""
              : "",
            cleanerName: "",
            weekLabel: `${Math.ceil(new Date().getDate() / 7)}주차`,
            monthLabel: `${new Date().getMonth() + 1}월`,
            cleanStatus: "미제출",
            checkResult: "-",
            score: 0,
            beforePhotoDataUrls: [],
            afterPhotoDataUrls: [],
            memo: `퇴실자: ${payload.employeeName}`,
            reporterUserId: currentUser?.id || "",
            reporterName: currentUser?.displayName || currentUser?.username || "",
            confirmedBy: "",
            confirmedAt: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setCleaningReports((prev) => [cleaningReport, ...prev]);
        }
      }
    }
    
    setAssignManagerToDorm(false);
    setOccupantForm(occupantTemplate());
    setEditingOccupantId(null);
    setShowOccupantForm(false);
  };

  const saveDormContract = () => {
    if (!canEditData(currentUser)) return;
    if (!dormContractForm.buildingName.trim() || !dormContractForm.address.trim()) {
      alert("건물명과 도로명주소는 필수입니다.");
      return;
    }
    if (!dormContractForm.contractStart || !dormContractForm.contractEnd) {
      alert("계약 시작일과 종료일을 모두 입력하세요.");
      return;
    }
    if (new Date(dormContractForm.contractStart) > new Date(dormContractForm.contractEnd)) {
      alert("계약 종료일은 시작일과 같거나 이후여야 합니다.");
      return;
    }

    const existing = editingDormContractId
      ? dormContracts.find((c) => c.id === editingDormContractId)
      : null;

    const actualStatus =
      dormContractForm.contractStatus === "자동선택"
        ? calculateDormContractStatus(dormContractForm, dorms, occupants)
        : dormContractForm.contractStatus;
    const actualType =
      dormContractForm.contractType === "자동선택"
        ? calculateDormContractType(dormContractForm, dormContracts, editingDormContractId)
        : dormContractForm.contractType;

    const finalPayload: DormContract = {
      id: editingDormContractId || crypto.randomUUID(),
      ...dormContractForm,
      contractStatus: actualStatus,
      contractType: actualType,
      registeredBy: dormContractForm.registeredBy || currentUser?.displayName || "",
      modifiedBy: currentUser?.displayName || dormContractForm.modifiedBy || "",
      createdAt:
        editingDormContractId
          ? existing?.createdAt || dormContractForm.createdAt
          : dormContractForm.createdAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    setDormContracts((prev) =>
      editingDormContractId
        ? prev.map((c) => (c.id === editingDormContractId ? finalPayload : c))
        : [finalPayload, ...prev]
    );

    const actionType = existing
      ? existing.contractStatus !== finalPayload.contractStatus
        ? "statusChange"
        : "update"
      : "create";

    createAuditLog({
      targetType: "dormContract",
      targetId: finalPayload.id,
      actionType,
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(finalPayload),
    });

    setDorms((prev) =>
      prev.map((dorm) => {
        const updatedContractsForDorm = editingDormContractId
          ? dormContracts.map((c) => (c.id === editingDormContractId ? finalPayload : c))
          : [finalPayload, ...dormContracts];

        const dormContractsForDorm = updatedContractsForDorm.filter(
          (c) =>
            c.address === dorm.address &&
            c.buildingName === dorm.buildingName &&
            c.dong === dorm.dong &&
            c.roomHo === dorm.roomHo
        );

        if (dormContractsForDorm.length === 0) return dorm;

        const hasActive = dormContractsForDorm.some((c) => c.contractStatus === "진행중");
        const hasExpiring = dormContractsForDorm.some((c) => c.contractStatus === "만료예정");
        const allTerminated = dormContractsForDorm.every(
          (c) => c.contractStatus === "종료" || c.contractStatus === "해지"
        );

        let newStatus = dorm.leaseStatus;
        if (hasActive) {
          newStatus = "사용중";
        } else if (hasExpiring) {
          newStatus = "만료예정";
        } else if (allTerminated) {
          newStatus = "해지";
        }

        return { ...dorm, leaseStatus: newStatus, updatedAt: new Date().toISOString() };
      })
    );

    setDormContractForm(dormContractTemplate());
    setEditingDormContractId(null);
    setShowDormContractForm(false);
  };

  const saveNewHire = () => {
    if (!canEditData(currentUser)) return;
    if (!newHireForm.name.trim()) {
      alert("이름은 필수입니다.");
      return;
    }
    if (!newHireForm.phone.trim()) {
      alert("연락처는 필수입니다.");
      return;
    }
    if (newHireForm.residenceStatus === "거주중" && !newHireForm.dormId) {
      const confirmed = window.confirm("기숙사가 배정되지 않았습니다. 미배정 상태로 등록하시겠습니까?");
      if (!confirmed) return;
    }
    if (newHireForm.expectedMoveInDate && newHireForm.expectedMoveOutDate && new Date(newHireForm.expectedMoveInDate) > new Date(newHireForm.expectedMoveOutDate)) {
      alert("예상 입주일은 예상 퇴실일 이전이어야 합니다.");
      return;
    }

    // 기존 담당자 중복 체크
    if (newHireForm.managerUserId && newHireForm.dormId) {
      const existingManager = dorms.find((d) => d.id === newHireForm.dormId)?.managerUserId;
      if (existingManager) {
        const existingManagerUser = users.find((u) => u.id === existingManager);
        const newManagerName = newHireForm.name;
        const existingManagerName = existingManagerUser?.displayName || "담당자";

        if (currentUser?.role === "admin") {
          const confirmed = window.confirm(
            `이미 이 기숙사에는 ${existingManagerName} 님이 기숙사 담당자로 지정되어 있습니다.\n그래도 ${newManagerName} 님으로 변경하시겠습니까?`
          );
          if (!confirmed) return;
        } else {
          alert(`이 기숙사는 이미 ${existingManagerName} 님이 담당자로 지정되어 있습니다.\n관리자에게 문의하세요.`);
          return;
        }
      }
    }

    const dorm = newHireForm.dormId ? dorms.find((d) => d.id === newHireForm.dormId) : null;
    const actualResidenceStatus =
      newHireForm.residenceStatus === "자동선택"
        ? calculateNewHireResidenceStatus(newHireForm)
        : newHireForm.residenceStatus;
    const actualMoveInType =
      newHireForm.moveInType === "자동선택"
        ? calculateMoveInType(newHireForm, newHires)
        : newHireForm.moveInType;

    const existing = editingNewHireId ? newHires.find((h) => h.id === editingNewHireId) : null;

    const payload: NewHireEmployee = {
      id: editingNewHireId || crypto.randomUUID(),
      ...newHireForm,
      managerUserId: newHireForm.dormId ? newHireForm.managerUserId : "",
      residenceStatus: actualResidenceStatus,
      moveInType: actualMoveInType,
      site: newHireForm.site || dorm?.site || "평택",
      createdAt:
        editingNewHireId
          ? existing?.createdAt || newHireForm.createdAt
          : newHireForm.createdAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setNewHires((prev) => (editingNewHireId ? prev.map((h) => (h.id === editingNewHireId ? payload : h)) : [payload, ...prev]));
    setOccupants((prev) => upsertOccupantFromNewHire(payload, prev));

    const actionType = existing
      ? existing.residenceStatus !== payload.residenceStatus
        ? "statusChange"
        : "update"
      : "create";

    createAuditLog({
      targetType: "newHire",
      targetId: payload.id,
      actionType,
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });

    if (payload.managerUserId && payload.dormId && dorm) {
      const existingManagerId = dorm.managerUserId;
      const existingManager = existingManagerId ? users.find((u) => u.id === existingManagerId) : null;
      const needNewManager = !existingManager || existingManager.displayName !== payload.name;
      if (needNewManager) {
        const manager = createMaintenanceReporter(
          payload.name,
          payload.dormId,
          dorm.buildingName,
          dorm.dong,
          dorm.roomHo,
          dorm.address,
          dorm.공동현관,
          dorm.세대현관
        );
        setUsers((prev) => [manager, ...prev]);
        setupDormManager(dorm.id, manager.id, existingManagerId);
      }
    }

    setNewHireForm(newHireTemplate());
    setEditingNewHireId(null);
    setShowNewHireForm(false);
  };

  const saveInventory = () => {
    if (!canEditData(currentUser)) return;

    const existing = editingInventoryId
      ? inventory.find((i) => i.id === editingInventoryId)
      : null;

    const payload: InventoryItem = {
      id: editingInventoryId || crypto.randomUUID(),
      ...inventoryForm,
      createdAt: editingInventoryId ? existing?.createdAt || new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setInventory((prev) => (editingInventoryId ? prev.map((i) => (i.id === editingInventoryId ? payload : i)) : [payload, ...prev]));

    const actionType = existing ? "update" : "create";
    createAuditLog({
      targetType: "inventory",
      targetId: payload.id,
      actionType,
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });

    setInventoryForm(inventoryTemplate());
    setEditingInventoryId(null);
    setShowInventoryForm(false);
  };

  const saveLease = () => {
    if (!canEditData(currentUser)) return;
    const payload: LeaseContract = { id: editingLeaseId || crypto.randomUUID(), ...leaseForm };
    setLeases((prev) => (editingLeaseId ? prev.map((l) => (l.id === editingLeaseId ? payload : l)) : [payload, ...prev]));
    setLeaseForm(leaseTemplate());
    setEditingLeaseId(null);
    setShowLeaseForm(false);
  };

  const saveSale = () => {
    if (!canEditData(currentUser)) return;
    const payload: SaleRecord = { id: editingSaleId || crypto.randomUUID(), ...saleForm, totalAmount: saleForm.unitPrice * saleForm.quantity };
    setSales((prev) => (editingSaleId ? prev.map((s) => (s.id === editingSaleId ? payload : s)) : [payload, ...prev]));
    setSaleForm(saleTemplate());
    setEditingSaleId(null);
    setShowSaleForm(false);
  };

  const saveDefect = () => {
    if (!canFileDefect(currentUser)) return;
    if (!defectForm.site.trim() || !defectForm.buildingName.trim() || !defectForm.dong.trim() || !defectForm.ho.trim() || !defectForm.requestText.trim()) {
      alert("필수 항목을 모두 입력하세요. (지역, 기숙사, 동/호, 요청 내용을 확인하세요.)");
      return;
    }

    const existing = editingDefectId
      ? defects.find((d) => d.id === editingDefectId)
      : null;

    const today = new Date().toISOString().slice(0, 10);

    const payload: DefectRequest = {
      id: editingDefectId || crypto.randomUUID(),
      ...defectForm,
      detailAddress: `${defectForm.dong} ${defectForm.ho}`,
      receiptDate: editingDefectId ? existing?.receiptDate || today : today,
      reporterUserId: existing?.reporterUserId || currentUser?.id || "",
      reporterName: existing?.reporterName || currentUser?.displayName || "",
      dormManagerName: existing?.dormManagerName || currentUser?.username || "",
      createdAt: editingDefectId
        ? existing?.createdAt || new Date().toISOString()
        : new Date().toISOString(),
      completedAt:
        defectForm.defectStatus === "완료"
          ? new Date().toISOString()
          : existing?.completedAt,
    };

    setDefects((prev) =>
      editingDefectId
        ? prev.map((d) => (d.id === editingDefectId ? payload : d))
        : [payload, ...prev]
    );

    const actionType = existing
      ? existing.defectStatus !== payload.defectStatus
        ? "statusChange"
        : "update"
      : "create";

    createAuditLog({
      targetType: "defect",
      targetId: payload.id,
      actionType,
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });

    setDefectForm(defectTemplate());
    setEditingDefectId(null);
    setShowDefectForm(false);
  };

  const canCreateCleaningReport = (user: LoginUser | null) => {
    return !!user && ["admin", "maintenance_reporter", "dorm_manager"].includes(user.role);
  };

  const canEditCleaningReport = (user: LoginUser | null, report: CleaningReport) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    return report.reporterUserId === user.id && report.cleanStatus === "제출완료";
  };

  const canEditDefect = (user: LoginUser | null, defect: DefectRequest) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    return defect.reporterUserId === user.id;
  };

  const openCleaningReportForm = (report?: CleaningReport, dorm?: OperationalDorm) => {
    const selectedDorm =
      dorm ||
      (currentUser?.role === "maintenance_reporter" && currentUser.dormId
        ? operationalDorms.find((d) => d.id === currentUser.dormId)
        : undefined);
    if (!canCreateCleaningReport(currentUser)) return;
    if (report && !canEditCleaningReport(currentUser, report)) return;
    if (selectedDorm && !hasAccessToOperationalDorm(currentUser, selectedDorm)) return;
    if (!report && !selectedDorm) return;

    const initial = report
      ? { ...report }
      : {
          ...cleaningReportTemplate(),
          reportDate: new Date().toISOString().slice(0, 10),
          site: selectedDorm?.site || "평택",
          dormId: selectedDorm?.id || "",
          buildingName: selectedDorm?.buildingName || "",
          address: selectedDorm?.address || "",
          dong: selectedDorm?.dong || "",
          roomHo: selectedDorm?.roomHo || "",
          공동현관: selectedDorm?.공동현관 || "",
          세대현관: selectedDorm?.세대현관 || "",
          managerUserId: currentUser?.id || selectedDorm?.managerUserId || "",
          managerName: currentUser?.displayName || "",
        };

    setCleaningReportForm(initial);
    setEditingCleaningReportId(report?.id || null);
    setShowCleaningReportForm(true);
  };

  const readFileDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  const handleCleaningReportPhotos = async (
    files: FileList | null,
    field: "beforePhotoDataUrls" | "afterPhotoDataUrls"
  ) => {
    if (!files) return;
    const urls = await Promise.all(Array.from(files).map((file) => readFileDataUrl(file)));
    setCleaningReportForm((prev) => ({
      ...prev,
      [field]: [...prev[field], ...urls],
    }));
  };

  const saveCleaningReport = () => {
    if (!canCreateCleaningReport(currentUser)) return;
    if (!cleaningReportForm.buildingName.trim() || !cleaningReportForm.dong.trim() || !cleaningReportForm.roomHo.trim()) {
      alert("청소보고서 저장을 위해 기숙사 정보(건물명, 동, 호수)를 입력해주세요.");
      return;
    }
    if (!cleaningReportForm.managerUserId.trim()) {
      alert("청소보고서 저장을 위해 담당 관리자 정보를 확인해주세요.");
      return;
    }

    const existing = editingCleaningReportId
      ? cleaningReports.find((r) => r.id === editingCleaningReportId)
      : null;

    if (existing) {
      const payload: CleaningReport = {
        id: existing.id,
        ...cleaningReportForm,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      setCleaningReports((prev) => prev.map((report) => (report.id === existing.id ? payload : report)));

      const actionType = existing.cleanStatus !== payload.cleanStatus ? "statusChange" : "update";
      createAuditLog({
        targetType: "cleaningReport",
        targetId: payload.id,
        actionType,
        changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
        beforeValue: JSON.stringify(existing),
        afterValue: JSON.stringify(payload),
      });
    } else {
      addCleaningReportWithAutoFill(currentUser, cleaningReportForm);
    }

    setCleaningReportForm(cleaningReportTemplate());
    setEditingCleaningReportId(null);
    setShowCleaningReportForm(false);
  };

  const deleteCleaningReport = (reportId: string) => {
    if (!currentUser || currentUser.role !== "admin") return;
    if (!confirm("이 청소보고서를 삭제하시겠습니까?")) return;
    softDeleteItem(cleaningReports, setCleaningReports, reportId, "cleaningReport");
  };

  const saveUser = async () => {
    if (!canManageUsers(currentUser)) return;
    if (!userForm.displayName.trim() || !userForm.username.trim()) {
      alert("표시이름과 아이디는 필수입니다.");
      return;
    }
    // 로그인 아이디 유효성 검사: 영문, 숫자, 점(.), 언더바(_), 하이픈(-)만 허용
    const rawUsername = userForm.username.trim();
    const usernamePattern = /^[A-Za-z0-9._-]+$/;
    if (!rawUsername.includes("@") && !usernamePattern.test(rawUsername)) {
      alert("로그인 아이디는 영문, 숫자, 점(.), 언더바(_), 하이픈(-)만 사용할 수 있습니다.");
      return;
    }
    if (!editingUserId && !userForm.password.trim()) {
      alert("새 계정은 비밀번호가 필요합니다.");
      return;
    }
    const dup = users.find((u) => u.username === userForm.username.trim() && u.id !== editingUserId);
    if (dup) {
      alert("이미 사용 중인 아이디입니다.");
      return;
    }

    const payload: LoginUser = {
      id: editingUserId || crypto.randomUUID(),
      ...userForm,
      username: userForm.username.trim(),
      displayName: userForm.displayName.trim(),
      createdAt: editingUserId ? users.find((u) => u.id === editingUserId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
    };

    // Supabase Auth + profiles 동기화
    if (isSupabaseAvailable()) {
      try {
        if (!editingUserId) {
          // 신규 사용자: Edge Function 호출 (service_role은 서버에서만 사용)
          const raw = userForm.username.trim();
          const email = raw.includes("@") ? raw : `${raw}@dormerpsystem.com`;
          const { user_id: userId, error: createError } = await createUserViaEdgeFunction({
            email,
            password: userForm.password,
            display_name: userForm.displayName.trim(),
            role: (userForm.role as any) || "viewer",
            is_active: userForm.isActive ?? true,
            dorm_id: userForm.dormId,
            site_access: userForm.siteAccess || "전체",
            gender_access: userForm.genderAccess || "전체",
            tenant_id: tenantId,
          });

          if (createError) {
            console.error("Edge Function user creation failed:", createError);
            alert(`사용자 생성 실패: ${(createError as any).message || "알 수 없는 오류"}`);
            return;
          }

          if (userId) {
            payload.id = userId;
          }
        } else {
          // 기존 사용자: profiles 테이블만 업데이트
          const { error: updateError } = await updateProfileOnly(editingUserId, {
            display_name: userForm.displayName.trim(),
            role: (userForm.role as any) || "viewer",
            is_active: userForm.isActive ?? true,
            dorm_id: userForm.dormId,
            site_access: userForm.siteAccess || "전체",
            gender_access: userForm.genderAccess || "전체",
          });

          if (updateError) {
            console.error("Profile update failed:", updateError);
            alert(`프로필 업데이트 실패: ${(updateError as any).message || "알 수 없는 오류"}`);
            return;
          }
        }
      } catch (err) {
        console.error("Supabase user save failed:", err);
        alert(`Supabase 저장 실패: ${err}`);
        return;
      }
    }

    // 로컬 상태 업데이트 (비밀번호는 저장하지 않음)
    setUsers((prev) =>
      editingUserId
        ? prev.map((u) => (u.id === editingUserId ? { ...payload, password: "" } : u))
        : [{ ...payload, password: "" }, ...prev]
    );
    setUserForm(userTemplate());
    setEditingUserId(null);
    setShowUserForm(false);
  };

  const openMilitaryPersonnelEdit = (person: MilitaryPersonnel) => {
    setMilitaryPersonnelForm(person);
    setEditingMilitaryPersonnelId(person.id);
    setShowMilitaryPersonnelForm(true);
  };

  const openMilitaryTrainingEdit = (record: TrainingRecord) => {
    setMilitaryTrainingForm(record);
    setEditingMilitaryTrainingId(record.id);
    setShowMilitaryTrainingForm(true);
  };

  const openMilitaryNoticeEdit = (notice: MilitaryNotice) => {
    setMilitaryNoticeForm(notice);
    setEditingMilitaryNoticeId(notice.id);
    setShowMilitaryNoticeForm(true);
  };

  const openMilitaryReportEdit = (report: MilitaryReport) => {
    setMilitaryReportForm(report);
    setEditingMilitaryReportId(report.id);
    setShowMilitaryReportForm(true);
  };

  const buildNoticeForTrainingRecord = (record: TrainingRecord, person: MilitaryPersonnel): MilitaryNotice | null => {
    const title = `${record.trainingType || record.subject || "훈련"} 통보서`;
    const content = [
      `이름: ${person.name}`,
      `부서: ${person.unit || ""}`,
      `연락처: ${person.phone || ""}`,
      `훈련유형: ${record.trainingType || record.subject || ""}`,
      `차수: ${record.trainingRound || ""}`,
      `훈련예정일: ${record.trainingDate || ""}`,
      `장소: ${record.location || ""}`,
      `비고: ${record.notes || ""}`,
    ].join("\n");

    const exists = militaryNotices.some((n) => n.personnelIds?.includes(person.id) && n.title === title && n.content === content);
    if (exists) return null;

    return {
      id: crypto.randomUUID(),
      personnelIds: [person.id],
      title,
      category: record.trainingType || record.subject || "통보",
      publishedDate: "",
      expiresDate: "",
      content,
      sentStatus: "미발송",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const saveMilitaryPersonnel = () => {
    if (!canEditData(currentUser)) return;
    if (!militaryPersonnelForm.name.trim()) {
      alert("이름을 입력하세요.");
      return;
    }
    const existing = editingMilitaryPersonnelId ? militaryPersonnel.find((item) => item.id === editingMilitaryPersonnelId) : null;
    const payload: MilitaryPersonnel = {
      ...militaryPersonnelForm,
      id: editingMilitaryPersonnelId || crypto.randomUUID(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // save personnel
    setMilitaryPersonnel((prev) => (editingMilitaryPersonnelId ? prev.map((item) => (item.id === editingMilitaryPersonnelId ? payload : item)) : [payload, ...prev]));
    createAuditLog({
      targetType: "militaryPersonnel",
      targetId: payload.id,
      actionType: existing ? "update" : "create",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });

    // Helper: excluded statuses where training should not be generated
    const isExcludedStatus = (status?: string) => {
      if (!status) return false;
      return ["퇴사", "전출", "휴직"].some((s) => status.includes(s));
    };

    // Helper: whether this person should have auto-generation considered
    const shouldAutoCreateFor = (person: MilitaryPersonnel) => {
      if (!militaryTrainingAutoConfig.enabled) return false;
      if (!person.status) return false;
      if (!militaryTrainingAutoConfig.targetStatuses || militaryTrainingAutoConfig.targetStatuses.length === 0) return false;
      return militaryTrainingAutoConfig.targetStatuses.includes(person.status);
    };

    // Mark existing records as excluded if person moved to excluded status
    if (isExcludedStatus(payload.status)) {
      setMilitaryTrainingRecords((prev) => {
        const updated = prev.map((r) => (r.personnelId === payload.id && !/(관리제외|대상아님)/i.test(r.status) ? { ...r, status: "관리제외", updatedAt: new Date().toISOString() } : r));
        // create audit logs for changed records
        prev.forEach((r) => {
          if (r.personnelId === payload.id && !/(관리제외|대상아님)/i.test(r.status)) {
            createAuditLog({
              targetType: "trainingRecord",
              targetId: r.id,
              actionType: "update",
              changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
              beforeValue: JSON.stringify(r),
              afterValue: JSON.stringify({ ...r, status: "관리제외" }),
            });
          }
        });
        return updated;
      });
    } else {
      // If not excluded and eligible for auto-creation, create missing training records and automatic notices
      if (shouldAutoCreateFor(payload)) {
        const newRecords: TrainingRecord[] = [];
        const newNotices: MilitaryNotice[] = [];
        const personYear = getTrainingYear(payload, effectiveMilitaryReferenceYear);
        const applicable = militaryTrainingRules.filter((r) => {
          try {
            if (r.currentCategory && r.currentCategory !== getMilitaryCategory(payload, effectiveMilitaryReferenceYear)) return false;
            if (r.yearMin != null && personYear < Number(r.yearMin)) return false;
            if (r.yearMax != null && personYear > Number(r.yearMax)) return false;
            if (r.mobilizationOnly && !payload.mobilization) return false;
            if (!r.enabled) return false;
            return true;
          } catch (err) {
            return false;
          }
        });

        let selectedRules = applicable;
        if (applicable.length > 1) {
          const hasMobilized = applicable.some((x) => !!x.mobilizationOnly);
          const hasNonMobilized = applicable.some((x) => !x.mobilizationOnly);
          if (hasMobilized && hasNonMobilized) {
            selectedRules = payload.mobilization ? applicable.filter((x) => !!x.mobilizationOnly) : applicable.filter((x) => !x.mobilizationOnly);
          }
        }

        selectedRules.forEach((r) => {
          const yearKey = String(r.year || new Date().getFullYear());
          const trainingType = r.trainingType || r.name || "훈련";
          const trainingRound = r.trainingRound || "1차";
          const exists = militaryTrainingRecords.find((rec) => rec.personnelId === payload.id && rec.trainingYear === yearKey && rec.trainingType === trainingType && (rec.trainingRound || "1차") === trainingRound);
          if (exists) return;
          const newRec: TrainingRecord = {
            id: crypto.randomUUID(),
            personnelId: payload.id,
            subject: trainingType,
            trainingType: trainingType,
            trainingRound: trainingRound,
            trainingYear: yearKey,
            trainingDate: "",
            completionDate: "",
            trainingHours: Number(r.requiredHours) || 0,
            location: "",
            attendees: 0,
            status: "일정미등록",
            notes: "자동생성",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          newRecords.push(newRec);
          const notice = buildNoticeForTrainingRecord(newRec, payload);
          if (notice) newNotices.push(notice);
        });

        if (newRecords.length > 0) {
          setMilitaryTrainingRecords((prev) => [...newRecords, ...prev]);
          newRecords.forEach((newRec) => {
            createAuditLog({
              targetType: "trainingRecord",
              targetId: newRec.id,
              actionType: "create",
              changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
              beforeValue: "",
              afterValue: JSON.stringify(newRec),
            });
          });
        }

        if (newNotices.length > 0) {
          setMilitaryNotices((prev) => [...newNotices, ...prev]);
          newNotices.forEach((notice) => {
            createAuditLog({
              targetType: "militaryNotice",
              targetId: notice.id,
              actionType: "create",
              changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
              beforeValue: "",
              afterValue: JSON.stringify(notice),
            });
          });
        }
      }
    }
    setMilitaryPersonnelForm({
      id: "",
      name: "",
      rank: "",
      serviceBranch: "",
      unit: "",
      phone: "",
      birthDate: "",
      enlistmentDate: "",
      dischargeDate: "",
      calculationMode: "auto",
      manualCategory: "",
      manualYear: "",
      mobilization: false,
      status: "",
      notes: "",
      createdAt: "",
      updatedAt: "",
    });
    setEditingMilitaryPersonnelId(null);
    setShowMilitaryPersonnelForm(false);
  };

  const generateAllMilitaryTrainingRecords = () => {
    if (!canEditData(currentUser)) return;
    const existingRecords = militaryTrainingRecords;
    const newRecords: TrainingRecord[] = [];
    const newNotices: MilitaryNotice[] = [];

    const shouldAutoCreateForPerson = (person: MilitaryPersonnel) => {
      if (!militaryTrainingAutoConfig.enabled) return false;
      if (!person.status) return false;
      if (!militaryTrainingAutoConfig.targetStatuses || militaryTrainingAutoConfig.targetStatuses.length === 0) return false;
      return militaryTrainingAutoConfig.targetStatuses.includes(person.status);
    };

    const isExcludedStatus = (status?: string) => {
      if (!status) return false;
      return ["퇴사", "전출", "휴직"].some((s) => status.includes(s));
    };

    militaryPersonnel.forEach((person) => {
      if (isExcludedStatus(person.status)) return;
      if (!shouldAutoCreateForPerson(person)) return;
      const personYear = getTrainingYear(person, effectiveMilitaryReferenceYear);
      const applicable = militaryTrainingRules.filter((r) => {
        try {
          if (r.currentCategory && r.currentCategory !== getMilitaryCategory(person, effectiveMilitaryReferenceYear)) return false;
          if (r.yearMin != null && personYear < Number(r.yearMin)) return false;
          if (r.yearMax != null && personYear > Number(r.yearMax)) return false;
          if (r.mobilizationOnly && !person.mobilization) return false;
          if (!r.enabled) return false;
          return true;
        } catch {
          return false;
        }
      });
      let selectedRules = applicable;
      if (applicable.length > 1) {
        const hasMobilized = applicable.some((x) => !!x.mobilizationOnly);
        const hasNonMobilized = applicable.some((x) => !x.mobilizationOnly);
        if (hasMobilized && hasNonMobilized) {
          selectedRules = person.mobilization ? applicable.filter((x) => !!x.mobilizationOnly) : applicable.filter((x) => !x.mobilizationOnly);
        }
      }
      selectedRules.forEach((r) => {
        const yearKey = String(r.year || new Date().getFullYear());
        const trainingType = r.trainingType || r.name || "훈련";
        const trainingRound = r.trainingRound || "1차";
        const exists = existingRecords.find((rec) => rec.personnelId === person.id && rec.trainingYear === yearKey && rec.trainingType === trainingType && (rec.trainingRound || "1차") === trainingRound);
        if (exists) return;
        const newRec: TrainingRecord = {
          id: crypto.randomUUID(),
          personnelId: person.id,
          subject: trainingType,
          trainingType,
          trainingRound,
          trainingYear: yearKey,
          trainingDate: "",
          completionDate: "",
          trainingHours: Number(r.requiredHours) || 0,
          location: "",
          attendees: 0,
          status: "일정미등록",
          notes: "자동생성",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        newRecords.push(newRec);
        const notice = buildNoticeForTrainingRecord(newRec, person);
        if (notice) newNotices.push(notice);
      });
    });

    if (newRecords.length === 0) {
      alert("새로 생성할 훈련기록이 없습니다.");
      return;
    }

    setMilitaryTrainingRecords((prev) => [...newRecords, ...prev]);
    newRecords.forEach((newRec) => {
      createAuditLog({
        targetType: "trainingRecord",
        targetId: newRec.id,
        actionType: "create",
        changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
        beforeValue: "",
        afterValue: JSON.stringify(newRec),
      });
    });

    if (newNotices.length > 0) {
      setMilitaryNotices((prev) => [...newNotices, ...prev]);
      newNotices.forEach((notice) => {
        createAuditLog({
          targetType: "militaryNotice",
          targetId: notice.id,
          actionType: "create",
          changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
          beforeValue: "",
          afterValue: JSON.stringify(notice),
        });
      });
    }
    alert(`${newRecords.length}개의 훈련기록을 자동생성했습니다.`);
  };

  const saveMilitaryTraining = () => {
    if (!canEditData(currentUser)) return;
    if (!militaryTrainingForm.personnelId) {
      alert("훈련 대상자를 선택하세요.");
      return;
    }
    if (!militaryTrainingForm.subject.trim()) {
      alert("훈련명을 입력하세요.");
      return;
    }
    const person = militaryPersonnel.find((p) => p.id === militaryTrainingForm.personnelId);
    const requiredHours = person ? computeRequiredTraining(person).hours : 0;
    const enteredHours = Number(militaryTrainingForm.trainingHours) || 0;
    const computedStatus = requiredHours > 0 ? (enteredHours >= requiredHours ? "완료" : "미이수") : militaryTrainingForm.status || "완료";
    const existing = editingMilitaryTrainingId ? militaryTrainingRecords.find((item) => item.id === editingMilitaryTrainingId) : null;
    const payload: TrainingRecord = {
      ...militaryTrainingForm,
      trainingType: militaryTrainingForm.trainingType,
      trainingRound: militaryTrainingForm.trainingRound,
      trainingYear: militaryTrainingForm.trainingYear || String(getTrainingYear(person || { ...militaryPersonnelForm } as MilitaryPersonnel, effectiveMilitaryReferenceYear)),
      id: editingMilitaryTrainingId || crypto.randomUUID(),
      trainingHours: enteredHours,
      status: computedStatus,
      attendees: Number(militaryTrainingForm.attendees) || 0,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setMilitaryTrainingRecords((prev) => (editingMilitaryTrainingId ? prev.map((item) => (item.id === editingMilitaryTrainingId ? payload : item)) : [payload, ...prev]));
    createAuditLog({
      targetType: "trainingRecord",
      targetId: payload.id,
      actionType: existing ? "update" : "create",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });
    setMilitaryTrainingForm({
      id: "",
      personnelId: "",
      subject: "",
      trainingDate: "",
      completionDate: "",
      trainingHours: 0,
      location: "",
      attendees: 0,
      status: "",
      notes: "",
      createdAt: "",
      updatedAt: "",
    });
    setEditingMilitaryTrainingId(null);
    setShowMilitaryTrainingForm(false);
  };

  const saveMilitaryNotice = () => {
    if (!canEditData(currentUser)) return;
    if (!militaryNoticeForm.personnelIds?.length) {
      alert("통보 받을 인원을 선택하세요.");
      return;
    }
    if (!militaryNoticeForm.title.trim()) {
      alert("공지 제목을 입력하세요.");
      return;
    }
    const existing = editingMilitaryNoticeId ? militaryNotices.find((item) => item.id === editingMilitaryNoticeId) : null;
    const payload: MilitaryNotice = {
      ...militaryNoticeForm,
      id: editingMilitaryNoticeId || crypto.randomUUID(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setMilitaryNotices((prev) => (editingMilitaryNoticeId ? prev.map((item) => (item.id === editingMilitaryNoticeId ? payload : item)) : [payload, ...prev]));
    createAuditLog({
      targetType: "militaryNotice",
      targetId: payload.id,
      actionType: existing ? "update" : "create",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });
    setMilitaryNoticeForm({
      id: "",
      personnelIds: [],
      title: "",
      category: "",
      publishedDate: "",
      expiresDate: "",
      content: "",
      createdAt: "",
      updatedAt: "",
    });
    setEditingMilitaryNoticeId(null);
    setShowMilitaryNoticeForm(false);
  };

  // Auto-generate notices from training records
  const generateNoticesFromTrainingRecords = () => {
    if (!canEditData(currentUser)) return;
    const toCreate: MilitaryNotice[] = [];
    militaryTrainingRecords.forEach((rec) => {
      if (!rec.personnelId) return;
      if (/(관리제외|대상아님)/i.test(rec.status || "")) return;
      const person = militaryPersonnel.find((p) => p.id === rec.personnelId);
      if (!person) return;
      const title = `${rec.trainingType || rec.subject} 통보서`;
      const content = `이름: ${person.name}\n부서: ${person.unit || ""}\n연락처: ${person.phone || ""}\n훈련유형: ${rec.trainingType || rec.subject || ""}\n차수: ${rec.trainingRound || ""}\n훈련예정일: ${rec.trainingDate || ""}\n장소: ${rec.location || ""}`;
      // avoid duplicate: check existing notice with same personnelIds + title + content
      const exists = militaryNotices.find((n) => n.personnelIds?.includes(person.id) && n.title === title && n.content === content);
      if (exists) return;
      toCreate.push({
        id: crypto.randomUUID(),
        personnelIds: [person.id],
        title,
        category: rec.trainingType || "통보",
        publishedDate: "",
        expiresDate: "",
        content,
        sentStatus: "미발송",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    if (toCreate.length === 0) return alert("새로 생성할 통보서가 없습니다.");
    setMilitaryNotices((prev) => [...toCreate, ...prev]);
    toCreate.forEach((n) => createAuditLog({ targetType: "militaryNotice", targetId: n.id, actionType: "create", changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "", beforeValue: "", afterValue: JSON.stringify(n) }));
    alert(`${toCreate.length}개의 통보서를 생성했습니다.`);
  };

  const openNoticePrintWindow = (notice: MilitaryNotice) => {
    const personId = notice.personnelIds?.[0];
    const person = militaryPersonnel.find((p) => p.id === personId);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${notice.title}</title><style>body{font-family:Arial;margin:40px}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:6px;border:1px solid #ccc} .small{font-size:12px;color:#666}</style></head><body><h1>${notice.title}</h1><div class="small">발행일: ${notice.publishedDate || ''}</div><table><tr><td>이름</td><td>${person?.name || ''}</td></tr><tr><td>부서</td><td>${person?.unit || ''}</td></tr><tr><td>연락처</td><td>${person?.phone || ''}</td></tr><tr><td>훈련유형</td><td>${notice.category || ''}</td></tr><tr><td>차수</td><td>${(notice.content||'').match(/차수: ([^\n]+)/)?.[1] || ''}</td></tr><tr><td>훈련예정일</td><td>${(notice.content||'').match(/훈련예정일: ([^\n]+)/)?.[1] || ''}</td></tr><tr><td>장소</td><td>${(notice.content||'').match(/장소: ([^\n]+)/)?.[1] || ''}</td></tr></table><div style="margin-top:20px">${notice.content?.replace(/\n/g,'<br/>') || ''}</div><script>setTimeout(()=>{window.print();},500);</script></body></html>`;
    const w = window.open("", "notice-print", "width=800,height=900");
    if (!w) return alert('팝업이 차단되었습니다. 팝업을 허용해주세요.');
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // Generate summary reports into militaryReports state
  const formatReportNotes = (items: Array<Record<string, any>> | Record<string, any>): string => {
    if (!items) return "";
    if (!Array.isArray(items)) {
      return Object.entries(items).map(([key, value]) => `${key}: ${value}`).join("\n");
    }
    return items
      .map((item) =>
        Object.entries(item)
          .map(([key, value]) => {
            if (value === undefined || value === null) return `${key}: `;
            if (typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
            return `${key}: ${value}`;
          })
          .join(", ")
      )
      .join("\n");
  };

  const generateMilitaryReports = () => {
    if (!canEditData(currentUser)) return;
    const now = new Date().toISOString().slice(0,10);
    const reports: MilitaryReport[] = [];

    const reserveList = militaryPersonnel.filter((p) => getMilitaryCategory(p, effectiveMilitaryReferenceYear) === '예비군');
    reports.push({
      id: crypto.randomUUID(),
      title: '예비군 대상자 현황',
      reportDate: now,
      type: '예비군',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${reserveList.length}명\n${formatReportNotes(reserveList.map((p) => ({ id: p.id, name: p.name, department: p.unit || '', status: p.status })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const civilList = militaryPersonnel.filter((p) => getMilitaryCategory(p, effectiveMilitaryReferenceYear) === '민방위');
    reports.push({
      id: crypto.randomUUID(),
      title: '민방위 대상자 현황',
      reportDate: now,
      type: '민방위',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${civilList.length}명\n${formatReportNotes(civilList.map((p) => ({ id: p.id, name: p.name, department: p.unit || '', status: p.status })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const incomplete = militaryTrainingRecords.filter((r) => !/(완료|이수|completed)/i.test(r.status || '') && !/(관리제외|대상아님)/i.test(r.status || ''));
    reports.push({
      id: crypto.randomUUID(),
      title: '미이수자 명단',
      reportDate: now,
      type: '미이수',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${incomplete.length}건\n${formatReportNotes(incomplete.map((r) => ({ personnelId: r.personnelId, trainingType: r.trainingType || r.subject, trainingRound: r.trainingRound, status: r.status })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const scheduled = militaryTrainingRecords.filter((r) => r.trainingDate && !/(관리제외|대상아님)/i.test(r.status || ''));
    reports.push({
      id: crypto.randomUUID(),
      title: '훈련 예정자 명단',
      reportDate: now,
      type: '예정',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${scheduled.length}건\n${formatReportNotes(scheduled.map((r) => ({ personnelId: r.personnelId, trainingType: r.trainingType || r.subject, trainingDate: r.trainingDate })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const in30 = scheduled.filter((r) => {
      if (!r.trainingDate) return false;
      const d = new Date(r.trainingDate);
      const diff = (d.getTime() - new Date().getTime()) / (1000*60*60*24);
      return diff >= 0 && diff <= 30;
    });
    reports.push({
      id: crypto.randomUUID(),
      title: '30일 이내 예정자',
      reportDate: now,
      type: '30일',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${in30.length}건\n${formatReportNotes(in30.map((r) => ({ personnelId: r.personnelId, trainingType: r.trainingType || r.subject, trainingDate: r.trainingDate })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const unsent = militaryNotices.filter((n:any) => (n.sentStatus || '미발송') === '미발송');
    reports.push({
      id: crypto.randomUUID(),
      title: '통보서 미발송자',
      reportDate: now,
      type: '통보서',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${unsent.length}건\n${formatReportNotes(unsent.map((n) => ({ title: n.title, personnelIds: n.personnelIds, sentStatus: n.sentStatus || '미발송' })))}`,
      createdAt: now,
      updatedAt: now,
    });

    const byDept: Record<string, number> = {};
    militaryPersonnel.forEach((p) => {
      const d = p.unit || '미지정';
      byDept[d] = (byDept[d] || 0) + 1;
    });
    reports.push({
      id: crypto.randomUUID(),
      title: '부서별 현황',
      reportDate: now,
      type: '부서',
      author: currentUser?.displayName || currentUser?.username || '',
      status: '완료',
      notes: `총 ${militaryPersonnel.length}명\n${formatReportNotes(byDept)}`,
      createdAt: now,
      updatedAt: now,
    });

    setMilitaryReports((prev) => [...reports, ...prev]);
    reports.forEach((r) => createAuditLog({ targetType: 'militaryReport', targetId: r.id, actionType: 'create', changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || '', beforeValue: '', afterValue: JSON.stringify(r) }));
    alert(`${reports.length}개의 리포트를 생성했습니다.`);
  };

  const saveMilitaryReport = () => {
    if (!canEditData(currentUser)) return;
    if (!militaryReportForm.title.trim()) {
      alert("보고서 제목을 입력하세요.");
      return;
    }
    const existing = editingMilitaryReportId ? militaryReports.find((item) => item.id === editingMilitaryReportId) : null;
    const payload: MilitaryReport = {
      ...militaryReportForm,
      id: editingMilitaryReportId || crypto.randomUUID(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setMilitaryReports((prev) => (editingMilitaryReportId ? prev.map((item) => (item.id === editingMilitaryReportId ? payload : item)) : [payload, ...prev]));
    createAuditLog({
      targetType: "militaryReport",
      targetId: payload.id,
      actionType: existing ? "update" : "create",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: existing ? JSON.stringify(existing) : "",
      afterValue: JSON.stringify(payload),
    });
    setMilitaryReportForm({
      id: "",
      title: "",
      reportDate: "",
      type: "",
      author: "",
      status: "",
      notes: "",
      createdAt: "",
      updatedAt: "",
    });
    setEditingMilitaryReportId(null);
    setShowMilitaryReportForm(false);
  };

  const uploadDormExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" }).map((r) => normalizeExcelRow(r, "dorm"));
    const mappedDorms: Dorm[] = rows.map((r) => ({
      id: crypto.randomUUID(),
      site: String(r["지역"] || "평택") as Site,
      gender: String(r["성별"] || "남") as "남" | "여",
      buildingName: String(r["건물명"] || ""),
      address: String(r["주소"] || ""),
      dong: String(r["동"] || ""),
      roomHo: String(r["호수"] || r["호"] || ""),
      pyeong: String(r["평수"] || ""),
      capacity: 6,
      managerUserId: undefined,
      contractStart: String(r["계약시작"] || String(r["계약일"] || "")),
      contractEnd: String(r["계약종료"] || String(r["만료일"] || "")),
      contractAmount: String(r["계약금액"] || ""),
      leaseStatus: String(r["상태"] || "사용중") as Dorm["leaseStatus"],
      prepaymentDeposit: Number(r["선납계약금"] || 0),
      realEstateName: String(r["부동산명"] || ""),
      공동현관: String(r["공동현관"] || ""),
      세대현관: String(r["세대현관"] || ""),
      balanceDate: String(r["잔금일"] || ""),
      notes: String(r["비고"] || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setDorms((prev) => [...mappedDorms, ...prev]);
  };

  const uploadDormContractsExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" }).map((r) => normalizeExcelRow(r, "dormContract"));
    const mapped = rows.map((r) => ({
      id: crypto.randomUUID(),
      site: String(r["지역"] || "평택") as Site,
      address: String(r["도로명주소"] || r["주소"] || ""),
      buildingName: String(r["건물명"] || ""),
      dong: String(r["동"] || ""),
      roomHo: String(r["호수"] || r["호"] || ""),
      pyeong: String(r["평수"] || ""),
      landlordName: String(r["임대인명"] || ""),
      landlordPhone: String(r["임대인연락처"] || ""),
      realEstateName: String(r["부동산명"] || ""),
      realEstatePhone: String(r["부동산연락처"] || ""),
      공동현관: String(r["공동현관"] || ""),
      세대현관: String(r["세대현관"] || ""),
      contractStart: String(r["계약시작일"] || String(r["계약시작"] || "")),
      contractEnd: String(r["계약종료일"] || String(r["계약종료"] || "")),
      contractStatus: String(r["계약상태"] || r["status"] || "진행중") as DormContractStatus,
      contractAmount: String(r["계약금액"] || r["contractAmount"] || ""),
      prepaymentDeposit: String(r["선납금"] || r["prepaymentDeposit"] || ""),
      deposit: String(r["보증금"] || r["deposit"] || ""),
      monthlyRentOrMaintenance: String(r["월세/관리비"] || r["월세 or 관리비"] || r["monthlyRentOrMaintenance"] || ""),
      contractType: String(r["계약유형"] || r["contractType"] || "신규") as ContractType,
      gender: String(r["성별"] || "남") as Gender,
      notes: String(r["비고"] || ""),
      registeredBy: String(r["등록자"] || r["registeredBy"] || currentUser?.displayName || ""),
      modifiedBy: String(r["수정자"] || r["modifiedBy"] || currentUser?.displayName || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setDormContracts((prev) => [...mapped, ...prev]);
  };

  const uploadNewHiresExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" }).map((r) => normalizeExcelRow(r, "newHire"));
    const mapped = rows.map((r) => {
      const address = String(r["도로명주소"] || r["주소"] || "").trim();
      const matchedDorm = dorms.find(
        (d) =>
          d.address === address ||
          `${d.address} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`.trim() === address ||
          `${d.address}${stripDongHoSuffix(d.dong)}${stripDongHoSuffix(d.roomHo)}` === address
      );
      return {
      id: crypto.randomUUID(),
      site: String(r["지역"] || "평택") as Site,
      gender: String(r["성별"] || "남") as Gender,
      name: String(r["이름"] || ""),
      phone: String(r["연락처"] || ""),
      department: String(r["부서"] || ""),
      dormId: matchedDorm?.id || String(r["기숙사ID"] || r["dormId"] || ""),
      address: matchedDorm?.address || address || "",
      buildingName: String(r["건물명"] || r["buildingName"] || matchedDorm?.buildingName || ""),
      dong: String(r["동"] || matchedDorm?.dong || ""),
      roomHo: String(r["호수"] || r["호"] || r["roomHo"] || matchedDorm?.roomHo || ""),
      공동현관: matchedDorm?.공동현관 || String(r["공동현관"] || ""),
      세대현관: matchedDorm?.세대현관 || String(r["세대현관"] || ""),
      expectedMoveInDate: parseExcelDate(r["예상입실일"] || r["expectedMoveInDate"] || ""),
      moveInDate: parseExcelDate(r["입실일"] || r["moveInDate"] || ""),
      expectedMoveOutDate: parseExcelDate(r["예상퇴실일"] || r["expectedMoveOutDate"] || ""),
      moveOutDate: parseExcelDate(r["퇴실일"] || r["moveOutDate"] || ""),
      actualMoveOutDate: parseExcelDate(r["실제퇴실일"] || r["actualMoveOutDate"] || ""),
      cheonanMoveDate: parseExcelDate(r["천안이동일"] || r["cheonanMoveDate"] || ""),
      residenceStatus: String(r["거주상태"] || r["status"] || "거주중") as NewHireResidenceStatus,
      moveInType: String(r["입주유형"] || r["moveInType"] || "신규") as MoveInType,
      extensionReason: String(r["연장사유"] || r["extensionReason"] || ""),
      notes: String(r["특이사항 메모"] || r["notes"] || ""),
      createdAt: new Date().toISOString().slice(0,10),
      updatedAt: new Date().toISOString().slice(0,10),
    };
    });
    setNewHires((prev) => [...mapped, ...prev]);
  };

  const uploadMilitaryPersonnelExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => ({
      id: crypto.randomUUID(),
      name: String(r["이름"] || r["name"] || ""),
      rank: String(r["계급"] || r["rank"] || ""),
      serviceBranch: String(r["군별"] || r["serviceBranch"] || ""),
      unit: String(r["부대"] || r["unit"] || ""),
      phone: String(r["연락처"] || r["phone"] || ""),
      birthDate: parseExcelDate(r["생년월일"] || r["birthDate"] || ""),
      enlistmentDate: parseExcelDate(r["입대일"] || r["enlistmentDate"] || ""),
      dischargeDate: parseExcelDate(r["전역일"] || r["dischargeDate"] || ""),
      calculationMode: (String(r["계산모드"] || r["calculationMode"] || "auto") as "auto" | "manual"),
      manualCategory: (String(r["수동현재구분"] || r["manualCategory"] || r["현재구분"] || "") as "예비군" | "민방위" | "대상아님" | ""),
      manualYear: String(r["수동연차"] || r["manualYear"] || r["연차"] || ""),
      // parse mobilization: accept explicit values like '동원', '동원지정', 'y', 'yes', 'true'
      mobilization: (() => {
        const raw = String(r["동원여부"] || r["mobilization"] || "").trim().toLowerCase();
        if (!raw) return false;
        if (/^(동원|동원지정|동원확인|y|yes|true)$/.test(raw)) return true;
        // treat values containing '미지정' or '미' as false even if '동원' substring exists
        if (raw.includes('동원') && (raw.includes('미지정') || raw.includes('미'))) return false;
        return false;
      })(),
      status: String(r["상태"] || r["status"] || ""),
      notes: String(r["비고"] || r["notes"] || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setMilitaryPersonnel((prev) => [...mapped, ...prev]);
  };

  const uploadMilitaryTrainingExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => {
      const personnelName = String(r["대상자"] || r["personnelName"] || "");
      const personnelId = militaryPersonnel.find((p) => p.name === personnelName)?.id || "";
      return {
        id: crypto.randomUUID(),
        personnelId: personnelId,
        trainingType: String(r["훈련유형"] || r["trainingType"] || r["훈련명"] || r["subject"] || ""),
        subject: String(r["훈련명"] || r["subject"] || ""),
        trainingRound: String(r["차수"] || r["trainingRound"] || "1차"),
        trainingDate: parseExcelDate(r["훈련예정일"] || r["trainingDate"] || r["훈련일"] || "") || String(r["훈련예정일"] || r["trainingDate"] || r["훈련일"] || ""),
        completionDate: parseExcelDate(r["이수일"] || r["completionDate"] || "") || String(r["이수일"] || r["completionDate"] || ""),
        trainingHours: Number(r["이수시간"] || r["trainingHours"] || r["hours"] || 0),
        location: String(r["위치"] || r["location"] || ""),
        attendees: Number(r["참석인원"] || r["attendees"] || 0),
        status: String(r["상태"] || r["status"] || ""),
        notes: String(r["비고"] || r["notes"] || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    setMilitaryTrainingRecords((prev) => [...mapped, ...prev]);
  };

  const uploadMilitaryNoticesExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => {
      const personnelNamesStr = String(r["대상자"] || r["personnelNames"] || "");
      const personnelIds = personnelNamesStr
        .split(/[,;]/)
        .map((name) => name.trim())
        .filter((name) => name)
        .map((name) => militaryPersonnel.find((p) => p.name === name)?.id || "")
        .filter((id) => id);
      return {
        id: crypto.randomUUID(),
        personnelIds: personnelIds,
        title: String(r["제목"] || r["title"] || ""),
        category: String(r["구분"] || r["category"] || ""),
        publishedDate: String(r["게시일"] || r["publishedDate"] || ""),
        expiresDate: String(r["만료일"] || r["expiresDate"] || ""),
        content: String(r["내용"] || r["content"] || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    setMilitaryNotices((prev) => [...mapped, ...prev]);
  };

  const uploadMilitaryReportsExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => ({
      id: crypto.randomUUID(),
      title: String(r["제목"] || r["title"] || ""),
      reportDate: String(r["보고일"] || r["reportDate"] || ""),
      type: String(r["종류"] || r["type"] || ""),
      author: String(r["작성자"] || r["author"] || ""),
      status: String(r["상태"] || r["status"] || ""),
      notes: String(r["비고"] || r["notes"] || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setMilitaryReports((prev) => [...mapped, ...prev]);
  };

  const uploadExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    if (activeTab === "dormContracts") {
      await uploadDormContractsExcel(file);
      return;
    }
    if (activeTab === "newHires") {
      await uploadNewHiresExcel(file);
      return;
    }
    if (activeTab === "personnelManagement") {
      await uploadMilitaryPersonnelExcel(file);
      return;
    }
    if (activeTab === "trainingRecords") {
      await uploadMilitaryTrainingExcel(file);
      return;
    }
    if (activeTab === "militaryNotices") {
      await uploadMilitaryNoticesExcel(file);
      return;
    }
    if (activeTab === "militaryReports") {
      await uploadMilitaryReportsExcel(file);
      return;
    }
    await uploadDormExcel(file);
  };

  const uploadTemplateExcel = async (file: File) => {
    if (!canManageUsers(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const headers = getWorksheetHeaders(worksheet);
    if (headers.length === 0) {
      alert("첫 번째 행에서 헤더를 찾을 수 없습니다. 올바른 엑셀파일을 업로드해주세요.");
      return;
    }

    const newTemplate: CustomTemplate = {
      id: crypto.randomUUID(),
      name: templateUploadName.trim() || file.name.replace(/\.(xlsx|xls)$/i, ""),
      tableType: templateUploadType,
      headers,
      fileName: file.name,
      fileData: arrayBufferToBase64(buffer),
      createdAt: new Date().toISOString(),
    };

    setCustomTemplates((prev) => [newTemplate, ...prev]);
    setTemplateUploadName("");
    setTemplateUploadType("dormContract");
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

const exportExcel = () => {
  if (!canEditData(currentUser)) {
    alert("엑셀 다운로드는 관리자 권한이 필요합니다.");
    return;
  }
  let rows: Record<string, unknown>[] = [];
  let fileName = "export.xlsx";
  let tableType: TableType | null = TABLE_TYPE_BY_TAB[activeTab];

  if (activeTab === "dorms") {
    rows = visibleDorms.map((d) => ({
      지역: d.site,
      성별: d.gender,
      건물명: d.buildingName,
      주소: d.address,
      동: d.dong,
      호수: d.roomHo,
      평수: d.pyeong,
      계약시작: d.contractStart,
      계약종료: d.contractEnd,
      계약금액: d.contractAmount,
      상태: d.leaseStatus,
      공동현관: d.공동현관,
      세대현관: d.세대현관,
      선납계약금: d.prepaymentDeposit,
      부동산명: d.realEstateName,
      잔금일: d.balanceDate,
      비고: d.notes,
    }));
    fileName = "기숙사목록.xlsx";
  } else if (activeTab === "occupants") {
    rows = visibleOccupants
      .filter((o) => !selectedDormId || o.dormId === selectedDormId)
      .map((o) => {
        const dorm =
          operationalDorms.find((d) => d.id === o.dormId) ||
          dorms.find((d) => d.id === o.dormId);
        return {
          지역: dorm?.site || "",
          기숙사: dorm?.buildingName || "",
          이름: o.employeeName,
          성별: o.gender,
          부서: o.department,
          연락처: o.phone,
          입실일: o.moveInDate,
          잔여일: daysBetween(o.moveInDate, o.moveOutDueDate),
          예상입실일: o.expectedMoveInDate,
          예상퇴실일: o.expectedMoveOutDate,
          실제퇴실일: o.actualMoveOutDate,
          상태: o.status,
          비고: o.notes,
        };
      });
    fileName = "입주자목록.xlsx";
  } else if (activeTab === "simulation") {
    rows = visibleSimulationRows.map((r) => ({
      구분: r.site + "(" + r.gender + ")",
      기숙사수: r.dormCount,
      거주자TO: r.residentTo,
      현거주자: r.currentResidents,
      거주기한만료자: r.expiredResidents,
      중도퇴거자: r.earlyDepartures,
      천안이동: r.cheonanMove,
      신규입주: r.newMoveIn,
      과부족: r.shortage,
      임차만기건물수: r.expireBuildings,
      해지건물수: r.terminated,
      추가임차건물수: r.addLease,
    }));
    fileName = "운영시뮬레이션.xlsx";
  } else if (activeTab === "inventory") {
    rows = inventory.map((i) => ({
      관리자명: i.managerName,
      계약일: i.purchaseDate,
      만료일: i.purchaseDate,
      기숙사주소: i.dormAddress,
      비품명: i.itemName,
      수량: i.quantity,
      모델명: i.modelName,
      메이커: i.maker,
      구매액: i.purchaseAmount,
      지급일: i.issuedDate,
      매각일: i.soldDate,
      비고: i.notes,
    }));
    fileName = "비품현황.xlsx";
  } else if (activeTab === "leases") {
    rows = leases.map((l) => ({
      계약일: l.contractDate,
      주소명: l.addressName,
      동: l.dong,
      호수: l.ho,
      평수: l.pyeong,
      계약금액: l.contractAmount,
      계약기간: l.contractPeriod,
      선납계약금: l.prepaymentDeposit,
      부동산명: l.realEstateName,
      잔금일: l.balanceDate,
      참고사항: l.notes,
    }));
    fileName = "신규계약현황.xlsx";
  } else if (activeTab === "dormContracts") {
    rows = visibleDormContracts.map((c) => ({
      지역: c.site,
      도로명주소: c.address,
      건물명: c.buildingName,
      동: c.dong,
      호수: c.roomHo,
      평수: c.pyeong,
      임대인명: c.landlordName,
      임대인연락처: c.landlordPhone,
      부동산명: c.realEstateName,
      부동산연락처: c.realEstatePhone,
      공동현관: c.공동현관,
      세대현관: c.세대현관,
      계약시작일: c.contractStart,
      계약종료일: c.contractEnd,
      계약상태: c.contractStatus,
      계약금액: c.contractAmount,
      선납금: c.prepaymentDeposit,
      보증금: c.deposit,
      "월세/관리비": c.monthlyRentOrMaintenance,
      계약유형: c.contractType,
      성별: c.gender,
      비고: c.notes,
      등록일: formatDateOnly(c.createdAt),
      수정일: formatDateOnly(c.updatedAt),
      등록자: c.registeredBy,
    }));
    fileName = "기숙사계약현황.xlsx";
  } else if (activeTab === "settlementManagement") {
    const validSettlementYear = getValidSettlementYear(settlementYear);
    const validSettlementMonth = getValidSettlementMonth(settlementMonth);
    const settlementYearNum = Number(validSettlementYear);
    const settlementMonthNum = Number(validSettlementMonth);
    const periodStart = validSettlementYear && validSettlementMonth ? new Date(settlementYearNum, settlementMonthNum - 1, 1) : null;
    const periodEnd = validSettlementYear && validSettlementMonth ? getMonthEnd(settlementYearNum, settlementMonthNum) : null;

    rows = operationalDorms
      .filter((dorm) => settlementSiteFilter === "전체" || dorm.site === settlementSiteFilter)
      .filter((dorm) => settlementGenderFilter === "전체" || dorm.gender === settlementGenderFilter)
      .map((dorm) => {
        const currentResidents = occupants.filter((o) => {
          if (o.dormId !== dorm.id || o.isDeleted || o.status === "퇴실") return false;
          if (!periodStart || !periodEnd) return true;
          const moveInDate = parseSafeDate(o.moveInDate);
          if (!moveInDate || moveInDate > periodEnd) return false;
          const actualOutDate = parseSafeDate(o.actualMoveOutDate || "");
          if (actualOutDate && actualOutDate < periodStart) return false;
          const dueOutDate = parseSafeDate(o.moveOutDueDate);
          if (dueOutDate && dueOutDate < periodStart) return false;
          return true;
        }).length;

        const revenue = currentResidents * 2000000;
        const inventoryCost = inventory
          .filter((i) => {
            if (i.dormId !== dorm.id || i.isDeleted) return false;
            if (!periodStart || !periodEnd) return true;
            const purchaseDate = parseSafeDate(i.purchaseDate);
            return purchaseDate ? isSameMonth(purchaseDate, settlementYearNum, settlementMonthNum) : false;
          })
          .reduce((sum, i) => sum + (i.purchaseAmount || 0), 0);

        const defectCost = defects
          .filter((d) => {
            if (d.dormId !== dorm.id || d.isDeleted || d.defectStatus === "완료") return false;
            if (!periodStart || !periodEnd) return true;
            const receiptDate = parseSafeDate(d.receiptDate);
            return receiptDate ? isSameMonth(receiptDate, settlementYearNum, settlementMonthNum) : false;
          })
          .reduce((sum) => sum + 500000, 0);

        const manualCost = settlementRecords.find(
          (r) =>
            r.dormId === dorm.id &&
            r.settlementYear === safeSettlementYear &&
            r.settlementMonth === safeSettlementMonth
        )?.miscCost || 0;

        return {
          지역: dorm.site,
          성별: dorm.gender,
          기숙사명: dorm.buildingName,
          동: dorm.dong,
          호수: dorm.roomHo,
          입주인원: currentResidents,
          수입: revenue,
          비품비: inventoryCost,
          하자비: defectCost,
          기타비용: manualCost,
          정산액: revenue - (inventoryCost + defectCost + manualCost),
        };
      });
    fileName = "정산관리.xlsx";
  } else if (activeTab === "newHires") {
    rows = visibleNewHires.map((h) => {
      const dorm =
        operationalDorms.find((d) => d.id === h.dormId) ||
        dorms.find((d) => d.id === h.dormId);
      return {
        지역: dorm?.site || h.site,
        성별: h.gender,
        이름: h.name,
        연락처: h.phone,
        부서: h.department,
        도로명주소: dorm?.address || h.dormId,
        건물명: h.buildingName,
        동: h.dong,
        호수: h.roomHo,
        예상입실일: h.expectedMoveInDate,
        입실일: h.moveInDate,
        예상퇴실일: h.expectedMoveOutDate,
        퇴실일: h.moveOutDate,
        실제퇴실일: h.actualMoveOutDate,
        천안이동일: h.cheonanMoveDate,
        거주상태: h.residenceStatus,
        입주유형: h.moveInType,
        연장사유: h.extensionReason,
        "특이사항 메모": h.notes,
        등록일: formatDateOnly(h.createdAt),
        수정일: formatDateOnly(h.updatedAt),
      };
    });
    fileName = "신입사원명단.xlsx";
  } else if (activeTab === "personnelManagement") {
    rows = militaryPersonnelSummary.map((p) => ({
      이름: p.name,
      계급: p.rank,
      군별: p.serviceBranch,
      부대: p.unit,
      연락처: p.phone,
      생년월일: p.birthDate,
      전역일: p.dischargeDate,
      계산모드: p.calculationMode || "auto",
      수동현재구분: p.manualCategory || "-",
      수동연차: p.manualYear || "-",
      자동판정현재구분: p.currentCategory,
      훈련연차: p.trainingYear ? String(p.trainingYear) : "-",
      예비군연차: p.reserveAnnualLeave || "-",
      민방위연차: p.civilDefenseAnnualLeave || "-",
      동원여부: p.mobilization ? "동원" : "동원미지정",
      필요훈련: p.requiredTrainingLabel,
      필요시간: p.requiredTrainingHours ? `${p.requiredTrainingHours}시간` : "-",
      이수상태: p.trainingStatus,
      훈련기록수: p.trainingRecordsCount || 0,
      통보서수: p.noticeCount || 0,
      상태: p.status,
      비고: p.notes,
      등록일: formatDateOnly(p.createdAt),
      수정일: formatDateOnly(p.updatedAt),
    }));
    fileName = "예비군_민방위_인원.xlsx";
  } else if (activeTab === "trainingRecords") {
    rows = militaryTrainingRecords.map((r) => ({
      대상자: militaryPersonnel.find((p) => p.id === r.personnelId)?.name || "",
      훈련유형: r.trainingType || r.subject || "",
      차수: r.trainingRound || "",
      훈련명: r.subject || "",
      훈련예정일: r.trainingDate || "",
      이수일: r.completionDate || "",
      이수시간: r.trainingHours || 0,
      위치: r.location || "",
      참석인원: r.attendees || 0,
      훈련상태: r.status || "",
      비고: r.notes || "",
      등록일: formatDateOnly(r.createdAt),
      수정일: formatDateOnly(r.updatedAt),
    }));
    fileName = "예비군_민방위_훈련.xlsx";
  } else if (activeTab === "militaryNotices") {
    rows = militaryNotices.map((n) => ({
      제목: n.title,
      구분: n.category,
      게시일: n.publishedDate,
      만료일: n.expiresDate,
      내용: n.content,
      등록일: formatDateOnly(n.createdAt),
      수정일: formatDateOnly(n.updatedAt),
    }));
    fileName = "예비군_민방위_공지.xlsx";
  } else if (activeTab === "militaryReports") {
    rows = militaryReports.map((r) => ({
      제목: r.title,
      보고일: r.reportDate,
      종류: r.type,
      작성자: r.author,
      상태: r.status,
      비고: r.notes,
      등록일: formatDateOnly(r.createdAt),
      수정일: formatDateOnly(r.updatedAt),
    }));
    fileName = "예비군_민방위_보고서.xlsx";
  } else if (activeTab === "militarySettings") {
    rows = Object.entries(militarySettings).map(([key, value]) => ({
      항목: key,
      값: value,
    }));
    fileName = "예비군_민방위_설정.xlsx";
  } else if (activeTab === "sales") {
    rows = sales.map((s) => ({
      일자: s.saleDate,
      품목: s.itemName,
      단가: s.unitPrice,
      수량: s.quantity,
      합계: s.totalAmount,
      매각업체: s.buyerCompany,
      비고: s.notes,
    }));
    fileName = "비품매각현황.xlsx";
  } else if (activeTab === "defects") {
    rows = visibleDefects.map((d) => ({
      접수일: d.receiptDate,
      접수자: d.reporterName,
      기숙사관리자명: d.dormManagerName,
      건물명: d.buildingName,
      동: d.dong,
      호수: d.ho,
      도로명주소: d.roadAddress,
      공동현관: d["공동현관"],
      세대현관: d["세대현관"],
      상황: d.defectStatus,
      하자신청내용: d.requestText,
      점검자: d.inspectorName,
      완료내용: d.completeText,
      접수사진수: d.requestPhotoDataUrls.length,
      완료사진수: d.completionPhotoDataUrls.length,
    }));
    fileName = "하자접수현황.xlsx";
  } else {
    rows = visibleDorms.map((d) => ({
      지역: d.site,
      성별: d.gender,
      건물명: d.buildingName,
      주소: d.address,
      동: d.dong,
      호수: d.roomHo,
      상태: d.leaseStatus,
    }));
    fileName = "대시보드데이터.xlsx";
  }

  const template = tableType
    ? [...customTemplates]
        .filter((templateItem) => templateItem.tableType === tableType)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : null;

  if (template?.fileData) {
    try {
      const templateWorkbook = XLSX.read(base64ToArrayBuffer(template.fileData), { type: "array", cellStyles: true });
      const sheetName = templateWorkbook.SheetNames[0];
      const worksheet = templateWorkbook.Sheets[sheetName];
      const headers = getWorksheetHeaders(worksheet);
      if (headers.length > 0) {
        clearWorksheetRowsAfterHeader(worksheet, 0);
        const convertedRows = rows.map((row) => mapRowToTemplateHeaders(row, tableType as TableType, headers));
        XLSX.utils.sheet_add_json(worksheet, convertedRows, { skipHeader: true, origin: { r: 1, c: 0 }, header: headers });
        XLSX.writeFile(templateWorkbook, fileName, { bookType: "xlsx", cellStyles: true });
        return;
      }
    } catch (error) {
      console.error(error);
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, fileName);
};

const exportDormSummaryExcel = () => {
  const rows = operationalDorms.map((dorm) => {
    const currentResidents = occupancyCountByDorm.get(dorm.id) || 0;
    const vacancy = Math.max(dorm.capacity - currentResidents, 0);
    const manager = users.find((u) => u.id === dorm.managerUserId);
    const incompleteDefectCount = defects.filter((defect) => {
      const defectDorm = findOperationalDormForDefect(defect);
      return defectDorm?.id === dorm.id && defect.defectStatus !== "완료";
    }).length;
    const latestCleaning = cleaningReports
      .filter((report) =>
        report.dormId === dorm.id ||
        matchDormKey(report.site, report.buildingName, report.dong, report.roomHo) ===
          matchDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo)
      )
      .sort((a, b) => new Date(b.reportDate).valueOf() - new Date(a.reportDate).valueOf())[0];
    const cleaningStatus = latestCleaning?.cleanStatus || "미확인";
    const equipmentCount = inventory.filter((item) => item.dormId === dorm.id).length;

    return {
      지역: dorm.site,
      성별: dorm.gender,
      기숙사명: dorm.buildingName,
      주소: dorm.address,
      동: formatDong(dorm.dong),
      호수: formatRoomHo(dorm.roomHo),
      정원: dorm.capacity,
      현재인원: currentResidents,
      공실: vacancy,
      계약상태: dorm.leaseStatus,
      계약시작일: dorm.contractStart,
      계약종료일: dorm.contractEnd,
      담당자: manager?.displayName || manager?.username || "",
      "하자 미완료 건수": incompleteDefectCount,
      청소상태: cleaningStatus,
      "비품 수량": equipmentCount,
      비고: dorm.notes || "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "기숙사별 현황 요약");
  const fileName = `기숙사별_현황_요약_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

const exportDormSettlementExcel = (dorm: OperationalDorm) => {
  const validSettlementYear = getValidSettlementYear(settlementYear);
  const validSettlementMonth = getValidSettlementMonth(settlementMonth);
  const settlementYearNum = Number(validSettlementYear);
  const settlementMonthNum = Number(validSettlementMonth);
  const periodStart = validSettlementYear && validSettlementMonth ? new Date(settlementYearNum, settlementMonthNum - 1, 1) : null;
  const periodEnd = validSettlementYear && validSettlementMonth ? getMonthEnd(settlementYearNum, settlementMonthNum) : null;

  const dormOccupants = occupants.filter((o) => {
    if (o.dormId !== dorm.id || o.isDeleted) return false;
    if (!periodStart || !periodEnd) return true;
    const moveInDate = parseSafeDate(o.moveInDate);
    if (!moveInDate || moveInDate > periodEnd) return false;
    const actualOutDate = parseSafeDate(o.actualMoveOutDate || "");
    if (actualOutDate && actualOutDate < periodStart) return false;
    const dueOutDate = parseSafeDate(o.moveOutDueDate);
    if (dueOutDate && dueOutDate < periodStart) return false;
    return true;
  });

  const dormKey = getDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo);
  const contract = dormContracts.find((c) => getDormKey(c.site, c.buildingName, c.dong, c.roomHo) === dormKey);
  const monthlyRentOrMaintenance = contract?.monthlyRentOrMaintenance || "";
  const prepaymentDeposit = Number(contract?.prepaymentDeposit || 0);
  const companyPayment = 0;
  const companyRefund = 0;
  const defectCost = defects
    .filter((d) => {
      if (d.isDeleted || d.defectStatus === "완료") return false;
      const defectDorm = findOperationalDormForDefect(d);
      if (defectDorm?.id !== dorm.id) return false;
      const receiptDate = parseSafeDate(d.receiptDate);
      return receiptDate ? isSameMonth(receiptDate, settlementYearNum, settlementMonthNum) : false;
    })
    .reduce((sum) => sum + 500000, 0);
  const cleaningCost = cleaningReports
    .filter((r) => {
      if (r.isDeleted) return false;
      const reportDorm = findOperationalDormForCleaningReport(r);
      if (reportDorm?.id !== dorm.id) return false;
      const reportDate = parseSafeDate(r.reportDate);
      return reportDate ? isSameMonth(reportDate, settlementYearNum, settlementMonthNum) : false;
    })
    .length * 100000;
  const inventoryPurchaseCost = inventory
    .filter((i) => {
      if (i.dormId !== dorm.id || i.isDeleted) return false;
      const purchaseDate = parseSafeDate(i.purchaseDate);
      return purchaseDate ? isSameMonth(purchaseDate, settlementYearNum, settlementMonthNum) : false;
    })
    .reduce((sum, i) => sum + (i.purchaseAmount || 0), 0);
  const inventorySaleCost = inventory
    .filter((i) => {
      if (i.dormId !== dorm.id || i.isDeleted) return false;
      const soldDate = parseSafeDate(i.soldDate || "");
      return soldDate ? isSameMonth(soldDate, settlementYearNum, settlementMonthNum) : false;
    })
    .reduce((sum, i) => sum + (i.soldAmount || 0), 0);
  const inventoryDisposalCost = 0;
  const itemDetails = settlementItems.filter(
    (item) =>
      item.dormId === dorm.id &&
      item.settlementYear === safeSettlementYear &&
      item.settlementMonth === safeSettlementMonth
  );
  const itemCost = itemDetails.reduce((sum, item) => sum + item.amount, 0);
  const manualCost =
    (settlementRecords.find(
      (r) =>
        r.dormId === dorm.id &&
        r.settlementYear === safeSettlementYear &&
        r.settlementMonth === safeSettlementMonth
    )?.miscCost || 0) + itemCost;

  const rows = dormOccupants.map((o) => {
    const moveInDate = parseSafeDate(o.moveInDate);
    const moveOutDate = parseSafeDate(o.actualMoveOutDate || o.moveOutDueDate || "");
    const stayMonths = getStayMonths(moveInDate, moveOutDate || periodEnd);

    return {
      주소: dorm.address,
      건물명: dorm.buildingName,
      동: dorm.dong,
      호수: dorm.roomHo,
      거주자명: o.employeeName,
      입실일: o.moveInDate,
      퇴실일: o.actualMoveOutDate || o.moveOutDueDate || "",
      거주기간_개월수: stayMonths,
      "월세/관리비": monthlyRentOrMaintenance,
      장충금: prepaymentDeposit,
      회사_지급금: companyPayment,
      회사_환급금: companyRefund,
      하자_비용: defectCost,
      청소_비용: cleaningCost,
      "비품_구매_매각_폐기": `구매:${inventoryPurchaseCost} / 매각:${inventorySaleCost} / 폐기:${inventoryDisposalCost}`,
      비고: manualCost ? `기타 비용 ${manualCost}원` : "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [
    {
      주소: dorm.address,
      건물명: dorm.buildingName,
      동: dorm.dong,
      호수: dorm.roomHo,
      거주자명: "-",
      입실일: "-",
      퇴실일: "-",
      거주기간_개월수: 0,
      "월세/관리비": monthlyRentOrMaintenance,
      장충금: prepaymentDeposit,
      회사_지급금: companyPayment,
      회사_환급금: companyRefund,
      하자_비용: defectCost,
      청소_비용: cleaningCost,
      "비품_구매_매각_폐기": `구매:${inventoryPurchaseCost} / 매각:${inventorySaleCost} / 폐기:${inventoryDisposalCost}`,
      비고: manualCost ? `기타 비용 ${manualCost}원` : "",
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "정산내역");

  if (itemDetails.length > 0) {
    const itemSheetRows = itemDetails.map((item) => {
      const dormName = `${dorm.buildingName} ${formatDong(dorm.dong)} ${formatRoomHo(dorm.roomHo)}`;
      return {
        기숙사: dormName,
        항목구분: item.category,
        상세내용: item.details,
        금액: item.amount,
        부담구분: item.burdenType,
        대상자명: item.targetName,
        비고: item.memo,
      };
    });
    const itemWorksheet = XLSX.utils.json_to_sheet(itemSheetRows);
    XLSX.utils.book_append_sheet(workbook, itemWorksheet, "정산 항목");
  }

  const fileName = `정산_${dorm.site}_${dorm.buildingName}_${formatDong(dorm.dong)}-${formatRoomHo(dorm.roomHo)}_${safeSettlementYear}${safeSettlementMonth}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

// ============================================
// 보고서 엑셀 다운로드 함수들
// ============================================
const downloadOperationalReport = () => {
  const today = new Date().toISOString().slice(0, 10);
  const filtered = operationalDorms.filter((d) => {
    if (reportSiteFilter !== "전체" && d.site !== reportSiteFilter) return false;
    if (reportGenderFilter !== "전체" && d.gender !== reportGenderFilter) return false;
    return true;
  });
  const rows = filtered.map((dorm) => {
    const residents = occupancyCountByDorm.get(dorm.id) || 0;
    const vacancy = Math.max(dorm.capacity - residents, 0);
    const incompleteDefects = defects.filter(d => !d.isDeleted && d.defectStatus !== "완료").length;
    const unreportedCleaning = cleaningReports.filter(r => r.dormId === dorm.id).length;
    return {
      지역: dorm.site,
      기숙사: dorm.buildingName,
      정원: dorm.capacity,
      거주: residents,
      공실: vacancy,
      "미완료 하자": incompleteDefects,
      "청소 보고": unreportedCleaning,
      "계약만료": dorm.contractEnd,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "월간운영");
  const fileName = `월간운영보고서_${reportYear}${reportMonth}_${reportSiteFilter}_${reportGenderFilter}_${today}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

const downloadUnassignedReport = () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = newHires.filter(h => !h.dormId).map((h) => ({
    지역: h.site,
    이름: h.name,
    부서: h.department,
    성별: h.gender,
    연락처: h.phone || "",
    "예상입실": h.expectedMoveInDate,
    비고: h.notes,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "미배정");
  XLSX.writeFile(wb, `미배정자보고서_${today}.xlsx`);
};

const downloadDefectReport = () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = defects.filter(d => !d.isDeleted).map((d) => ({
    기숙사: d.buildingName,
    위치: `${formatDong(d.dong)}-${formatRoomHo(d.ho)}`,
    상태: d.defectStatus,
    "접수일": d.receiptDate,
    내용: d.requestText || d.completeText || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "하자처리");
  XLSX.writeFile(wb, `하자처리보고서_${today}.xlsx`);
};

const downloadCleaningReport = () => {
  const today = new Date().toISOString().slice(0, 10);
  const unreported = occupants.filter(o =>
    !o.isDeleted && o.status === "퇴실" && o.actualMoveOutDate &&
    !cleaningReports.find(r => r.dormId === o.dormId && r.reportDate >= (o.actualMoveOutDate || ""))
  );
  const rows = unreported.map((o) => {
    const dorm = operationalDorms.find(d => d.id === o.dormId) || dorms.find(d => d.id === o.dormId);
    return {
      기숙사: dorm?.buildingName || "",
      위치: `${formatDong(dorm?.dong || "")}-${formatRoomHo(dorm?.roomHo || "")}`,
      이름: o.employeeName,
      "퇴실일": o.actualMoveOutDate,
      "현황": "미보고",
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "청소미보고");
  XLSX.writeFile(wb, `청소미보고보고서_${today}.xlsx`);
};

const downloadInventoryReport = () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = inventory.filter(i => !i.isDeleted).map((i) => {
    const dorm = operationalDorms.find(d => d.id === i.dormId) || dorms.find(d => d.id === i.dormId);
    return {
      기숙사: dorm?.buildingName || "",
      품목: i.itemName,
      상태: i.status,
      수량: i.quantity,
      "구매금액": i.purchaseAmount,
      "구매일": i.purchaseDate,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "비품");
  XLSX.writeFile(wb, `비품현황보고서_${today}.xlsx`);
};

const handleDefectRequestPhotos = async (files: FileList | null) => {
    if (!files) return;

    const convert = Array.from(files).map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        })
    );

    const results = await Promise.all(convert);

    setDefectForm((prev) => ({
      ...prev,
      requestPhotoDataUrls: [...prev.requestPhotoDataUrls, ...results].slice(0, 10),
    }));
  };

  const handleDefectCompletionPhotos = async (files: FileList | null) => {
    if (!files) return;

    const convert = Array.from(files).map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        })
    );

    const results = await Promise.all(convert);

    setDefectForm((prev) => ({
      ...prev,
      completionPhotoDataUrls: [...prev.completionPhotoDataUrls, ...results].slice(0, 10),
    }));
  };

  const openCleaningReportEdit = (report: CleaningReport) => {
    if (!canEditCleaningReport(currentUser, report)) return;
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = report;
    setCleaningReportForm(rest);
    setEditingCleaningReportId(report.id);
    setShowCleaningReportForm(true);
  };

  const openDormContractEdit = (c: DormContract) => {
    const { id: _id, ...rest } = c;
    setDormContractForm({
      ...rest,
      contractStatus: "자동선택",
      contractType: "자동선택",
    });
    setEditingDormContractId(c.id);
    setShowDormContractForm(true);
  };

  const openNewHireEdit = (h: NewHireEmployee) => {
    const { id: _id, ...rest } = h;
    setNewHireForm({
      ...rest,
      residenceStatus: "자동선택",
      moveInType: "자동선택",
    });
    setEditingNewHireId(h.id);
    setShowNewHireForm(true);
  };

  const buildNewHireFormFromOccupant = (occupant: Occupant): NewHireFormState => {
    const dorm = operationalDorms.find((d) => d.id === occupant.dormId) || dorms.find((d) => d.id === occupant.dormId);
    const occupancyStatus = ["거주중", "만료예정", "신규입주"].includes(occupant.status)
      ? (occupant.status as NewHireResidenceStatus)
      : "자동선택";

    return {
      ...newHireTemplate(),
      name: occupant.employeeName,
      phone: occupant.phone,
      department: occupant.department,
      site: occupant.site,
      gender: occupant.gender,
      dormId: occupant.dormId || "",
      address: dorm?.address || "",
      buildingName: dorm?.buildingName || "",
      dong: dorm?.dong || "",
      roomHo: dorm?.roomHo || "",
      공동현관: dorm?.공동현관 || "",
      세대현관: dorm?.세대현관 || "",
      moveInDate: occupant.moveInDate,
      moveOutDate: occupant.moveOutDueDate,
      expectedMoveInDate: occupant.expectedMoveInDate || "",
      expectedMoveOutDate: occupant.expectedMoveOutDate || "",
      actualMoveOutDate: occupant.actualMoveOutDate || "",
      residenceStatus: occupancyStatus,
      moveInType: "자동선택",
      notes: occupant.notes || "",
      createdAt: occupant.createdAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
  };

  const handleOccupantRowDoubleClick = (occupant: Occupant) => {
    if (currentUser?.role === "maintenance_reporter" && occupant.dormId !== currentUser.dormId) {
      alert("본인 기숙사 관련 내용만 조회 가능합니다.");
      return;
    }

    if (occupant.id.startsWith("newhire-")) {
      const targetHire = newHires.find((h) => h.id === occupant.sourceNewHireId);
      if (currentUser?.role === "admin" && targetHire) {
        openNewHireEdit(targetHire);
        return;
      }
      setActiveTab("newHires");
      return;
    }

    const targetHire =
      newHires.find((h) => h.id === occupant.sourceNewHireId) ||
      newHires.find((h) => h.name === occupant.employeeName && h.dormId === occupant.dormId);

    if (currentUser?.role === "admin" && targetHire) {
      openNewHireEdit(targetHire);
      return;
    }

    if (currentUser?.role === "admin") {
      setNewHireForm(buildNewHireFormFromOccupant(occupant));
      setEditingNewHireId(null);
      setShowNewHireForm(true);
      return;
    }

    setActiveTab("newHires");
  };

  const canAccessOperationalDorm = (dorm?: OperationalDorm) => {
    if (!currentUser || !dorm) return false;
    if (currentUser.role === "maintenance_reporter") return dorm.id === currentUser.dormId;
    return true;
  };

  const handleDashboardContractDoubleClick = (dorm: OperationalDorm) => {
    if (!canAccessOperationalDorm(dorm)) {
      alert("본인 기숙사 관련 내용만 조회 가능합니다.");
      return;
    }
    const contract = dormContracts.find((c) =>
      matchDormKey(c.site, c.buildingName, c.dong, c.roomHo) ===
      matchDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo)
    );
    if (currentUser?.role === "admin" && contract) {
      openDormContractEdit(contract);
      return;
    }
    setActiveTab("dormContracts");
  };

  const handleNewHireDoubleClick = (occupant: Occupant) => {
    if (currentUser?.role === "maintenance_reporter" && occupant.dormId !== currentUser.dormId) {
      alert("본인 기숙사 관련 내용만 조회 가능합니다.");
      return;
    }
    const targetHire = newHires.find((h) => h.name === occupant.employeeName && h.dormId === occupant.dormId);
    if (currentUser?.role === "admin" && targetHire) {
      openNewHireEdit(targetHire);
      return;
    }
    setActiveTab("newHires");
  };

  const handleAlertDoubleClick = (alertItem: { id: string; title: string; detail: string; when: string; type: string }) => {
    if (alertItem.type === "contract" && (currentUser?.role === "maintenance_reporter" || currentUser?.role === "dorm_manager")) {
      const contractId = alertItem.id.replace(/^contract-status?-/, "");
      const contract = dormContracts.find((c) => c.id === contractId);
      const contractDorm = contract
        ? dorms.find((d) =>
            matchDormKey(d.site, d.buildingName, d.dong, d.roomHo) ===
            matchDormKey(contract.site, contract.buildingName, contract.dong, contract.roomHo)
          )
        : undefined;
      if (!contractDorm || contractDorm.id !== currentUser.dormId) {
        window.alert("본인 기숙사 관련 내용만 조회 가능합니다.");
        return;
      }
    }

    // 알림 타입에 따라 해당 메뉴로 이동 및 상세보기
    if (alertItem.type === "contract") {
      setActiveTab("dormContracts");
      // 계약 ID에서 실제 계약 찾기
      const contractId = alertItem.id.replace(/^contract-status?-/, "");
      const contract = dormContracts.find((c) => c.id === contractId);
      if (contract && currentUser?.role === "admin") {
        openDormContractEdit(contract);
      }
    } else if (alertItem.type === "defect") {
      setActiveTab("defects");
      // 하자 ID에서 실제 하자 찾기
      const defectId = alertItem.id.replace("defect-", "");
      const defect = defects.find(d => d.id === defectId);
      if (defect) {
        setDefectForm(defect);
        setEditingDefectId(defect.id);
        setShowDefectForm(true);
      }
    } else if (alertItem.type === "cleaning") {
      setActiveTab("cleaningReports");
    } else if (alertItem.type === "moveOut" || alertItem.type === "occupant") {
      setActiveTab("occupants");
      // 입주자 ID에서 실제 입주자 찾기
      const occupantId = alertItem.id.replace("moveout-", "").replace("occupant-status-", "");
      const occupant = occupants.find(o => o.id === occupantId);
      if (occupant) {
        setOccupantForm(occupant);
        setEditingOccupantId(occupant.id);
        setShowOccupantForm(true);
      }
    } else if (alertItem.type === "training") {
      setActiveTab("trainingRecords");
    } else if (alertItem.type === "militaryNotice") {
      setActiveTab("militaryNotices");
    } else {
      setActiveTab("notificationManagement");
    }
  };

  const handleDormSummaryDoubleClick = (row: { id: string }) => {
    const dorm = operationalDorms.find((d) => d.id === row.id);
    if (!canAccessOperationalDorm(dorm)) {
      alert("본인 기숙사 관련 내용만 조회 가능합니다.");
      return;
    }
    if (currentUser?.role === "admin" && dorm) {
      setEditingDormId(dorm.id);
      setShowDormForm(true);
      return;
    }
    setActiveTab("dorms");
  };

  const openInventoryEdit = (i: InventoryItem) => {
    const { id: _id, createdAt: _c, ...rest } = i;
    setInventoryForm(rest);
    setEditingInventoryId(i.id);
    setShowInventoryForm(true);
  };

  const openLeaseEdit = (l: LeaseContract) => {
    const { id: _id, ...rest } = l;
    setLeaseForm(rest);
    setEditingLeaseId(l.id);
    setShowLeaseForm(true);
  };

  const openSaleEdit = (s: SaleRecord) => {
    const { id: _id, ...rest } = s;
    setSaleForm(rest);
    setEditingSaleId(s.id);
    setShowSaleForm(true);
  };

  const openDefectEdit = (d: DefectRequest) => {
    if (!canEditDefect(currentUser, d)) return;
    const { id: _id, createdAt: _c, ...rest } = d;
    setDefectForm(rest);
    setEditingDefectId(d.id);
    setShowDefectForm(true);
  };

  const openUserEdit = (u: LoginUser) => {
    const { id: _id, createdAt: _c, password: _p, ...rest } = u;
    setUserForm({ ...rest, password: "" });
    setEditingUserId(u.id);
    setShowUserForm(true);
  };

  const handleRowClick = (e: React.MouseEvent<HTMLElement>, callback: () => void) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("a") || target.closest("label")) return;
    callback();
  };

  const createAuditLog = (params: Omit<AuditLog, "id" | "changedAt">) => {
    const entry = createAuditLogEntry(params);
    setAuditLogs((prev) => [entry, ...prev]);
  };

  // ============================================
  // 5. AuditLog 실제 연결
  // ============================================
  const addAuditLog = (log: Omit<AuditLog, "id" | "changedAt">) => {
    createAuditLog(log);
  };

  // occupants 상태 자동 동기화 (계약상태 기반)
  useEffect(() => {
    if (dormContracts.length === 0 || occupants.length === 0) return;
    let hasChanges = false;

    const updatedOccupants = occupants.map((occupant) => {
      const contract = dormContracts.find((c) => c.id === occupant.dormId);
      if (!contract) return occupant;

      // 계약 상태가 종료/해지면 occupants도 퇴실 처리
      if (["종료", "해지"].includes(contract.contractStatus) && occupant.status !== "퇴실") {
        hasChanges = true;
        createAuditLog({
          targetType: "occupant",
          targetId: occupant.id,
          actionType: "statusChange",
          changedBy: currentUser?.displayName || "시스템",
          beforeValue: occupant.status,
          afterValue: "퇴실",
          memo: `계약 ${contract.contractStatus} 자동 반영`,
        });
        return { ...occupant, status: "퇴실" as const };
      }
      return occupant;
    });

    if (hasChanges) {
      setOccupants(updatedOccupants);
      saveJson(OCCUPANTS_KEY, updatedOccupants, tenantId);
    }
  }, [dormContracts, occupants, currentUser?.displayName, tenantId]);

  // 변경이력 복구 함수
  const restoreFromAuditLog = (auditLogId: string) => {
    if (!canEditData(currentUser)) {
      alert("복구는 관리자만 실행할 수 있습니다.");
      return;
    }

    const log = auditLogs.find((l) => l.id === auditLogId);
    if (!log) return;

    const confirmed = window.confirm(
      `정말 이전값으로 복구하시겠습니까?\n\n대상: ${log.targetType}\n시간: ${new Date(log.changedAt).toLocaleString("ko-KR")}\n변경자: ${log.changedBy}`
    );
    if (!confirmed) return;

    try {
      const beforeData = JSON.parse(log.beforeValue);

      if (log.targetType === "dormContract") {
        const updated = dormContracts.map((c) => (c.id === log.targetId ? beforeData : c));
        setDormContracts(updated);
        saveJson(DORM_CONTRACTS_KEY, updated, tenantId);
      } else if (log.targetType === "occupant") {
        const updated = occupants.map((o) => (o.id === log.targetId ? beforeData : o));
        setOccupants(updated);
        saveJson(OCCUPANTS_KEY, updated, tenantId);
      }

      createAuditLog({
        targetType: log.targetType,
        targetId: log.targetId,
        actionType: "restore",
        changedBy: currentUser?.displayName || "시스템",
        beforeValue: log.afterValue,
        afterValue: log.beforeValue,
        memo: `변경이력 복구 (원본 시간: ${log.changedAt})`,
      });

      setShowAuditLogModal(false);
      setSelectedAuditLogId(null);
    } catch (e) {
      console.error("변경이력 복구 실패:", e);
    }
  };

  const softDeleteItems = <T extends { id: string; isDeleted?: boolean; deletedAt?: string; deletedBy?: string; updatedAt?: string }>(
    items: T[],
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    ids: string[],
    targetType: AuditLog["targetType"]
  ) => {
    if (ids.length === 0) return false;
    if (!confirm("삭제할까요?")) return false;
    const now = new Date().toISOString();
    const deletedBy = currentUser?.displayName || currentUser?.username || currentUser?.id || "";
    const beforeMap = new Map(items.filter((entry) => ids.includes(entry.id)).map((entry) => [entry.id, entry]));

    setter((prev) =>
      prev.map((entry) =>
        ids.includes(entry.id)
          ? {
              ...entry,
              isDeleted: true,
              deletedAt: now,
              deletedBy,
              updatedAt: now,
            }
          : entry
      )
    );

    ids.forEach((id) => {
      const beforeItem = beforeMap.get(id);
      if (!beforeItem) return;
      const afterItem = {
        ...beforeItem,
        isDeleted: true,
        deletedAt: now,
        deletedBy,
        updatedAt: now,
      };
      createAuditLog({
        targetType,
        targetId: id,
        actionType: "delete",
        changedBy: deletedBy,
        beforeValue: JSON.stringify(beforeItem),
        afterValue: JSON.stringify(afterItem),
      });
    });
    return true;
  };

  const softDeleteItem = <T extends { id: string; isDeleted?: boolean; deletedAt?: string; deletedBy?: string; updatedAt?: string }>(
    items: T[],
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    id: string,
    targetType: AuditLog["targetType"]
  ) => {
    softDeleteItems(items, setter, [id], targetType);
  };

  const deleteById = <T extends { id: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    id: string
  ) => {
    if (!confirm("삭제할까요?")) return;
    setter((prev) => prev.filter((item) => item.id !== id));
  };

  const restoreItem = <T extends { id: string; isDeleted?: boolean; deletedAt?: string | undefined; deletedBy?: string | undefined; updatedAt?: string }>(
    items: T[],
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    id: string,
    targetType: AuditLog["targetType"]
  ) => {
    const existing = items.find((entry) => entry.id === id);
    if (!existing || !existing.isDeleted) return;
    const restored = {
      ...existing,
      isDeleted: false,
      deletedAt: undefined,
      deletedBy: undefined,
      updatedAt: new Date().toISOString(),
    };
    setter((prev) => prev.map((entry) => (entry.id === id ? restored : entry)));
    createAuditLog({
      targetType,
      targetId: id,
      actionType: "restore",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: JSON.stringify(existing),
      afterValue: JSON.stringify(restored),
    });
  };

  const permanentlyDeleteItem = <T extends { id: string }>(
    items: T[],
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    id: string,
    targetType: AuditLog["targetType"]
  ) => {
    const existing = items.find((entry) => entry.id === id);
    if (!existing) return;
    if (!confirm("영구 삭제할까요?")) return;
    setter((prev) => prev.filter((entry) => entry.id !== id));
    createAuditLog({
      targetType,
      targetId: id,
      actionType: "delete",
      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
      beforeValue: JSON.stringify(existing),
      afterValue: "",
      memo: "permanently deleted",
    });
  };

  const selectDormForContext = (dormId: string) => {
    setSelectedDormId(dormId);
    setActiveTab("occupants");
  };

  const fallbackMenuGroupForTab: Record<TabKey, string> = {
    dashboard: "dashboard",
    dorms: "dormManagement",
    occupants: "occupantManagement",
    simulation: "simulation",
    inventory: "inventory",
    leases: "leaseManagement",
    sales: "salesManagement",
    dormContracts: "dormManagement",
    newHires: "occupantManagement",
    settlementManagement: "settlementManagement",
    notificationManagement: "notificationManagement",
    documentManagement: "documentManagement",
    reportManagement: "reportManagement",
    cleaningReports: "reportManagement",
    defects: "defects",
    users: "users",
    settings: "settings",
    recycleBin: "recycleBin",
    militaryDashboard: "militaryModule",
    personnelManagement: "militaryModule",
    trainingRecords: "militaryModule",
    militaryNotices: "militaryModule",
    militaryReports: "militaryModule",
    militarySettings: "militaryModule",
    testChecklist: "settings",
  };

  const menuGroupForTab = useMemo<Record<TabKey, string>>(() => {
    const mapping = { ...fallbackMenuGroupForTab };
    systemSettings.menus.forEach((menu) => {
      mapping[menu.tabKey] = menu.groupName;
    });
    return mapping;
  }, [systemSettings.menus]);

  const visibleMenuGroups = useMemo(
    () => {
      const groups: Record<string, { groupKey: string; label: string; order: number; children: Array<{ tab: TabKey; label: string; order: number }> }> = {};
      const currentRole = currentUser?.role || "viewer";
      systemSettings.menus
        .filter((menu) => {
          if (!menu.isVisible || !menu.requiredRoles.includes(currentRole)) return false;
          if (currentUser?.role === "maintenance_reporter") {
            return menu.tabKey === "cleaningReports" || menu.tabKey === "defects";
          }
          return true;
        })
        .sort((a, b) => a.order - b.order)
        .forEach((menu) => {
          const existing = groups[menu.groupName] || {
            groupKey: menu.groupName,
            label: menu.groupName,
            order: menu.order,
            children: [],
          };
          existing.children.push({ tab: menu.tabKey, label: menu.menuName, order: menu.order });
          existing.order = Math.min(existing.order, menu.order);
          groups[menu.groupName] = existing;
        });

      return Object.values(groups)
        .map((group) => ({
          ...group,
          children: group.children.sort((a, b) => a.order - b.order),
        }))
        .sort((a, b) => a.order - b.order);
    },
    [systemSettings.menus, currentUser]
  );

  const filteredMenuGroups = useMemo(() => {
    const query = menuSearchKeyword.trim().toLowerCase();
    if (!query) return visibleMenuGroups;

    return visibleMenuGroups
      .map((group) => {
        const groupMatches = group.label.toLowerCase().includes(query);
        const children = group.children.filter((child) => child.label.toLowerCase().includes(query));
        if (groupMatches && children.length === 0) return group;
        if (children.length > 0) return { ...group, children };
        return null;
      })
      .filter((group): group is NonNullable<typeof group> => Boolean(group));
  }, [visibleMenuGroups, menuSearchKeyword]);

  const currentMenuGroup = menuGroupForTab[activeTab];
  const isViewer = currentUser?.role === "viewer";
  const isMaintenanceReporterWithDorm = currentUser?.role === "maintenance_reporter" && !!currentUser.dormId;

  useEffect(() => {
    if (currentUser?.role === "maintenance_reporter" && activeTab !== "cleaningReports" && activeTab !== "defects") {
      setActiveTab("defects");
    }
  }, [currentUser, activeTab]);

  const isGroupOpen = (group: string) => group === currentMenuGroup || group === expandedMenu || group === hoveredMenu;
  const isMenuActive = (group: string) => group === currentMenuGroup;

  const filteredCodeValues = useMemo(
    () => systemSettings.codeValues.filter((code) => !codeTypeFilter || code.codeType === codeTypeFilter),
    [systemSettings.codeValues, codeTypeFilter]
  );

  const menuItems = filteredMenuGroups.map((group) => ({
    groupKey: group.groupKey,
    label: group.label,
    icon: group.groupKey === "dashboard" ? Home : group.groupKey === "users" ? UserCog : group.groupKey === "settings" ? UserCog : group.groupKey === "defects" ? Wrench : group.groupKey === "inventory" ? Package : group.groupKey === "자산관리" ? Package : group.groupKey === "운영관리" ? Wrench : group.groupKey === "leaseManagement" ? ClipboardList : group.groupKey === "salesManagement" ? ClipboardList : group.groupKey === "simulation" ? ClipboardList : group.groupKey === "reportManagement" ? FileSpreadsheet : group.groupKey === "notificationManagement" ? Bell : group.groupKey === "documentManagement" ? Camera : group.groupKey === "militaryModule" ? ShieldCheck : Building2,
    children: group.children,
  }));

  const inventoryAlerts = useMemo(() => {
    const lowStock = inventory.filter((item) => item.quantity <= 2 && !item.soldDate && !item.disposalDate).length;
    const expiringSoon = inventory.filter((item) => ["고장", "노후"].includes(item.status)).length;
    return { lowStock, expiringSoon };
  }, [inventory]);

  const inventoryByDorm = useMemo(() => {
    const groups: Record<string, { dormName: string; itemCount: number; totalAmount: number; currentItems: number }> = {};
    operationalDorms.forEach((dorm) => {
      const dormItems = inventory.filter((item) => item.dormId === dorm.id && !item.soldDate && !item.disposalDate && !["매각", "폐기"].includes(item.status));
      groups[dorm.id] = {
        dormName: `${dorm.site} ${dorm.buildingName} ${dorm.dong}-${dorm.roomHo}`,
        itemCount: inventory.filter((item) => item.dormId === dorm.id).length,
        totalAmount: inventory.filter((item) => item.dormId === dorm.id).reduce((sum, item) => sum + item.purchaseAmount, 0),
        currentItems: dormItems.length,
      };
    });
    return groups;
  }, [inventory, operationalDorms]);

  const uniqueActiveDormContracts = useMemo(() => {
    const uniqueMap = new Map<string, DormContract>();
    dormContracts
      .filter((contract) => !contract.isDeleted && !["종료", "해지"].includes(contract.contractStatus))
      .forEach((contract) => {
        const key = getUniqueDormKey(contract.site, contract.buildingName, contract.dong, contract.roomHo);
        const existing = uniqueMap.get(key);
        if (
          !existing ||
          (contract.updatedAt && existing.updatedAt && new Date(contract.updatedAt) > new Date(existing.updatedAt))
        ) {
          uniqueMap.set(key, contract);
        }
      });
    return Array.from(uniqueMap.values());
  }, [dormContracts]);

  // 지역별/성별별 통계 계산
  const siteGenderStats = useMemo(() => {
    const combinations = [
      { site: "평택" as Site, gender: "남" as "남" | "여" },
      { site: "평택" as Site, gender: "여" as "남" | "여" },
      { site: "천안" as Site, gender: "남" as "남" | "여" },
      { site: "천안" as Site, gender: "여" as "남" | "여" },
    ];

    const activeStatus = ["거주중", "신규입주", "만료예정"] as Occupant["status"][];

    return combinations.map(({ site, gender }) => {
      const regionDorms = uniqueActiveDormContracts.filter((d) => d.site === site && d.gender === gender);
      const operationalRegionDorms = operationalDorms.filter((d) => d.site === site && d.gender === gender);
      const dormCount = regionDorms.length;
      const operationalDormCount = operationalRegionDorms.length;
      const totalCapacity = operationalRegionDorms.reduce((sum, d) => sum + (d.capacity || 0), 0);
      const relevantOccupants = occupants.filter((o) => {
        if (o.isDeleted || !activeStatus.includes(o.status)) return false;
        const dorm = operationalDorms.find((d) => d.id === o.dormId) || dorms.find((d) => d.id === o.dormId);
        return dorm?.site === site && dorm?.gender === gender;
      });
      const currentResidents = relevantOccupants.length;
      const vacancy = Math.max(totalCapacity - currentResidents, 0);
      const occupancyRate = totalCapacity > 0 ? Math.round((currentResidents / totalCapacity) * 100) : 0;
      const expiringCount = operationalRegionDorms.filter((d) => d.leaseStatus === "만료예정").length;
      const unprocessedDefects = defects.filter(
        (d) => !d.isDeleted && d.defectStatus !== "완료" && operationalRegionDorms.some((room) => room.id === d.dormId)
      ).length;
      const unsubmittedCleaning = cleaningReports.filter(
        (r) => !r.isDeleted && r.cleanStatus === "미제출" && operationalRegionDorms.some((room) => room.id === r.dormId)
      ).length;

      return {
        site,
        gender,
        dormCount,
        operationalDormCount,
        totalCapacity,
        currentResidents,
        vacancy,
        occupancyRate,
        expiringCount,
        unprocessedDefects,
        unsubmittedCleaning,
      };
    });
  }, [dorms, operationalDorms, occupants, defects, cleaningReports]);

  const dashboardStat = {
    dormCount: uniqueActiveDormContracts.length,
    currentResidents: occupants.filter((o) => !o.isDeleted && ["거주중", "신규입주", "만료예정"].includes(o.status)).length,
    totalVacancy: dormSummary.reduce((sum, item) => sum + item.vacancy, 0),
    openDefects: defects.filter((d) => !d.isDeleted && d.defectStatus !== "완료").length,
    inventoryCount: inventory.filter((i) => !i.isDeleted).length,
  };

  const settlementManagementStats = useMemo(() => {
    const periodYear = safeSettlementYear;
    const periodMonth = safeSettlementMonth;
    const settlementYearNum = Number(periodYear);
    const settlementMonthNum = Number(periodMonth);
    const periodStart = new Date(settlementYearNum, settlementMonthNum - 1, 1);
    const periodEnd = getMonthEnd(settlementYearNum, settlementMonthNum);

    const filteredDorms = operationalDorms
      .filter((dorm) => {
        const siteMatch = settlementSiteFilter === "전체" || dorm.site === settlementSiteFilter;
        const genderMatch = settlementGenderFilter === "전체" || dorm.gender === settlementGenderFilter;
        const searchMatch = !settlementSearch || `${dorm.buildingName} ${dorm.dong} ${dorm.roomHo}`.toLowerCase().includes(settlementSearch.toLowerCase());
        return siteMatch && genderMatch && searchMatch;
      })
      .map((dorm) => {
        const dormOccupants = occupants.filter((o) => {
          if (o.dormId !== dorm.id || o.isDeleted) return false;
          if (!periodStart || !periodEnd) return true;
          const moveInDate = parseSafeDate(o.moveInDate);
          if (!moveInDate || moveInDate > periodEnd) return false;
          const actualOutDate = parseSafeDate(o.actualMoveOutDate || "");
          if (actualOutDate && actualOutDate < periodStart) return false;
          const dueOutDate = parseSafeDate(o.moveOutDueDate);
          if (dueOutDate && dueOutDate < periodStart) return false;
          return true;
        });

        const revenue = dormOccupants.length * 2000000;
        const inventoryCost = inventory
          .filter((i) => {
            if (i.dormId !== dorm.id || i.isDeleted) return false;
            if (!periodStart || !periodEnd) return true;
            const purchaseDate = parseSafeDate(i.purchaseDate);
            return purchaseDate ? isSameMonth(purchaseDate, settlementYearNum, settlementMonthNum) : false;
          })
          .reduce((sum, i) => sum + (i.purchaseAmount || 0), 0);
        const defectCost = defects
          .filter((d) => {
            if (d.dormId !== dorm.id || d.isDeleted || d.defectStatus === "완료") return false;
            if (!periodStart || !periodEnd) return true;
            const receiptDate = parseSafeDate(d.receiptDate);
            return receiptDate ? isSameMonth(receiptDate, settlementYearNum, settlementMonthNum) : false;
          })
          .reduce((sum) => sum + 500000, 0);
        const itemCost = settlementItems
          .filter((item) =>
            item.dormId === dorm.id &&
            item.settlementYear === safeSettlementYear &&
            item.settlementMonth === safeSettlementMonth
          )
          .reduce((sum, item) => sum + item.amount, 0);
        const manualCost =
          (settlementRecords.find(
            (r) =>
              r.dormId === dorm.id &&
              r.settlementYear === safeSettlementYear &&
              r.settlementMonth === safeSettlementMonth
          )?.miscCost || 0) + itemCost;
        const totalCost = inventoryCost + defectCost + manualCost;
        const settlementAmount = revenue - totalCost;

        return {
          dorm,
          dormOccupants,
          revenue,
          inventoryCost,
          defectCost,
          manualCost,
          totalCost,
          settlementAmount,
        };
      })
      .filter((row) => !settlementShowUnpaid || row.settlementAmount < 0);

    const filteredSettlementItems = settlementItems.filter(
      (item) =>
        item.settlementYear === safeSettlementYear &&
        item.settlementMonth === safeSettlementMonth
    );

    return { filteredDorms, filteredSettlementItems };
  }, [operationalDorms, settlementSiteFilter, settlementGenderFilter, settlementSearch, settlementShowUnpaid, settlementYear, settlementMonth, occupants, inventory, defects, settlementRecords, settlementItems]);

  React.useEffect(() => {
    if (activeTab !== "dashboard") {
      setStatsSectionExpanded(false);
    }
  }, [activeTab]);

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${theme.darkMode ? "bg-slate-950 text-slate-300" : "bg-slate-50 text-slate-700"}`}>
        <div className={`rounded-2xl border ${theme.darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"} p-8 shadow-lg`}>
          <div className="text-2xl font-semibold">데이터 로딩 중...</div>
          <div className="mt-2 text-sm text-slate-500">SaaS 준비 구조로 저장소와 테넌트 데이터를 초기화하고 있습니다.</div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className={`min-h-screen ${theme.darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-100 text-slate-900"} p-6 flex items-center justify-center`}>
        <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
          <div className="mb-6 text-center">
            <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
              <Building2 className={`h-7 w-7 ${theme.darkMode ? "text-slate-300" : "text-slate-700"}`} />
            </div>
            <h1 className="text-2xl font-bold">기숙사 운영관리 로그인</h1>
            <p className="mt-2 text-sm text-slate-500">관리자, 조회전용, 기숙사관리자, 하자접수 전용 계정 지원</p>
          </div>
          <div className="space-y-4">
            <Input label="아이디" value={loginForm.username} onChange={(v) => setLoginForm((f) => ({ ...f, username: v }))} />
            <Input label="비밀번호" type="password" value={loginForm.password} onChange={(v) => setLoginForm((f) => ({ ...f, password: v }))} />
            {loginError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{loginError}</div>}
            <button onClick={login} className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-800">로그인</button>
          </div>
          <div className={`mt-5 rounded-2xl ${theme.darkMode ? "bg-slate-900 text-slate-400" : "bg-slate-50 text-slate-600"} p-4 text-sm`}>
            <div className={`font-semibold ${theme.darkMode ? "text-slate-200" : "text-slate-800"}`}>기본 계정</div>
            <div className="mt-2">총관리자: admin / admin1234</div>
            <div>조회전용: viewer / viewer1234</div>
            <div>하자접수: defect1 / defect1234</div>
          </div>
        </div>
      </div>
    );
  }

    return (
      <div className={`min-h-screen ${theme.darkMode ? "dark-mode bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"}`}>
        {operationalSyncError && (
          <div className={`fixed inset-x-0 top-0 z-50 border-b px-4 py-3 text-sm font-medium ${theme.darkMode ? "border-rose-700 bg-rose-900 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
            Supabase operational sync failed: {operationalSyncError}
          </div>
        )}
        <aside className={`hidden xl:block fixed left-0 top-0 z-20 h-full w-72 border-r p-6 pt-8 shadow-sm ${theme.darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
          <div className="mb-8">
            <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-3xl ${theme.darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
              <Building2 className={`h-7 w-7 ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`} />
            </div>
            <p className={`text-xs font-semibold uppercase tracking-[0.25em] ${theme.darkMode ? "text-slate-400" : "text-slate-400"}`}>기숙사 ERP CRM</p>
            <h2 className={`mt-3 text-xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>운영관리 대시보드</h2>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">메뉴 검색</div>
              <input
                type="text"
                value={menuSearchKeyword}
                onChange={(e) => setMenuSearchKeyword(e.target.value)}
                placeholder="검색..."
                className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`}
              />
            </div>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              {filteredMenuGroups.length === 0 ? (
                <div className={`rounded-2xl border p-4 text-sm ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>검색 결과가 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {menuItems.map((item) => {
                  const open = isGroupOpen(item.groupKey);
                  const mainActive = isMenuActive(item.groupKey);
                  const hasChildren = item.children && item.children.length > 0;
                  return (
                    <div
                      key={item.groupKey}
                      className={`rounded-3xl border p-2 ${theme.darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}
                      onMouseEnter={() => setHoveredMenu(item.groupKey)}
                      onMouseLeave={() => setHoveredMenu(null)}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (hasChildren) {
                            setExpandedMenu(item.groupKey);
                            const currentTab = item.children.find((child) => child.tab === activeTab);
                            if (!currentTab && item.children[0]) setActiveTab(item.children[0].tab);
                          }
                          setMenuSearchKeyword("");
                        }}
                        className={`w-full justify-start inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${mainActive || open ? "bg-slate-900 text-white" : theme.darkMode ? "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </button>
                      {hasChildren && open && (
                        <div className="mt-2 space-y-2 pl-4">
                          {item.children.map((child) => (
                            <button
                              key={child.tab}
                              type="button"
                              onClick={() => {
                                setActiveTab(child.tab);
                                setExpandedMenu(item.groupKey);
                                setMenuSearchKeyword("");
                              }}
                              className={`w-full justify-start inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm ${activeTab === child.tab ? "bg-slate-900 text-white" : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                            >
                              <span className="h-3 w-3 rounded-full bg-slate-300" />
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          </div>
          <div className={`mt-10 rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            <div className={`font-semibold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>현재 사용자</div>
            <div className={`mt-2 ${theme.darkMode ? "text-slate-200" : "text-slate-700"}`}>{currentUser.displayName}</div>
            <div className={`${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>{getRoleLabel(currentUser.role)}</div>
          </div>
        </aside>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 flex xl:hidden">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <div className={`relative z-50 h-full w-80 overflow-y-auto border-r ${theme.darkMode ? "border-slate-800 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className={`text-lg font-semibold ${theme.darkMode ? "text-slate-100" : ""}`}>메뉴</div>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className={`rounded-2xl border px-3 py-2 text-sm ${theme.darkMode ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"}`}>
                  닫기
                </button>
              </div>
              <div className="p-5">
                <div className="mb-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">메뉴 검색</div>
                  <input
                    type="text"
                    value={menuSearchKeyword}
                    onChange={(e) => setMenuSearchKeyword(e.target.value)}
                    placeholder="검색..."
                    className={`w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`}
                  />
                </div>
                {filteredMenuGroups.length === 0 ? (
                  <div className={`rounded-2xl border p-4 text-sm ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>검색 결과가 없습니다.</div>
                ) : (
                  menuItems.map((item) => (
                  <div key={item.groupKey} className={`mb-4 rounded-3xl border p-3 ${theme.darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-white"}`}>
                    <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </div>
                    <div className="space-y-2">
                      {item.children.map((child) => (
                        <button
                          key={child.tab}
                          type="button"
                          onClick={() => {
                            setActiveTab(child.tab);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${activeTab === child.tab ? "bg-slate-900 text-white" : theme.darkMode ? "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))) }
              </div>
            </div>
          </div>
        )}
        <div className="mx-auto max-w-[1800px] pl-0 xl:pl-[280px] p-4 md:p-6 lg:p-8">
          <header className={`mb-6 rounded-3xl ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"} p-5 shadow-sm ring-1`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500"><Building2 className="h-4 w-4" /> 기숙사 운영 통합 시스템</div>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">운영관리 대시보드 v4</h1>
                <p className="mt-1 text-sm text-slate-500">기숙사, 입주배정, 비품, 계약, 매각, 하자접수, 운영시뮬레이션까지 한 번에</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} xl:hidden`}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  title="알림 보기"
                  onClick={() => setActiveTab("notificationManagement")}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  <Bell className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  title="문서/메시지 보기"
                  onClick={() => setActiveTab("documentManagement")}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  <MessageSquare className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  title="도움말/설정 보기"
                  onClick={() => setActiveTab("settings")}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  <HelpCircle className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme((prev) => ({ ...prev, darkMode: !prev.darkMode }))}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  <Moon className="h-5 w-5" />
                </button>
                <button type="button" onClick={logout} className={`inline-flex h-12 items-center gap-2 rounded-2xl border ${theme.darkMode ? "border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"} px-4 text-sm font-semibold`}>
                  <LogOut className="h-4 w-4" /> 로그아웃
                </button>
              </div>
            </div>
            <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadExcel(file); e.currentTarget.value = ""; }} />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                <div className="text-sm font-medium text-slate-500">기숙사 수(현재 사용중인 기숙사 수)</div>
                <div className="mt-3 text-3xl font-bold">{dashboardStat.dormCount}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                <div className="text-sm font-medium text-slate-500">현 거주자</div>
                <div className="mt-3 text-3xl font-bold">{dashboardStat.currentResidents}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                <div className="text-sm font-medium text-slate-500">남은공실</div>
                <div className="mt-3 text-3xl font-bold">{dashboardStat.totalVacancy}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                <div className="text-sm font-medium text-slate-500">하자 미완료</div>
                <div className="mt-3 text-3xl font-bold">{dashboardStat.openDefects}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                <div className="text-sm font-medium text-slate-500">비품 품목</div>
                <div className="mt-3 text-3xl font-bold">{dashboardStat.inventoryCount}</div>
              </div>
            </div>
          </header>

          <section className={`mb-6 rounded-3xl ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"} p-5 shadow-sm ring-1`}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">지역별 상세 통계</h2>
                <p className="text-sm text-slate-500">평택과 천안의 전체 통계를 한 번에 보고, 필요할 때 접어서 화면을 정리할 수 있습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setStatsSectionExpanded((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700" : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
              >
                <span>{statsSectionExpanded ? "접기" : "펼치기"}</span>
                <ChevronRight className={`h-4 w-4 transition-transform ${statsSectionExpanded ? "rotate-90" : ""}`} />
              </button>
            </div>

            {statsSectionExpanded ? (
              <div className="grid gap-4 md:grid-cols-2">
                {siteGenderStats.map((stat) => (
                  <div key={`${stat.site}-${stat.gender}`} className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <div className={`text-sm font-semibold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.site}({stat.gender})</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>기숙사 {stat.dormCount}개</div>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-100" : "bg-slate-100 text-slate-600"}`}>통계</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>총 기숙사 수</div>
                        <div className={`mt-2 text-2xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.dormCount}</div>
                      </div>
                      <div className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>운영중 기숙사 수</div>
                        <div className={`mt-2 text-2xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.operationalDormCount}</div>
                      </div>
                      <div className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>입주자 수</div>
                        <div className={`mt-2 text-2xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.currentResidents}</div>
                      </div>
                      <div className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>공실</div>
                        <div className={`mt-2 text-2xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.vacancy}</div>
                      </div>
                      <div className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>입주율</div>
                        <div className={`mt-2 text-2xl font-bold ${theme.darkMode ? "text-slate-100" : "text-slate-900"}`}>{stat.occupancyRate}%</div>
                      </div>
                      <div className="rounded-2xl border p-3 shadow-sm bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-800/50">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-800 dark:text-rose-200">계약 만료 예정</div>
                        <div className="mt-2 text-2xl font-bold text-rose-900 dark:text-rose-200">{stat.expiringCount}</div>
                      </div>
                      <div className="rounded-2xl bg-yellow-50 p-3 shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">미처리 하자</div>
                        <div className="mt-2 text-2xl font-bold text-amber-700">{stat.unprocessedDefects}</div>
                      </div>
                      <div className="rounded-2xl bg-emerald-50 p-3 shadow-sm">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">청소 미제출</div>
                        <div className="mt-2 text-2xl font-bold text-emerald-700">{stat.unsubmittedCleaning}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`rounded-3xl border p-4 text-sm ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>지역별 상세 통계가 접혀 있습니다. 펼치기 버튼을 클릭하면 전체 통계를 확인할 수 있습니다.</div>
            )}
          </section>

          <section className={`mb-6 rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mt-4 flex flex-wrap gap-2">
              {canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => {
                    setDormContractForm(dormContractTemplate());
                    setEditingDormContractId(null);
                    setShowDormContractForm(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  <Plus className="h-4 w-4" /> 기숙사 추가
                </button>
              )}
              {canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => {
                    setNewHireForm(newHireTemplate());
                    setEditingNewHireId(null);
                    setShowNewHireForm(true);
                  }}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  <Plus className="h-4 w-4" /> 입주자 추가
                </button>
              )}
              {canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => {
                    setInventoryForm(inventoryTemplate());
                    setEditingInventoryId(null);
                    setShowInventoryForm(true);
                  }}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  비품 등록
                </button>
              )}
              {canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => {
                    setDefectForm(defectTemplate());
                    setEditingDefectId(null);
                    setShowDefectForm(true);
                  }}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  유지보수 등록
                </button>
              )}
              <button
                type="button"
                onClick={exportExcel}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold border ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                <Download className="h-4 w-4" /> Excel 내보내기
              </button>
              {currentUser.role !== "maintenance_reporter" && canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold border ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  <Upload className="h-4 w-4" /> Excel 등록
                </button>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                <FileSpreadsheet className="h-4 w-4" /> 보고서 생성
              </button>
            </div>
          </section>



        {showExcelTemplate && currentUser?.role === "admin" && (
          <section className={`mb-6 rounded-3xl ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"} p-5 shadow-sm ring-1`}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">엑셀 양식 설정</h2>
              <p className="text-sm text-slate-500">각 항목별 엑셀 등록/내보내기 양식을 다운로드하고 맞춤 양식을 추가할 수 있습니다.</p>
            </div>
            
            <div className={`${theme.darkMode ? "mb-6 rounded-2xl bg-slate-950 p-4" : "mb-6 rounded-2xl bg-slate-50 p-4"}`}>
              <h3 className="mb-4 font-semibold">기본 양식 다운로드</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["지역", "도로명주소", "건물명", "동", "호수", "평수", "임대인명", "임대인연락처", "부동산명", "부동산연락처", "계약시작일", "계약종료일", "계약상태", "계약금액", "공동현관", "세대현관", "선납금", "보증금", "월세/관리비", "계약유형", "성별", "비고", "등록일", "수정일", "등록자"],
                      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "기숙사계약현황");
                    XLSX.writeFile(wb, "기숙사계약현황_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 기숙사 계약현황
                </button>
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["지역", "성별", "이름", "연락처", "부서", "도로명주소", "건물명", "동", "호수", "예상입실일", "입실일", "예상퇴실일", "퇴실일", "실제퇴실일", "천안이동일", "거주상태", "입주유형", "연장사유", "특이사항 메모", "등록일", "수정일"],
                      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "신입사원명단");
                    XLSX.writeFile(wb, "신입사원명단_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 신입사원명단
                </button>
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["지역", "성별", "건물명", "주소", "동", "호수", "평수", "계약시작", "계약종료", "계약금액", "상태", "공동현관", "세대현관", "선납계약금", "부동산명", "잔금일", "비고"],
                      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "기숙사");
                    XLSX.writeFile(wb, "기숙사_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 기숙사
                </button>
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["지역", "기숙사", "이름", "성별", "부서", "연락처", "입실일", "잔여일", "예상입실일", "예상퇴실일", "실제퇴실일", "상태", "비고"],
                      ["", "", "", "", "", "", "", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "입주자");
                    XLSX.writeFile(wb, "입주자_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 입주자
                </button>
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["관리자명", "계약일", "만료일", "기숙사주소", "비품명", "수량", "모델명", "메이커", "구매액", "지급일", "매각일", "비고"],
                      ["", "", "", "", "", "", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "비품현황");
                    XLSX.writeFile(wb, "비품현황_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 비품현황
                </button>
                <button
                  onClick={() => {
                    const ws = XLSX.utils.aoa_to_sheet([
                      ["일자", "품목", "단가", "수량", "합계", "매각업체", "비고"],
                      ["", "", "", "", "", "", ""],
                    ]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "비품매각");
                    XLSX.writeFile(wb, "비품매각_양식.xlsx");
                  }}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  📋 비품매각
                </button>
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl bg-slate-950 p-4" : "rounded-2xl bg-slate-50 p-4"}`}>
              <h3 className="mb-4 font-semibold">맞춤 양식 업로드</h3>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <input
                  type="text"
                  placeholder="양식명 (생략 시 파일명 사용)"
                  value={templateUploadName}
                  onChange={(e) => setTemplateUploadName(e.target.value)}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"}`}
                />
                <select
                  value={templateUploadType}
                  onChange={(e) => setTemplateUploadType(e.target.value as "dormContract" | "newHire" | "dorm" | "occupant" | "inventory" | "sale")}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"}`}
                >
                  <option value="dormContract">기숙사 계약현황</option>
                  <option value="newHire">신입사원명단</option>
                  <option value="dorm">기숙사</option>
                  <option value="occupant">입주자</option>
                  <option value="inventory">비품현황</option>
                  <option value="sale">비품매각</option>
                </select>
                <button
                  onClick={() => templateInputRef.current?.click()}
                  className="rounded-2xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                >
                  템플릿 엑셀 업로드
                </button>
              </div>
              <input
                ref={templateInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadTemplateExcel(file);
                  if (e.currentTarget) e.currentTarget.value = "";
                }}
              />
              <p className="mb-4 text-sm text-slate-500">업로드된 템플릿은 선택한 항목에 맞추어 등록/내보내기 시 헤더를 기준으로 매핑됩니다.</p>
              {customTemplates.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">저장된 맞춤 양식</h4>
                  {customTemplates.map((template) => (
                    <div key={template.id} className={`${theme.darkMode ? "grid gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 md:grid-cols-[1fr_auto_auto]" : "grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_auto_auto]"}`}>
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-xs text-slate-500">{template.tableType}</p>
                        <p className="text-xs text-slate-400">{template.fileName}</p>
                      </div>
                      <button
                        onClick={() => {
                          const workbook = XLSX.read(base64ToArrayBuffer(template.fileData), { type: "array", cellStyles: true });
                          XLSX.writeFile(workbook, template.fileName);
                        }}
                        className={`${theme.darkMode ? "rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-200" : "rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"}`}
                      >
                        다운로드
                      </button>
                      <button
                        onClick={() => setCustomTemplates((prev) => prev.filter((t) => t.id !== template.id))}
                        className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-200"
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* 운영 요약 카드 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <button type="button" onClick={() => setActiveTab("newHires")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">미배정 신입</div>
                <div className="mt-3 text-3xl font-bold text-blue-700">{dashboardSummaryStats.unassignedCount}</div>
                <div className="mt-2 text-xs text-blue-600">명 등록 대기</div>
              </button>
              <button type="button" onClick={() => setActiveTab("dormContracts")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-amber-50 to-amber-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-amber-50 to-amber-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">계약 만료</div>
                <div className="mt-3 text-3xl font-bold text-amber-700">{dashboardSummaryStats.expiringCount}</div>
                <div className="mt-2 text-xs text-amber-600">건 예정 (30일)</div>
              </button>
              <button type="button" onClick={() => setActiveTab("occupants")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-purple-50 to-purple-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-purple-600">공실률</div>
                <div className="mt-3 text-3xl font-bold text-purple-700">{dashboardSummaryStats.vacancyRate}%</div>
                <div className="mt-2 text-xs text-purple-600">입주 가능</div>
              </button>
              <button type="button" onClick={() => setActiveTab("defects")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-red-50 to-red-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-red-50 to-red-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-red-600">미처리 하자</div>
                <div className="mt-3 text-3xl font-bold text-red-700">{dashboardSummaryStats.unprocessedDefects}</div>
                <div className="mt-2 text-xs text-red-600">건 처리중</div>
              </button>
              <button type="button" onClick={() => setActiveTab("cleaningReports")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-green-50 to-green-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-green-50 to-green-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-green-600">청소 미보고</div>
                <div className="mt-3 text-3xl font-bold text-green-700">{dashboardSummaryStats.unreportedCleaning}</div>
                <div className="mt-2 text-xs text-green-600">건 대기중</div>
              </button>
              <button type="button" onClick={() => setActiveTab("inventory")} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-cyan-50 to-cyan-100 p-4 hover:shadow-lg transition-shadow" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-cyan-50 to-cyan-100 p-4 hover:shadow-lg transition-shadow"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-600">비품 노후</div>
                <div className="mt-3 text-3xl font-bold text-cyan-700">{dashboardSummaryStats.outdatedInventory}</div>
                <div className="mt-2 text-xs text-cyan-600">개 교체필요</div>
              </button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.4fr_0.95fr]">
              <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">최근 계약 만료 예정 TOP 10</h2>
                    <p className="text-sm text-slate-500">계약 만료가 가까운 기숙사를 빠르게 확인하세요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExpiringDormsModal(true)}
                    className={`${theme.darkMode ? "text-sm font-semibold text-slate-500 hover:text-slate-100" : "text-sm font-semibold text-slate-500 hover:text-slate-900"}`}
                  >
                    더보기
                  </button>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm text-left">
                    <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                      <tr>
                        <th className="px-3 py-3">순번</th>
                        <th className="px-3 py-3">지역</th>
                        <th className="px-3 py-3">기숙사명</th>
                        <th className="px-3 py-3">주소</th>
                        <th className="px-3 py-3">만료일</th>
                        <th className="px-3 py-3">D-Day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDashboard.map((d, index) => (
                        <tr
                          key={d.id}
                          className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                          onDoubleClick={() => handleDashboardContractDoubleClick(d)}
                          title="계약 상세보기/수정"
                        >
                          <td className="px-3 py-4 font-semibold">{index + 1}</td>
                          <td className="px-3 py-4">{d.site}</td>
                          <td className="px-3 py-4">{d.buildingName}</td>
                          <td className="px-3 py-4">{`${d.address} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`}</td>
                          <td className="px-3 py-4">{d.contractEnd || "-"}</td>
                          <td className="px-3 py-4 text-blue-600 font-semibold">{daysDiff(d.contractEnd)}</td>
                        </tr>
                      ))}
                      {visibleDashboard.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-12 text-center text-slate-400">검색 조건에 맞는 기숙사가 없습니다.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="space-y-6">
                <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">신입사원 입주배정</h2>
                      <p className="text-sm text-slate-500">신규 입주자의 배정 현황을 확인하세요.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUnassignedNewHiresModal(true)}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                    >
                      더보기
                    </button>
                  </div>
                  <div className="space-y-3">
                    {occupants.filter((o) => o.isNewHireAssignment).map((o) => {
                      const dorm =
                        operationalDorms.find((d) => d.id === o.dormId) ||
                        dorms.find((d) => d.id === o.dormId);
                      return (
                        <div
                          key={o.id}
                          className={`${theme.darkMode ? "cursor-pointer rounded-2xl border border-slate-700 p-4" : "cursor-pointer rounded-2xl border border-slate-200 p-4"}`}
                          onDoubleClick={() => handleNewHireDoubleClick(o)}
                          title="신입사원 상세보기/수정"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-semibold">{o.employeeName}</div>
                              <div translate="no" className="text-sm text-slate-500 notranslate">{o.department}</div>
                              <div className="text-sm text-slate-500">{dorm ? `${dorm.buildingName} ${dorm.dong} ${dorm.roomHo}` : "미배정"}</div>
                            </div>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{o.status}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!occupants.some((o) => o.isNewHireAssignment) && (
                      <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 p-8 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400"}`}>현재 신입사원 배정 데이터가 없습니다.</div>
                    )}
                  </div>
                </section>

                <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">오늘의 일정 및 알림</h2>
                      <p className="text-sm text-slate-500">계약 만료, 하자, 출입 일정 등을 한 곳에서 확인합니다.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("notificationManagement")}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                    >
                      모두 보기
                    </button>
                  </div>
                  <div className="space-y-3">
                    {dashboardAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`${theme.darkMode ? "cursor-pointer rounded-2xl border border-slate-700 bg-slate-950 p-4" : "cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}
                        onDoubleClick={() => handleAlertDoubleClick(alert)}
                        title="알림 상세보기"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">{alert.title}</p>
                            <p className="text-sm text-slate-500">{alert.detail}</p>
                          </div>
                          <span className="text-sm font-semibold text-blue-700">{alert.when}</span>
                        </div>
                      </div>
                    ))}
                    {dashboardAlerts.length === 0 && (
                      <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 p-8 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400"}`}>현재 알림이 없습니다.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">기숙사별 현황 요약</h2>
                  <p className="text-sm text-slate-500">기숙사별 입주 현황과 공실을 확인하세요.</p>
                </div>
                <button
                  type="button"
                  onClick={exportDormSummaryExcel}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  엑셀다운
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[1100px] text-sm text-left">
                  <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                    <tr>
                      <th className="px-3 py-3">기숙사</th>
                      <th className="px-3 py-3">지역</th>
                      <th className="px-3 py-3">성별</th>
                      <th className="px-3 py-3">동</th>
                      <th className="px-3 py-3">호수</th>
                      <th className="px-3 py-3">관리자</th>
                      <th className="px-3 py-3">상태</th>
                      <th className="px-3 py-3">만료일</th>
                      <th className="px-3 py-3">D-Day</th>
                      <th className="px-3 py-3">현재 거주자</th>
                      <th className="px-3 py-3">정원</th>
                      <th className="px-3 py-3">공실</th>
                      <th className="px-3 py-3">입주율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dormSummary.map((row) => (
                      <tr
                        key={row.id}
                        className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                        onDoubleClick={() => handleDormSummaryDoubleClick(row)}
                        title="기숙사 상세보기/수정"
                      >
                        <td className="px-3 py-3 font-semibold">{row.buildingName}</td>
                        <td className="px-3 py-3">{row.site}</td>
                        <td className="px-3 py-3">{row.gender}</td>
                        <td className="px-3 py-3">{row.dong}</td>
                        <td className="px-3 py-3">{row.roomHo}</td>
                        <td className="px-3 py-3">{row.managerName}</td>
                        <td className="px-3 py-3">{row.leaseStatus}</td>
                        <td className="px-3 py-3">{row.contractEnd || "-"}</td>
                        <td className="px-3 py-3">{row.dDay}</td>
                        <td className="px-3 py-3">{row.currentResidents}</td>
                        <td className="px-3 py-3">{row.capacity}</td>
                        <td className="px-3 py-3">{row.vacancy}</td>
                        <td className="px-3 py-3">{row.usageRate}%</td>
                      </tr>
                    ))}
                    {dormSummary.length === 0 && (
                      <tr>
                        <td colSpan={13} className="px-3 py-12 text-center text-slate-400">표시할 기숙사 데이터가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === "militaryDashboard" && (
          <section className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-5">
              {[
                { title: "전체 인원", value: militaryPersonnel.length },
                { title: "예비군", value: militaryCategoryCounts.reserve },
                { title: "민방위", value: militaryCategoryCounts.civilDefense },
                { title: "대상아님", value: militaryCategoryCounts.none },
                { title: "전역 예정(30일)", value: militaryUpcomingDischargeCount },
                { title: "보고서", value: militaryReports.length },
              ].map((item) => (
                <div key={item.title} className={`${theme.darkMode ? "rounded-3xl border p-5 shadow-sm ring-1 ring-slate-200 bg-slate-950" : "rounded-3xl border p-5 shadow-sm ring-1 ring-slate-200 bg-white"}`}>
                  <div className="text-sm font-medium text-slate-500">{item.title}</div>
                  <div className={`${theme.darkMode ? "mt-3 text-3xl font-bold text-slate-100" : "mt-3 text-3xl font-bold text-slate-900"}`}>{item.value}</div>
                </div>
              ))}
            </div>
            <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
              <h2 className="text-lg font-semibold">예비군/민방위 현황</h2>
              <p className="mt-2 text-sm text-slate-500">전역 예정, 미발송 통보서, 미이수 교육 항목을 자동 집계합니다.</p>
              <p className="mt-2 text-xs text-slate-400">집계 기준: 미이수/예정자는 자동연차 대상 상태(예: 재직)이며 필요훈련시간&gt;0인 인원 중 훈련상태가 '미이수' 또는 '예정'으로 분류됩니다.</p>
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-sm font-semibold text-slate-400">전역 예정 인원</div>
                  {militaryPersonnel.filter((person) => typeof person.dischargeDate === "string" && person.dischargeDate).length === 0 ? (
                    <div className="mt-3 text-sm text-slate-400">예정 인원이 없습니다.</div>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {militaryPersonnelSummary
                        .filter((person) => typeof person.dischargeDue === "number" && person.dischargeDue >= 0 && person.dischargeDue <= 30)
                        .slice(0, 5)
                        .map((person) => (
                          <li key={person.id}>{person.name} · D-{person.dischargeDue}</li>
                        ))}
                    </ul>
                  )}
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-sm font-semibold text-slate-400">미이수 교육</div>
                  {militaryTrainingNotCompletedCount === 0 ? (
                    <div className="mt-3 text-sm text-slate-400">모든 훈련이 완료되었습니다.</div>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {militaryPersonnelSummary
                        .filter((person) => militaryTrainingAutoConfig.targetStatuses?.includes(person.status) && person.requiredTrainingHours > 0 && person.trainingStatus === "미이수")
                        .slice(0, 5)
                        .map((person) => (
                          <li key={person.id}>{person.name} · {person.requiredTrainingLabel}</li>
                        ))}
                    </ul>
                  )}
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-sm font-semibold text-slate-400">미발송 통보서</div>
                  {militaryPendingNoticeCount === 0 ? (
                    <div className="mt-3 text-sm text-slate-400">모든 통보서가 발송되었습니다.</div>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {(() => {
                        const targetPersonnelIds = militaryPersonnel.filter((p) => militaryTrainingAutoConfig.targetStatuses?.includes(p.status)).map((p) => p.id);
                        return militaryNotices.filter((n) => !n.publishedDate && n.personnelIds?.some((pid) => targetPersonnelIds.includes(pid))).slice(0, 5).map((notice) => (
                          <li key={notice.id}>{notice.title || "제목 없음"}</li>
                        ));
                      })()}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          </section>
        )}

        {activeTab === "personnelManagement" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">예비군/민방위 인원 관리</h2>
                  <p className="text-sm text-slate-500">인원 정보를 확인하고 엑셀로 내보낼 수 있습니다.</p>
                  <p className="text-xs text-slate-400 mt-1">기준연도: {effectiveMilitaryReferenceYear ? `${effectiveMilitaryReferenceYear}년` : "자동"} · 자동연차/필요훈련은 이 기준연도를 기준으로 계산됩니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={militaryPersonnelSearch}
                  onChange={(e) => setMilitaryPersonnelSearch(e.target.value)}
                  placeholder="이름, 계급, 부대 검색"
                  className="rounded-2xl border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={militaryPersonnelStatusFilter}
                  onChange={(e) => setMilitaryPersonnelStatusFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 상태</option>
                  <option value="복무중">복무중</option>
                  <option value="전역">전역</option>
                  <option value="휴직">휴직</option>
                </select>
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMilitaryPersonnelForm({
                        id: "",
                        name: "",
                        rank: "",
                        serviceBranch: "",
                        unit: "",
                        phone: "",
                        birthDate: "",
                        enlistmentDate: "",
                        dischargeDate: "",
                        mobilization: false,
                        status: "",
                        notes: "",
                        createdAt: "",
                        updatedAt: "",
                      });
                      setEditingMilitaryPersonnelId(null);
                      setShowMilitaryPersonnelForm(true);
                    }}
                    className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    인원 등록
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] table-auto text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3 whitespace-nowrap">이름</th>
                    <th className="px-3 py-3 whitespace-nowrap">연락처</th>
                    <th className="px-3 py-3 whitespace-nowrap">생년월일</th>
                    <th className="px-3 py-3 whitespace-nowrap">현재구분</th>
                    <th className="px-3 py-3 whitespace-nowrap">병역구분</th>
                    <th className="px-3 py-3 whitespace-nowrap">동원여부</th>
                    <th className="px-3 py-3 whitespace-nowrap">예비군연차</th>
                    <th className="px-3 py-3 whitespace-nowrap">민방위연차</th>
                    <th className="px-3 py-3 whitespace-nowrap">필요훈련</th>
                    <th className="px-3 py-3 whitespace-nowrap">필요시간</th>
                    <th className="px-3 py-3 whitespace-nowrap">이수상태</th>
                    <th className="px-3 py-3 whitespace-nowrap">훈련기록</th>
                    <th className="px-3 py-3 whitespace-nowrap">통보서</th>
                    <th className="px-3 py-3 whitespace-nowrap">상태</th>
                    {canEditData(currentUser) && <th className="px-3 py-3 whitespace-nowrap">작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredMilitaryPersonnel.map((person) => {
                    const isExpanded = expandedMilitaryPersonnelIds.includes(person.id);
                    return (
                      <>
                        <tr key={person.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                          <td className="max-w-[150px] truncate px-3 py-3 whitespace-nowrap" title={person.name}>{person.name}</td>
                          <td className="max-w-[140px] truncate px-3 py-3 whitespace-nowrap" title={person.phone}>{person.phone}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.birthDate || "-"}</td>
                          <td className="max-w-[120px] truncate px-3 py-3 whitespace-nowrap" title={person.currentCategory}>{person.currentCategory}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.currentCategory}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.mobilization ? "동원" : "동원미지정"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.reserveAnnualLeave || "-"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.civilDefenseAnnualLeave || "-"}</td>
                          <td className="max-w-[170px] truncate px-3 py-3 whitespace-nowrap" title={person.requiredTrainingLabel}>{person.requiredTrainingLabel || "-"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.requiredTrainingHours ? `${person.requiredTrainingHours}시간` : "-"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.trainingStatus || "-"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.trainingRecordsCount ?? 0}건</td>
                          <td className="px-3 py-3 whitespace-nowrap">{person.noticeCount ?? 0}건</td>
                          <td className="max-w-[120px] truncate px-3 py-3 whitespace-nowrap" title={person.status}>{person.status}</td>
                          {canEditData(currentUser) && (
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => setExpandedMilitaryPersonnelIds((prev) =>
                                    prev.includes(person.id) ? prev.filter((id) => id !== person.id) : [...prev, person.id]
                                  )}
                                  className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                                >
                                  {isExpanded ? "숨기기" : "상세"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openMilitaryPersonnelEdit(person)}
                                  className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!confirm("해당 인원을 삭제하시겠습니까?")) return;
                                    const existing = militaryPersonnel.find((item) => item.id === person.id);
                                    if (!existing) return;
                                    setMilitaryPersonnel((prev) => prev.filter((item) => item.id !== person.id));
                                    createAuditLog({
                                      targetType: "militaryPersonnel",
                                      targetId: person.id,
                                      actionType: "delete",
                                      changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
                                      beforeValue: JSON.stringify(existing),
                                      afterValue: "",
                                    });
                                  }}
                                  className="rounded-2xl border border-rose-300 px-3 py-1 text-rose-600 hover:bg-rose-50"
                                >
                                  삭제
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr key={`${person.id}-detail`} className={theme.darkMode ? "bg-slate-950" : "bg-slate-50"}>
                            <td colSpan={canEditData(currentUser) ? 13 : 12} className="px-3 py-3">
                              <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-3">
                                <div><span className="font-medium text-slate-700">계급:</span> {person.rank || "-"}</div>
                                <div><span className="font-medium text-slate-700">군별:</span> {person.serviceBranch || "-"}</div>
                                <div><span className="font-medium text-slate-700">부대:</span> {person.unit || "-"}</div>
                                <div><span className="font-medium text-slate-700">입대일:</span> {person.enlistmentDate || "-"}</div>
                                <div><span className="font-medium text-slate-700">전역일:</span> {person.dischargeDate || "-"}</div>
                                <div><span className="font-medium text-slate-700">근속:</span> {person.serviceDuration || "-"}</div>
                                <div><span className="font-medium text-slate-700">연차:</span> {person.accruedAnnualLeave ? `${person.accruedAnnualLeave}일` : "-"}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {filteredMilitaryPersonnel.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 13 : 12} className="px-3 py-12 text-center text-slate-400">예비군/민방위 인원 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "trainingRecords" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">훈련/교육 기록</h2>
                <p className="text-sm text-slate-500">훈련 현황을 확인하고 관리하세요.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={militaryTrainingSearch}
                  onChange={(e) => setMilitaryTrainingSearch(e.target.value)}
                  placeholder="훈련명, 위치, 상태 검색"
                  className="rounded-2xl border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={militaryTrainingYearFilter}
                  onChange={(e) => setMilitaryTrainingYearFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 연도</option>
                  {militaryTrainingYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <select
                  value={militaryTrainingPersonFilter}
                  onChange={(e) => setMilitaryTrainingPersonFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 대상자</option>
                  {militaryPersonnel.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
                <select
                  value={militaryTrainingTypeFilter}
                  onChange={(e) => setMilitaryTrainingTypeFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 훈련유형</option>
                  {militaryTrainingTypeOptions.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <select
                  value={militaryTrainingRoundFilter}
                  onChange={(e) => setMilitaryTrainingRoundFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 차수</option>
                  {militaryTrainingRoundOptions.map((round) => (
                    <option key={round} value={round}>{round}</option>
                  ))}
                </select>
                <select
                  value={militaryTrainingDepartmentFilter}
                  onChange={(e) => setMilitaryTrainingDepartmentFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 부서</option>
                  {militaryTrainingDepartmentOptions.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
                <select
                  value={militaryTrainingStatusFilter}
                  onChange={(e) => setMilitaryTrainingStatusFilter(e.target.value)}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="전체">전체 상태</option>
                  <option value="완료">완료</option>
                  <option value="미완료">미완료</option>
                  <option value="미이수">미이수</option>
                  <option value="예정">예정</option>
                  <option value="진행중">진행중</option>
                  <option value="관리제외">관리제외</option>
                </select>
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMilitaryTrainingForm({
                        id: "",
                        personnelId: "",
                        subject: "",
                        trainingDate: "",
                        location: "",
                        attendees: 0,
                        status: "",
                        notes: "",
                        createdAt: "",
                        updatedAt: "",
                      });
                      setEditingMilitaryTrainingId(null);
                      setShowMilitaryTrainingForm(true);
                    }}
                    className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    훈련 등록
                  </button>
                )}
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => generateAllMilitaryTrainingRecords()}
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    현재 인원 기준 훈련기록 자동생성
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                기준연도 필터는 훈련예정일, 이수일, 등록일을 기준으로 작동합니다. 전년도 기록은 연도 선택에서 해당 연도를 고르면 조회할 수 있습니다.
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3">대상자</th>
                    <th className="px-3 py-3">훈련명</th>
                    <th className="px-3 py-3">훈련일</th>
                    <th className="px-3 py-3">위치</th>
                    <th className="px-3 py-3">참석인원</th>
                    <th className="px-3 py-3">상태</th>
                    <th className="px-3 py-3">비고</th>
                    {canEditData(currentUser) && <th className="px-3 py-3">작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredMilitaryTrainingRecords.map((record) => (
                    <tr key={record.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                        <td className="px-3 py-3">{militaryPersonnel.find((person) => person.id === record.personnelId)?.name || "-"}</td>
                      <td className="px-3 py-3">{record.subject}</td>
                      <td className="px-3 py-3">{record.trainingDate}</td>
                      <td className="px-3 py-3">{record.location}</td>
                      <td className="px-3 py-3">{record.attendees}</td>
                      <td className="px-3 py-3">
                        <span className={`${/(완료|completed)/i.test(record.status) ? "text-emerald-500" : "text-amber-500"}`}>{record.status}</span>
                      </td>
                      <td className="px-3 py-3">{record.notes}</td>
                      {canEditData(currentUser) && (
                        <td className="px-3 py-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => openMilitaryTrainingEdit(record)}
                            className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm("해당 훈련 기록을 삭제하시겠습니까?")) return;
                              const existing = militaryTrainingRecords.find((item) => item.id === record.id);
                              if (!existing) return;
                              setMilitaryTrainingRecords((prev) => prev.filter((item) => item.id !== record.id));
                              createAuditLog({
                                targetType: "trainingRecord",
                                targetId: record.id,
                                actionType: "delete",
                                changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
                                beforeValue: JSON.stringify(existing),
                                afterValue: "",
                              });
                            }}
                            className="rounded-2xl border border-rose-300 px-3 py-1 text-rose-600 hover:bg-rose-50"
                          >
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredMilitaryTrainingRecords.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 7 : 6} className="px-3 py-12 text-center text-slate-400">훈련 기록 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "militaryNotices" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">공지/알림</h2>
                <p className="text-sm text-slate-500">예비군 및 민방위 공지를 확인하세요.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={militaryNoticeSearch}
                  onChange={(e) => setMilitaryNoticeSearch(e.target.value)}
                  placeholder="제목, 구분, 내용 검색"
                  className="rounded-2xl border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMilitaryNoticeForm({
                        id: "",
                        personnelIds: [],
                        title: "",
                        category: "",
                        publishedDate: "",
                        expiresDate: "",
                        content: "",
                        createdAt: "",
                        updatedAt: "",
                      });
                      setEditingMilitaryNoticeId(null);
                      setShowMilitaryNoticeForm(true);
                    }}
                    className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    공지 등록
                  </button>
                )}
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => generateNoticesFromTrainingRecords()}
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    통보서 자동생성
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3">제목</th>
                    <th className="px-3 py-3">구분</th>
                    <th className="px-3 py-3">게시일</th>
                    <th className="px-3 py-3">만료일</th>
                    <th className="px-3 py-3">통보대상</th>
                    <th className="px-3 py-3">발송상태</th>
                    <th className="px-3 py-3">내용</th>
                    {canEditData(currentUser) && <th className="px-3 py-3">작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredMilitaryNotices.map((notice) => {
                    const publishStatus = notice.publishedDate ? "발송됨" : "미발송";
                    return (
                      <tr key={notice.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                        <td className="px-3 py-3">{notice.title}</td>
                        <td className="px-3 py-3">{notice.category}</td>
                        <td className="px-3 py-3">{notice.publishedDate}</td>
                        <td className="px-3 py-3">
                          {notice.personnelIds?.map((id) => militaryPersonnel.find((person) => person.id === id)?.name || id).join(", ")}
                        </td>
                        <td className="px-3 py-3">{publishStatus}</td>
                        <td className="px-3 py-3">{notice.content}</td>
                        {canEditData(currentUser) && (
                          <td className="px-3 py-3 space-x-2">
                            <button
                              type="button"
                              onClick={() => openMilitaryNoticeEdit(notice)}
                              className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                            >
                              수정
                            </button>
                              <button
                                type="button"
                                onClick={() => openNoticePrintWindow(notice)}
                                className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                              >
                                인쇄
                              </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!confirm("해당 공지를 삭제하시겠습니까?")) return;
                                const existing = militaryNotices.find((item) => item.id === notice.id);
                                if (!existing) return;
                                setMilitaryNotices((prev) => prev.filter((item) => item.id !== notice.id));
                                createAuditLog({
                                  targetType: "militaryNotice",
                                  targetId: notice.id,
                                  actionType: "delete",
                                  changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
                                  beforeValue: JSON.stringify(existing),
                                  afterValue: "",
                                });
                              }}
                              className="rounded-2xl border border-rose-300 px-3 py-1 text-rose-600 hover:bg-rose-50"
                            >
                              삭제
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filteredMilitaryNotices.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 7 : 6} className="px-3 py-12 text-center text-slate-400">공지/알림 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "militaryReports" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">보고서</h2>
                <p className="text-sm text-slate-500">예비군/민방위 보고서를 확인하세요.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={militaryReportSearch}
                  onChange={(e) => setMilitaryReportSearch(e.target.value)}
                  placeholder="제목, 작성자, 종류 검색"
                  className="rounded-2xl border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMilitaryReportForm({
                        id: "",
                        title: "",
                        reportDate: "",
                        type: "",
                        author: "",
                        status: "",
                        notes: "",
                        createdAt: "",
                        updatedAt: "",
                      });
                      setEditingMilitaryReportId(null);
                      setShowMilitaryReportForm(true);
                    }}
                    className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    보고서 등록
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-auto">
                {canEditData(currentUser) && (
                  <button
                    type="button"
                    onClick={() => generateMilitaryReports()}
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    보고서 자동생성
                  </button>
                )}
              <table className="w-full text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3">제목</th>
                    <th className="px-3 py-3">보고일</th>
                    <th className="px-3 py-3">종류</th>
                    <th className="px-3 py-3">작성자</th>
                    <th className="px-3 py-3">상태</th>
                    <th className="px-3 py-3">비고</th>
                    {canEditData(currentUser) && <th className="px-3 py-3">작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredMilitaryReports.map((report) => (
                    <tr key={report.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                      <td className="px-3 py-3">{report.title}</td>
                      <td className="px-3 py-3">{report.reportDate}</td>
                      <td className="px-3 py-3">{report.type}</td>
                      <td className="px-3 py-3">{report.author}</td>
                      <td className="px-3 py-3">{report.status}</td>
                      <td className="px-3 py-3">{report.notes}</td>
                      {canEditData(currentUser) && (
                        <td className="px-3 py-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => openMilitaryReportEdit(report)}
                            className="rounded-2xl border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
                          >수정</button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm("해당 보고서를 삭제하시겠습니까?")) return;
                              const existing = militaryReports.find((item) => item.id === report.id);
                              if (!existing) return;
                              setMilitaryReports((prev) => prev.filter((item) => item.id !== report.id));
                              createAuditLog({
                                targetType: "militaryReport",
                                targetId: report.id,
                                actionType: "delete",
                                changedBy: currentUser?.displayName || currentUser?.username || currentUser?.id || "",
                                beforeValue: JSON.stringify(existing),
                                afterValue: "",
                              });
                            }}
                            className="rounded-2xl border border-rose-300 px-3 py-1 text-rose-600 hover:bg-rose-50"
                          >삭제</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredMilitaryReports.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 7 : 6} className="px-3 py-12 text-center text-slate-400">보고서 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "militarySettings" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">환경설정</h2>
              <p className="text-sm text-slate-500">예비군/민방위 기준표와 코드값, 자동생성 설정을 관리합니다.</p>
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-5" : "rounded-2xl border border-slate-200 bg-slate-50 p-5"}`}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">훈련기준표</h3>
                      <p className="text-sm text-slate-500">기준표를 추가/수정/삭제하고 저장합니다.</p>
                    </div>
                    <div className="w-full sm:w-auto">
                      <label className="space-y-1 text-sm">
                        기준연도 설정
                        <input
                          type="number"
                          min="1900"
                          max="2100"
                          value={militarySettings["기준연도"] || ""}
                          onChange={(e) => setMilitarySettings((prev) => ({ ...prev, 기준연도: e.target.value }))}
                          className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="예: 2026"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      훈련연도
                      <input
                        type="text"
                        value={militaryTrainingRuleForm.year}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, year: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      현재구분
                      <select
                        value={militaryTrainingRuleForm.currentCategory}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, currentCategory: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="예비군">예비군</option>
                        <option value="민방위">민방위</option>
                        <option value="대상아님">대상아님</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      연차시작
                      <input
                        type="number"
                        min="1"
                        value={militaryTrainingRuleForm.yearMin}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, yearMin: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      연차종료
                      <input
                        type="number"
                        min="1"
                        value={militaryTrainingRuleForm.yearMax}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, yearMax: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      동원지정여부
                      <select
                        value={militaryTrainingRuleForm.mobilizationOnly ? "동원" : "동원미지정"}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, mobilizationOnly: e.target.value === "동원" }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="동원">동원</option>
                        <option value="동원미지정">동원미지정</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      훈련유형
                      <input
                        type="text"
                        value={militaryTrainingRuleForm.trainingType}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, trainingType: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      필요시간
                      <input
                        type="number"
                        min="0"
                        value={militaryTrainingRuleForm.requiredHours}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, requiredHours: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      필수여부
                      <select
                        value={militaryTrainingRuleForm.mandatory ? "예" : "아니오"}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, mandatory: e.target.value === "예" }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="예">예</option>
                        <option value="아니오">아니오</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      적용시작일
                      <input
                        type="date"
                        value={militaryTrainingRuleForm.effectiveFrom}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      적용종료일
                      <input
                        type="date"
                        value={militaryTrainingRuleForm.effectiveTo}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, effectiveTo: e.target.value }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      사용여부
                      <select
                        value={militaryTrainingRuleForm.enabled ? "사용" : "미사용"}
                        onChange={(e) => setMilitaryTrainingRuleForm((prev) => ({ ...prev, enabled: e.target.value === "사용" }))}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="사용">사용</option>
                        <option value="미사용">미사용</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const payload: MilitaryTrainingRule = {
                          ...militaryTrainingRuleForm,
                          id: editingMilitaryTrainingRuleId || crypto.randomUUID(),
                        };
                        setMilitaryTrainingRules((prev) =>
                          editingMilitaryTrainingRuleId
                            ? prev.map((item) => (item.id === editingMilitaryTrainingRuleId ? payload : item))
                            : [payload, ...prev]
                        );
                        setEditingMilitaryTrainingRuleId(null);
                        setMilitaryTrainingRuleForm({
                          id: "",
                          year: new Date().getFullYear().toString(),
                          currentCategory: "예비군",
                          yearMin: "1",
                          yearMax: "4",
                          mobilizationOnly: false,
                          trainingType: "동원훈련",
                          requiredHours: "28",
                          mandatory: true,
                          effectiveFrom: "",
                          effectiveTo: "",
                          enabled: true,
                        });
                      }}
                      className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      {editingMilitaryTrainingRuleId ? "기준표 수정" : "기준표 추가"}
                    </button>
                    {editingMilitaryTrainingRuleId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMilitaryTrainingRuleId(null);
                          setMilitaryTrainingRuleForm({
                            id: "",
                            year: new Date().getFullYear().toString(),
                            currentCategory: "예비군",
                            yearMin: "1",
                            yearMax: "4",
                            mobilizationOnly: false,
                            trainingType: "동원훈련",
                            requiredHours: "28",
                            mandatory: true,
                            effectiveFrom: "",
                            effectiveTo: "",
                            enabled: true,
                          });
                        }}
                        className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        취소
                      </button>
                    )}
                  </div>
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-5" : "rounded-2xl border border-slate-200 bg-slate-50 p-5"}`}>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold">훈련 자동생성 설정</h3>
                    <p className="text-sm text-slate-500">자동생성 ON/OFF와 대상 재직상태를 설정합니다.</p>
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={militaryTrainingAutoConfig.enabled}
                        onChange={(e) => setMilitaryTrainingAutoConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      자동생성 사용
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        "신규입사",
                        "전배",
                        "복직",
                        "전출",
                        "휴직",
                        "퇴사",
                        "재직",
                      ].map((status) => (
                        <label key={status} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={militaryTrainingAutoConfig.targetStatuses?.includes(status)}
                            onChange={() => toggleMilitaryAutoTargetStatus(status)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          {status}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div>현재 설정: {militaryTrainingAutoConfig.enabled ? "ON" : "OFF"}</div>
                      <div>자동생성 대상 상태: {militaryTrainingAutoConfig.targetStatuses?.join(", ") || "없음"}</div>
                      <div>기준연도: {militarySettings["기준연도"] || "자동"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={saveMilitaryTrainingAutoSettings}
                      className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      자동생성 설정 저장
                    </button>
                    <button
                      type="button"
                      onClick={saveSupabaseMilitaryModule}
                      disabled={!isSupabaseAvailable() || isSupabaseSyncing}
                      className="rounded-2xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Supabase 저장
                    </button>
                    <button
                      type="button"
                      onClick={loadSupabaseMilitaryModule}
                      disabled={!isSupabaseAvailable() || isSupabaseSyncing}
                      className="rounded-2xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Supabase 불러오기
                    </button>
                    <p className="text-xs text-slate-400">
                      자동생성 ON/OFF는 신규입사/전배/복직/전출/휴직/퇴사/재직 상태의 자동훈련기록 생성에 적용됩니다.
                    </p>
                    {supabaseSyncStatus && (
                      <p className="text-xs text-slate-400">{supabaseSyncStatus}</p>
                    )}
                  </div>
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold">현재 등록된 훈련기준표</h3>
                    <span className="rounded-full border px-2 py-1 text-xs text-slate-500">총 {militaryTrainingRules.length}개</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                        <tr>
                          <th className="px-3 py-2">기준연도</th>
                          <th className="px-3 py-2">구분</th>
                          <th className="px-3 py-2">연차</th>
                          <th className="px-3 py-2">동원</th>
                          <th className="px-3 py-2">훈련유형</th>
                          <th className="px-3 py-2">시간</th>
                          <th className="px-3 py-2">사용</th>
                          <th className="px-3 py-2">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {militaryTrainingRules.map((rule) => (
                          <tr key={rule.id} className={`${theme.darkMode ? "border-slate-700 hover:bg-slate-950" : "border-slate-200 hover:bg-slate-50"}`}>
                            <td className="px-3 py-2">{rule.year}</td>
                            <td className="px-3 py-2">{rule.currentCategory}</td>
                            <td className="px-3 py-2">{rule.yearMin}~{rule.yearMax}</td>
                            <td className="px-3 py-2">{rule.mobilizationOnly ? "동원" : "동원미지정"}</td>
                            <td className="px-3 py-2">{rule.trainingType}</td>
                            <td className="px-3 py-2">{rule.requiredHours}</td>
                            <td className="px-3 py-2">{rule.enabled ? "사용" : "미사용"}</td>
                            <td className="px-3 py-2 space-x-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMilitaryTrainingRuleId(rule.id);
                                  setMilitaryTrainingRuleForm(rule);
                                }}
                                className="rounded-2xl border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
                              >수정</button>
                              <button
                                type="button"
                                onClick={() => setMilitaryTrainingRules((prev) => prev.filter((item) => item.id !== rule.id))}
                                className="rounded-2xl border border-rose-300 px-2 py-1 text-rose-600 hover:bg-rose-50"
                              >삭제</button>
                            </td>
                          </tr>
                        ))}
                        {militaryTrainingRules.length === 0 && (
                          <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">등록된 훈련기준표가 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-5" : "rounded-2xl border border-slate-200 bg-slate-50 p-5"}`}>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold">코드값 관리</h3>
                    <p className="text-sm text-slate-500">부서명, 재직상태, 병역구분, 동원여부, 훈련유형, 차수, 훈련상태를 관리합니다.</p>
                  </div>
                  <div className="space-y-3">
                    <label className="space-y-1 text-sm">
                      코드 카테고리
                      <select
                        value={codeValueCategory}
                        onChange={(e) => setCodeValueCategory(e.target.value as keyof MilitaryCodeValues)}
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="departments">부서명</option>
                        <option value="employmentStatus">재직상태</option>
                        <option value="militaryCategory">병역구분</option>
                        <option value="mobilizationStatus">동원여부</option>
                        <option value="trainingType">훈련유형</option>
                        <option value="trainingRound">차수</option>
                        <option value="trainingStatus">훈련상태</option>
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={codeValueInput}
                        onChange={(e) => setCodeValueInput(e.target.value)}
                        placeholder="추가할 코드값 입력"
                        className="w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const value = codeValueInput.trim();
                          if (!value) return;
                          setMilitaryCodeValues((prev) => ({
                            ...prev,
                            [codeValueCategory]: Array.from(new Set([value, ...(prev[codeValueCategory] || [])])),
                          }));
                          setCodeValueInput("");
                        }}
                        className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >추가</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                          <tr>
                            <th className="px-3 py-2">카테고리</th>
                            <th className="px-3 py-2">코드값</th>
                            <th className="px-3 py-2">작업</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(militaryCodeValues).flatMap(([category, values]) =>
                            values.map((value) => (
                              <tr key={`${category}-${value}`} className={`${theme.darkMode ? "border-slate-700 hover:bg-slate-950" : "border-slate-200 hover:bg-slate-50"}`}>
                                <td className="px-3 py-2">{category}</td>
                                <td translate="no" className="px-3 py-2 notranslate">{value}</td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() => setMilitaryCodeValues((prev) => ({
                                      ...prev,
                                      [category]: (prev[category as keyof MilitaryCodeValues] || []).filter((item) => item !== value),
                                    }))}
                                    className="rounded-2xl border border-rose-300 px-2 py-1 text-rose-600 hover:bg-rose-50"
                                  >삭제</button>
                                </td>
                              </tr>
                            ))
                          )}
                          {Object.values(militaryCodeValues).every((items) => items.length === 0) && (
                            <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">코드값이 없습니다.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-5" : "rounded-2xl border border-slate-200 bg-slate-50 p-5"}`}>
                  <div className="mb-4">
                    <h3 className="text-base font-semibold">훈련이력 자동생성 설정</h3>
                    <p className="text-sm text-slate-500">자동생성 대상 재직상태와 ON/OFF를 설정합니다.</p>
                  </div>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={militaryTrainingAutoConfig.enabled}
                      onChange={(e) => setMilitaryTrainingAutoConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    자동생성 사용
                  </label>
                  <div className="mt-4 grid gap-2">
                    {(militaryCodeValues.employmentStatus || []).map((status) => (
                      <label key={status} className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={militaryTrainingAutoConfig.targetStatuses.includes(status)}
                          onChange={(e) => {
                            setMilitaryTrainingAutoConfig((prev) => {
                              const next = e.target.checked
                                ? Array.from(new Set([status, ...prev.targetStatuses]))
                                : prev.targetStatuses.filter((item) => item !== status);
                              return { ...prev, targetStatuses: next };
                            });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        {status}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "dormContracts" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사 계약현황</h2>
                <p className="text-sm text-slate-500">
                  지역 / 상태 필터와 검색으로 계약 정보를 확인하세요.
                  {selectedDormContractIds.length > 0 && ` 선택된 ${selectedDormContractIds.length}개`}
                </p>
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <MiniStat label="총 계약 건수" value={`${visibleDormContracts.length}`} />
              <MiniStat label="진행중" value={`${visibleDormContracts.filter((c) => getDormContractDisplayStatus(c, dorms, occupants) === "진행중").length}`} />
              <div className="col-span-4 text-xs text-slate-400">집계 기준: '진행중'은 저장된 '진행중'과 '자동선택'의 계산 결과가 '진행중'인 계약을 포함합니다.</div>
              <MiniStat label="만료예정" value={`${visibleDormContracts.filter((c) => getDormContractDisplayStatus(c, dorms, occupants) === "만료예정").length}`} />
              <MiniStat label="종료" value={`${visibleDormContracts.filter((c) => getDormContractDisplayStatus(c, dorms, occupants) === "종료").length}`} />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  label="지역"
                  value={dormContractSiteFilter}
                  onChange={(v) => setDormContractSiteFilter(v as Site | "전체")}
                  options={["전체", "평택", "천안"]}
                />
                <FilterSelect
                  label="상태"
                  value={dormContractStatusFilter}
                  onChange={(v) => setDormContractStatusFilter(v as DormContractStatus | "전체")}
                  options={["전체", "공실", "진행중", "만료예정", "연장", "종료", "해지"]}
                />
                <input
                  type="text"
                  placeholder="검색..."
                  value={dormContractSearch}
                  onChange={(e) => setDormContractSearch(e.target.value)}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {canEditData(currentUser) && (
                  <button
                    onClick={() => {
                      setDormContractForm(dormContractTemplate());
                      setEditingDormContractId(null);
                      setShowDormContractForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" /> 기숙사 추가
                  </button>
                )}
                {canEditData(currentUser) && selectedDormContractIds.length === 1 && (
                  <button
                    onClick={() => {
                      const selected = dormContracts.find((c) => c.id === selectedDormContractIds[0]);
                      if (!selected) return;
                      setDormContractForm({
                        site: selected.site,
                        address: selected.address,
                        buildingName: selected.buildingName,
                        dong: selected.dong,
                        roomHo: selected.roomHo,
                        pyeong: selected.pyeong,
                        landlordName: selected.landlordName,
                        landlordPhone: selected.landlordPhone,
                        realEstateName: selected.realEstateName,
                        realEstatePhone: selected.realEstatePhone,
                        공동현관: selected.공동현관,
                        세대현관: selected.세대현관,
                        contractStart: "",
                        contractEnd: "",
                        contractStatus: "자동선택",
                        contractAmount: selected.contractAmount,
                        prepaymentDeposit: selected.prepaymentDeposit,
                        deposit: selected.deposit,
                        monthlyRentOrMaintenance: selected.monthlyRentOrMaintenance,
                        contractType: "자동선택",
                        gender: selected.gender,
                        notes: selected.notes,
                        registeredBy: currentUser?.displayName || selected.registeredBy,
                        modifiedBy: currentUser?.displayName || selected.modifiedBy,
                        createdAt: new Date().toISOString().slice(0, 10),
                        updatedAt: new Date().toISOString().slice(0, 10),
                      });
                      setEditingDormContractId(null);
                      setShowDormContractForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                  >
                    계약 갱신 등록
                  </button>
                )}
                {canEditData(currentUser) && selectedDormContractIds.length > 0 && (
                  <button
                    onClick={() => {
                      if (softDeleteItems(dormContracts, setDormContracts, selectedDormContractIds, "dormContract")) {
                        setSelectedDormContractIds([]);
                      }
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1400px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    {canEditData(currentUser) && (
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={visibleDormContracts.length > 0 && selectedDormContractIds.length === visibleDormContracts.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDormContractIds(visibleDormContracts.map((c) => c.id));
                            else setSelectedDormContractIds([]);
                          }}
                          className="h-5 w-5"
                        />
                      </th>
                    )}
                    <th className="px-2 py-2 whitespace-nowrap text-xs">구분</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">지역</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">성별</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">주소</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">건물</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">동</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">호</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">평수</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">임대인명</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">임대인연락처</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">부동산명</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">부동산연락처</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">시작</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">종료</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">상태</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">금액</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">선납</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">보증</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">월세</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">유형</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">비고</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">등록</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">수정</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">등록자</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDormContracts.map((c, index) => (
                    <tr
                      key={c.id}
                      onClick={(e) => handleRowClick(e, () => openDormContractEdit(c))}
                      className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                    >
                      {canEditData(currentUser) && (
                        <td className="px-2 py-3">
                          <input
                            type="checkbox"
                            checked={selectedDormContractIds.includes(c.id)}
                            onChange={(e) =>
                              e.target.checked
                                ? setSelectedDormContractIds((prev) => [...prev, c.id])
                                : setSelectedDormContractIds((prev) => prev.filter((id) => id !== c.id))
                            }
                            className="h-5 w-5"
                          />
                        </td>
                      )}
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{index + 1}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.site}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.gender}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.address}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.buildingName}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.dong}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.roomHo}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.pyeong}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.landlordName}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.landlordPhone}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.realEstateName}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.realEstatePhone}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractStart}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractEnd}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{getDormContractDisplayStatus(c, dorms, occupants)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractAmount}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.prepaymentDeposit}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.deposit}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.monthlyRentOrMaintenance}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractType}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.notes}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(c.createdAt)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(c.updatedAt)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.registeredBy}</td>
                    </tr>
                  ))}
                  {visibleDormContracts.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 25 : 24} className="px-4 py-12 text-center text-slate-400">
                        기숙사 계약 정보가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "newHires" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">신입사원 명단</h2>
                <p className="text-sm text-slate-500">
                  지역 / 성별 필터와 검색으로 입주 정보를 관리하세요.
                  {selectedNewHireIds.length > 0 && ` 선택된 ${selectedNewHireIds.length}개`}
                </p>
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <MiniStat label="총 신입사원" value={`${visibleNewHires.length}`} />
              <MiniStat label="거주중" value={`${visibleNewHires.filter((h) => h.residenceStatus === "거주중").length}`} />
              <MiniStat label="퇴실" value={`${visibleNewHires.filter((h) => h.residenceStatus === "퇴실").length}`} />
              <MiniStat label="만료예정" value={`${visibleNewHires.filter((h) => h.residenceStatus === "만료예정").length}`} />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  label="지역"
                  value={newHireSiteFilter}
                  onChange={(v) => setNewHireSiteFilter(v as Site | "전체")}
                  options={["전체", "평택", "천안"]}
                />
                <FilterSelect
                  label="성별"
                  value={newHireGenderFilter}
                  onChange={(v) => setNewHireGenderFilter(v as "남" | "여" | "전체")}
                  options={["전체", "남", "여", "기타"]}
                />
                <FilterSelect
                  label="배정상태"
                  value={newHireAssignmentFilter}
                  onChange={(v) => setNewHireAssignmentFilter(v as "전체" | "배정완료" | "미배정")}
                  options={["전체", "배정완료", "미배정"]}
                />
                <input
                  type="text"
                  placeholder="검색..."
                  value={newHireSearch}
                  onChange={(e) => setNewHireSearch(e.target.value)}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {canEditData(currentUser) && (
                  <button
                    onClick={() => {
                      setNewHireForm(newHireTemplate());
                      setEditingNewHireId(null);
                      setShowNewHireForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" /> 입주자 추가
                  </button>
                )}
                {canEditData(currentUser) && selectedNewHireIds.length === 1 && (
                  <button
                    onClick={() => {
                      const selected = newHires.find((h) => h.id === selectedNewHireIds[0]);
                      if (!selected) return;
                      setNewHireForm({
                        site: selected.site,
                        gender: selected.gender,
                        name: selected.name,
                        phone: selected.phone,
                        department: selected.department,
                        dormId: selected.dormId,
                        address: selected.address,
                        buildingName: selected.buildingName,
                        dong: selected.dong,
                        roomHo: selected.roomHo,
                        공동현관: selected.공동현관,
                        세대현관: selected.세대현관,
                        expectedMoveInDate: "",
                        moveInDate: "",
                        expectedMoveOutDate: "",
                        moveOutDate: "",
                        actualMoveOutDate: "",
                        cheonanMoveDate: "",
                        residenceStatus: "자동선택",
                        moveInType: "자동선택",
                        extensionReason: selected.extensionReason,
                        notes: selected.notes,
                        createdAt: new Date().toISOString().slice(0, 10),
                        updatedAt: new Date().toISOString().slice(0, 10),
                      });
                      setEditingNewHireId(null);
                      setShowNewHireForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                  >
                    거주 갱신 등록
                  </button>
                )}
                {canEditData(currentUser) && selectedNewHireIds.length > 0 && (
                  <button
                    onClick={() => {
                      if (softDeleteItems(newHires, setNewHires, selectedNewHireIds, "newHire")) {
                        setSelectedNewHireIds([]);
                      }
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1400px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    {canEditData(currentUser) && (
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={visibleNewHires.length > 0 && selectedNewHireIds.length === visibleNewHires.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedNewHireIds(visibleNewHires.map((h) => h.id));
                            else setSelectedNewHireIds([]);
                          }}
                          className="h-5 w-5"
                        />
                      </th>
                    )}
                    <th className="px-2 py-2 whitespace-nowrap text-xs">구분</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">지역</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">성별</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">이름</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">연락</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">부서</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">도로명주소</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">건물명</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">동</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">호</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">예상입실</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">입실</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">예상퇴실</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">퇴실</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">실제퇴실</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">천안이동</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">상태</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">유형</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">사유</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">메모</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">등록</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">수정</th>
                    <th className="px-2 py-2 whitespace-nowrap text-xs">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleNewHires.map((h, index) => (
                    <tr
                      key={h.id}
                      onClick={(e) => handleRowClick(e, () => openNewHireEdit(h))}
                      className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                    >
                      {canEditData(currentUser) && (
                        <td className="px-2 py-3">
                          <input
                            type="checkbox"
                            checked={selectedNewHireIds.includes(h.id)}
                            onChange={(e) =>
                              e.target.checked
                                ? setSelectedNewHireIds((prev) => [...prev, h.id])
                                : setSelectedNewHireIds((prev) => prev.filter((id) => id !== h.id))
                            }
                            className="h-5 w-5"
                          />
                        </td>
                      )}
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{index + 1}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.site}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.gender}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.name} {(!h.dormId || !h.buildingName || !h.address) && <span className="ml-1 rounded-full bg-orange-100 px-1 py-0.5 text-xs font-semibold text-orange-700">미배정</span>}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.phone}</td>
                      <td translate="no" className="px-2 py-3 whitespace-nowrap text-xs notranslate">{h.department}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{operationalDorms.find((d) => d.id === h.dormId)?.address || dorms.find((d) => d.id === h.dormId)?.address || h.dormId}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.buildingName}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.dong}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.roomHo}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.expectedMoveInDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveInDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.expectedMoveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.actualMoveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.cheonanMoveDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{calculateNewHireResidenceStatus(h)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveInType}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.extensionReason || "-"}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.notes || "-"}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(h.createdAt)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(h.updatedAt)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">
                        <div className="flex gap-2">
                          {canEditData(currentUser) && (!h.dormId || !h.buildingName || !h.address) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssigningNewHireId(h.id);
                                setShowAssignDormForNewHire(true);
                              }}
                              className="rounded-xl border border-blue-300 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                            >
                              기숙사 배정
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleNewHires.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 24 : 23} className="px-4 py-12 text-center text-slate-400">
                        신입사원 명단이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "dorms" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사별 정보</h2>
                <p className="text-sm text-slate-500">기숙사별 관리자 1명 지정, 최대 인원 6명 관리</p>
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <MiniStat label="총 기숙사" value={`${visibleDorms.length}`} />
              <MiniStat label="평택" value={`${visibleDorms.filter((d) => d.site === "평택").length}`} />
              <MiniStat label="천안" value={`${visibleDorms.filter((d) => d.site === "천안").length}`} />
              <MiniStat label="남성" value={`${visibleDorms.filter((d) => d.gender === "남").length}`} />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <FilterSelect
                  label="지역"
                  value={dormSiteFilter}
                  onChange={(v) => setDormSiteFilter(v as Site | "전체")}
                  options={["전체", "평택", "천안"]}
                />
                <FilterSelect
                  label="성별"
                  value={dormGenderFilter}
                  onChange={(v) => setDormGenderFilter(v as "남" | "여" | "전체")}
                  options={["전체", "남", "여"]}
                />
                <input
                  type="text"
                  placeholder="검색..."
                  value={dormSearch}
                  onChange={(e) => setDormSearch(e.target.value)}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
                />
              </div>
              <div className="flex items-center gap-2">
                {canEditData(currentUser) && selectedDormIds.length > 0 && (
                  <button
                    onClick={() => {
                      setDorms((prev) => prev.filter((d) => !selectedDormIds.includes(d.id)));
                      setSelectedDormIds([]);
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    선택 삭제
                  </button>
                )}
                {/* 기숙사 등록/수정 기능 제외됨 */}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {visibleDorms.map((d, index) => {
                const manager = users.find((u) => u.id === d.managerUserId);
                const residentCount = occupancyCountByDorm.get(d.id) || 0;
                return (
                  <div
                    key={d.id}
                    className={`cursor-pointer rounded-2xl border p-3 ${theme.darkMode ? "border-slate-700 bg-slate-900 hover:shadow-md" : "border-slate-200 bg-white hover:shadow-md transition-shadow"}`}
                    onClick={() => {
                      const getDormKey = (site: string, buildingName: string, dong: string, roomHo: string) =>
                        `${site.trim().toLowerCase()}|${buildingName.trim().toLowerCase()}|${stripDongHoSuffix(dong).toLowerCase()}|${stripDongHoSuffix(roomHo).toLowerCase()}`;
                      const matchingContract = dormContracts.find(
                        (c) => getDormKey(c.site, c.buildingName, c.dong, c.roomHo) === getDormKey(d.site, d.buildingName, d.dong, d.roomHo)
                      );
                      if (matchingContract) {
                        openDormContractEdit(matchingContract);
                      } else {
                        setEditingDormId(d.id);
                        setShowDormForm(true);
                      }
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-xs">#{index + 1}</span>
                      <label className="inline-flex items-center gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={selectedDormIds.includes(d.id)}
                          onChange={(e) =>
                            e.target.checked
                              ? setSelectedDormIds((prev) => [...prev, d.id])
                              : setSelectedDormIds((prev) => prev.filter((id) => id !== d.id))
                          }
                          className={`h-5 w-5 rounded ${theme.darkMode ? "border-slate-600 text-slate-100" : "border-slate-300 text-slate-900"}`}
                        />
                      </label>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-xs font-semibold ring-1 ring-slate-300 dark:ring-slate-400 dark:text-white"
                        style={{ backgroundColor: badgeColor(theme, d.leaseStatus) }}
                      >
                        {d.leaseStatus}
                      </span>
                    </div>
                    <div className="mb-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{d.site} · {d.gender}</div>
                      <div className="text-sm font-semibold">{d.buildingName}</div>
                      <div className="text-xs text-slate-500">{`${d.address} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[0.72rem]">
                      <CompactField
                        label="계약기간"
                        value={`${d.contractStart || "-"} ~ ${d.contractEnd || "-"}`}
                        className="p-3 min-h-[4rem]"
                        valueClassName="text-[0.78rem] leading-5"
                      />
                      <CompactField label="계약금액" value={d.contractAmount || "-"} />
                      <CompactField
                        label="평수"
                        value={d.pyeong || "-"}
                        className="p-1.5"
                        labelClassName="text-[0.64rem]"
                        valueClassName="text-[0.68rem]"
                      />
                      <CompactField label="관리자" value={manager?.displayName || "미지정"} />
                      <CompactField label="현재 인원" value={`${residentCount}/6`} />
                      <CompactField label="부동산명" value={d.realEstateName || "-"} />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-center gap-1">
                      {/* 기숙사 수정 기능 제외됨 */}
                      {canEditData(currentUser) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            softDeleteItem(dorms, setDorms, d.id, "dorm");
                          }}
                          className="rounded-xl border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          삭제
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectDormForContext(d.id);
                        }}
                        className={`${theme.darkMode ? "rounded-xl border border-slate-600 px-2 py-1 text-xs hover:bg-slate-950" : "rounded-xl border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"}`}
                      >
                        입주자 보기
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeTab === "occupants" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사별 인원 / 입실일</h2>
                <p className="text-sm text-slate-500">선택된 기숙사 기준 입주자 상세 관리</p>
                <p className="text-xs text-slate-400 mt-1">집계 기준: "거주중"은 거주중·만료예정·신규입주를 포함합니다.</p>
              </div>
              {canEditData(currentUser) && (
                <button
                  type="button"
                  onClick={() => setShowNewHireAssignmentModal(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  <Plus className="h-4 w-4" /> 신입사원 배정
                </button>
              )}
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <MiniStat label="총 입주자" value={`${visibleOccupants.length}`} />
              <MiniStat label="거주중" value={`${visibleOccupants.filter((o) => ["거주중", "만료예정", "신규입주"].includes(o.status)).length}`} />
              <MiniStat label="만료예정" value={`${visibleOccupants.filter((o) => o.status === "만료예정").length}`} />
              <MiniStat label="퇴실" value={`${visibleOccupants.filter((o) => o.status === "퇴실").length}`} />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect label="지역" value={occupantMenuFilterSite} onChange={(v) => setOccupantMenuFilterSite(v as Site | "전체")} options={["전체", "평택", "천안"]} />
                <FilterSelect label="성별" value={occupantMenuFilterGender} onChange={(v) => setOccupantMenuFilterGender(v as "남" | "여" | "전체")} options={["전체", "남", "여"]} />
                <FilterSelect label="상태" value={occupantMenuFilterStatus} onChange={(v) => setOccupantMenuFilterStatus(v as "전체" | "배정완료" | "퇴실자" | "미배정")} options={["전체", "배정완료", "퇴실자", "미배정"]} />
                <input type="text" placeholder="건물명/주소 검색..." value={occupantMenuFilterSearch} onChange={(e) => setOccupantMenuFilterSearch(e.target.value)} className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`} />
              </div>
              <div className="text-xs text-slate-500">
                총 기숙사: {filteredDormsForOccupantMenu.length} · 선택: {selectedDormId ? (operationalDorms.find((d) => d.id === selectedDormId)?.buildingName || "-") : "없음"}
              </div>
            </div>

            <div className="mb-6 grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredDormsForOccupantMenu.map((dorm) => {
                const currentCount = occupancyCountByDorm.get(dorm.id) || 0;
                const isSelected = selectedDormId === dorm.id;
                return (
                  <button
                    key={dorm.id}
                    type="button"
                    onClick={() => handleDormCardClick(dorm.id)}
                    onDoubleClick={() => openDormDetailModal(dorm.id)}
                    className={`group rounded-2xl border p-3 text-left text-xs transition ${isSelected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300" : theme.darkMode ? "border-slate-700 bg-slate-900 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <div className={`${theme.darkMode ? "truncate font-semibold text-slate-100" : "truncate font-semibold text-slate-900"}`}>{dorm.buildingName}</div>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium text-white"
                        style={{ backgroundColor: badgeColor(theme, dorm.leaseStatus) }}
                      >
                        {dorm.leaseStatus}
                      </span>
                    </div>
                    <div className="mb-2 text-[0.7rem] text-slate-500">{dorm.site} / {dorm.gender} · {formatDong(dorm.dong)} {formatRoomHo(dorm.roomHo)}</div>
                    <div className="flex flex-wrap gap-1">
                      <span className={`${theme.darkMode ? "inline-flex items-center gap-0.5 rounded bg-slate-900 px-1.5 py-0.5 text-[0.65rem] font-medium" : "inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium"}`}>👥 {currentCount}/{dorm.capacity}</span>
                      <span className={`${theme.darkMode ? "inline-flex items-center gap-0.5 rounded bg-slate-900 px-1.5 py-0.5 text-[0.65rem] font-medium" : "inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium"}`}>{isCleaningMissing(dorm) ? "🔴 미보" : "✓ 정상"}</span>
                      {getOpenDefectCount(dorm.id) > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-rose-700">⚠️ {getOpenDefectCount(dorm.id)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1300px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          visibleOccupants
                            .filter((o) => {
                              if (selectedDormId) return o.dormId === selectedDormId;
                              return filteredDormsForOccupantMenu.some((d) => d.id === o.dormId);
                            })
                            .filter((o) => selectedOccupantIds.includes(o.id)).length > 0 &&
                          visibleOccupants
                            .filter((o) => {
                              if (selectedDormId) return o.dormId === selectedDormId;
                              return filteredDormsForOccupantMenu.some((d) => d.id === o.dormId);
                            })
                            .filter((o) => selectedOccupantIds.includes(o.id)).length ===
                            visibleOccupants.filter((o) => {
                              if (selectedDormId) return o.dormId === selectedDormId;
                              return filteredDormsForOccupantMenu.some((d) => d.id === o.dormId);
                            }).length
                        }
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelectedOccupantIds(
                              visibleOccupants
                                .filter((o) => {
                                  if (selectedDormId) return o.dormId === selectedDormId;
                                  return filteredDormsForOccupantMenu.some((d) => d.id === o.dormId);
                                })
                                .map((o) => o.id)
                            );
                          else setSelectedOccupantIds([]);
                        }}
                        className="h-5 w-5"
                      />
                    </th>
                    <th className="px-3 py-2">지역</th>
                    <th className="px-3 py-2">성별</th>
                    <th className="px-3 py-2">건물명</th>
                    <th className="px-3 py-2">동</th>
                    <th className="px-3 py-2">호수</th>
                    <th className="px-3 py-2">공동현관</th>
                    <th className="px-3 py-2">세대현관</th>
                    <th className="px-3 py-2">계약상태</th>
                    <th className="px-3 py-2">계약만료일</th>
                    <th className="px-3 py-2">남은일수</th>
                    <th className="px-3 py-2">담당자</th>
                    <th className="px-3 py-2">청소상태</th>
                    <th className="px-3 py-2">하자건수</th>
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">입실일</th>
                    <th className="px-3 py-2">부서</th>
                    <th className="px-3 py-2">연락처</th>
                    <th className="px-3 py-2">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...visibleOccupants
                      .filter((o) => {
                        if (selectedDormId) {
                          return o.dormId === selectedDormId;
                        }
                        if (!filteredDormsForOccupantMenu.some((d) => d.id === o.dormId)) return false;
                        if (occupantMenuFilterStatus !== "전체") {
                          if (occupantMenuFilterStatus === "배정완료") {
                            return ["거주중", "만료예정"].includes(o.status);
                          } else if (occupantMenuFilterStatus === "퇴실자") {
                            return o.status === "퇴실";
                          }
                        }
                        return true;
                      }),
                    ...(occupantMenuFilterStatus === "전체" || occupantMenuFilterStatus === "미배정"
                      ? filteredUnassignedNewHires.map((h) => ({
                          id: `newhire-${h.id}`,
                          site: h.site,
                          employeeName: h.name,
                          gender: h.gender,
                          dormId: "",
                          moveInDate: h.moveInDate,
                          moveOutDueDate: h.moveOutDate,
                          status: "미배정" as const,
                          isNewHireAssignment: true,
                          notes: `미배정: ${h.department}`,
                          department: h.department,
                          phone: h.phone,
                          expectedMoveInDate: h.expectedMoveInDate,
                          expectedMoveOutDate: h.expectedMoveOutDate,
                          actualMoveOutDate: h.actualMoveOutDate,
                          sourceNewHireId: h.id,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        } as Occupant))
                      : [])
                  ]
                    .map((o) => {
                      const dorm =
                        operationalDorms.find((d) => d.id === o.dormId) ||
                        dorms.find((d) => d.id === o.dormId);
                      return (
                        <tr
                          key={o.id}
                          onDoubleClick={() => handleOccupantRowDoubleClick(o)}
                          className={`${theme.darkMode ? "border-b border-slate-700" : "border-b border-slate-100"}`}
                        >
                        <td className="px-3 py-3">
                          <label className="inline-flex items-center justify-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedOccupantIds.includes(o.id)}
                              onChange={(e) =>
                                e.target.checked
                                  ? setSelectedOccupantIds((prev) => [...prev, o.id])
                                  : setSelectedOccupantIds((prev) => prev.filter((id) => id !== o.id))
                              }
                              className="h-5 w-5"
                            />
                          </label>
                        </td>
                        <td className="px-3 py-3">{dorm?.site || "-"}</td>
                        <td className="px-3 py-3">{o.gender}</td>
                        <td className="px-3 py-3">{dorm?.buildingName || "-"}</td>
                        <td className="px-3 py-3">{formatDong(dorm?.dong) || "-"}</td>
                        <td className="px-3 py-3">{formatRoomHo(dorm?.roomHo) || "-"}</td>
                        <td className="px-3 py-3">{dorm?.공동현관 || "-"}</td>
                        <td className="px-3 py-3">{dorm?.세대현관 || "-"}</td>
                        <td className="px-3 py-3">{dorm?.leaseStatus || "-"}</td>
                        <td className="px-3 py-3">{dorm?.contractEnd || "-"}</td>
                        <td className="px-3 py-3">{dorm ? daysDiff(dorm.contractEnd) : "-"}</td>
                        <td className="px-3 py-3">{users.find((u) => u.id === dorm?.managerUserId)?.displayName || "미지정"}</td>
                        <td className="px-3 py-3">{dorm ? (isCleaningMissing(dorm) ? "미보고" : "정상") : "-"}</td>
                        <td className="px-3 py-3">{getOpenDefectCount(dorm?.id || "")}</td>
                        <td className="px-3 py-3">{o.employeeName}</td>
                        <td className="px-3 py-3">
                          <span
                            className="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-300 dark:ring-slate-400 dark:text-white"
                            style={{ backgroundColor: badgeColor(theme, o.status) }}
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">{o.moveInDate || "-"}</td>
                        <td translate="no" className="px-3 py-3 notranslate">{o.department}</td>
                        <td className="px-3 py-3">{o.phone}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-2">
                            {/* 입주자 수정 기능 제외됨 */}
                            {canEditData(currentUser) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  softDeleteItem(occupants, setOccupants, o.id, "occupant");
                                }}
                                className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleOccupants.filter((o) => !selectedDormId || o.dormId === selectedDormId).length === 0 && (
                    <tr>
                      <td colSpan={20} className="px-4 py-12 text-center text-slate-400">
                        입주자 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedDetailDorm && (
              <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
                <div className={`${theme.darkMode ? "mx-auto max-w-5xl rounded-3xl bg-slate-950 p-6 shadow-2xl ring-1 ring-slate-200" : "mx-auto max-w-5xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"}`}>
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold">기숙사 상세보기</h3>
                      <p className="text-sm text-slate-500">{selectedDetailDorm.buildingName} {formatDong(selectedDetailDorm.dong)} {formatRoomHo(selectedDetailDorm.roomHo)}</p>
                    </div>
                    <button type="button" onClick={closeDormDetailModal} className={`${theme.darkMode ? "rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-950" : "rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}`}>닫기</button>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <h4 className="mb-3 text-base font-semibold">기본정보</h4>
                      <dl className={`${theme.darkMode ? "grid gap-2 text-sm text-slate-300 sm:grid-cols-2" : "grid gap-2 text-sm text-slate-700 sm:grid-cols-2"}`}>
                        <div><dt className="font-medium">지역</dt><dd>{selectedDetailDorm.site}</dd></div>
                        <div><dt className="font-medium">성별</dt><dd>{selectedDetailDorm.gender}</dd></div>
                        <div><dt className="font-medium">건물명</dt><dd>{selectedDetailDorm.buildingName}</dd></div>
                        <div><dt className="font-medium">동/호수</dt><dd>{`${formatDong(selectedDetailDorm.dong)} / ${formatRoomHo(selectedDetailDorm.roomHo)}`}</dd></div>
                        <div><dt className="font-medium">주소</dt><dd>{selectedDetailDorm.address}</dd></div>
                        <div><dt className="font-medium">평수</dt><dd>{selectedDetailDorm.pyeong}</dd></div>
                      </dl>
                    </div>
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <h4 className="mb-3 text-base font-semibold">계약정보</h4>
                      <dl className={`${theme.darkMode ? "grid gap-2 text-sm text-slate-300 sm:grid-cols-2" : "grid gap-2 text-sm text-slate-700 sm:grid-cols-2"}`}>
                        <div><dt className="font-medium">계약시작</dt><dd>{selectedDetailDorm.contractStart || "-"}</dd></div>
                        <div><dt className="font-medium">계약종료</dt><dd>{selectedDetailDorm.contractEnd || "-"}</dd></div>
                        <div><dt className="font-medium">만료 D-Day</dt><dd>{getDormDday(selectedDetailDorm)}</dd></div>
                        <div><dt className="font-medium">계약상태</dt><dd>{selectedDetailDorm.leaseStatus}</dd></div>
                        <div><dt className="font-medium">계약금액</dt><dd>{selectedDetailDorm.contractAmount || "-"}</dd></div>
                        <div><dt className="font-medium">부동산</dt><dd>{selectedDetailDorm.realEstateName || "-"}</dd></div>
                      </dl>
                    </div>
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <h4 className="mb-3 text-base font-semibold">운영정보</h4>
                      <dl className={`${theme.darkMode ? "grid gap-2 text-sm text-slate-300 sm:grid-cols-2" : "grid gap-2 text-sm text-slate-700 sm:grid-cols-2"}`}>
                        <div><dt className="font-medium">현재인원</dt><dd>{occupancyCountByDorm.get(selectedDetailDorm.id) || 0} / {selectedDetailDorm.capacity}</dd></div>
                        <div><dt className="font-medium">공실수</dt><dd>{Math.max(selectedDetailDorm.capacity - (occupancyCountByDorm.get(selectedDetailDorm.id) || 0), 0)}</dd></div>
                        <div><dt className="font-medium">청소상태</dt><dd>{isCleaningMissing(selectedDetailDorm) ? "미보고" : "정상"}</dd></div>
                        <div><dt className="font-medium">미처리 하자</dt><dd>{getOpenDefectCount(selectedDetailDorm.id)}</dd></div>
                        <div><dt className="font-medium">공동현관</dt><dd>{selectedDetailDorm.공동현관 || "-"}</dd></div>
                        <div><dt className="font-medium">세대현관</dt><dd>{selectedDetailDorm.세대현관 || "-"}</dd></div>
                      </dl>
                    </div>
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <h4 className="mb-3 text-base font-semibold">비품정보</h4>
                      <div className={`${theme.darkMode ? "space-y-2 text-sm text-slate-300" : "space-y-2 text-sm text-slate-700"}`}>
                        <div>총 비품수: {selectedDetailInventory.length}</div>
                        <div>정상: {selectedDetailInventory.filter((item) => item.status === "정상").length}</div>
                        <div>고장/노후: {selectedDetailInventory.filter((item) => ["고장", "노후"].includes(item.status)).length}</div>
                      </div>
                    </div>
                  </div>

                  <div className={`${theme.darkMode ? "mt-6 rounded-3xl border border-slate-700 p-4" : "mt-6 rounded-3xl border border-slate-200 p-4"}`}>
                    <h4 className="mb-4 text-base font-semibold">입주자 리스트</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm text-left">
                        <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                          <tr>
                            <th className="px-3 py-2">이름</th>
                            <th className="px-3 py-2">성별</th>
                            <th className="px-3 py-2">입실일</th>
                            <th className="px-3 py-2">상태</th>
                            <th className="px-3 py-2">부서</th>
                            <th className="px-3 py-2">연락처</th>
                            <th className="px-3 py-2">계약만료일</th>
                            <th className="px-3 py-2">남은일수</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetailOccupants.map((occupant) => (
                            <tr key={occupant.id} className={`${theme.darkMode ? "border-b border-slate-700" : "border-b border-slate-100"}`}>
                              <td className="px-3 py-3">{occupant.employeeName}</td>
                              <td className="px-3 py-3">{occupant.gender}</td>
                              <td className="px-3 py-3">{occupant.moveInDate || "-"}</td>
                              <td className="px-3 py-3">{occupant.status}</td>
                              <td translate="no" className="px-3 py-3 notranslate">{occupant.department}</td>
                              <td className="px-3 py-3">{occupant.phone}</td>
                              <td className="px-3 py-3">{occupant.moveOutDueDate || "-"}</td>
                              <td className="px-3 py-3">{daysBetween(occupant.moveInDate, occupant.moveOutDueDate)}</td>
                            </tr>
                          ))}
                          {selectedDetailOccupants.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                                선택된 기숙사에 입주자 정보가 없습니다.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 신입사원 일괄 배정 모달 */}
        {showNewHireAssignmentModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
            <div className={`${theme.darkMode ? "mx-auto max-w-4xl rounded-3xl bg-slate-950 p-6 shadow-2xl ring-1 ring-slate-200" : "mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"}`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">신입사원 일괄 배정</h3>
                  <p className="text-sm text-slate-500">기숙사를 선택한 후 미배정 신입사원을 배정합니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewHireAssignmentModal(false);
                    setSelectedDormForAssignment("");
                    setSelectedNewHiresForAssignment([]);
                    setAssignmentSiteFilter("전체");
                    setAssignmentGenderFilter("전체");
                    setAssignmentNewHireSearch("");
                  }}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-950" : "rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}`}
                >
                  닫기
                </button>
              </div>

              {/* 필터 및 검색 */}
              <div className="mb-6 flex flex-wrap items-center gap-4">
                <FilterSelect
                  label="지역"
                  value={assignmentSiteFilter}
                  onChange={(v) => {
                    setAssignmentSiteFilter(v as Site | "전체");
                    setSelectedDormForAssignment("");
                    setSelectedNewHiresForAssignment([]);
                  }}
                  options={["전체", "평택", "천안"]}
                />
                <FilterSelect
                  label="성별"
                  value={assignmentGenderFilter}
                  onChange={(v) => {
                    setAssignmentGenderFilter(v as "남" | "여" | "전체");
                    setSelectedDormForAssignment("");
                    setSelectedNewHiresForAssignment([]);
                  }}
                  options={["전체", "남", "여"]}
                />
                <div className="flex-1 min-w-64">
                  <input
                    type="text"
                    placeholder="신입사원 검색 (이름, 부서, 연락처)..."
                    value={assignmentNewHireSearch}
                    onChange={(e) => setAssignmentNewHireSearch(e.target.value)}
                    className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
                  />
                </div>
                <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                  표시 기숙사: {filteredDormsForAssignment.length}개 / 미배정 신입사원: {filteredUnassignedNewHires.length}명
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* 기숙사 선택 */}
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <h4 className="mb-3 text-base font-semibold">1. 기숙사 선택</h4>
                  <div className="space-y-3">
                    <div className="max-h-64 overflow-y-auto">
                      {filteredDormsForAssignment.map((dorm) => (
                          <button
                            key={dorm.id}
                            type="button"
                            onClick={() => setSelectedDormForAssignment(dorm.id)}
                            className={`w-full rounded-xl border p-3 text-left transition-colors ${
                              selectedDormForAssignment === dorm.id
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <div className="font-medium">{dorm.buildingName} {formatDong(dorm.dong)} {formatRoomHo(dorm.roomHo)}</div>
                            <div className="text-sm text-slate-500">{dorm.site} · {dorm.gender} · 정원 {dorm.capacity}명</div>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                {/* 신입사원 선택 */}
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <h4 className="mb-3 text-base font-semibold">2. 신입사원 선택</h4>
                  {selectedDormForAssignment ? (
                    <div className="space-y-3">
                      <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                        선택된 기숙사: {operationalDorms.find(d => d.id === selectedDormForAssignment)?.buildingName}
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {filteredUnassignedNewHires.map((hire) => (
                            <label key={hire.id} className={`${theme.darkMode ? "flex items-center gap-3 rounded-xl border border-slate-700 p-3 hover:bg-slate-950" : "flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"}`}>
                              <input
                                type="checkbox"
                                checked={selectedNewHiresForAssignment.includes(hire.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedNewHiresForAssignment(prev => [...prev, hire.id]);
                                  } else {
                                    setSelectedNewHiresForAssignment(prev => prev.filter(id => id !== hire.id));
                                  }
                                }}
                                className="rounded"
                              />
                              <div className="flex-1">
                                <div className="font-medium">{hire.name}</div>
                                <div translate="no" className="text-sm text-slate-500 notranslate">{hire.department} · {hire.phone}</div>
                              </div>
                            </label>
                          ))}
                        {filteredUnassignedNewHires.length === 0 && (
                          <div className="text-center text-slate-400 py-4">
                            해당 필터에 맞는 미배정 신입사원이 없습니다.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-slate-400 py-8">
                      기숙사를 먼저 선택해주세요.
                    </div>
                  )}
                </div>
              </div>

              {/* 배정 버튼 */}
              {selectedDormForAssignment && selectedNewHiresForAssignment.length > 0 && (
                <div className={`${theme.darkMode ? "mt-6 rounded-3xl border border-slate-700 p-4" : "mt-6 rounded-3xl border border-slate-200 p-4"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">선택 인원: {selectedNewHiresForAssignment.length}명</div>
                      <div className="text-sm text-slate-500">
                        {(() => {
                          const selectedDorm = operationalDorms.find(d => d.id === selectedDormForAssignment);
                          const currentOccupants = occupants.filter(o => o.dormId === selectedDormForAssignment && !o.isDeleted && ["거주중", "만료예정", "신규입주"].includes(o.status)).length;
                          const totalAfter = currentOccupants + selectedNewHiresForAssignment.length;
                          const capacity = selectedDorm?.capacity || 6;
                          return `현재 ${currentOccupants}명 거주 중 / 정원 ${capacity}명 → 배정 후 ${totalAfter}명`;
                        })()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const selectedDorm = operationalDorms.find(d => d.id === selectedDormForAssignment);
                        if (!selectedDorm) return;

                        const currentOccupants = occupants.filter(o => o.dormId === selectedDorm.id && !o.isDeleted && ["거주중", "만료예정", "신규입주"].includes(o.status)).length;
                        const capacity = selectedDorm.capacity || 6;
                        const totalAfter = currentOccupants + selectedNewHiresForAssignment.length;

                        if (totalAfter > capacity) {
                          if (!confirm(`현재 ${currentOccupants}명 거주 중 / 정원 ${capacity}명입니다. ${selectedNewHiresForAssignment.length}명을 배정하면 정원을 초과합니다. 그래도 배정하시겠습니까?`)) {
                            return;
                          }
                        }

                        // 신입사원 배정 처리
                        const updatedNewHires = newHires.map(h => {
                          if (selectedNewHiresForAssignment.includes(h.id)) {
                            return {
                              ...h,
                              dormId: selectedDorm.id,
                              site: selectedDorm.site,
                              address: selectedDorm.address,
                              buildingName: selectedDorm.buildingName,
                              dong: selectedDorm.dong,
                              roomHo: selectedDorm.roomHo,
                              공동현관: selectedDorm.공동현관,
                              세대현관: selectedDorm.세대현관,
                              residenceStatus: (h.moveInDate ? "거주중" : "대기중") as NewHireResidenceStatus,
                              moveInType: "신규" as MoveInType,
                              updatedAt: new Date().toISOString(),
                            };
                          }
                          return h;
                        });

                        // occupants에 추가/업데이트
                        const newOccupants = selectedNewHiresForAssignment
                          .map(hireId => {
                            const hire = updatedNewHires.find(h => h.id === hireId);
                            if (!hire) return null;

                            // 이미 존재하는 occupant 확인
                            const existingOccupant = occupants.find(o => o.sourceNewHireId === hire.id);
                            if (existingOccupant) {
                              // 업데이트
                              return {
                                ...existingOccupant,
                                dormId: selectedDorm.id,
                                site: selectedDorm.site,
                                employeeName: hire.name,
                                gender: hire.gender,
                                department: hire.department,
                                phone: hire.phone,
                                moveInDate: hire.moveInDate,
                                moveOutDueDate: hire.moveOutDate,
                                status: hire.residenceStatus as Occupant["status"],
                                address: selectedDorm.address,
                                buildingName: selectedDorm.buildingName,
                                dong: selectedDorm.dong,
                                roomHo: selectedDorm.roomHo,
                                공동현관: selectedDorm.공동현관,
                                세대현관: selectedDorm.세대현관,
                                updatedAt: new Date().toISOString(),
                              };
                            } else {
                              // 새로 생성
                              return {
                                id: `occupant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                dormId: selectedDorm.id,
                                site: selectedDorm.site,
                                employeeName: hire.name,
                                gender: hire.gender,
                                department: hire.department,
                                phone: hire.phone,
                                moveInDate: hire.moveInDate,
                                moveOutDueDate: hire.moveOutDate,
                                status: hire.residenceStatus as Occupant["status"],
                                isNewHireAssignment: true,
                                notes: "",
                                address: selectedDorm.address,
                                buildingName: selectedDorm.buildingName,
                                dong: selectedDorm.dong,
                                roomHo: selectedDorm.roomHo,
                                공동현관: selectedDorm.공동현관,
                                세대현관: selectedDorm.세대현관,
                                sourceNewHireId: hire.id,
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                              } as Occupant;
                            }
                          })
                          .filter(Boolean) as Occupant[];

                        // 상태 업데이트
                        setNewHires(updatedNewHires);
                        setOccupants(prev => {
                          // 기존 occupant 업데이트
                          const updated = prev.map(o => {
                            const newOccupant = newOccupants.find(no => no.sourceNewHireId === o.sourceNewHireId);
                            return newOccupant || o;
                          });
                          // 새 occupant 추가
                          const toAdd = newOccupants.filter(no => !updated.find(o => o.sourceNewHireId === no.sourceNewHireId));
                          return [...updated, ...toAdd];
                        });

                        // 모달 닫기
                        setShowNewHireAssignmentModal(false);
                        setSelectedDormForAssignment("");
                        setSelectedNewHiresForAssignment([]);

                        // 로컬스토리지 저장
                        saveJson(NEW_HIRES_KEY, updatedNewHires, tenantId);
                        saveJson(OCCUPANTS_KEY, [
                          ...occupants.map(o => {
                            const newOccupant = newOccupants.find(no => no.sourceNewHireId === o.sourceNewHireId);
                            return newOccupant || o;
                          }),
                          ...newOccupants.filter(no => !occupants.find(o => o.sourceNewHireId === no.sourceNewHireId))
                        ], tenantId);
                      }}
                      className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500"
                    >
                      선택 인원 배정
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showExpiringDormsModal && modalWrap(
          "계약 만료 예정 목록",
          <div className="overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">지역</th>
                  <th className="px-3 py-2">기숙사</th>
                  <th className="px-3 py-2">주소</th>
                  <th className="px-3 py-2">만료일</th>
                  <th className="px-3 py-2">D-Day</th>
                  <th className="px-3 py-2">작업</th>
                </tr>
              </thead>
              <tbody>
                {expiringDormsTop10.map((d, idx) => (
                  <tr key={d.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                    <td className="px-3 py-3">{idx + 1}</td>
                    <td className="px-3 py-3">{d.site}</td>
                    <td className="px-3 py-3">{d.buildingName}</td>
                    <td className="px-3 py-3">{`${d.address} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`}</td>
                    <td className="px-3 py-3">{d.contractEnd || "-"}</td>
                    <td className="px-3 py-3">{daysDiff(d.contractEnd)}</td>
                    <td className="px-3 py-3">
                      <button className="text-blue-600 text-sm" onClick={() => { const contract = dormContracts.find(c => matchDormKey(c.site, c.buildingName, c.dong, c.roomHo) === matchDormKey(d.site, d.buildingName, d.dong, d.roomHo)); if (contract) openDormContractEdit(contract); }}>수정</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          () => setShowExpiringDormsModal(false),
          () => {},
          "bg-blue-600",
          true
        )}

        {showUnassignedNewHiresModal && modalWrap(
          "미배정 신입사원 목록",
          <div className="overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">이름</th>
                  <th className="px-3 py-2">부서</th>
                  <th className="px-3 py-2">예정입실일</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">작업</th>
                </tr>
              </thead>
              <tbody>
                {newHires.filter(h => !h.dormId && !h.isDeleted).map((h, idx) => (
                  <tr key={h.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                    <td className="px-3 py-3">{idx + 1}</td>
                    <td className="px-3 py-3">{h.name}</td>
                    <td className="px-3 py-3">{h.department}</td>
                    <td className="px-3 py-3">{h.expectedMoveInDate || "-"}</td>
                    <td className="px-3 py-3">{h.residenceStatus}</td>
                    <td className="px-3 py-3">
                      <button className="text-blue-600 text-sm mr-3" onClick={() => { setAssigningNewHireId(h.id); setShowAssignDormForNewHire(true); }}>배정</button>
                      <button className="text-slate-700 text-sm" onClick={() => openNewHireEdit(h)}>수정</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          () => setShowUnassignedNewHiresModal(false),
          () => {},
          "bg-green-600",
          true
        )}

        {/* 변경이력 모달 */}
        {showAuditLogModal && selectedAuditLogId && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
            <div className={`${theme.darkMode ? "mx-auto max-w-4xl rounded-3xl bg-slate-950 p-6 shadow-2xl ring-1 ring-slate-200" : "mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"}`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">변경 이력 상세</h3>
                  <p className="text-sm text-slate-500">변경된 필드를 확인하고 필요시 복구할 수 있습니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAuditLogModal(false);
                    setSelectedAuditLogId(null);
                  }}
                  className={`${theme.darkMode ? "rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-950" : "rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}`}
                >
                  닫기
                </button>
              </div>

              {auditLogs.find((log) => log.id === selectedAuditLogId) && (
                <div className="space-y-4">
                  {(() => {
                    const log = auditLogs.find((l) => l.id === selectedAuditLogId)!;
                    let changedFields: Array<{ field: string; label: string; beforeValue: string; afterValue: string }> = [];
                    try {
                      const before = log.beforeValue ? JSON.parse(log.beforeValue) : {};
                      const after = log.afterValue ? JSON.parse(log.afterValue) : {};
                      changedFields = getChangedFields(before, after);
                    } catch (e) {
                      changedFields = [];
                    }

                    return (
                      <>
                        {/* 메타 정보 */}
                        <div className={`${theme.darkMode ? "grid gap-2 rounded-2xl bg-slate-950 p-4 sm:grid-cols-2 md:grid-cols-5" : "grid gap-2 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 md:grid-cols-5"}`}>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">대상</div>
                            <div className={`${theme.darkMode ? "mt-1 text-sm font-medium text-slate-100" : "mt-1 text-sm font-medium text-slate-900"}`}>{getAuditTargetLabel(log.targetType)}</div>
                            <div className={`${theme.darkMode ? "text-xs text-slate-400" : "text-xs text-slate-500"}`}>{getAuditTargetName(log)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">작업</div>
                            <div className={`${theme.darkMode ? "mt-1 text-sm font-medium text-slate-100" : "mt-1 text-sm font-medium text-slate-900"}`}>{log.actionType === "restore" ? "복구" : log.actionType === "create" ? "생성" : log.actionType === "update" ? "수정" : log.actionType === "delete" ? "삭제" : log.actionType}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">변경자</div>
                            <div className={`${theme.darkMode ? "mt-1 text-sm font-medium text-slate-100" : "mt-1 text-sm font-medium text-slate-900"}`}>{log.changedBy}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">변경 시간</div>
                            <div className={`${theme.darkMode ? "mt-1 text-sm font-medium text-slate-100" : "mt-1 text-sm font-medium text-slate-900"}`}>{new Date(log.changedAt).toLocaleString("ko-KR")}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">변경 필드</div>
                            <div className={`${theme.darkMode ? "mt-1 text-sm font-medium text-slate-100" : "mt-1 text-sm font-medium text-slate-900"}`}>{changedFields.length}개</div>
                          </div>
                        </div>

                        {log.memo && (
                          <div className="rounded-2xl bg-blue-50 p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">메모</div>
                            <div className="mt-1 text-sm text-blue-900">{log.memo}</div>
                          </div>
                        )}

                        {/* 필드 비교표 */}
                        <div>
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>변경된 필드</h4>
                            <button
                              type="button"
                              onClick={() => setShowRawJson(!showRawJson)}
                              className={`${theme.darkMode ? "rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-950" : "rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"}`}
                            >
                              {showRawJson ? "▼ 원본 JSON" : "▶ 원본 JSON"}
                            </button>
                          </div>
                          
                          {changedFields.length > 0 ? (
                            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 overflow-hidden" : "rounded-2xl border border-slate-200 overflow-hidden"}`}>
                              <table className="w-full text-sm">
                                <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                                  <tr>
                                    <th className={`${theme.darkMode ? "px-4 py-2 text-left font-semibold text-slate-300" : "px-4 py-2 text-left font-semibold text-slate-700"}`}>필드명</th>
                                    <th className={`${theme.darkMode ? "px-4 py-2 text-left font-semibold text-slate-300" : "px-4 py-2 text-left font-semibold text-slate-700"}`}>이전값</th>
                                    <th className={`${theme.darkMode ? "px-4 py-2 text-left font-semibold text-slate-300" : "px-4 py-2 text-left font-semibold text-slate-700"}`}>변경값</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {changedFields.map((change, idx) => {
                                    const beforeDisplay = getAuditDisplayValue(change.field, change.beforeValue);
                                    const afterDisplay = getAuditDisplayValue(change.field, change.afterValue);
                                    return (
                                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                        <td className={`${theme.darkMode ? "px-4 py-3 font-medium text-slate-100" : "px-4 py-3 font-medium text-slate-900"}`}>{getAuditFieldLabel(change.field)}</td>
                                        <td className={`${theme.darkMode ? "px-4 py-3 text-slate-300 max-w-xs overflow-hidden text-ellipsis" : "px-4 py-3 text-slate-600 max-w-xs overflow-hidden text-ellipsis"}`} title={beforeDisplay}>
                                          <span className="line-clamp-2">{beforeDisplay}</span>
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-emerald-700 bg-emerald-50 max-w-xs overflow-hidden text-ellipsis" title={afterDisplay}>
                                          <span className="line-clamp-2">{afterDisplay}</span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 bg-slate-950 p-4 text-center text-slate-500" : "rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-slate-500"}`}>
                              변경된 항목이 없습니다.
                            </div>
                          )}
                        </div>

                        {/* 원본 JSON 보기 */}
                        {showRawJson && (
                          <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                            <div className="mb-3 grid gap-2 md:grid-cols-2">
                              <div>
                                <div className={`${theme.darkMode ? "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300" : "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600"}`}>이전값 (JSON)</div>
                                <div className={`${theme.darkMode ? "max-h-48 overflow-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-100 font-mono border border-slate-700" : "max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs text-slate-900 font-mono border border-slate-200"}`}>
                                  <pre className="whitespace-pre-wrap break-words">{log.beforeValue}</pre>
                                </div>
                              </div>
                              <div>
                                <div className={`${theme.darkMode ? "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300" : "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600"}`}>변경값 (JSON)</div>
                                <div className={`${theme.darkMode ? "max-h-48 overflow-auto rounded-lg bg-slate-950 p-2 text-xs text-slate-100 font-mono border border-slate-700" : "max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs text-slate-900 font-mono border border-slate-200"}`}>
                                  <pre className="whitespace-pre-wrap break-words">{log.afterValue}</pre>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 복구 버튼 */}
                        <div className="flex gap-2 pt-2">
                          {canEditData(currentUser) ? (
                            <button
                              type="button"
                              onClick={() => selectedAuditLogId && restoreFromAuditLog(selectedAuditLogId)}
                              className="flex-1 rounded-2xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-500 transition"
                            >
                              이전값으로 복구
                            </button>
                          ) : (
                            <div className={`${theme.darkMode ? "flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-500" : "flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500"}`}>
                              관리자 권한이 있어야 복구할 수 있습니다.
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "simulation" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">월별 운영 시뮬레이션</h2>
                <p className="text-sm text-slate-500">선택한 년/월 기준으로 운영 현황과 수요를 확인합니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className={`${theme.darkMode ? "flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2" : "flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"}`}>
                  <span className="text-sm text-slate-500">기준년</span>
                  <select
                    value={simulationYear}
                    onChange={(e) => setSimulationYear(e.target.value)}
                    className={`rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                  >
                    {Array.from({ length: 5 }, (_, idx) => String(2023 + idx)).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div className={`${theme.darkMode ? "flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2" : "flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"}`}>
                  <span className="text-sm text-slate-500">월</span>
                  <select
                    value={simulationMonth}
                    onChange={(e) => setSimulationMonth(e.target.value)}
                    className={`rounded-2xl border px-3 py-2 text-sm outline-none focus:border-slate-400 ${theme.darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                  >
                    {Array.from({ length: 12 }, (_, idx) => String(idx + 1).padStart(2, "0")).map((month) => (
                      <option key={month} value={month}>{month}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    const data = simulationMonthlyStats.map((s) => ({
                      지역: s.site,
                      성별: s.gender,
                      월: s.month,
                      기숙사수: s.dormCount,
                      거주자TO: s.residentTo,
                      현거주자: s.currentResidents,
                      만료자: s.expiredResidents,
                      중도퇴거: s.earlyDepartures,
                      천안이동: s.cheonanMove,
                      신규입주: s.newMoveIn,
                      과부족: s.shortage,
                      임차만기: s.expireBuildings,
                      해지: s.terminated,
                      추가임차: s.addLease,
                    }));
                    const ws = XLSX.utils.json_to_sheet(data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "운영시뮬레이션");
                    XLSX.writeFile(wb, `운영시뮬레이션_${simulationYear}년.xlsx`);
                  }}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  엑셀 다운로드
                </button>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
              <MiniStat label="남자 총원" value={String(simulationTotal.maleCount)} />
              <MiniStat label="여자 총원" value={String(simulationTotal.femaleCount)} />
              <MiniStat label="입주율" value={`${simulationTotal.usageRate}%`} />
              <MiniStat label="공실률" value={`${simulationTotal.vacancyRate}%`} />
              <MiniStat label="전체 TO" value={String(simulationTotal.residentTo)} />
              <MiniStat label="월 예상 운영비" value={`${simulationTotal.totalOperatingCost.toLocaleString()}원`} />
              <MiniStat label="공실 손실 추정" value={`${simulationTotal.totalVacancyLoss.toLocaleString()}원`} />
              <MiniStat label="계약 만료 위험" value={String(simulationTotal.totalExpireRisk)} />
              <MiniStat label="평택 부족 TO" value={String(simulationTotal.siteShortage.평택)} />
              <MiniStat label="천안 부족 TO" value={String(simulationTotal.siteShortage.천안)} />
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FilterSelect label="지역" value={simulationSiteFilter} onChange={(v) => setSimulationSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} />
                <FilterSelect label="성별" value={simulationGenderFilter} onChange={(v) => setSimulationGenderFilter(v as "남" | "여" | "전체")} options={["전체", "남", "여"]} />
              </div>
              <input
                type="text"
                placeholder="검색..."
                value={simulationSearch}
                onChange={(e) => setSimulationSearch(e.target.value)}
                className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
              />
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1400px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3">구분</th>
                    <th className="px-3 py-3">기숙사수</th>
                    <th className="px-3 py-3">거주자(TO)</th>
                    <th className="px-3 py-3">현 거주자</th>
                    <th className="px-3 py-3">만료자</th>
                    <th className="px-3 py-3">중도퇴거</th>
                    <th className="px-3 py-3">천안이동</th>
                    <th className="px-3 py-3">신규입주</th>
                    <th className="px-3 py-3">과부족</th>
                    <th className="px-3 py-3">임차만기</th>
                    <th className="px-3 py-3">해지</th>
                    <th className="px-3 py-3">추가임차</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSimulationRows.map((r) => (
                    <tr key={r.key} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                      <td className="px-3 py-3 font-medium">{r.site} ({r.gender})</td>
                      <td className="px-3 py-3">{r.dormCount}</td>
                      <td className="px-3 py-3">{r.residentTo}</td>
                      <td className="px-3 py-3">{r.currentResidents}</td>
                      <td className="px-3 py-3">{r.expiredResidents}</td>
                      <td className="px-3 py-3">{r.earlyDepartures}</td>
                      <td className="px-3 py-3">{r.cheonanMove}</td>
                      <td className="px-3 py-3">{r.newMoveIn}</td>
                      <td className="px-3 py-3">{r.shortage}</td>
                      <td className="px-3 py-3">{r.expireBuildings}</td>
                      <td className="px-3 py-3">{r.terminated}</td>
                      <td className="px-3 py-3">{r.addLease}</td>
                    </tr>
                  ))}
                  {visibleSimulationRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-12 text-center text-slate-400">검색 조건에 맞는 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const data = visibleSimulationRows.map((r) => ({
                    지역: r.site,
                    성별: r.gender,
                    기숙사수: r.dormCount,
                    거주자TO: r.residentTo,
                    현거주자: r.currentResidents,
                    만료자: r.expiredResidents,
                    중도퇴거: r.earlyDepartures,
                    천안이동: r.cheonanMove,
                    신규입주: r.newMoveIn,
                    과부족: r.shortage,
                    임차만기: r.expireBuildings,
                    해지: r.terminated,
                    추가임차: r.addLease,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "지역별상세통계");
                  XLSX.writeFile(wb, `지역별상세통계_${simulationYear}년_${simulationMonth}월.xlsx`);
                }}
                className={`${theme.darkMode ? "inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-200" : "inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"}`}
              >
                <Download className="h-4 w-4" /> 지역별 통계 다운로드
              </button>
            </div>
          </section>
        )}

        {activeTab === "inventory" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사별 비품현황</h2>
                <p className="text-sm text-slate-500">관리자명, 계약일, 만료일, 주소, 비품명, 수량, 모델, 메이커, 구매액, 지급일, 매각일, 비고</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setInventorySubTab("status")}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${inventorySubTab === "status" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  비품현황
                </button>
                <button
                  type="button"
                  onClick={() => setInventorySubTab("manage")}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${inventorySubTab === "manage" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  비품 등록/수정
                </button>
                <button
                  type="button"
                  onClick={() => setInventorySubTab("history")}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${inventorySubTab === "history" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  구매/매각/폐기 이력
                </button>
              </div>
            </div>
            <div className="mb-4 grid gap-4 md:grid-cols-3">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">저수량 알림</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventoryAlerts.lowStock}</div>
                <div className="mt-2 text-sm text-slate-500">수량 2개 이하 품목</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">비품 고장/노후</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventoryAlerts.expiringSoon}</div>
                <div className="mt-2 text-sm text-slate-500">고장 또는 노후 품목</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">총 등록 품목</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventory.length}</div>
                <div className="mt-2 text-sm text-slate-500">전체 비품 수</div>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <DateFilter label="구매일" yearValue={inventoryYearFilter} monthValue={inventoryMonthFilter} dayValue={inventoryDayFilter} onYearChange={setInventoryYearFilter} onMonthChange={setInventoryMonthFilter} onDayChange={setInventoryDayFilter} />
              <input
                type="text"
                placeholder="검색..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
              />
              {canEditData(currentUser) && selectedInventoryIds.length > 0 && (
                <button
                  onClick={() => {
                    setInventory((prev) => prev.filter((i) => !selectedInventoryIds.includes(i.id)));
                    setSelectedInventoryIds([]);
                  }}
                  className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                >
                  선택 삭제
                </button>
              )}
              {canEditData(currentUser) && (
                <button
                  onClick={() => {
                    setInventoryForm(inventoryTemplate());
                    setEditingInventoryId(null);
                    setShowInventoryForm(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"
                >
                  <Plus className="h-4 w-4" /> 비품 추가
                </button>
              )}
            </div>
            {inventorySubTab === "status" && (
              <div className={`${theme.darkMode ? "mb-4 rounded-3xl border border-slate-700 bg-slate-950 p-4" : "mb-4 rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기숙사별 비품 현황</div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(inventoryByDorm).map(([dormId, data]) => (
                    <div key={dormId} className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                      <div className={`font-medium text-sm ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{data.dormName}</div>
                      <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>총 등록: {data.itemCount}개 · 현재 보유: {data.currentItems}개</div>
                      <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>총 구매액: {formatNumber(data.totalAmount)}원</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {inventorySubTab === "history" ? (
              <div className="grid gap-4 xl:grid-cols-3">
                <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">등록된 비품 항목</div>
                  <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventory.length}</div>
                </div>
                <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">총 구매액</div>
                  <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{formatNumber(inventory.reduce((sum, item) => sum + item.purchaseAmount, 0))}원</div>
                </div>
                <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">최근 기록</div>
                  <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventory.slice(-1)[0]?.issuedDate || "-"}</div>
                </div>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[1500px] text-sm text-center">
                  <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                    <tr>
                      <th className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={visibleInventory.length > 0 && selectedInventoryIds.length === visibleInventory.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedInventoryIds(visibleInventory.map((i) => i.id));
                            else setSelectedInventoryIds([]);
                          }}
                          className="h-5 w-5"
                        />
                      </th>
                      <th className="px-3 py-2">구분</th>
                      <th className="px-3 py-2">지역</th>
                      <th className="px-3 py-2">건물명</th>
                      <th className="px-3 py-2">관리자명</th>
                      <th className="px-3 py-2">구매일</th>
                      <th className="px-3 py-2">구매일</th>
                      <th className="px-3 py-2">기숙사 주소</th>
                      <th className="px-3 py-2">비품명</th>
                      <th className="px-3 py-2">수량</th>
                      <th className="px-3 py-2">모델명</th>
                      <th className="px-3 py-2">메이커</th>
                      <th className="px-3 py-2">구매액</th>
                      <th className="px-3 py-2">지급일</th>
                      <th className="px-3 py-2">매각일</th>
                      <th className="px-3 py-2">비고</th>
                      <th className="px-3 py-2">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInventory.map((i, index) => (
                      <tr
                        key={i.id}
                        onClick={(e) => handleRowClick(e, () => openInventoryEdit(i))}
                        className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedInventoryIds.includes(i.id)}
                            onChange={(e) =>
                              e.target.checked
                                ? setSelectedInventoryIds((prev) => [...prev, i.id])
                                : setSelectedInventoryIds((prev) => prev.filter((id) => id !== i.id))
                            }
                            className="h-5 w-5"
                          />
                        </td>
                        <td className="px-3 py-3 font-medium">{index + 1}</td>
                        <td className="px-3 py-3">{i.site}</td>
                        <td className="px-3 py-3">{i.buildingName} {i.dong}-{i.roomHo}</td>
                        <td className="px-3 py-3">{i.managerName}</td>
                        <td className="px-3 py-3">{i.purchaseDate}</td>
                        <td className="px-3 py-3">{i.purchaseDate}</td>
                        <td className="px-3 py-3">{i.dormAddress}</td>
                        <td className="px-3 py-3">{i.itemName}</td>
                        <td className="px-3 py-3">{i.quantity}</td>
                        <td className="px-3 py-3">{i.modelName}</td>
                        <td className="px-3 py-3">{i.maker}</td>
                        <td className="px-3 py-3">{formatNumber(i.purchaseAmount)}</td>
                        <td className="px-3 py-3">{i.issuedDate}</td>
                        <td className="px-3 py-3">{i.soldDate || "-"}</td>
                        <td className="px-3 py-3">{i.notes}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-2">
                            {canEditData(currentUser) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openInventoryEdit(i);
                                }}
                                className={`${theme.darkMode ? "rounded-xl border border-slate-600 p-2 hover:bg-slate-950" : "rounded-xl border border-slate-300 p-2 hover:bg-slate-50"}`}
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {canEditData(currentUser) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  softDeleteItem(inventory, setInventory, i.id, "inventory");
                                }}
                                className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleInventory.length === 0 && (
                      <tr>
                        <td colSpan={15} className="px-4 py-12 text-center text-slate-400">
                          비품 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "leases" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">날짜별 신규계약 현황</h2><p className="text-sm text-slate-500">주소명, 동/호수, 평수, 계약금액, 계약기간, 계약일, 선납계약금, 부동산명, 참고사항, 잔금일</p></div></div>
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <MiniStat label="계약 건수" value={`${visibleLeases.length}`} />
              <MiniStat label="총 계약 금액" value={`${formatNumber(visibleLeases.reduce((sum, l) => sum + Number(l.contractAmount), 0))}원`} />
              <MiniStat label="평균 계약 금액" value={`${visibleLeases.length > 0 ? formatNumber(Math.round(visibleLeases.reduce((sum, l) => sum + Number(l.contractAmount), 0) / visibleLeases.length)) : 0}원`} />
            </div>
            <div className="mb-6 flex flex-wrap gap-2 items-center justify-between"><div className="flex items-center gap-2 flex-wrap"><DateFilter label="계약일" yearValue={leaseYearFilter} monthValue={leaseMonthFilter} dayValue={leaseDayFilter} onYearChange={setLeaseYearFilter} onMonthChange={setLeaseMonthFilter} onDayChange={setLeaseDayFilter} /><input type="text" placeholder="검색..." value={leaseSearch} onChange={(e) => setLeaseSearch(e.target.value)} className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`} /></div><div className="flex items-center gap-2">{canEditData(currentUser) && selectedLeaseIds.length > 0 && (<button onClick={() => { setLeases((prev) => prev.filter((l) => !selectedLeaseIds.includes(l.id))); setSelectedLeaseIds([]); }} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">선택 삭제</button>)}{canEditData(currentUser) && <button onClick={() => { setLeaseForm(leaseTemplate()); setEditingLeaseId(null); setShowLeaseForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="h-4 w-4" /> 신규계약 추가</button>}</div></div>
            <div className="overflow-auto"><table className="w-full min-w-[1300px] text-sm text-center"><thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}><tr><th className="px-3 py-2"><input type="checkbox" checked={visibleLeases.length > 0 && selectedLeaseIds.length === visibleLeases.length} onChange={(e) => { if (e.target.checked) setSelectedLeaseIds(visibleLeases.map((l) => l.id)); else setSelectedLeaseIds([]); }} className="h-5 w-5" /></th><th className="px-3 py-2">구분</th><th className="px-3 py-2">계약일</th><th className="px-3 py-2">주소명</th><th className="px-3 py-2">동</th><th className="px-3 py-2">호수</th><th className="px-3 py-2">평수</th><th className="px-3 py-2">계약금액</th><th className="px-3 py-2">계약기간</th><th className="px-3 py-2">선납계약금</th><th className="px-3 py-2">부동산명</th><th className="px-3 py-2">잔금일</th><th className="px-3 py-2">참고사항</th><th className="px-3 py-2">작업</th></tr></thead><tbody>{visibleLeases.map((l, index) => (
                    <tr
                      key={l.id}
                      onClick={(e) => handleRowClick(e, () => openLeaseEdit(l))}
                      className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedLeaseIds.includes(l.id)}
                          onChange={(e) =>
                            e.target.checked
                              ? setSelectedLeaseIds((prev) => [...prev, l.id])
                              : setSelectedLeaseIds((prev) => prev.filter((id) => id !== l.id))
                          }
                          className="h-5 w-5"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">{index + 1}</td>
                      <td className="px-3 py-3">{l.contractDate}</td>
                      <td className="px-3 py-3">{l.addressName}</td>
                      <td className="px-3 py-3">{l.dong}</td>
                      <td className="px-3 py-3">{l.ho}</td>
                      <td className="px-3 py-3">{l.pyeong}</td>
                      <td className="px-3 py-3">{l.contractAmount}</td>
                      <td className="px-3 py-3">{l.contractPeriod}</td>
                      <td className="px-3 py-3">{formatNumber(l.prepaymentDeposit)}</td>
                      <td className="px-3 py-3">{l.realEstateName}</td>
                      <td className="px-3 py-3">{l.balanceDate}</td>
                      <td className="px-3 py-3">{l.notes}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openLeaseEdit(l);
                              }}
                              className={`${theme.darkMode ? "rounded-xl border border-slate-600 p-2 hover:bg-slate-950" : "rounded-xl border border-slate-300 p-2 hover:bg-slate-50"}`}
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                softDeleteItem(leases, setLeases, l.id, "lease");
                              }}
                              className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}{visibleLeases.length === 0 && <tr><td colSpan={14} className="px-4 py-12 text-center text-slate-400">신규계약 데이터가 없습니다.</td></tr>}</tbody></table></div>
          </section>
        )}

        {activeTab === "sales" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">비품매각 현황</h2>
                <p className="text-sm text-slate-500">일자, 품목, 단가, 수량, 합계, 매각업체, 비고</p>
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <Input label="연도" value={saleYear} onChange={(v) => setSaleYear(v)} placeholder="YYYY" />
              <Input label="월" value={saleMonth} onChange={(v) => setSaleMonth(v)} placeholder="MM" />
              <Input label="검색" value={saleSearch} onChange={(v) => setSaleSearch(v)} placeholder="품목/업체명 검색" />
              <div className="flex items-end justify-end gap-2">
                {canEditData(currentUser) && (
                  <button
                    onClick={() => {
                      setSaleForm(saleTemplate());
                      setEditingSaleId(null);
                      setShowSaleForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white h-11"
                  >
                    <Plus className="h-4 w-4" /> 매각 등록
                  </button>
                )}
                {canEditData(currentUser) && selectedSaleIds.length > 0 && (
                  <button
                    onClick={() => {
                      setSales((prev) => prev.filter((s) => !selectedSaleIds.includes(s.id)));
                      setSelectedSaleIds([]);
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 h-11"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-3">
              <MiniStat label="매각 건수" value={`${visibleSales.length}`} />
              <MiniStat label="총 매각 금액" value={`${formatNumber(visibleSales.reduce((sum, s) => sum + s.totalAmount, 0))}원`} />
              <MiniStat label="평균 단가" value={`${visibleSales.length > 0 ? formatNumber(Math.round(visibleSales.reduce((sum, s) => sum + s.unitPrice, 0) / visibleSales.length)) : 0}원`} />
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1000px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2"><input type="checkbox" checked={visibleSales.length > 0 && selectedSaleIds.length === visibleSales.length} onChange={(e) => { if (e.target.checked) setSelectedSaleIds(visibleSales.map((s) => s.id)); else setSelectedSaleIds([]); }} className="h-5 w-5" /></th>
                    <th className="px-3 py-2">구분</th>
                    <th className="px-3 py-2">일자</th>
                    <th className="px-3 py-2">품목</th>
                    <th className="px-3 py-2">단가</th>
                    <th className="px-3 py-2">수량</th>
                    <th className="px-3 py-2">합계</th>
                    <th className="px-3 py-2">매각업체</th>
                    <th className="px-3 py-2">비고</th>
                    <th className="px-3 py-2">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSales.map((s, index) => (
                    <tr
                      key={s.id}
                      onClick={(e) => handleRowClick(e, () => openSaleEdit(s))}
                      className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedSaleIds.includes(s.id)}
                          onChange={(e) =>
                            e.target.checked
                              ? setSelectedSaleIds((prev) => [...prev, s.id])
                              : setSelectedSaleIds((prev) => prev.filter((id) => id !== s.id))
                          }
                          className="h-5 w-5"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">{index + 1}</td>
                      <td className="px-3 py-3">{s.saleDate}</td>
                      <td className="px-3 py-3">{s.itemName}</td>
                      <td className="px-3 py-3">{formatNumber(s.unitPrice)}</td>
                      <td className="px-3 py-3">{s.quantity}</td>
                      <td className="px-3 py-3">{formatNumber(s.totalAmount)}</td>
                      <td className="px-3 py-3">{s.buyerCompany}</td>
                      <td className="px-3 py-3">{s.notes || "-"}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openSaleEdit(s);
                              }}
                              className={`${theme.darkMode ? "rounded-xl border border-slate-600 p-2 hover:bg-slate-950" : "rounded-xl border border-slate-300 p-2 hover:bg-slate-50"}`}
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteById(setSales, s.id);
                              }}
                              className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleSales.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                        매각 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "settlementManagement" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">정산 관리</h2>
                <p className="text-sm text-slate-500">기숙사별 수입과 비용을 통합 관리하고 정산을 완료합니다.</p>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-6">
              <Input
                label="연도"
                value={settlementYear}
                onChange={(v) => setSettlementYear(v.replace(/\D/g, "").slice(0, 4))}
                onBlur={() => setSettlementYear(getValidSettlementYear(settlementYear) || currentSettlementYear)}
                placeholder="YYYY"
              />
              <Input
                label="월"
                value={settlementMonth}
                onChange={(v) => setSettlementMonth(v.replace(/\D/g, "").slice(0, 2))}
                onBlur={() => setSettlementMonth(getValidSettlementMonth(settlementMonth) || currentSettlementMonth)}
                placeholder="MM"
              />
              <SelectInput label="지역" value={settlementSiteFilter} onChange={(v) => setSettlementSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} />
              <SelectInput label="성별" value={settlementGenderFilter} onChange={(v) => setSettlementGenderFilter(v as "남" | "여" | "전체")} options={["전체", "남", "여"]} />
              <Input label="기숙사명" value={settlementSearch} onChange={(v) => setSettlementSearch(v)} placeholder="검색" />
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={settlementShowUnpaid} onChange={(e) => setSettlementShowUnpaid(e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-sm">미납만</span>
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4 mb-6">
              <MiniStat label="기숙사 수" value={`${operationalDorms.length}개`} />
              <MiniStat label="현재 거주인" value={`${occupants.filter(o => !o.isDeleted && o.status !== "퇴실").length}명`} />
              <MiniStat label="비품 총액" value={`${formatNumber(inventory.reduce((sum, i) => sum + (i.purchaseAmount || 0), 0))}원`} />
              <MiniStat label="미완료 하자" value={`${defects.filter(d => !d.isDeleted && d.defectStatus !== "완료").length}건`} />
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {[
                { key: "monthly", label: "월별 정산" },
                { key: "dormReport", label: "기숙사별 보고서" },
                { key: "itemEntry", label: "정산 항목 입력" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSettlementSubTab(tab.key as "monthly" | "dormReport" | "itemEntry")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${settlementSubTab === tab.key ? "bg-blue-600 text-white" : theme.darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={settlementSubTab === "monthly" ? "" : "hidden"}>
              <div className="space-y-4">
              {(() => {
                const periodYear = safeSettlementYear;
                const periodMonth = safeSettlementMonth;
                const settlementYearNum = Number(periodYear);
                const settlementMonthNum = Number(periodMonth);
                const periodStart = new Date(settlementYearNum, settlementMonthNum - 1, 1);
                const periodEnd = getMonthEnd(settlementYearNum, settlementMonthNum);

                const filteredDorms = operationalDorms
                  .filter((dorm) => {
                    const siteMatch = settlementSiteFilter === "전체" || dorm.site === settlementSiteFilter;
                    const genderMatch = settlementGenderFilter === "전체" || dorm.gender === settlementGenderFilter;
                    const searchMatch = !settlementSearch || `${dorm.buildingName} ${dorm.dong} ${dorm.roomHo}`.toLowerCase().includes(settlementSearch.toLowerCase());
                    return siteMatch && genderMatch && searchMatch;
                  })
                  .map((dorm) => {
                    const dormOccupants = occupants.filter((o) => {
                      if (o.dormId !== dorm.id || o.isDeleted) return false;
                      if (!periodStart || !periodEnd) return true;
                      const moveInDate = parseSafeDate(o.moveInDate);
                      if (!moveInDate || moveInDate > periodEnd) return false;
                      const actualOutDate = parseSafeDate(o.actualMoveOutDate || "");
                      if (actualOutDate && actualOutDate < periodStart) return false;
                      const dueOutDate = parseSafeDate(o.moveOutDueDate);
                      if (dueOutDate && dueOutDate < periodStart) return false;
                      return true;
                    });

                    const revenue = dormOccupants.length * 2000000;
                    const inventoryCost = inventory
                      .filter((i) => {
                        if (i.dormId !== dorm.id || i.isDeleted) return false;
                        if (!periodStart || !periodEnd) return true;
                        const purchaseDate = parseSafeDate(i.purchaseDate);
                        return purchaseDate ? isSameMonth(purchaseDate, settlementYearNum, settlementMonthNum) : false;
                      })
                      .reduce((sum, i) => sum + (i.purchaseAmount || 0), 0);
                    const defectCost = defects
                      .filter((d) => {
                        if (d.dormId !== dorm.id || d.isDeleted || d.defectStatus === "완료") return false;
                        if (!periodStart || !periodEnd) return true;
                        const receiptDate = parseSafeDate(d.receiptDate);
                        return receiptDate ? isSameMonth(receiptDate, settlementYearNum, settlementMonthNum) : false;
                      })
                      .reduce((sum) => sum + 500000, 0);
                    const itemCost = settlementItems
                      .filter((item) =>
                        item.dormId === dorm.id &&
                        item.settlementYear === safeSettlementYear &&
                        item.settlementMonth === safeSettlementMonth
                      )
                      .reduce((sum, item) => sum + item.amount, 0);
                    const manualCost =
                      (settlementRecords.find(
                        (r) =>
                          r.dormId === dorm.id &&
                          r.settlementYear === safeSettlementYear &&
                          r.settlementMonth === safeSettlementMonth
                      )?.miscCost || 0) + itemCost;
                    const totalCost = inventoryCost + defectCost + manualCost;
                    const settlementAmount = revenue - totalCost;

                    return {
                      dorm,
                      dormOccupants,
                      revenue,
                      inventoryCost,
                      defectCost,
                      manualCost,
                      totalCost,
                      settlementAmount,
                    };
                  })
                  .filter((row) => !settlementShowUnpaid || row.settlementAmount < 0);

                return (
                  <>
                    {filteredDorms.length > 0 ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-4 mb-6">
                          {filteredDorms.map(({ dorm, dormOccupants, revenue, inventoryCost, defectCost, manualCost, settlementAmount }) => (
                            <div key={dorm.id} className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4 hover:bg-slate-900 transition" : "rounded-2xl border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100 transition"}`}>
                              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-2 h-8 rounded-full" style={{ backgroundColor: dorm.site === "평택" ? "#3b82f6" : "#ec4899" }}></div>
                                  <div>
                                    <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{dorm.buildingName}</div>
                                    <div className="text-xs text-slate-500">{dorm.dong} | {dorm.address}</div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className={`${theme.darkMode ? "text-lg font-bold text-slate-100" : "text-lg font-bold text-slate-900"}`}>{formatNumber(settlementAmount)}원</div>
                                  <div className="text-xs text-slate-500">정산액</div>
                                </div>
                              </div>
                              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                                <div className={`${theme.darkMode ? "rounded-lg bg-slate-950 p-2" : "rounded-lg bg-white p-2"}`}>
                                  <div className="text-slate-500">수입</div>
                                  <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{formatNumber(revenue)}원</div>
                                </div>
                                <div className={`${theme.darkMode ? "rounded-lg bg-slate-950 p-2" : "rounded-lg bg-white p-2"}`}>
                                  <div className="text-slate-500">비품</div>
                                  <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{formatNumber(inventoryCost)}원</div>
                                </div>
                                <div className={`${theme.darkMode ? "rounded-lg bg-slate-950 p-2" : "rounded-lg bg-white p-2"}`}>
                                  <div className="text-slate-500">하자</div>
                                  <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{formatNumber(defectCost)}원</div>
                                </div>
                                <div className={`${theme.darkMode ? "rounded-lg bg-slate-950 p-2" : "rounded-lg bg-white p-2"}`}>
                                  <div className="text-slate-500">기타</div>
                                  <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{formatNumber(manualCost)}원</div>
                                </div>
                                <div className="rounded-lg bg-slate-200 p-2">
                                  <div className={`${theme.darkMode ? "text-slate-300" : "text-slate-600"}`}>거주인</div>
                                  <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>{dormOccupants.length}명</div>
                                </div>
                              </div>
                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() => exportDormSettlementExcel(dorm)}
                                  className="w-full rounded-2xl bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
                                >
                                  <Download className="inline-block h-4 w-4 align-middle" />
                                  <span className="ml-2">기숙사별 엑셀 다운로드</span>
                                </button>
                                {canEditData(currentUser) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const value = window.prompt("기타 비용(원)을 입력하세요.", String(manualCost || 0));
                                      if (value === null) return;
                                      const amount = Number(value.replace(/,/g, ""));
                                      if (Number.isNaN(amount) || amount < 0) {
                                        alert("유효한 금액을 입력하세요.");
                                        return;
                                      }
                                      saveSettlementMiscCost(dorm.id, amount);
                                    }}
                                    className="w-full rounded-2xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                                  >
                                    기타비용 입력
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className={`${theme.darkMode ? "overflow-x-auto rounded-3xl border border-slate-700 bg-slate-950 p-4" : "overflow-x-auto rounded-3xl border border-slate-200 bg-white p-4"}`}>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>기숙사별 정산 상세</h3>
                              <p className="text-xs text-slate-500">선택한 연도/월 기준</p>
                            </div>
                            <div className="text-right">
                              <div className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>총 정산액: {formatNumber(filteredDorms.reduce((sum, row) => sum + row.settlementAmount, 0))}원</div>
                              <div className="text-xs text-slate-500">기숙사 {filteredDorms.length}개</div>
                            </div>
                          </div>
                          <table className={`${theme.darkMode ? "min-w-full text-sm text-slate-300" : "min-w-full text-sm text-slate-700"}`}>
                            <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">기숙사명</th>
                                <th className="px-3 py-2 text-left font-semibold">지역</th>
                                <th className="px-3 py-2 text-left font-semibold">성별</th>
                                <th className="px-3 py-2 text-right font-semibold">수입</th>
                                <th className="px-3 py-2 text-right font-semibold">비품</th>
                                <th className="px-3 py-2 text-right font-semibold">하자</th>
                                <th className="px-3 py-2 text-right font-semibold">기타</th>
                                <th className="px-3 py-2 text-right font-semibold">정산액</th>
                                <th className="px-3 py-2 text-right font-semibold">거주인</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredDorms.map(({ dorm, revenue, inventoryCost, defectCost, manualCost, settlementAmount, dormOccupants }, idx) => (
                                <tr key={dorm.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                  <td className={`${theme.darkMode ? "px-3 py-2 font-medium text-slate-100" : "px-3 py-2 font-medium text-slate-900"}`}>{dorm.buildingName}</td>
                                  <td className="px-3 py-2">{dorm.site}</td>
                                  <td className="px-3 py-2">{dorm.gender}</td>
                                  <td className="px-3 py-2 text-right">{formatNumber(revenue)}원</td>
                                  <td className="px-3 py-2 text-right">{formatNumber(inventoryCost)}원</td>
                                  <td className="px-3 py-2 text-right">{formatNumber(defectCost)}원</td>
                                  <td className="px-3 py-2 text-right">{formatNumber(manualCost)}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-2 text-right font-semibold text-slate-100" : "px-3 py-2 text-right font-semibold text-slate-900"}`}>{formatNumber(settlementAmount)}원</td>
                                  <td className="px-3 py-2 text-right">{dormOccupants.length}</td>
                                </tr>
                              ))}
                              {filteredDorms.length > 0 && (
                                <tr className={`${theme.darkMode ? "bg-slate-200 border-t-2 border-slate-600" : "bg-slate-200 border-t-2 border-slate-300"}`}>
                                  <td className={`${theme.darkMode ? "px-3 py-3 font-bold text-slate-100" : "px-3 py-3 font-bold text-slate-900"}`} colSpan={3}>합계</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{formatNumber(filteredDorms.reduce((sum, row) => sum + row.revenue, 0))}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{formatNumber(filteredDorms.reduce((sum, row) => sum + row.inventoryCost, 0))}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{formatNumber(filteredDorms.reduce((sum, row) => sum + row.defectCost, 0))}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{formatNumber(filteredDorms.reduce((sum, row) => sum + row.manualCost, 0))}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{formatNumber(filteredDorms.reduce((sum, row) => sum + row.settlementAmount, 0))}원</td>
                                  <td className={`${theme.darkMode ? "px-3 py-3 text-right font-bold text-slate-100" : "px-3 py-3 text-right font-bold text-slate-900"}`}>{filteredDorms.reduce((sum, row) => sum + row.dormOccupants.length, 0)}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className={`${theme.darkMode ? "overflow-x-auto rounded-3xl border border-slate-700 bg-slate-950 p-4 mt-6" : "overflow-x-auto rounded-3xl border border-slate-200 bg-white p-4 mt-6"}`}>
                          <div className="mb-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <h3 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>기숙사별 상세 정산 내역</h3>
                                <p className="text-xs text-slate-500">선택한 연도/월 기준 실제 거주 입주자만 표시</p>
                              </div>
                            </div>
                          </div>
                          <table className={`${theme.darkMode ? "min-w-full text-sm text-slate-300" : "min-w-full text-sm text-slate-700"}`}>
                            <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">기숙사 주소</th>
                                <th className="px-3 py-2 text-left font-semibold">건물명</th>
                                <th className="px-3 py-2 text-left font-semibold">동</th>
                                <th className="px-3 py-2 text-left font-semibold">호수</th>
                                <th className="px-3 py-2 text-left font-semibold">거주자명</th>
                                <th className="px-3 py-2 text-left font-semibold">입실일</th>
                                <th className="px-3 py-2 text-left font-semibold">퇴실일</th>
                                <th className="px-3 py-2 text-right font-semibold">거주기간(개월)</th>
                                <th className="px-3 py-2 text-right font-semibold">월세/관리비</th>
                                <th className="px-3 py-2 text-right font-semibold">장충금</th>
                                <th className="px-3 py-2 text-right font-semibold">회사 지급금</th>
                                <th className="px-3 py-2 text-right font-semibold">회사 환급금</th>
                                <th className="px-3 py-2 text-right font-semibold">하자 비용</th>
                                <th className="px-3 py-2 text-right font-semibold">청소 비용</th>
                                <th className="px-3 py-2 text-right font-semibold">비품 구매/매각/폐기</th>
                                <th className="px-3 py-2 text-left font-semibold">비고</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredDorms.flatMap(({ dorm, dormOccupants }) => {
                                const dormKey = getDormKey(dorm.site, dorm.buildingName, dorm.dong, dorm.roomHo);
                                const contract = dormContracts.find((c) => getDormKey(c.site, c.buildingName, c.dong, c.roomHo) === dormKey);
                                const monthlyRentOrMaintenance = contract?.monthlyRentOrMaintenance || "";
                                const prepaymentDeposit = Number(contract?.prepaymentDeposit || 0);
                                const defectCost = defects
                                  .filter((d) => {
                                    if (d.isDeleted || d.defectStatus === "완료") return false;
                                    const defectDorm = findOperationalDormForDefect(d);
                                    if (defectDorm?.id !== dorm.id) return false;
                                    const receiptDate = parseSafeDate(d.receiptDate);
                                    return receiptDate ? isSameMonth(receiptDate, settlementYearNum, settlementMonthNum) : false;
                                  })
                                  .reduce((sum) => sum + 500000, 0);
                                const cleaningCost = cleaningReports
                                  .filter((r) => {
                                    if (r.isDeleted) return false;
                                    const reportDorm = findOperationalDormForCleaningReport(r);
                                    if (reportDorm?.id !== dorm.id) return false;
                                    const reportDate = parseSafeDate(r.reportDate);
                                    return reportDate ? isSameMonth(reportDate, settlementYearNum, settlementMonthNum) : false;
                                  })
                                  .length * 100000;
                                const inventoryPurchaseCost = inventory
                                  .filter((i) => {
                                    if (i.dormId !== dorm.id || i.isDeleted) return false;
                                    const purchaseDate = parseSafeDate(i.purchaseDate);
                                    return purchaseDate ? isSameMonth(purchaseDate, settlementYearNum, settlementMonthNum) : false;
                                  })
                                  .reduce((sum, i) => sum + (i.purchaseAmount || 0), 0);
                                const inventorySaleCost = inventory
                                  .filter((i) => {
                                    if (i.dormId !== dorm.id || i.isDeleted) return false;
                                    const soldDate = parseSafeDate(i.soldDate || "");
                                    return soldDate ? isSameMonth(soldDate, settlementYearNum, settlementMonthNum) : false;
                                  })
                                  .reduce((sum, i) => sum + (i.soldAmount || 0), 0);
                                const inventoryDisposalCost = 0;
                                const manualCost = settlementRecords.find(
                                  (r) =>
                                    r.dormId === dorm.id &&
                                    r.settlementYear === safeSettlementYear &&
                                    r.settlementMonth === safeSettlementMonth
                                )?.miscCost || 0;

                                return dormOccupants.map((o) => {
                                  const moveInDate = parseSafeDate(o.moveInDate);
                                  const moveOutDate = parseSafeDate(o.actualMoveOutDate || o.moveOutDueDate || "");
                                  const stayMonths = getStayMonths(moveInDate, moveOutDate || periodEnd);

                                  return (
                                    <tr key={`${dorm.id}-${o.id}`} className={o.id ? "" : ""}>
                                      <td className="px-3 py-2">{dorm.address}</td>
                                      <td className="px-3 py-2">{dorm.buildingName}</td>
                                      <td className="px-3 py-2">{dorm.dong}</td>
                                      <td className="px-3 py-2">{dorm.roomHo}</td>
                                      <td className="px-3 py-2">{o.employeeName}</td>
                                      <td className="px-3 py-2">{o.moveInDate}</td>
                                      <td className="px-3 py-2">{o.actualMoveOutDate || o.moveOutDueDate || "-"}</td>
                                      <td className="px-3 py-2 text-right">{stayMonths}</td>
                                      <td className="px-3 py-2 text-right">{monthlyRentOrMaintenance}</td>
                                      <td className="px-3 py-2 text-right">{formatNumber(prepaymentDeposit)}원</td>
                                      <td className="px-3 py-2 text-right">0원</td>
                                      <td className="px-3 py-2 text-right">0원</td>
                                      <td className="px-3 py-2 text-right">{formatNumber(defectCost)}원</td>
                                      <td className="px-3 py-2 text-right">{formatNumber(cleaningCost)}원</td>
                                      <td className="px-3 py-2 text-right">구매:{formatNumber(inventoryPurchaseCost)} / 매각:{formatNumber(inventorySaleCost)} / 폐기:{formatNumber(inventoryDisposalCost)}</td>
                                      <td className="px-3 py-2">{manualCost ? `기타 비용 ${formatNumber(manualCost)}원` : ""}</td>
                                    </tr>
                                  );
                                });
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 bg-slate-950 p-6 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400"}`}>해당 월 데이터가 없습니다.</div>
                    )}
                  </>
                );
              })()}
              </div>
            </div>

            {settlementSubTab === "dormReport" && (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-4 mb-6">
                  <MiniStat label="연도/월" value={`${settlementYear}년 ${settlementMonth}월`} />
                  <MiniStat label="선택 지역" value={settlementSiteFilter} />
                  <MiniStat label="선택 성별" value={settlementGenderFilter} />
                  <MiniStat label="등록 항목" value={`${settlementManagementStats.filteredSettlementItems.length}건`} />
                </div>
                <div className={`${theme.darkMode ? "overflow-x-auto rounded-3xl border border-slate-700 bg-slate-950 p-4" : "overflow-x-auto rounded-3xl border border-slate-200 bg-white p-4"}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>기숙사별 보고서</h3>
                      <p className="text-xs text-slate-500">선택한 연도/월의 기숙사별 정산 개요를 확인합니다.</p>
                    </div>
                    <div className="text-right">
                      <div className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>총 정산액: {formatNumber(settlementManagementStats.filteredDorms.reduce((sum, row) => sum + row.settlementAmount, 0))}원</div>
                      <div className="text-xs text-slate-500">기숙사 {settlementManagementStats.filteredDorms.length}개</div>
                    </div>
                  </div>
                  <table className={`${theme.darkMode ? "min-w-full text-sm text-slate-300" : "min-w-full text-sm text-slate-700"}`}>
                    <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">기숙사명</th>
                        <th className="px-3 py-2 text-left font-semibold">지역</th>
                        <th className="px-3 py-2 text-left font-semibold">성별</th>
                        <th className="px-3 py-2 text-right font-semibold">수입</th>
                        <th className="px-3 py-2 text-right font-semibold">비품</th>
                        <th className="px-3 py-2 text-right font-semibold">하자</th>
                        <th className="px-3 py-2 text-right font-semibold">기타</th>
                        <th className="px-3 py-2 text-right font-semibold">정산액</th>
                        <th className="px-3 py-2 text-right font-semibold">거주인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlementManagementStats.filteredDorms.map(({ dorm, revenue, inventoryCost, defectCost, manualCost, settlementAmount, dormOccupants }, idx) => (
                        <tr key={dorm.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className={`${theme.darkMode ? "px-3 py-2 font-medium text-slate-100" : "px-3 py-2 font-medium text-slate-900"}`}>{dorm.buildingName}</td>
                          <td className="px-3 py-2">{dorm.site}</td>
                          <td className="px-3 py-2">{dorm.gender}</td>
                          <td className="px-3 py-2 text-right">{formatNumber(revenue)}원</td>
                          <td className="px-3 py-2 text-right">{formatNumber(inventoryCost)}원</td>
                          <td className="px-3 py-2 text-right">{formatNumber(defectCost)}원</td>
                          <td className="px-3 py-2 text-right">{formatNumber(manualCost)}원</td>
                          <td className={`${theme.darkMode ? "px-3 py-2 text-right font-semibold text-slate-100" : "px-3 py-2 text-right font-semibold text-slate-900"}`}>{formatNumber(settlementAmount)}원</td>
                          <td className="px-3 py-2 text-right">{dormOccupants.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-white p-4"}`}>
                  <h3 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>기숙사별 정산 항목</h3>
                  <p className="text-xs text-slate-500 mb-3">선택한 연도/월에 입력된 정산 항목을 확인할 수 있습니다.</p>
                  <table className={`${theme.darkMode ? "min-w-full text-sm text-slate-300" : "min-w-full text-sm text-slate-700"}`}>
                    <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">기숙사</th>
                        <th className="px-3 py-2 text-left font-semibold">항목</th>
                        <th className="px-3 py-2 text-left font-semibold">세부</th>
                        <th className="px-3 py-2 text-right font-semibold">금액</th>
                        <th className="px-3 py-2 text-left font-semibold">부담형태</th>
                        <th className="px-3 py-2 text-left font-semibold">메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlementManagementStats.filteredSettlementItems.length > 0 ? (
                        settlementManagementStats.filteredSettlementItems.map((item) => {
                          const itemDorm = operationalDorms.find((d) => d.id === item.dormId);
                          return (
                            <tr key={item.id} className="even:bg-slate-50">
                              <td className="px-3 py-2">{itemDorm ? itemDorm.buildingName : item.dormId}</td>
                              <td className="px-3 py-2">{item.category}</td>
                              <td className="px-3 py-2">{item.details}</td>
                              <td className="px-3 py-2 text-right">{formatNumber(item.amount)}원</td>
                              <td className="px-3 py-2">{item.burdenType}</td>
                              <td className="px-3 py-2">{item.memo}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td className="px-3 py-4 text-center text-slate-500" colSpan={6}>등록된 항목이 없습니다.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {settlementSubTab === "itemEntry" && (
              <div className="space-y-6">
                <div className={`rounded-3xl border p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-950 ring-slate-700 border-slate-700" : "bg-white ring-slate-200 border-slate-200"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>정산 항목 입력</h3>
                      <p className="text-xs text-slate-500">선택한 연도/월에 대한 정산 항목을 등록하고 관리합니다.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">기숙사 선택</label>
                        <select
                          value={settlementItemForm.dormId}
                          onChange={(e) => setSettlementItemForm((prev) => ({ ...prev, dormId: e.target.value }))}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
                        >
                          <option value="">기숙사를 선택하세요</option>
                          {operationalDorms.map((dorm) => (
                            <option key={dorm.id} value={dorm.id}>{`${dorm.buildingName} ${dorm.dong}${dorm.roomHo}`}</option>
                          ))}
                        </select>
                      </div>
                      <SelectInput label="항목" value={settlementItemForm.category} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, category: v as SettlementItemCategory }))} options={settlementItemCategories} />
                      <Input label="세부내용" value={settlementItemForm.details} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, details: v }))} placeholder="예: 추가 청소 비용" />
                      <Input label="금액" value={settlementItemForm.amount} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, amount: v }))} placeholder="0" />
                      <SelectInput label="부담형태" value={settlementItemForm.burdenType} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, burdenType: v as SettlementBurdenType }))} options={settlementBurdenTypes} />
                      <Input label="대상" value={settlementItemForm.targetName} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, targetName: v }))} placeholder="예: 김철수" />
                      <Input label="메모" value={settlementItemForm.memo} onChange={(v) => setSettlementItemForm((prev) => ({ ...prev, memo: v }))} placeholder="비고" />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={saveSettlementItem} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">{selectedSettlementItemId ? "수정" : "등록"}</button>
                        <button type="button" onClick={resetSettlementItemForm} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">초기화</button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <h4 className="text-sm font-semibold text-slate-900">선택된 연월</h4>
                        <p className="text-sm text-slate-500">{settlementYear}년 {settlementMonth}월</p>
                      </div>
                      <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-white p-4"}`}>
                        <h4 className={`${theme.darkMode ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}`}>등록된 정산 항목</h4>
                        <div className="mt-4 overflow-x-auto">
                          <table className={`${theme.darkMode ? "min-w-full text-sm text-slate-300" : "min-w-full text-sm text-slate-700"}`}>
                            <thead className={`${theme.darkMode ? "bg-slate-900 border-b border-slate-700" : "bg-slate-100 border-b border-slate-200"}`}>
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">기숙사</th>
                                <th className="px-3 py-2 text-left font-semibold">항목</th>
                                <th className="px-3 py-2 text-right font-semibold">금액</th>
                                <th className="px-3 py-2 text-left font-semibold">부담</th>
                                <th className="px-3 py-2 text-right font-semibold">액션</th>
                              </tr>
                            </thead>
                            <tbody>
                              {settlementManagementStats.filteredSettlementItems.length > 0 ? (
                                settlementManagementStats.filteredSettlementItems.map((item) => {
                                  const itemDorm = operationalDorms.find((d) => d.id === item.dormId);
                                  return (
                                    <tr key={item.id} className="even:bg-slate-50">
                                      <td className="px-3 py-2">{itemDorm ? `${itemDorm.buildingName} ${itemDorm.dong}${itemDorm.roomHo}` : item.dormId}</td>
                                      <td className="px-3 py-2">{item.category}</td>
                                      <td className="px-3 py-2 text-right">{formatNumber(item.amount)}원</td>
                                      <td className="px-3 py-2">{item.burdenType}</td>
                                      <td className="px-3 py-2 text-right">
                                        <button type="button" onClick={() => openSettlementItemEdit(item)} className="mr-2 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300">수정</button>
                                        <button type="button" onClick={() => deleteSettlementItem(item.id)} className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-400">삭제</button>
                                      </td>
                                    </tr>
                                  );
                                })
                              ) : (
                                <tr>
                                  <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>등록된 정산 항목이 없습니다.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "notificationManagement" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">알림 관리</h2>
                <p className="text-sm text-slate-500">계약 만료, 하자접수, 청소 미보고 등 중요한 알림을 한 곳에서 확인합니다. (자동 생성)</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-5">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">계약 만료</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{autoNotifications.filter((n) => n.type === "contract").length}</div>
                <div className="mt-2 text-sm text-slate-500">30일 이내</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">퇴실 예정</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{autoNotifications.filter((n) => n.type === "occupant").length}</div>
                <div className="mt-2 text-sm text-slate-500">14일 이내</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">청소 미제출</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{autoNotifications.filter((n) => n.type === "cleaning").length}</div>
                <div className="mt-2 text-sm text-slate-500">당월 제출 필요</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">미완료 하자</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{autoNotifications.filter((n) => n.type === "defect").length}</div>
                <div className="mt-2 text-sm text-slate-500">진행중</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">저수량 알림</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{autoNotifications.filter((n) => n.type === "inventory").length}</div>
                <div className="mt-2 text-sm text-slate-500">2개 이하</div>
              </div>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>자동 생성 알림 (전체)</div>
                {autoNotifications.length > 0 ? (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {autoNotifications.map((alert) => (
                      <div key={alert.id} className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-white p-3"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={`${theme.darkMode ? "font-semibold text-slate-300" : "font-semibold text-slate-700"}`}>{alert.title}</p>
                            <p className="text-sm text-slate-500">{alert.detail}</p>
                          </div>
                          <span className="text-xs font-semibold text-blue-700 whitespace-nowrap">{alert.when}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 bg-slate-950 p-6 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400"}`}>확인할 알림이 없습니다.</div>
                )}
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>항목별 알림</div>
                <div className="space-y-3">
                  {autoNotifications.filter((n) => n.type === "contract").length > 0 && (
                    <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-white p-3"}`}>
                      <div className={`${theme.darkMode ? "text-xs font-semibold text-slate-300 mb-2" : "text-xs font-semibold text-slate-600 mb-2"}`}>📅 계약 만료 예정</div>
                      <div className="space-y-1">
                        {autoNotifications
                          .filter((n) => n.type === "contract")
                          .slice(0, 3)
                          .map((alert) => (
                            <div key={alert.id} className={`${theme.darkMode ? "text-xs text-slate-300" : "text-xs text-slate-600"}`}>
                              {alert.title}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {autoNotifications.filter((n) => n.type === "cleaning").length > 0 && (
                    <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-white p-3"}`}>
                      <div className={`${theme.darkMode ? "text-xs font-semibold text-slate-300 mb-2" : "text-xs font-semibold text-slate-600 mb-2"}`}>🧹 청소 미제출</div>
                      <div className="space-y-1">
                        {autoNotifications
                          .filter((n) => n.type === "cleaning")
                          .slice(0, 3)
                          .map((alert) => (
                            <div key={alert.id} className={`${theme.darkMode ? "text-xs text-slate-300" : "text-xs text-slate-600"}`}>
                              {alert.title}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {autoNotifications.filter((n) => n.type === "defect").length > 0 && (
                    <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-white p-3"}`}>
                      <div className={`${theme.darkMode ? "text-xs font-semibold text-slate-300 mb-2" : "text-xs font-semibold text-slate-600 mb-2"}`}>🔧 미완료 하자</div>
                      <div className="space-y-1">
                        {autoNotifications
                          .filter((n) => n.type === "defect")
                          .slice(0, 3)
                          .map((alert) => (
                            <div key={alert.id} className={`${theme.darkMode ? "text-xs text-slate-300" : "text-xs text-slate-600"}`}>
                              {alert.title}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {autoNotifications.length === 0 && (
                    <div className="text-center text-slate-400 py-4">확인할 알림이 없습니다.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "notificationManagement" && (
          <section className={`rounded-3xl ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"} p-5 shadow-sm ring-1 mt-6`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">변경이력 (Audit Log)</h2>
                <p className="text-sm text-slate-500">계약, 입주자 상태 변경 등 모든 데이터 변경사항을 추적합니다.</p>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2 items-center">
              <input
                type="text"
                placeholder="변경자명 검색..."
                className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"}`}
              />
              <FilterSelect
                label="대상"
                value="전체"
                onChange={() => {}}
                options={["전체", "dormContract", "occupant", "dorm", "newHire"]}
              />
              <FilterSelect
                label="작업"
                value="전체"
                onChange={() => {}}
                options={["전체", "create", "update", "delete", "restore", "statusChange"]}
              />
              <button
                type="button"
                onClick={() => {
                  if (currentUser?.role !== "admin") {
                    alert("관리자만 감사 로그를 삭제할 수 있습니다.");
                    return;
                  }
                  if (selectedAuditLogIds.length === 0) {
                    alert("삭제할 감사 로그를 선택해주세요.");
                    return;
                  }
                  if (!window.confirm("선택한 감사 로그를 삭제하시겠습니까?")) return;
                  setAuditLogs((prev) => prev.filter((log) => !selectedAuditLogIds.includes(log.id)));
                  setSelectedAuditLogIds([]);
                }}
                disabled={selectedAuditLogIds.length === 0 || currentUser?.role !== "admin"}
                className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                선택 삭제
              </button>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1000px] text-xs">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={
                          auditLogs.slice(0, 50).length > 0 &&
                          selectedAuditLogIds.length > 0 &&
                          auditLogs.slice(0, 50).every((log) => selectedAuditLogIds.includes(log.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAuditLogIds(auditLogs.slice(0, 50).map((log) => log.id));
                          } else {
                            setSelectedAuditLogIds([]);
                          }
                        }}
                        className="h-5 w-5"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">시간</th>
                    <th className="px-3 py-2 text-left">변경자</th>
                    <th className="px-3 py-2 text-left">대상</th>
                    <th className="px-3 py-2 text-left">작업</th>
                    <th className="px-3 py-2 text-left">메모</th>
                    <th className="px-3 py-2 text-center">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.slice(0, 50).map((log) => (
                    <tr key={log.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedAuditLogIds.includes(log.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAuditLogIds((prev) => [...prev, log.id]);
                            } else {
                              setSelectedAuditLogIds((prev) => prev.filter((id) => id !== log.id));
                            }
                          }}
                          className="h-5 w-5"
                        />
                      </td>
                      <td className="px-3 py-2">{new Date(log.changedAt).toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2">{log.changedBy}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <span className={`${theme.darkMode ? "rounded-full bg-slate-900 px-2 py-1 text-xs" : "rounded-full bg-slate-100 px-2 py-1 text-xs"}`}>{getAuditTargetLabel(log.targetType)}</span>
                          <span className={`${theme.darkMode ? "text-[10px] text-slate-400" : "text-[10px] text-slate-500"}`}>{getAuditTargetName(log)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-1 text-xs ${
                          log.actionType === "create" ? "bg-green-100 text-green-700" :
                          log.actionType === "update" ? "bg-blue-100 text-blue-700" :
                          log.actionType === "delete" ? "bg-red-100 text-red-700" :
                          log.actionType === "restore" ? "bg-orange-100 text-orange-700" :
                          "bg-purple-100 text-purple-700"
                        }`}>
                          {log.actionType}
                        </span>
                      </td>
                      <td className={`${theme.darkMode ? "px-3 py-2 text-slate-300 max-w-xs truncate" : "px-3 py-2 text-slate-600 max-w-xs truncate"}`}>{log.memo || "-"}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setSelectedAuditLogId(log.id);
                            setShowAuditLogModal(true);
                            setShowRawJson(false);
                          }}
                          className={`${theme.darkMode ? "rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-200" : "rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"}`}
                        >
                          보기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {auditLogs.length === 0 && (
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-8 text-center" : "rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center"}`}>
                <div className="text-sm text-slate-500">변경이력이 없습니다.</div>
              </div>
            )}
          </section>
        )}

        {activeTab === "documentManagement" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">문서 관리</h2>
                <p className="text-sm text-slate-500">계약서, 청소 보고서, 하자 기록 등 문서를 기숙사별로 자동 분류하여 관리합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExcelTemplate((prev) => !prev)}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                문서 템플릿 업로드
              </button>
            </div>
            
            {/* 자동 집계 문서 현황 */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">계약 문서</div>
                <div className="mt-3 text-2xl font-semibold text-blue-900">{dormContracts.length}</div>
                <div className="mt-2 text-sm text-blue-700">등록된 계약</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-green-50 to-green-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-green-50 to-green-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-green-600">청소 보고서</div>
                <div className="mt-3 text-2xl font-semibold text-green-900">{cleaningReports.length}</div>
                <div className="mt-2 text-sm text-green-700">제출된 보고서</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-orange-50 to-orange-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">하자 기록</div>
                <div className="mt-3 text-2xl font-semibold text-orange-900">{defects.length}</div>
                <div className="mt-2 text-sm text-orange-700">등록된 하자</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-purple-50 to-purple-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-purple-600">맞춤 템플릿</div>
                <div className="mt-3 text-2xl font-semibold text-purple-900">{customTemplates.length}</div>
                <div className="mt-2 text-sm text-purple-700">등록된 양식</div>
              </div>
            </div>
            
            {/* 기숙사별 문서 목록 */}
            <div className={`${theme.darkMode ? "mt-6 rounded-3xl border border-slate-700 bg-slate-950 p-4" : "mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
              <div className={`${theme.darkMode ? "mb-4 text-sm font-semibold text-slate-300" : "mb-4 text-sm font-semibold text-slate-700"}`}>기숙사별 문서 현황</div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                    <tr>
                      <th className="px-3 py-2 text-left">지역</th>
                      <th className="px-3 py-2 text-left">건물명</th>
                      <th className="px-3 py-2 text-left">동-호</th>
                      <th className="px-3 py-2 text-center">계약</th>
                      <th className="px-3 py-2 text-center">청소</th>
                      <th className="px-3 py-2 text-center">하자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationalDorms.map((dorm) => {
                      const dormContractsForDoc = dormContracts.filter(
                        (c) =>
                          c.address === dorm.address &&
                          c.buildingName === dorm.buildingName &&
                          c.dong === dorm.dong &&
                          c.roomHo === dorm.roomHo
                      );
                      const dormCleanings = cleaningReports.filter(
                        (r) =>
                          r.buildingName === dorm.buildingName &&
                          r.address === dorm.address &&
                          r.dong === dorm.dong &&
                          r.roomHo === dorm.roomHo
                      );
                      const dormDefects = defects.filter(
                        (d) =>
                          d.buildingName === dorm.buildingName &&
                          d.dong === dorm.dong &&
                          d.ho === dorm.roomHo
                      );
                      return (
                        <tr key={dorm.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-white"}`}>
                          <td className="px-3 py-3">{dorm.site}</td>
                          <td className="px-3 py-3 font-medium">{dorm.buildingName}</td>
                          <td className="px-3 py-3">{dorm.dong}-{dorm.roomHo}</td>
                          <td className="px-3 py-3 text-center">
                            <span className="inline-block rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                              {dormContractsForDoc.length}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                              {dormCleanings.length}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="inline-block rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                              {dormDefects.length}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {operationalDorms.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          운영 중인 기숙사가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* 최근 업로드 문서 */}
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>최근 계약 문서</div>
                {dormContracts.slice(-5).reverse().length > 0 ? (
                  <div className="space-y-2">
                    {dormContracts.slice(-5).reverse().map((contract) => (
                      <div key={contract.id} className={`rounded-2xl p-3 shadow-sm text-xs ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`font-medium truncate ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{contract.buildingName} {contract.dong}-{contract.roomHo}</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>{contract.contractStart}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-2xl border border-dashed p-4 text-center text-xs ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-300 bg-white text-slate-400"}`}>
                    계약 문서가 없습니다.
                  </div>
                )}
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>최근 청소 보고서</div>
                {cleaningReports.slice(-5).reverse().length > 0 ? (
                  <div className="space-y-2">
                    {cleaningReports.slice(-5).reverse().map((report) => (
                      <div key={report.id} className={`rounded-2xl p-3 shadow-sm text-xs ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`font-medium truncate ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{report.buildingName} {report.dong}-{report.roomHo}</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>{report.monthLabel} {report.weekLabel}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-2xl border border-dashed p-4 text-center text-xs ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-300 bg-white text-slate-400"}`}>
                    청소 보고서가 없습니다.
                  </div>
                )}
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>최근 하자 기록</div>
                {defects.slice(-5).reverse().length > 0 ? (
                  <div className="space-y-2">
                    {defects.slice(-5).reverse().map((defect) => (
                      <div key={defect.id} className={`rounded-2xl p-3 shadow-sm text-xs ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`font-medium truncate ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{defect.buildingName} {formatDong(defect.dong)}-{formatRoomHo(defect.ho)}</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>{defect.defectStatus}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`rounded-2xl border border-dashed p-4 text-center text-xs ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-300 bg-white text-slate-400"}`}>
                    하자 기록이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "reportManagement" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">통계 및 보고서</h2>
                <p className="text-sm text-slate-500">운영 데이터를 자동으로 집계하여 주요 지표를 확인하고 리포트를 생성합니다.</p>
              </div>
              <div className="w-full mt-3 mb-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Input label="연도" value={reportYear} onChange={(v) => setReportYear(v)} placeholder="YYYY" />
                  <Input label="월" value={reportMonth} onChange={(v) => setReportMonth(v)} placeholder="MM" />
                  <SelectInput label="지역" value={reportSiteFilter} onChange={(v) => setReportSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} />
                  <SelectInput label="성별" value={reportGenderFilter} onChange={(v) => setReportGenderFilter(v as "남" | "여" | "전체")} options={["전체", "남", "여"]} />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {currentUser?.role === "admin" && (
                  <button onClick={() => window.print()} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${theme.darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>🖨️ 프린트</button>
                )}
                {currentUser?.role === "admin" ? (
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={downloadOperationalReport} title="월간 운영 보고서" className="rounded-2xl bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-200">📊 월간운영</button>
                    <button onClick={downloadUnassignedReport} title="미배정자 보고서" className="rounded-2xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-200">👤 미배정</button>
                    <button onClick={downloadDefectReport} title="하자 처리 보고서" className="rounded-2xl bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-200">🔧 하자</button>
                    <button onClick={downloadCleaningReport} title="청소 미보고 보고서" className="rounded-2xl bg-green-100 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-200">🧹 청소</button>
                    <button onClick={downloadInventoryReport} title="비품 현황 보고서" className="rounded-2xl bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-200">📦 비품</button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">보고서 다운로드는 관리자만 가능합니다.</div>
                )}
              </div>
            </div>
            
            {/* 자동 집계 통계 */}
            <div className="grid gap-4 md:grid-cols-4">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-blue-50 to-blue-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">공실률</div>
                <div className="mt-3 text-2xl font-semibold text-blue-900">{reportData.vacancyRate}%</div>
                <div className="mt-2 text-sm text-blue-700">{reportData.vacancyDormCount}개 / {reportData.totalDormCount}개</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-green-50 to-green-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-green-50 to-green-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-green-600">청소 제출률</div>
                <div className="mt-3 text-2xl font-semibold text-green-900">{reportData.cleaningSubmissionRate}%</div>
                <div className="mt-2 text-sm text-green-700">{reportData.submittedCleaningCount}건 / {reportData.requiredCleaningCount}건</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-orange-50 to-orange-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">하자 완료율</div>
                <div className="mt-3 text-2xl font-semibold text-orange-900">{reportData.defectCompletionRate}%</div>
                <div className="mt-2 text-sm text-orange-700">{reportData.completedDefectCount}건 / {reportData.totalDefectCount}건</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-gradient-to-br from-purple-50 to-purple-100 p-4" : "rounded-3xl border border-slate-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-purple-600">계약 만료 예정</div>
                <div className="mt-3 text-2xl font-semibold text-purple-900">{reportData.expiringContractCount}</div>
                <div className="mt-2 text-sm text-purple-700">30일 이내</div>
              </div>
            </div>
            
            {/* 상세 분석 */}
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>지역별 운영 통계</div>
                <div className="grid gap-3">
                  {siteGenderStats
                    .filter((stat) => (reportSiteFilter === "전체" || stat.site === reportSiteFilter) && (reportGenderFilter === "전체" || stat.gender === reportGenderFilter))
                    .map((stat) => (
                      <div key={`${stat.site}-${stat.gender}`} className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                        <div className={`font-medium ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{stat.site} ({stat.gender})</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>기숙사 {stat.dormCount}개 · 재원 {stat.currentResidents}명</div>
                        <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>잔여 {stat.vacancy}명 · 사용률 {((stat.currentResidents / (stat.dormCount * 6)) * 100).toFixed(1)}%</div>
                      </div>
                    ))}
                </div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>임차 만기 예정 (Top 10)</div>
                {expiringDormsTop10.filter((dorm) =>
                    (reportSiteFilter === "전체" || dorm.site === reportSiteFilter) &&
                    (reportGenderFilter === "전체" || dorm.gender === reportGenderFilter) &&
                    dorm.contractEnd.startsWith(reportPeriod)
                  ).length > 0 ? (
                  <ul className={`${theme.darkMode ? "space-y-2 text-sm text-slate-300 max-h-64 overflow-y-auto" : "space-y-2 text-sm text-slate-700 max-h-64 overflow-y-auto"}`}>
                    {expiringDormsTop10
                      .filter((dorm) =>
                        (reportSiteFilter === "전체" || dorm.site === reportSiteFilter) &&
                        (reportGenderFilter === "전체" || dorm.gender === reportGenderFilter) &&
                        dorm.contractEnd.startsWith(reportPeriod)
                      )
                      .map((dorm) => (
                        <li key={dorm.id} className={`rounded-2xl p-3 shadow-sm ${theme.darkMode ? "bg-slate-900" : "bg-white"}`}>
                          <div className={`font-medium ${theme.darkMode ? "text-slate-100" : "text-slate-700"}`}>{dorm.site} {dorm.buildingName} {dorm.dong}-{dorm.roomHo}</div>
                          <div className={`text-xs ${theme.darkMode ? "text-slate-400" : "text-slate-500"}`}>만기 {dorm.contractEnd} · 상태 {dorm.leaseStatus}</div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 bg-slate-950 p-6 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400"}`}>만기 예정 기숙사가 없습니다.</div>
                )}
              </div>
            </div>
            
            {/* 월별 요약 테이블 */}
            <div className={`${theme.darkMode ? "mt-6 overflow-auto rounded-3xl border border-slate-700 bg-slate-950 p-4" : "mt-6 overflow-auto rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
              <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>운영 현황 요약</div>
              <table className="w-full text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2">지역</th>
                    <th className="px-3 py-2">총 기숙사</th>
                    <th className="px-3 py-2">공실</th>
                    <th className="px-3 py-2">현 거주자</th>
                    <th className="px-3 py-2">임차만기</th>
                    <th className="px-3 py-2">사용률</th>
                  </tr>
                </thead>
                <tbody>
                  {reportSummaryRows.map((row) => (
                    <tr key={row.key} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                      <td className="px-3 py-3">{row.site} ({row.gender})</td>
                      <td className="px-3 py-3">{row.dormCount}</td>
                      <td className="px-3 py-3">{row.residentTo}</td>
                      <td className="px-3 py-3">{row.currentResidents}</td>
                      <td className="px-3 py-3">{row.expireBuildings}</td>
                      <td className="px-3 py-3">{row.usageRate}%</td>
                    </tr>
                  ))}
                  {reportSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">검색 결과가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "cleaningReports" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">청소 보고서 관리</h2>
                <p className="text-sm text-slate-500">이 화면에서는 운영 중인 기숙사별 월별 주차 청소 현황을 확인하고 보고서를 등록/수정할 수 있습니다.</p>
              </div>
              {canCreateCleaningReport(currentUser) && (
                <button
                  onClick={() =>
                    openCleaningReportForm(
                      undefined,
                      operationalDorms.find((d) =>
                        currentUser?.role === "admin" ||
                        d.managerUserId === currentUser?.id ||
                        (currentUser?.role === "maintenance_reporter" && d.id === currentUser.dormId)
                      )
                    )
                  }
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  새 보고서 등록
                </button>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Input label="연도" value={cleaningYear} onChange={(v) => setCleaningYear(v)} placeholder="YYYY" />
              <Input label="월" value={cleaningMonth} onChange={(v) => setCleaningMonth(v)} placeholder="MM" />
              <SelectInput label="지역" value={cleaningDormSiteFilter} onChange={(v) => setCleaningDormSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Input label="기숙사 검색" value={cleaningDormSearch} onChange={(v) => setCleaningDormSearch(v)} />
              <SelectInput label="담당자" value={cleaningManagerFilter} onChange={(v) => setCleaningManagerFilter(v)} options={["전체", ...managerFilterOptions]} />
              <SelectInput label="청소 상태" value={cleaningStatusFilter} onChange={(v) => setCleaningStatusFilter(v)} options={["전체", "미제출", "제출완료", "확인완료", "불량", "재청소요청"]} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Input
                label="미보고 감점"
                value={String(cleaningSettings.missingReportPenalty)}
                onChange={(v) => setCleaningSettings((prev) => ({ ...prev, missingReportPenalty: Number(v) || 0 }))}
              />
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">요약</div>
                <div className={`${theme.darkMode ? "mt-2 space-y-2 text-sm text-slate-300" : "mt-2 space-y-2 text-sm text-slate-700"}`}>
                  <div>기숙사 수: {cleaningOverview.totalDorms}</div>
                  <div>제출 완료: {cleaningOverview.submitted}</div>
                  <div>미보고: {cleaningOverview.missing}</div>
                  <div>불량: {cleaningOverview.bad}</div>
                  <div>사진누락: {cleaningOverview.photoMissing}</div>
                  <div>총 감점: {cleaningOverview.penaltyTotal}</div>
                </div>
              </div>
              <div className={`${theme.darkMode ? "space-y-2 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300" : "space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">담당자별 감점</div>
                {managerFilterOptions.length === 0 ? (
                  <div className="text-slate-500">담당자 정보 없음</div>
                ) : (
                  managerFilterOptions.slice(0, 5).map((managerName) => {
                    const manager = users.find((u) => u.displayName === managerName);
                    const penalty = manager ? getManagerCleaningPenalty(manager.id) : 0;
                    return (
                      <div key={managerName} className="flex items-center justify-between">
                        <span>{managerName}</span>
                        <span className="font-semibold text-rose-600">{penalty}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[1300px] text-sm text-left">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">지역</th>
                    <th className="px-3 py-3">성별</th>
                    <th className="px-3 py-3">기숙사명</th>
                    <th className="px-3 py-3">도로명주소</th>
                    <th className="px-3 py-3">동</th>
                    <th className="px-3 py-3">호수</th>
                    <th className="px-3 py-3">공동현관</th>
                    <th className="px-3 py-3">세대현관</th>
                    <th className="px-3 py-3">거주자</th>
                    <th className="px-3 py-3">연락처</th>
                    <th className="px-3 py-3">입실일</th>
                    <th className="px-3 py-3">퇴실예정일</th>
                    <th className="px-3 py-3">담당 관리자</th>
                    <th className="px-3 py-3">1주차</th>
                    <th className="px-3 py-3">2주차</th>
                    <th className="px-3 py-3">3주차</th>
                    <th className="px-3 py-3">4주차</th>
                    <th className="px-3 py-3">5주차</th>
                    <th className="px-3 py-3">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCleaningDormRows.map((dorm, idx) => {
                    const occupant = occupants.find(
                      (o) =>
                        o.dormId === dorm.id && ["거주중", "만료예정", "신규입주"].includes(o.status)
                    );
                    const manager = users.find((u) => u.id === dorm.managerUserId);
                    return (
                      <tr key={`${dorm.id}-${idx}`} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                        <td className="px-3 py-3">{idx + 1}</td>
                        <td className="px-3 py-3">{dorm.site}</td>
                        <td className="px-3 py-3">{dorm.gender}</td>
                        <td className="px-3 py-3">{dorm.buildingName}</td>
                        <td className="px-3 py-3">{dorm.address}</td>
                        <td className="px-3 py-3">{dorm.dong}</td>
                        <td className="px-3 py-3">{dorm.roomHo}</td>
                        <td className="px-3 py-3">{dorm.공동현관 || "-"}</td>
                        <td className="px-3 py-3">{dorm.세대현관 || "-"}</td>
                        <td className="px-3 py-3">{occupant?.employeeName || "-"}</td>
                        <td className="px-3 py-3">{occupant?.phone || "-"}</td>
                        <td className="px-3 py-3">{occupant?.moveInDate || "-"}</td>
                        <td className="px-3 py-3">{occupant?.expectedMoveOutDate || occupant?.moveOutDueDate || "-"}</td>
                        <td className="px-3 py-3">{manager?.displayName || "미지정"}</td>
                        {[1, 2, 3, 4, 5].map((weekNo) => (
                          <td key={weekNo} className="px-3 py-3">
                            {getCleaningWeeklyStatus(dorm, weekNo)}
                          </td>
                        ))}
                        <td className="px-3 py-3">
                          <button
                            onClick={() => openCleaningReportForm(undefined, dorm)}
                            className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-900" : "rounded-2xl border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"}`}
                          >
                            보고서 등록
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleCleaningDormRows.length === 0 && (
                    <tr>
                      <td colSpan={20} className="px-3 py-6 text-center text-slate-500">
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={`${theme.darkMode ? "mt-8 rounded-3xl border border-slate-700 p-5" : "mt-8 rounded-3xl border border-slate-200 p-5"}`}>
              {currentUser?.role === "maintenance_reporter" && (
                <div className={`${theme.darkMode ? "mb-4 p-4 bg-slate-950 rounded-2xl" : "mb-4 p-4 bg-slate-50 rounded-2xl"}`}>
                  <h3 className="text-lg font-semibold">내 청소보고 통계</h3>
                  {(() => {
                    const stats = getManagerCleaningStats(currentUser.id);
                    return (
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <div>총 보고: {stats.totalReports}</div>
                        <div>완료 보고: {stats.completedReports}</div>
                        <div>불량 보고: {stats.defectReports}</div>
                        <div>점수: {stats.score}</div>
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">청소보고서 원본 리스트</h3>
                  <p className="text-sm text-slate-500">등록된 보고서를 수정하거나 삭제할 수 있습니다.</p>
                </div>
                {canEditDormData(currentUser, "maintenance_reporter") && (
                  <button
                    onClick={() =>
                      openCleaningReportForm(
                        undefined,
                        operationalDorms.find((d) =>
                          currentUser?.role === "admin" ||
                          d.managerUserId === currentUser?.id ||
                          (currentUser?.role === "maintenance_reporter" && d.id === currentUser.dormId)
                        )
                      )
                    }
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    새 보고서 등록
                  </button>
                )}
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                    <tr>
                      <th className="px-3 py-3">보고일</th>
                      <th className="px-3 py-3">기숙사</th>
                      <th className="px-3 py-3">상태</th>
                      <th className="px-3 py-3">담당 관리자</th>
                      <th className="px-3 py-3">청소담당자</th>
                      <th className="px-3 py-3">사진</th>
                      <th className="px-3 py-3">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCleaningReports.map((report) => (
                      <tr key={report.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-100 hover:bg-slate-50"}`}>
                        <td className="px-3 py-3">{report.reportDate}</td>
                        <td className="px-3 py-3">{`${report.buildingName} ${report.dong}-${report.roomHo}`}</td>
                        <td className="px-3 py-3">{report.cleanStatus}</td>
                        <td className="px-3 py-3">{report.managerName || "-"}</td>
                        <td className="px-3 py-3">{report.cleanerName || "-"}</td>
                        <td className="px-3 py-3">{report.beforePhotoDataUrls.length && report.afterPhotoDataUrls.length ? "완료" : "사진누락"}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            {shouldShowMaintenanceControls(currentUser) && (
                              <button onClick={() => openCleaningReportEdit(report)} className={`${theme.darkMode ? "rounded-xl border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-900" : "rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"}`}>
                                수정
                              </button>
                            )}
                            {canModifyPermission(currentUser) && (
                              <button onClick={() => deleteCleaningReport(report.id)} className="rounded-xl border border-rose-300 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50">
                                삭제
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleCleaningReports.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                          등록된 청소보고서가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">시스템 설정</h2>
                <p className="text-sm text-slate-500">시스템 메뉴, 필드, 권한, 코드값, 화면 설정을 관리합니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSettingsMode("beginner")}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                    settingsMode === "beginner"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  쉬운 설정
                </button>
                <button
                  onClick={() => setSettingsMode("advanced")}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                    settingsMode === "advanced"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  고급 설정
                </button>
              </div>
            </div>

            <div className={`${theme.darkMode ? "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-700 bg-slate-950 p-4" : "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
              <p className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                {settingsMode === "beginner"
                  ? "초보자 모드: 가장 많이 사용하는 항목을 간단히 편집하세요."
                  : "고급 모드: 필드 키 및 JSON 필터를 포함한 모든 설정을 자세히 편집합니다."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  onClick={saveSystemSettings}
                  className="w-full sm:w-auto rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  설정 저장
                </button>
                <button
                  onClick={restoreDefaultSystemSettings}
                  className={`${theme.darkMode ? "w-full sm:w-auto rounded-2xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-400" : "w-full sm:w-auto rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"}`}
                >
                  기본값 복원
                </button>
                <button
                  onClick={exportLocalStorageBackup}
                  className={`${theme.darkMode ? "w-full sm:w-auto rounded-2xl border border-slate-600 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100" : "w-full sm:w-auto rounded-2xl border border-slate-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"}`}
                >
                  로컬백업 다운로드
                </button>
                <button
                  onClick={() => backupInputRef.current?.click()}
                  className={`${theme.darkMode ? "w-full sm:w-auto rounded-2xl border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900" : "w-full sm:w-auto rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"}`}
                >
                  백업 파일 복원
                </button>
                <button
                  onClick={resetAllData}
                  disabled={!canEditData(currentUser)}
                  className={`w-full sm:w-auto rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 ${
                    !canEditData(currentUser) ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  전체 데이터 초기화
                </button>
                <button
                  onClick={resetDemoData}
                  disabled={!canEditData(currentUser)}
                  className={`w-full sm:w-auto rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 ${
                    !canEditData(currentUser) ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  데모 데이터 로드
                </button>
                <button
                  onClick={resetAdminAccount}
                  disabled={!canEditData(currentUser)}
                  className={`w-full sm:w-auto rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 ${
                    !canEditData(currentUser) ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  관리자 계정 초기화
                </button>
                {settingsSavedAt && (
                  <div className="text-xs text-slate-500">저장됨: {settingsSavedAt}</div>
                )}
              </div>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => importLocalStorageBackup(e.target.files)}
              />
              {backupImportError && (
                <div className="mt-2 text-sm text-rose-600">백업 복원 오류: {backupImportError}</div>
              )}
            </div>

            <div className={`${theme.darkMode ? "mb-6 rounded-3xl border border-slate-700 bg-slate-950 p-4 shadow-sm" : "mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"}`}>
              <h3 className="mb-4 text-base font-semibold">📖 사용 설명서</h3>
              <div className={`${theme.darkMode ? "space-y-4 text-sm text-slate-300" : "space-y-4 text-sm text-slate-600"}`}>
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-sm">1</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">신규계약 등록</div>
                      <div className="mt-1 text-xs text-black dark:text-black">상단 메뉴에서 "신규계약" 탭 선택 → 건물 정보 입력 (지역, 건물명, 주소 등) → 계약 기간 설정 (시작일/종료일) → 계약금액 입력 → 저장 버튼 클릭</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white font-bold text-sm">2</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">신입사원 등록</div>
                      <div className="mt-1 text-xs text-black dark:text-black">상단 메뉴에서 "신입사원" 탭 선택 → 직원 정보 입력 (이름, 부서, 연락처, 지역, 성별) → 저장 버튼 클릭. 등록된 신입사원은 입주자 배정 시 자동 표시됩니다.</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white font-bold text-sm">3</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">입주자 배정</div>
                      <div className="mt-1 text-xs text-black dark:text-black">기숙사관리 탭 → 입주자 메뉴 → "신입사원 배정" 버튼 클릭 → 지역/성별 선택 → 배정할 기숙사 선택 → 미배정 신입사원 선택 → "선택 인원 배정" 버튼 클릭</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-600 text-white font-bold text-sm">4</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">청소보고 확인</div>
                      <div className="mt-1 text-xs text-black dark:text-black">청소관리 탭에서 주간별 청소 상태 확인 → 담당자별 청소 현황 조회 → 불량/재청소 상태 관리. 미제출 건은 알림관리에서 자동으로 추적됩니다.</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-600 text-white font-bold text-sm">5</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">하자접수 처리</div>
                      <div className="mt-1 text-xs text-black dark:text-black">하자접수 탭 → 기숙사/호실 선택 → 하자 내용 입력 → 사진 첨부 → 저장. 등록 후 담당자에게 자동 배정되며, 상태는 접수→진행→완료로 관리합니다.</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-slate-900">
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white font-bold text-sm">6</div>
                    <div>
                      <div className="font-semibold text-slate-950 dark:text-slate-950">정산관리 사용</div>
                      <div className="mt-1 text-xs text-black dark:text-black">정산관리 탭 → 월/지역/성별/기숙사 선택 → 신규계약, 비품, 청소, 하자 데이터 자동 집계 → 엑셀 다운로드로 상세 분석. 월별 운영 현황과 수익을 한눈에 파악할 수 있습니다.</div>
                    </div>
                  </div>
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-600 bg-slate-950 p-4" : "rounded-2xl border border-slate-300 bg-slate-50 p-4"}`}>
                  <div className="flex gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-600 text-white font-bold text-sm">7</div>
                    <div>
                      <div className={`${theme.darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-900"}`}>백업/복원</div>
                      <div className="mt-1 text-xs">"로컬백업 다운로드"로 모든 데이터를 JSON 파일로 저장 → 긴급 상황 발생 시 "백업 파일 복원"으로 이전 상태로 복구. 월 1회 정기 백업을 권장합니다.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Sub-Tabs */}
            <div className={`${theme.darkMode ? "mb-6 flex flex-wrap gap-2 border-b border-slate-700 pb-4" : "mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-4"}`}>
              <button
                onClick={() => setSettingsSubTab("menuManagement")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "menuManagement"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                메뉴 관리
              </button>
              <button
                onClick={() => setSettingsSubTab("fieldManagement")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "fieldManagement"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                필드 관리
              </button>
              <button
                onClick={() => setSettingsSubTab("permissionManagement")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "permissionManagement"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                권한 관리
              </button>
              <button
                onClick={() => setSettingsSubTab("codeManagement")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "codeManagement"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                코드값 관리
              </button>
              <button
                onClick={() => setSettingsSubTab("screenSettings")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "screenSettings"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                화면 설정
              </button>
              <button
                onClick={() => setSettingsSubTab("trashManagement")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  settingsSubTab === "trashManagement"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                휴지통 & 감사
              </button>
            </div>

            {/* Menu Management */}
            {settingsSubTab === "menuManagement" && (
              <div className="space-y-4">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className={`${theme.darkMode ? "bg-slate-900" : "bg-slate-100"}`}>
                      <tr>
                        <th className="px-3 py-2 text-left">그룹명</th>
                        <th className="px-3 py-2 text-left">메뉴명</th>
                        <th className="px-3 py-2 text-center">표시</th>
                        <th className="px-3 py-2 text-center">순서</th>
                        <th className="px-3 py-2 text-center">접근권한</th>
                        <th className="px-3 py-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {systemSettings.menus.map((menu) => (
                        <tr key={menu.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-200 hover:bg-slate-50"}`}>
                          <td className="px-3 py-2">{menu.groupName}</td>
                          <td className="px-3 py-2">{menu.menuName}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={menu.isVisible}
                              onChange={() => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  menus: prev.menus.map((m) =>
                                    m.id === menu.id ? { ...m, isVisible: !m.isVisible } : m
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              value={menu.order}
                              onChange={(e) => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  menus: prev.menus.map((m) =>
                                    m.id === menu.id ? { ...m, order: Number(e.target.value) } : m
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "w-12 rounded border border-slate-600 px-2 py-1 text-center" : "w-12 rounded border border-slate-300 px-2 py-1 text-center"}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center text-xs">
                            {menu.requiredRoles.map((r) => getRoleLabel(r)).join(", ")}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                const newName = prompt("새 메뉴명:", menu.menuName);
                                if (newName) {
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    menus: prev.menus.map((m) =>
                                      m.id === menu.id ? { ...m, menuName: newName } : m
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }
                              }}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              수정
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Code Management */}
            {settingsSubTab === "codeManagement" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold">코드 타입</label>
                    <select
                      value={codeTypeFilter}
                      onChange={(e) => setCodeTypeFilter(e.target.value as CodeValue["codeType"] | "")}
                      className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm"}`}
                    >
                      <option value="">모든 타입</option>
                      <option value="dormStatus">기숙사 상태</option>
                      <option value="residenceStatus">거주 상태</option>
                      <option value="cleaningStatus">청소 상태</option>
                      <option value="defectStatus">하자 상태</option>
                      <option value="site">지역</option>
                      <option value="gender">성별</option>
                      <option value="contractStatus">계약 상태</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const newCode: CodeValue = {
                        id: crypto.randomUUID(),
                        codeType: codeTypeFilter || "dormStatus",
                        codeKey: "newCode",
                        codeName: "새 코드",
                        order: systemSettings.codeValues.length + 1,
                        isActive: true,
                      };
                      setSystemSettings((prev) => ({
                        ...prev,
                        codeValues: [...prev.codeValues, newCode],
                        updatedAt: new Date().toISOString(),
                      }));
                    }}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    코드 추가
                  </button>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className={`${theme.darkMode ? "bg-slate-900" : "bg-slate-100"}`}>
                      <tr>
                        <th className="px-3 py-2 text-left">코드 타입</th>
                        <th className="px-3 py-2 text-left">코드 키</th>
                        <th className="px-3 py-2 text-left">코드명</th>
                        <th className="px-3 py-2 text-left">색상</th>
                        <th className="px-3 py-2 text-center">활성화</th>
                        <th className="px-3 py-2 text-center">순서</th>
                        <th className="px-3 py-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCodeValues.map((code) => (
                        <tr key={code.id} className={`${theme.darkMode ? "border-b border-slate-700 hover:bg-slate-950" : "border-b border-slate-200 hover:bg-slate-50"}`}>
                          <td className="px-3 py-2 text-xs">
                            <select
                              value={code.codeType}
                              onChange={(e) => {
                                const newType = e.target.value as CodeValue["codeType"];
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, codeType: newType } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-xs" : "w-full rounded border border-slate-300 px-2 py-1 text-xs"}`}
                            >
                              <option value="dormStatus">기숙사 상태</option>
                              <option value="residenceStatus">거주 상태</option>
                              <option value="cleaningStatus">청소 상태</option>
                              <option value="defectStatus">하자 상태</option>
                              <option value="site">지역</option>
                              <option value="gender">성별</option>
                              <option value="contractStatus">계약 상태</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <input
                              type="text"
                              value={code.codeKey}
                              onChange={(e) => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, codeKey: e.target.value } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-xs" : "w-full rounded border border-slate-300 px-2 py-1 text-xs"}`}
                            />
                            <div className="mt-1 text-xs text-slate-500">화면 라벨: {getCodeKeyLabel(code.codeKey)}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <input
                              type="text"
                              value={code.codeName}
                              onChange={(e) => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, codeName: e.target.value } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-xs" : "w-full rounded border border-slate-300 px-2 py-1 text-xs"}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="color"
                              value={code.colorCode || "#ffffff"}
                              onChange={(e) => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, colorCode: e.target.value } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "mx-auto h-10 w-16 rounded border border-slate-600" : "mx-auto h-10 w-16 rounded border border-slate-300"}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={code.isActive}
                              onChange={() => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, isActive: !c.isActive } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              value={code.order}
                              onChange={(e) => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.map((c) =>
                                    c.id === code.id ? { ...c, order: Number(e.target.value) } : c
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className={`${theme.darkMode ? "w-12 rounded border border-slate-600 px-2 py-1 text-center" : "w-12 rounded border border-slate-300 px-2 py-1 text-center"}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  codeValues: prev.codeValues.filter((c) => c.id !== code.id),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="text-rose-600 hover:text-rose-800 text-xs"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Field Management */}
            {settingsSubTab === "fieldManagement" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                    {settingsMode === "beginner"
                      ? "자주 사용하는 필드를 카드 형태로 편하게 관리하세요."
                      : "필드 키를 포함한 전체 필드 설정을 자세히 편집합니다."}
                  </p>
                  {settingsMode === "advanced" && (
                    <span className="text-xs text-slate-500">fieldKey는 고급 모드에서만 표시됩니다.</span>
                  )}
                </div>

                {settingsMode === "beginner" ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {systemSettings.fields.map((field) => (
                      <div key={field.id} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                        <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>
                          {getTabLabel(field.tabKey)} · {field.fieldName}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className={`${theme.darkMode ? "inline-flex items-center gap-2 text-sm text-slate-300" : "inline-flex items-center gap-2 text-sm text-slate-700"}`}>
                            <input
                              type="checkbox"
                              checked={field.isVisible}
                              disabled={!canModifyPermission(currentUser)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((item) =>
                                    item.id === field.id ? { ...item, isVisible: checked } : item
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            표시
                          </label>
                          <label className={`${theme.darkMode ? "inline-flex items-center gap-2 text-sm text-slate-300" : "inline-flex items-center gap-2 text-sm text-slate-700"}`}>
                            <input
                              type="checkbox"
                              checked={field.isRequired}
                              disabled={!canModifyPermission(currentUser)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((item) =>
                                    item.id === field.id ? { ...item, isRequired: checked } : item
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            필수
                          </label>
                          <label className={`${theme.darkMode ? "inline-flex items-center gap-2 text-sm text-slate-300" : "inline-flex items-center gap-2 text-sm text-slate-700"}`}>
                            <input
                              type="checkbox"
                              checked={field.isReadOnly}
                              disabled={!canModifyPermission(currentUser)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((item) =>
                                    item.id === field.id ? { ...item, isReadOnly: checked } : item
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            읽기전용
                          </label>
                          <label className={`${theme.darkMode ? "inline-flex items-center gap-2 text-sm text-slate-300" : "inline-flex items-center gap-2 text-sm text-slate-700"}`}>
                            <input
                              type="checkbox"
                              checked={field.adminOnlyEdit}
                              disabled={!canModifyPermission(currentUser)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSystemSettings((prev) => ({
                                  ...prev,
                                  fields: prev.fields.map((item) =>
                                    item.id === field.id ? { ...item, adminOnlyEdit: checked } : item
                                  ),
                                  updatedAt: new Date().toISOString(),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            관리자만
                          </label>
                        </div>
                        <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
                          <span>순서</span>
                          <input
                            type="number"
                            min={1}
                            value={field.order}
                            disabled={!canModifyPermission(currentUser)}
                            onChange={(e) => {
                              const order = parseInt(e.target.value, 10) || field.order;
                              setSystemSettings((prev) => ({
                                ...prev,
                                fields: prev.fields.map((item) =>
                                  item.id === field.id ? { ...item, order } : item
                                ),
                                updatedAt: new Date().toISOString(),
                              }));
                            }}
                            className={`${theme.darkMode ? "w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-300" : "w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`overflow-x-auto rounded-2xl border ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className={`${theme.darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                        <tr>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>메뉴</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>필드명</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>fieldKey</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>표시</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>필수</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>읽기전용</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>관리자만</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>순서</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {systemSettings.fields.map((field) => (
                          <tr key={field.id}>
                            <td className="px-3 py-3">{getTabLabel(field.tabKey)}</td>
                            <td className="px-3 py-3">{field.fieldName}</td>
                            <td className="px-3 py-3">{getFieldLabel(field.fieldKey)}</td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={field.isVisible}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    fields: prev.fields.map((item) =>
                                      item.id === field.id ? { ...item, isVisible: checked } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={field.isRequired}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    fields: prev.fields.map((item) =>
                                      item.id === field.id ? { ...item, isRequired: checked } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={field.isReadOnly}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    fields: prev.fields.map((item) =>
                                      item.id === field.id ? { ...item, isReadOnly: checked } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={field.adminOnlyEdit}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    fields: prev.fields.map((item) =>
                                      item.id === field.id ? { ...item, adminOnlyEdit: checked } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="number"
                                min={1}
                                value={field.order}
                                disabled={!canModifyPermission(currentUser)}
                                className={`${theme.darkMode ? "w-16 rounded border border-slate-600 px-2 py-1 text-center" : "w-16 rounded border border-slate-300 px-2 py-1 text-center"}`}
                                onChange={(e) => {
                                  const order = parseInt(e.target.value, 10) || field.order;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    fields: prev.fields.map((item) =>
                                      item.id === field.id ? { ...item, order } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Permission Management */}
            {settingsSubTab === "permissionManagement" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                    {settingsMode === "beginner"
                      ? "역할별로 가장 중요한 메뉴 권한을 카드 형태로 관리합니다."
                      : "권한별 메뉴 접근과 CRUD 권한을 세부적으로 관리합니다."}
                  </p>
                </div>
                {settingsMode === "beginner" ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {Object.entries(permissionsByRole).map(([role, perms]) => (
                      <div key={role} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                        <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>{getRoleLabel(role as UserRole)}</div>
                        <div className="space-y-3">
                          {perms.map((perm) => (
                            <div key={`${role}-${perm.tabKey}`} className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-white p-3"}`}>
                              <div className={`${theme.darkMode ? "mb-2 text-sm font-medium text-slate-300" : "mb-2 text-sm font-medium text-slate-700"}`}>{getTabLabel(perm.tabKey)}</div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {[
                                  { label: "조회", value: "canView" },
                                  { label: "생성", value: "canCreate" },
                                  { label: "수정", value: "canEdit" },
                                  { label: "삭제", value: "canDelete" },
                                ].map((item) => (
                                  <label key={item.value} className={`${theme.darkMode ? "inline-flex items-center gap-2 text-sm text-slate-300" : "inline-flex items-center gap-2 text-sm text-slate-700"}`}>
                                    <input
                                      type="checkbox"
                                      checked={perm[item.value as keyof PermissionConfig] as boolean}
                                      disabled={!canModifyPermission(currentUser)}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setSystemSettings((prev) => ({
                                          ...prev,
                                          permissions: prev.permissions.map((permission) =>
                                            permission.role === perm.role && permission.tabKey === perm.tabKey
                                              ? { ...permission, [item.value]: checked }
                                              : permission
                                          ),
                                          updatedAt: new Date().toISOString(),
                                        }));
                                      }}
                                      className="h-4 w-4"
                                    />
                                    {item.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`overflow-x-auto rounded-2xl border ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className={`${theme.darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                        <tr>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>역할</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>화면</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>조회</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>생성</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>수정</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-center font-semibold text-slate-300" : "px-3 py-3 text-center font-semibold text-slate-700"}`}>삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {systemSettings.permissions.map((perm) => (
                          <tr key={`${perm.role}-${perm.tabKey}`}>
                            <td className="px-3 py-3">{getRoleLabel(perm.role)}</td>
                            <td className="px-3 py-3">{getTabLabel(perm.tabKey)}</td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canView}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    permissions: prev.permissions.map((item) =>
                                      item.role === perm.role && item.tabKey === perm.tabKey
                                        ? { ...item, canView: checked }
                                        : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canCreate}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    permissions: prev.permissions.map((item) =>
                                      item.role === perm.role && item.tabKey === perm.tabKey
                                        ? { ...item, canCreate: checked }
                                        : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canEdit}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    permissions: prev.permissions.map((item) =>
                                      item.role === perm.role && item.tabKey === perm.tabKey
                                        ? { ...item, canEdit: checked }
                                        : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canDelete}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    permissions: prev.permissions.map((item) =>
                                      item.role === perm.role && item.tabKey === perm.tabKey
                                        ? { ...item, canDelete: checked }
                                        : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Screen Settings */}
            {settingsSubTab === "screenSettings" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}`}>
                    {settingsMode === "beginner"
                      ? "화면을 선택해 표시 컬럼과 순서를 간단히 설정합니다."
                      : "모든 화면별 열 표시, 순서, 기본 필터 설정을 JSON 형태로 편집합니다."}
                  </p>
                  {settingsMode === "beginner" && (
                    <div className="text-xs text-slate-500">메뉴 선택 후 해당 화면만 간단히 편집하세요.</div>
                  )}
                </div>
                {settingsMode === "beginner" ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>화면 선택</label>
                        <select
                          value={selectedScreenTab}
                          onChange={(e) => setSelectedScreenTab(e.target.value as TabKey | "all")}
                          className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 bg-slate-950 px-3 py-3 outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"}`}
                        >
                          <option value="all">전체 화면</option>
                          {systemSettings.screenSettings.map((screen) => (
                            <option key={screen.id} value={screen.tabKey}>
                              {getTabLabel(screen.tabKey)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {currentScreenSettings.map((screen) => (
                        <div key={screen.id} className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                          <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>{getTabLabel(screen.tabKey)}</div>
                          <div className="space-y-3">
                            <div>
                              <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>표시 컬럼</label>
                              <input
                                className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400"}`}
                                type="text"
                                value={screen.visibleColumns.join(", ")}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const next = e.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean);
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    screenSettings: prev.screenSettings.map((item) =>
                                      item.id === screen.id ? { ...item, visibleColumns: next } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                              <p className="mt-2 text-xs text-slate-500">표시 컬럼(한글): {screen.visibleColumns.map((k) => getFieldLabel(k)).join(", ")}</p>
                            </div>
                            <div>
                              <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>컬럼 순서</label>
                              <input
                                className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400"}`}
                                type="text"
                                value={screen.columnOrder.join(", ")}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const next = e.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean);
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    screenSettings: prev.screenSettings.map((item) =>
                                      item.id === screen.id ? { ...item, columnOrder: next } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                              <p className="mt-2 text-xs text-slate-500">컬럼 순서(한글): {screen.columnOrder.map((k) => getFieldLabel(k)).join(", ")}</p>
                            </div>
                            <div>
                              <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>기본 필터</label>
                              <input
                                className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-slate-400"}`}
                                type="text"
                                value={JSON.stringify(screen.defaultFilter || {})}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    if (parsed && typeof parsed === "object") {
                                      setSystemSettings((prev) => ({
                                        ...prev,
                                        screenSettings: prev.screenSettings.map((item) =>
                                          item.id === screen.id ? { ...item, defaultFilter: parsed } : item
                                        ),
                                        updatedAt: new Date().toISOString(),
                                      }));
                                    }
                                  } catch {
                                    // invalid JSON는 무시
                                  }
                                }}
                              />
                              <p className="mt-2 text-xs text-slate-500">기본 필터(한글): {screen.defaultFilter ? Object.entries(screen.defaultFilter).map(([k, v]) => `${getFieldLabel(k)}: ${v}`).join(", ") : "-"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`overflow-x-auto rounded-2xl border ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className={`${theme.darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                        <tr>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>tabKey</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>visibleColumns</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>columnOrder</th>
                          <th className={`${theme.darkMode ? "px-3 py-3 text-left font-semibold text-slate-300" : "px-3 py-3 text-left font-semibold text-slate-700"}`}>defaultFilter</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {systemSettings.screenSettings.map((screen) => (
                          <tr key={screen.id}>
                            <td className="px-3 py-3">{getTabLabel(screen.tabKey)}</td>
                            <td className="px-3 py-3">
                              <input
                                className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-sm" : "w-full rounded border border-slate-300 px-2 py-1 text-sm"}`}
                                type="text"
                                value={screen.visibleColumns.join(",")}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const next = e.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean);
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    screenSettings: prev.screenSettings.map((item) =>
                                      item.id === screen.id ? { ...item, visibleColumns: next } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                              <div className="mt-2 text-xs text-slate-500">{screen.visibleColumns.map((k) => getFieldLabel(k)).join(", ")}</div>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-sm" : "w-full rounded border border-slate-300 px-2 py-1 text-sm"}`}
                                type="text"
                                value={screen.columnOrder.join(",")}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  const next = e.target.value
                                    .split(",")
                                    .map((item) => item.trim())
                                    .filter(Boolean);
                                  setSystemSettings((prev) => ({
                                    ...prev,
                                    screenSettings: prev.screenSettings.map((item) =>
                                      item.id === screen.id ? { ...item, columnOrder: next } : item
                                    ),
                                    updatedAt: new Date().toISOString(),
                                  }));
                                }}
                              />
                              <div className="mt-2 text-xs text-slate-500">{screen.columnOrder.map((k) => getFieldLabel(k)).join(", ")}</div>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                className={`${theme.darkMode ? "w-full rounded border border-slate-600 px-2 py-1 text-sm" : "w-full rounded border border-slate-300 px-2 py-1 text-sm"}`}
                                type="text"
                                value={JSON.stringify(screen.defaultFilter || {})}
                                disabled={!canModifyPermission(currentUser)}
                                onChange={(e) => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    if (parsed && typeof parsed === "object") {
                                      setSystemSettings((prev) => ({
                                        ...prev,
                                        screenSettings: prev.screenSettings.map((item) =>
                                          item.id === screen.id ? { ...item, defaultFilter: parsed } : item
                                        ),
                                        updatedAt: new Date().toISOString(),
                                      }));
                                    }
                                  } catch {
                                    // invalid JSON는 무시
                                  }
                                }}
                              />
                              <div className="mt-2 text-xs text-slate-500">{screen.defaultFilter ? Object.entries(screen.defaultFilter).map(([k, v]) => `${getFieldLabel(k)}: ${v}`).join(", ") : "-"}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {settingsSubTab === "trashManagement" && (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-5" : "rounded-3xl border border-slate-200 bg-slate-50 p-5"}`}>
                    <div className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>휴지통 요약</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">기숙사</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedDorms.length}</div>
                      </div>
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">계약</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedDormContracts.length}</div>
                      </div>
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">신규계약</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedLeases.length}</div>
                      </div>
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">신입사원</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedNewHires.length}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">입주자</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedOccupants.length}</div>
                      </div>
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">비품</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedInventory.length}</div>
                      </div>
                      <div className={`rounded-3xl p-4 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
                        <div className="text-xs text-slate-500">하자</div>
                        <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedDefects.length}</div>
                      </div>
                    </div>
                    <div className={`${theme.darkMode ? "mt-3 rounded-3xl bg-slate-950 p-4 shadow-sm ring-1 ring-slate-200" : "mt-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"}`}>
                      <div className="text-xs text-slate-500">청소 보고서</div>
                      <div className={`${theme.darkMode ? "mt-2 text-xl font-semibold text-slate-100" : "mt-2 text-xl font-semibold text-slate-900"}`}>{deletedCleaningReports.length}</div>
                    </div>
                  </div>
                  <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-sm" : "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className={`${theme.darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-700"}`}>감사 로그</div>
                        <div className="text-xs text-slate-500">최근 변경 내역을 확인하세요.</div>
                      </div>
                      <div className="text-xs text-slate-500">총 {auditLogs.length}건</div>
                    </div>
                    <div className="max-h-80 space-y-3 overflow-y-auto">
                      {auditLogs.length > 0 ? (
                        auditLogs.slice(0, 20).map((log) => (
                          <div key={log.id} className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-3" : "rounded-2xl border border-slate-200 bg-slate-50 p-3"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-800">{log.actionType} · {log.targetType}</div>
                              <div className="text-xs text-slate-500">{log.changedAt.slice(0, 10)}</div>
                            </div>
                            <div className="mt-2 text-xs text-slate-500">{log.changedBy}</div>
                            {log.memo && <div className="mt-1 text-xs text-slate-500">{log.memo}</div>}
                          </div>
                        ))
                      ) : (
                        <div className={`${theme.darkMode ? "rounded-2xl border border-dashed border-slate-600 bg-slate-950 p-6 text-center text-slate-400" : "rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-400"}`}>기록된 감사 로그가 없습니다.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {deletedDorms.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 기숙사</h3>
                          <p className="text-sm text-slate-500">복원 또는 영구 삭제가 가능합니다.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedDorms.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.buildingName} {item.dong}-{item.roomHo}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(dorms, setDorms, item.id, "dorm")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(dorms, setDorms, item.id, "dorm")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedDormContracts.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 신규계약</h3>
                          <p className="text-sm text-slate-500">삭제된 계약을 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedDormContracts.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.buildingName} {item.dong}-{item.roomHo} ({item.contractStatus})</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(dormContracts, setDormContracts, item.id, "dormContract")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(dormContracts, setDormContracts, item.id, "dormContract")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedLeases.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 신규계약(Lease)</h3>
                          <p className="text-sm text-slate-500">삭제된 Lease 데이터를 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedLeases.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.addressName} {item.dong}-{item.ho} ({item.contractPeriod})</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(leases, setLeases, item.id, "lease")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(leases, setLeases, item.id, "lease")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedNewHires.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 신입사원</h3>
                          <p className="text-sm text-slate-500">삭제된 직원 정보를 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedNewHires.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.name} / {item.buildingName} {item.dong}-{item.roomHo}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(newHires, setNewHires, item.id, "newHire")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(newHires, setNewHires, item.id, "newHire")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedOccupants.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 입주자</h3>
                          <p className="text-sm text-slate-500">삭제된 입주자를 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedOccupants.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>
                              {item.employeeName} / {dorms.find((d) => d.id === item.dormId)
                                ? `${dorms.find((d) => d.id === item.dormId)?.buildingName} ${dorms.find((d) => d.id === item.dormId)?.dong}-${dorms.find((d) => d.id === item.dormId)?.roomHo}`
                                : item.dormId}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(occupants, setOccupants, item.id, "occupant")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(occupants, setOccupants, item.id, "occupant")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedInventory.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 비품</h3>
                          <p className="text-sm text-slate-500">삭제된 비품 데이터를 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedInventory.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.itemName} / {item.buildingName} {item.dong}-{item.roomHo}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(inventory, setInventory, item.id, "inventory")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(inventory, setInventory, item.id, "inventory")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedDefects.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 하자 접수</h3>
                          <p className="text-sm text-slate-500">삭제된 하자 접수 건을 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedDefects.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.buildingName} {item.dong}-{item.ho} / {item.defectStatus}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(defects, setDefects, item.id, "defect")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(defects, setDefects, item.id, "defect")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deletedCleaningReports.length > 0 && (
                    <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-800">삭제된 청소 보고서</h3>
                          <p className="text-sm text-slate-500">삭제된 청소 보고서를 복원하거나 영구 삭제하세요.</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {deletedCleaningReports.map((item) => (
                          <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                            <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>{item.buildingName} {item.dong}-{item.roomHo} / {item.cleanStatus}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => restoreItem(cleaningReports, setCleaningReports, item.id, "cleaningReport")}
                                className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                              >
                                복원
                              </button>
                              <button
                                onClick={() => permanentlyDeleteItem(cleaningReports, setCleaningReports, item.id, "cleaningReport")}
                                className="rounded-2xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                              >
                                영구 삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "recycleBin" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">🗑️ 휴지통 관리</h2>
                <p className="text-sm text-slate-500">삭제된 데이터를 복원하거나 영구 삭제합니다.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">신규계약</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{dormContracts.filter(c => c.isDeleted).length}</div>
                <div className="mt-2 text-sm text-slate-500">삭제됨</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">신입사원</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{newHires.filter(h => h.isDeleted).length}</div>
                <div className="mt-2 text-sm text-slate-500">삭제됨</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">입주자</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{occupants.filter(o => o.isDeleted).length}</div>
                <div className="mt-2 text-sm text-slate-500">삭제됨</div>
              </div>
              <div className={`${theme.darkMode ? "rounded-3xl border border-slate-700 bg-slate-950 p-4" : "rounded-3xl border border-slate-200 bg-slate-50 p-4"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">비품</div>
                <div className={`${theme.darkMode ? "mt-3 text-2xl font-semibold text-slate-100" : "mt-3 text-2xl font-semibold text-slate-900"}`}>{inventory.filter(i => i.isDeleted).length}</div>
                <div className="mt-2 text-sm text-slate-500">삭제됨</div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* 신규계약 휴지통 */}
              {dormContracts.filter(c => c.isDeleted).length > 0 && (
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">삭제된 신규계약</h3>
                      <p className="text-sm text-slate-500">삭제된 계약 데이터를 복원하거나 영구 삭제하세요.</p>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {dormContracts.filter(c => c.isDeleted).map((contract) => (
                      <div key={contract.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                        <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>
                          {contract.buildingName} {contract.dong}-{contract.roomHo} ({contract.contractStatus})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setDormContracts(prev => prev.map(c => 
                                c.id === contract.id ? { ...c, isDeleted: false, deletedAt: undefined, deletedBy: undefined } : c
                              ));
                              addAuditLog({
                                targetType: "dormContract",
                                targetId: contract.id,
                                actionType: "restore",
                                changedBy: currentUser?.displayName || "",
                                beforeValue: "삭제됨",
                                afterValue: "복원됨",
                                memo: "휴지통에서 복원",
                              });
                            }}
                            className="rounded-2xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                          >
                            복원
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("정말로 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                                setDormContracts(prev => prev.filter(c => c.id !== contract.id));
                              }
                            }}
                            className="rounded-2xl bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                          >
                            영구삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 신입사원 휴지통 */}
              {newHires.filter(h => h.isDeleted).length > 0 && (
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">삭제된 신입사원</h3>
                      <p className="text-sm text-slate-500">삭제된 신입사원 데이터를 복원하거나 영구 삭제하세요.</p>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {newHires.filter(h => h.isDeleted).map((hire) => (
                      <div key={hire.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                        <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>
                          {hire.name} ({hire.residenceStatus})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setNewHires(prev => prev.map(h => 
                                h.id === hire.id ? { ...h, isDeleted: false, deletedAt: undefined, deletedBy: undefined } : h
                              ));
                              addAuditLog({
                                targetType: "newHire",
                                targetId: hire.id,
                                actionType: "restore",
                                changedBy: currentUser?.displayName || "",
                                beforeValue: "삭제됨",
                                afterValue: "복원됨",
                                memo: "휴지통에서 복원",
                              });
                            }}
                            className="rounded-2xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                          >
                            복원
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("정말로 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                                setNewHires(prev => prev.filter(h => h.id !== hire.id));
                                // 관련 입주자도 영구 삭제
                                setOccupants(prev => prev.filter(o => o.sourceNewHireId !== hire.id));
                              }
                            }}
                            className="rounded-2xl bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                          >
                            영구삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 입주자 휴지통 */}
              {occupants.filter(o => o.isDeleted).length > 0 && (
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">삭제된 입주자</h3>
                      <p className="text-sm text-slate-500">삭제된 입주자 데이터를 복원하거나 영구 삭제하세요.</p>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {occupants.filter(o => o.isDeleted).map((occupant) => (
                      <div key={occupant.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                        <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>
                          {occupant.employeeName} ({occupant.status})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setOccupants(prev => prev.map(o => 
                                o.id === occupant.id ? { ...o, isDeleted: false, deletedAt: undefined, deletedBy: undefined } : o
                              ));
                              addAuditLog({
                                targetType: "occupant",
                                targetId: occupant.id,
                                actionType: "restore",
                                changedBy: currentUser?.displayName || "",
                                beforeValue: "삭제됨",
                                afterValue: "복원됨",
                                memo: "휴지통에서 복원",
                              });
                            }}
                            className="rounded-2xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                          >
                            복원
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("정말로 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                                setOccupants(prev => prev.filter(o => o.id !== occupant.id));
                              }
                            }}
                            className="rounded-2xl bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                          >
                            영구삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 비품 휴지통 */}
              {inventory.filter(i => i.isDeleted).length > 0 && (
                <div className={`rounded-3xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">삭제된 비품</h3>
                      <p className="text-sm text-slate-500">삭제된 비품 데이터를 복원하거나 영구 삭제하세요.</p>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {inventory.filter(i => i.isDeleted).map((item) => (
                      <div key={item.id} className={`${theme.darkMode ? "flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"}`}>
                        <div className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>
                          {item.itemName} ({item.status})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setInventory(prev => prev.map(i => 
                                i.id === item.id ? { ...i, isDeleted: false, deletedAt: undefined, deletedBy: undefined } : i
                              ));
                              addAuditLog({
                                targetType: "inventory",
                                targetId: item.id,
                                actionType: "restore",
                                changedBy: currentUser?.displayName || "",
                                beforeValue: "삭제됨",
                                afterValue: "복원됨",
                                memo: "휴지통에서 복원",
                              });
                            }}
                            className="rounded-2xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                          >
                            복원
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("정말로 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                                setInventory(prev => prev.filter(i => i.id !== item.id));
                              }
                            }}
                            className="rounded-2xl bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                          >
                            영구삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "testChecklist" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">✅ 관리자용 테스트 체크리스트</h2>
                <p className="text-sm text-slate-500 mt-1">시스템 운영 전 필수 검증 항목들 - 모든 항목을 확인 후 운영 시작하세요</p>
              </div>
              <div className="text-sm text-slate-500">
                <div>총 {[
                  // 대시보드 검증 (7개)
                  7,
                  // 알림관리 검증 (4개)
                  4,
                  // 문서관리 검증 (4개)
                  4,
                  // 보고서 엑셀 다운로드 (5개)
                  5,
                  // 통합 동기화 (6개)
                  6,
                  // 권한별 접근 (4개)
                  4,
                  // 성능 및 안정성 (5개)
                  5
                ].reduce((a, b) => a + b, 0)}개 항목</div>
              </div>
            </div>

            <div className="space-y-6">
              {/* 1. 대시보드 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>📊 1. 대시보드 요약 카드 검증 (7개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 미배정 신입사원 수 표시 확인 (카드 클릭 시 신입사원 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 계약 만료 예정 수 표시 확인 (카드 클릭 시 신규계약 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 공실률 % 표시 확인 (카드 클릭 시 입주자 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 미처리 하자 수 표시 확인 (카드 클릭 시 하자접수 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 청소 미보고 수 표시 확인 (카드 클릭 시 청소관리 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 비품 노후/부족 수 표시 확인 (카드 클릭 시 비품현황 메뉴 이동)</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 모든 카드에 hover 효과 및 클릭 가능 표시 확인</label>
                </div>
              </div>

              {/* 2. 알림관리 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>🔔 2. 알림관리 클릭 이동 검증 (4개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 계약 만료 알림 더블클릭 → 신규계약 메뉴 이동 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 미완료 하자 알림 더블클릭 → 하자접수 메뉴 이동 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 청소 미보고 알림 더블클릭 → 청소관리 메뉴 이동 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 기숙사관리자 권한: 자신 기숙사 알림만 조회 가능 확인</label>
                </div>
              </div>

              {/* 3. 문서관리 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>📁 3. 문서관리 자동 수집 검증 (4개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 기숙사별 계약 문서 자동 조회 및 다운로드 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 기숙사별 청소 보고서 자동 조회 및 다운로드 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 기숙사별 하자 기록 자동 조회 및 사진 다운로드 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 최근 업로드 문서 5개씩 표시 및 다운로드 확인</label>
                </div>
              </div>

              {/* 4. 보고서 엑셀 다운로드 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>📈 4. 보고서 엑셀 다운로드 검증 (5개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 월간운영 보고서 다운로드 및 데이터 정확성 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 미배정자 보고서 다운로드 및 필터링 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 하자 처리 보고서 다운로드 및 상태별 분류 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 청소 미보고 보고서 다운로드 및 퇴실자 필터링 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 비품 현황 보고서 다운로드 및 상태별 집계 확인</label>
                </div>
              </div>

              {/* 5. 통합 동기화 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>🔄 5. 통합 동기화 시스템 검증 (6개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 신규계약 등록 → operationalDorms 자동 생성 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 신입사원 배정 → occupants 자동 생성 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 입주자 퇴실 → 기숙사 공실 상태 자동 변경 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 퇴실 처리 → 청소관리 자동 생성 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 퇴실 처리 → 하자점검 자동 생성 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 계약만료 → 알림관리 자동 생성 확인</label>
                </div>
              </div>

              {/* 6. 권한별 접근 제어 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>👥 6. 권한별 접근 제어 검증 (4개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 관리자 권한: 모든 메뉴 조회/수정/삭제 가능 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 뷰어 권한: 조회만 가능, 수정/삭제 불가 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 기숙사관리자: 자신의 기숙사만 조회/수정 가능 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 하자처리담당자: 하자접수 메뉴만 접근 가능 확인</label>
                </div>
              </div>

              {/* 7. 성능 및 안정성 검증 */}
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 p-4 bg-slate-950" : "rounded-2xl border border-slate-200 p-4 bg-slate-50"}`}>
                <h3 className={`${theme.darkMode ? "font-semibold text-slate-300 mb-3" : "font-semibold text-slate-700 mb-3"}`}>⚡ 7. 성능 및 안정성 검증 (5개)</h3>
                <div className="space-y-2 ml-4">
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 대용량 데이터(1000개 이상) 로딩 시 3초 이내 완료 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> localStorage 데이터 저장/복구 정상 작동 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 브라우저 새로고침 후 모든 데이터 유지 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> TypeScript 컴파일 오류 없이 빌드 성공 확인</label>
                  <label className="flex items-center gap-3"><input type="checkbox" className="rounded" /> 메모리 누수 없이 장시간 사용 가능 확인</label>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 mt-6">
                <p className="text-sm text-blue-700">
                  💡 <strong>테스트 완료 후:</strong> 모든 체크리스트 항목을 확인하신 후 시스템을 운영 환경에 배포하세요.
                  문제가 발견되면 해당 메뉴로 이동하여 데이터를 검토하고 수정하시기 바랍니다.
                </p>
              </div>
            </div>
          </section>
        )}

        {activeTab === "defects" && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">하자접수건</h2>
                <p className="text-sm text-slate-500">
                  접수일, 기숙사관리자명, 주소, 하자신청/완료 내용, 사진 첨부
                </p>
              </div>

            </div>

            <div className="grid gap-4 mb-4 md:grid-cols-4">
              <MiniStat label="전체 접수건" value={`${visibleDefects.length}`} />
              <MiniStat label="접수" value={`${visibleDefects.filter((d) => d.defectStatus === "접수").length}`} />
              <MiniStat label="진행중" value={`${visibleDefects.filter((d) => d.defectStatus === "진행중").length}`} />
              <MiniStat label="완료" value={`${visibleDefects.filter((d) => d.defectStatus === "완료").length}`} />
            </div>

            <div className="grid gap-3 mb-6 md:grid-cols-3">
              <div className="md:col-span-1">
                <SelectInput
                  label="상태 필터"
                  value={defectStatusFilter}
                  onChange={(v) => setDefectStatusFilter(v as "전체" | "접수" | "진행중" | "완료")}
                  options={["전체", "접수", "진행중", "완료"]}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  label="검색"
                  value={defectSearch}
                  onChange={setDefectSearch}
                  placeholder="관리자명, 주소, 내용 검색"
                />
              </div>
              <div className="flex items-end justify-end gap-2 md:col-span-1">
                {canFileDefect(currentUser) && (
                  <button
                    onClick={() => {
                      const currentDorm =
                        currentUser?.role === "maintenance_reporter" && currentUser.dormId
                          ? operationalDorms.find((d) => d.id === currentUser.dormId)
                          : undefined;
                      setDefectForm({
                        ...defectTemplate(),
                        reporterUserId: currentUser.id,
                        reporterName: currentUser.displayName,
                        dormManagerName: currentUser.displayName,
                        site: currentDorm?.site || "평택",
                        dormId: currentDorm?.id || "",
                        buildingName: currentDorm?.buildingName || "",
                        dong: currentDorm?.dong || "",
                        ho: currentDorm?.roomHo || "",
                        공동현관: currentDorm?.공동현관 || "",
                        세대현관: currentDorm?.세대현관 || "",
                        roadAddress: currentDorm?.address || "",
                      });
                      setEditingDefectId(null);
                      setShowDefectForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"
                  >
                    <Plus className="h-4 w-4" /> 하자접수
                  </button>
                )}

                {canManageUsers(currentUser) && selectedDefectIds.length > 0 && (
                  <button
                    onClick={() => {
                      setDefects((prev) => prev.filter((d) => !selectedDefectIds.includes(d.id)));
                      setSelectedDefectIds([]);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-700"
                  >
                    선택삭제
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1500px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          visibleDefects.length > 0 &&
                          selectedDefectIds.length === visibleDefects.length
                        }
                        onChange={(e) => {
                          if (e.target.checked) setSelectedDefectIds(visibleDefects.map((d) => d.id));
                          else setSelectedDefectIds([]);
                        }}
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-3 py-2 text-center">구분</th>
                    <th className="px-3 py-2 text-center">접수일</th>
                    <th className="px-3 py-2 text-center">기숙사관리자명</th>
                    <th className="px-3 py-2 text-center">건물명</th>
                    <th className="px-3 py-2 text-center">도로명주소</th>
                    <th className="px-3 py-2 text-center">동</th>
                    <th className="px-3 py-2 text-center">호수</th>
                    <th className="px-3 py-2 text-center">공동현관</th>
                    <th className="px-3 py-2 text-center">세대현관</th>
                    <th className="px-3 py-2 text-center">상황</th>
                    <th className="px-3 py-2 text-center">하자신청</th>

                    {currentUser.role !== "maintenance_reporter" && (
                      <>
                        <th className="px-3 py-2 text-center">점검자</th>
                        <th className="px-3 py-2 text-center">완료내용</th>
                      </>
                    )}

                    <th className="px-3 py-2 text-center">접수사진</th>
                    {currentUser.role !== "maintenance_reporter" && (
                      <th className="px-3 py-2 text-center">완료사진</th>
                    )}
                    <th className="px-3 py-2 text-centerer">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDefects.map((d, idx) => (
                    <tr
                      key={d.id}
                      onClick={(e) => handleRowClick(e, () => openDefectEdit(d))}
                      className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedDefectIds.includes(d.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDefectIds((prev) => [...prev, d.id]);
                            } else {
                              setSelectedDefectIds((prev) => prev.filter((id) => id !== d.id));
                            }
                          }}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">{idx + 1}</td>
                      <td className="px-3 py-3">{d.receiptDate}</td>
                      <td className="px-3 py-3">{d.dormManagerName}</td>
                      <td className="px-3 py-3">{d.buildingName}</td>
                      <td className="px-3 py-3">{d.roadAddress}</td>
                      <td className="px-3 py-3">{d.dong}</td>
                      <td className="px-3 py-3">{d.ho}</td>
                      <td className="px-3 py-3">{d.공동현관}</td>
                      <td className="px-3 py-3">{d.세대현관}</td>
                      <td className="px-3 py-3">
                        <span
                          className="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-300 dark:ring-slate-400 dark:text-white"
                          style={{ backgroundColor: badgeColor(theme, d.defectStatus) }}
                        >
                          {d.defectStatus}
                        </span>
                      </td>
                      <td className="px-3 py-3">{d.requestText}</td>

                      {currentUser.role !== "maintenance_reporter" && (
                        <>
                          <td className="px-3 py-3">{d.inspectorName || "-"}</td>
                          <td className="px-3 py-3">{d.completeText || "-"}</td>
                        </>
                      )}

                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {d.requestPhotoDataUrls.map((src, idx) => (
                            <a
                              key={idx}
                              href={src}
                              download={`request-${d.id}-${idx + 1}.png`}
                              className={`${theme.darkMode ? "rounded-lg border border-slate-600 px-2 py-1 text-xs hover:bg-slate-950" : "rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"}`}
                            >
                              접수{idx + 1}
                            </a>
                          ))}
                          {d.requestPhotoDataUrls.length === 0 && "-"}
                        </div>
                      </td>

                      {currentUser.role !== "maintenance_reporter" && (
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            {d.completionPhotoDataUrls.map((src, idx) => (
                              <a
                                key={idx}
                                href={src}
                                download={`completion-${d.id}-${idx + 1}.png`}
                                className={`${theme.darkMode ? "rounded-lg border border-slate-600 px-2 py-1 text-xs hover:bg-slate-950" : "rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"}`}
                              >
                                완료{idx + 1}
                              </a>
                            ))}
                            {d.completionPhotoDataUrls.length === 0 && "-"}
                          </div>
                        </td>
                      )}

                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          {canFileDefect(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDefectEdit(d);
                              }}
                              className={`${theme.darkMode ? "rounded-xl border border-slate-600 p-2 hover:bg-slate-950" : "rounded-xl border border-slate-300 p-2 hover:bg-slate-50"}`}
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}

                          {canManageUsers(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                softDeleteItem(defects, setDefects, d.id, "defect");
                              }}
                              className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {visibleDefects.length === 0 && (
                    <tr>
                      <td
                        colSpan={currentUser.role !== "maintenance_reporter" ? 16 : 13}
                        className="px-4 py-12 text-center text-slate-400"
                      >
                        하자접수 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "users" && canManageUsers(currentUser) && (
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">계정 및 권한 설정</h2>
                <p className="text-sm text-slate-500">기숙사관리자 1명 지정, 하자접수 전용 계정 추가 생성</p>
              </div>
            </div>

            <div className="grid gap-4 mb-6 md:grid-cols-4">
              <MiniStat label="총 사용자" value={`${visibleUsers.length}`} />
              <MiniStat label="활성 사용자" value={`${visibleUsers.filter((u) => u.isActive).length}`} />
              <MiniStat label="관리자" value={`${visibleUsers.filter((u) => u.role === "admin").length}`} />
              <MiniStat label="뷰어" value={`${visibleUsers.filter((u) => u.role === "viewer").length}`} />
            </div>

            <div className="mb-6 flex flex-wrap gap-2 items-center justify-between">
              <input
                type="text"
                placeholder="아이디 또는 표시이름 검색"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className={`${theme.darkMode ? "rounded-2xl border border-slate-600 px-3 py-2 text-sm outline-none focus:border-slate-400 flex-1 max-w-md" : "rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 flex-1 max-w-md"}`}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setUserForm(userTemplate());
                    setEditingUserId(null);
                    setShowUserForm(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"
                >
                  <Plus className="h-4 w-4" /> 계정 추가
                </button>

                {selectedUserIds.length > 0 && (
                  <button
                    onClick={() => {
                      setUsers((prev) => prev.filter((u) => !selectedUserIds.includes(u.id)));
                      setSelectedUserIds([]);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-700"
                  >
                    선택삭제
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1100px] text-sm text-center">
                <thead className={`${theme.darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-700"}`}>
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={visibleUsers.length > 0 && selectedUserIds.length === visibleUsers.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedUserIds(visibleUsers.map((u) => u.id));
                          else setSelectedUserIds([]);
                        }}
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-3 py-2 text-center">구분</th>
                    <th className="px-3 py-2 text-center">표시이름</th>
                    <th className="px-3 py-2 text-center">아이디</th>
                    <th className="px-3 py-2 text-center">권한</th>
                    <th className="px-3 py-2 text-center">지역권한</th>
                    <th className="px-3 py-2 text-center">담당기숙사</th>
                    <th className="px-3 py-2 text-center">상태</th>
                    <th className="px-3 py-2 text-centerer">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u, idx) => {
                    const dorm = dorms.find((d) => d.id === u.dormId);
                    return (
                      <tr
                        key={u.id}
                        onClick={(e) => handleRowClick(e, () => openUserEdit(u))}
                        className={`${theme.darkMode ? "cursor-pointer border-b border-slate-700 hover:bg-slate-950" : "cursor-pointer border-b border-slate-100 hover:bg-slate-50"}`}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(u.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedUserIds((prev) => [...prev, u.id]);
                              } else {
                                setSelectedUserIds((prev) => prev.filter((id) => id !== u.id));
                              }
                            }}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-3 font-medium">{idx + 1}</td>
                        <td className="px-3 py-3">{u.displayName}</td>
                        <td className="px-3 py-3">{u.username}</td>
                        <td className="px-3 py-3">{getRoleLabel(u.role)}</td>
                        <td className="px-3 py-3">{u.siteAccess}</td>
                        <td className="px-3 py-3">{dorm ? `${dorm.buildingName} ${formatDong(dorm.dong)} ${formatRoomHo(dorm.roomHo)}` : "-"}</td>
                        <td className="px-3 py-3">{u.isActive ? "활성" : "비활성"}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserEdit(u);
                              }}
                              className={`${theme.darkMode ? "rounded-xl border border-slate-600 p-2 hover:bg-slate-950" : "rounded-xl border border-slate-300 p-2 hover:bg-slate-50"}`}
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            {u.id !== currentUser.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteById(setUsers, u.id);
                                }}
                                className="rounded-xl border border-rose-300 p-2 text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleUsers.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                        계정 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {showCleaningReportForm && modalWrap(
          "청소보고서 등록/수정",
          <div className="space-y-6">
            <div className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <h3 className="text-lg font-semibold mb-4">보고 기본정보</h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Input label="보고일" type="date-text" value={cleaningReportForm.reportDate} onChange={(v) => setCleaningReportForm((f) => ({ ...f, reportDate: v }))} />
                <SearchableSelect
                  label="기숙사 선택"
                  value={cleaningReportForm.dormId}
                  onChange={(v) => {
                    const selected = operationalDorms.find((d) => d.id === v);
                    handleCleaningReportDormChange(selected || null);
                  }}
                  options={getAccessibleOperationalDorms(currentUser, operationalDorms).map((d) => d.id)}
                  displayOptions={getAccessibleOperationalDorms(currentUser, operationalDorms).map((d) => `${d.buildingName} ${formatDong(d.dong)} ${formatRoomHo(d.roomHo)}`)}
                />
                <Input label="청소 담당자" value={cleaningReportForm.cleanerName} onChange={(v) => setCleaningReportForm((f) => ({ ...f, cleanerName: v }))} />
              </div>
            </div>

            <div className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <h3 className="text-lg font-semibold mb-4">자동 입력 정보</h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Input label="지역" value={cleaningReportForm.site} readOnly />
                <Input label="주소" value={cleaningReportForm.address} readOnly />
                <Input label="건물명" value={cleaningReportForm.buildingName} readOnly />
                <Input label="동/호수" value={`${formatDong(cleaningReportForm.dong)} ${formatRoomHo(cleaningReportForm.roomHo)}`} readOnly />
                <Input label="공동현관" value={cleaningReportForm.공동현관} readOnly />
                <Input label="세대현관" value={cleaningReportForm.세대현관} readOnly />
                <Input label="담당 관리자" value={cleaningReportForm.managerName} readOnly />
              </div>
            </div>

            <div className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <h3 className="text-lg font-semibold mb-4">청소 사진</h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className={`${theme.darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-700"}`}>청소 전 사진</label>
                  <input
                    ref={cleaningReportBeforePhotoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleCleaningReportPhotos(e.target.files, "beforePhotoDataUrls")}
                    className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2" : "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2"}`}
                  />
                </div>
                <div className="space-y-2">
                  <label className={`${theme.darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-700"}`}>청소 후 사진</label>
                  <input
                    ref={cleaningReportAfterPhotoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleCleaningReportPhotos(e.target.files, "afterPhotoDataUrls")}
                    className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2" : "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2"}`}
                  />
                </div>
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4 lg:col-span-2" : "rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2"}`}>
                  <div className={`${theme.darkMode ? "text-sm font-semibold text-slate-300" : "text-sm font-semibold text-slate-600"}`}>현재 사진 개수</div>
                  <div className={`${theme.darkMode ? "mt-3 flex flex-wrap gap-3 text-sm text-slate-300" : "mt-3 flex flex-wrap gap-3 text-sm text-slate-700"}`}>
                    <div>전: {cleaningReportForm.beforePhotoDataUrls.length}</div>
                    <div>후: {cleaningReportForm.afterPhotoDataUrls.length}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <h3 className="text-lg font-semibold mb-4">특이사항</h3>
              <Input label="메모" value={cleaningReportForm.memo} onChange={(v) => setCleaningReportForm((f) => ({ ...f, memo: v }))} />
            </div>

            {canConfirmCleaningReport(currentUser) && (
              <div className={`rounded-2xl border p-4 ${theme.darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                <h3 className="text-lg font-semibold mb-4">관리자 확인 영역</h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SelectInput
                    label="청소 상태"
                    value={cleaningReportForm.cleanStatus}
                    onChange={(v) => setCleaningReportForm((f) => ({ ...f, cleanStatus: v as CleaningReport["cleanStatus"] }))}
                    options={["미제출", "제출완료", "확인완료", "불량", "재청소요청"]}
                  />
                  <SelectInput
                    label="점검 결과"
                    value={cleaningReportForm.checkResult}
                    onChange={(v) => setCleaningReportForm((f) => ({ ...f, checkResult: v as CleaningReport["checkResult"] }))}
                    options={["O", "X", "-"]}
                  />
                  <Input
                    label="점수"
                    type="number"
                    value={String(cleaningReportForm.score)}
                    onChange={(v) => setCleaningReportForm((f) => ({ ...f, score: Number(v) || 0 }))}
                  />
                  <Input label="확인자" value={cleaningReportForm.confirmedBy || ""} readOnly />
                  <Input label="확인일" value={cleaningReportForm.confirmedAt || ""} readOnly />
                </div>
              </div>
            )}
          </div>,
          () => setShowCleaningReportForm(false),
          saveCleaningReport,
          theme.accentColor
        )}

        {showDormForm && modalWrap(
          "기숙사 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectInput label="지역" value={dormForm.site} onChange={(v) => setDormForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SelectInput label="성별" value={dormForm.gender} onChange={(v) => setDormForm((f) => ({ ...f, gender: v as "남" | "여" }))} options={["남", "여"]} />
            <Input label="건물명" value={dormForm.buildingName} onChange={(v) => setDormForm((f) => ({ ...f, buildingName: v }))} />
            <Input label="주소" value={dormForm.address} onChange={(v) => setDormForm((f) => ({ ...f, address: v }))} />
            <Input label="동" value={dormForm.dong} onChange={(v) => setDormForm((f) => ({ ...f, dong: stripDongHoSuffix(v) }))} />
            <Input label="호수" value={dormForm.roomHo} onChange={(v) => setDormForm((f) => ({ ...f, roomHo: stripDongHoSuffix(v) }))} />
            <Input label="평수" value={dormForm.pyeong} onChange={(v) => setDormForm((f) => ({ ...f, pyeong: v }))} />
            <SelectInput label="기숙사 관리자" value={dormForm.managerUserId || ""} onChange={(v) => setDormForm((f) => ({ ...f, managerUserId: v }))} options={["", ...users.filter((u) => u.role === "dorm_manager").map((u) => u.id)]} />
            <Input label="계약시작" type="date-text" value={dormForm.contractStart} onChange={(v) => setDormForm((f) => ({ ...f, contractStart: v }))} />
            <Input label="계약종료" type="date-text" value={dormForm.contractEnd} onChange={(v) => setDormForm((f) => ({ ...f, contractEnd: v }))} />
            <Input label="계약금액" value={dormForm.contractAmount} onChange={(v) => setDormForm((f) => ({ ...f, contractAmount: v }))} />
            <SelectInput label="상태" value={dormForm.leaseStatus} onChange={(v) => setDormForm((f) => ({ ...f, leaseStatus: v as Dorm["leaseStatus"] }))} options={["사용중", "만료예정", "해지", "공실"]} />
            <Input label="공동현관" value={dormForm.공동현관} onChange={(v) => setDormForm((f) => ({ ...f, 공동현관: v }))} />
            <Input label="세대현관" value={dormForm.세대현관} onChange={(v) => setDormForm((f) => ({ ...f, 세대현관: v }))} />
            <Input label="선납계약금" type="number" value={String(dormForm.prepaymentDeposit)} onChange={(v) => setDormForm((f) => ({ ...f, prepaymentDeposit: Number(v || 0) }))} />
            <Input label="부동산명" value={dormForm.realEstateName} onChange={(v) => setDormForm((f) => ({ ...f, realEstateName: v }))} />
            <Input label="잔금일" type="date-text" value={dormForm.balanceDate} onChange={(v) => setDormForm((f) => ({ ...f, balanceDate: v }))} />
            <Input label="비고" value={dormForm.notes} onChange={(v) => setDormForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowDormForm(false),
          saveDorm,
          theme.accentColor
        )}

        {showDormContractForm && modalWrap(
          "계약 등록/수정",
          <div className="space-y-6">
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>계약 기본</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SelectInput label="지역" value={dormContractForm.site} onChange={(v) => setDormContractForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
                <SelectInput label="성별" value={dormContractForm.gender} onChange={(v) => setDormContractForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여"]} />
                <Input label="임대인명" value={dormContractForm.landlordName} onChange={(v) => setDormContractForm((f) => ({ ...f, landlordName: v }))} />
                <Input label="임대인연락처" value={dormContractForm.landlordPhone} onChange={(v) => setDormContractForm((f) => ({ ...f, landlordPhone: v }))} />
                <Input label="계약시작일" type="date-text" value={dormContractForm.contractStart} onChange={(v) => setDormContractForm((f) => ({ ...f, contractStart: v }))} />
                <Input label="계약종료일" type="date-text" value={dormContractForm.contractEnd} onChange={(v) => setDormContractForm((f) => ({ ...f, contractEnd: v }))} />
                <div className="space-y-1">
                  <SelectInput
                    label="계약상태"
                    value={dormContractForm.contractStatus}
                    onChange={(v) => setDormContractForm((f) => ({ ...f, contractStatus: v as DormContractStatus | "자동선택" }))}
                    options={["자동선택", "공실", "진행중", "만료예정", "연장", "종료", "해지"]}
                  />
                  <div className="text-xs text-slate-500">자동선택 시 날짜 기준으로 자동 계산됩니다. 직접 선택하면 수동값이 우선 적용됩니다.</div>
                  {dormContractForm.contractStatus === "자동선택" && (
                    <div className="text-xs text-slate-500">자동계산: {calculateDormContractStatus(dormContractForm, dorms, occupants)}</div>
                  )}
                </div>
                <Input label="계약금액" value={dormContractForm.contractAmount} onChange={(v) => setDormContractForm((f) => ({ ...f, contractAmount: v }))} />
                <Input label="선납금" value={dormContractForm.prepaymentDeposit} onChange={(v) => setDormContractForm((f) => ({ ...f, prepaymentDeposit: v }))} />
                <Input label="보증금" value={dormContractForm.deposit} onChange={(v) => setDormContractForm((f) => ({ ...f, deposit: v }))} />
                <Input label="월세/관리비" value={dormContractForm.monthlyRentOrMaintenance} onChange={(v) => setDormContractForm((f) => ({ ...f, monthlyRentOrMaintenance: v }))} />
                <div className="space-y-1">
                  <SelectInput
                    label="계약유형"
                    value={dormContractForm.contractType}
                    onChange={(v) => setDormContractForm((f) => ({ ...f, contractType: v as ContractType | "자동선택" }))}
                    options={["자동선택", "신규", "연장", "재계약", "해지후신규"]}
                  />
                  <div className="text-xs text-slate-500">자동선택 시 날짜 기준으로 자동 계산됩니다. 직접 선택하면 수동값이 우선 적용됩니다.</div>
                  {dormContractForm.contractType === "자동선택" && (
                    <div className="text-xs text-slate-500">자동계산: {calculateDormContractType(dormContractForm, dormContracts, editingDormContractId)}</div>
                  )}
                </div>
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기숙사 위치</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">도로명주소</label>
                    <button
                      type="button"
                      onClick={() => openAddressSearch((roadAddress) => setDormContractForm((f) => ({ ...f, address: roadAddress })))}
                      className={`${theme.darkMode ? "rounded-2xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:bg-slate-950" : "rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"}`}
                    >
                      주소찾기
                    </button>
                  </div>
                  <input
                    value={dormContractForm.address}
                    onChange={(e) => setDormContractForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="도로명주소"
                    className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 bg-slate-950 px-3 py-3 outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"}`}
                  />
                </div>
                <Input label="건물명" value={dormContractForm.buildingName} onChange={(v) => setDormContractForm((f) => ({ ...f, buildingName: v }))} />
                <Input label="동" value={dormContractForm.dong} onChange={(v) => setDormContractForm((f) => ({ ...f, dong: stripDongHoSuffix(v) }))} />
                <Input label="호수" value={dormContractForm.roomHo} onChange={(v) => setDormContractForm((f) => ({ ...f, roomHo: stripDongHoSuffix(v) }))} />
                <Input label="평수" value={dormContractForm.pyeong} onChange={(v) => setDormContractForm((f) => ({ ...f, pyeong: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>추가 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="부동산명" value={dormContractForm.realEstateName} onChange={(v) => setDormContractForm((f) => ({ ...f, realEstateName: v }))} />
                <Input label="부동산연락처" value={dormContractForm.realEstatePhone} onChange={(v) => setDormContractForm((f) => ({ ...f, realEstatePhone: v }))} />
                <Input label="공동현관" value={dormContractForm.공동현관} onChange={(v) => setDormContractForm((f) => ({ ...f, 공동현관: v }))} />
                <Input label="세대현관" value={dormContractForm.세대현관} onChange={(v) => setDormContractForm((f) => ({ ...f, 세대현관: v }))} />
                <Input label="비고" value={dormContractForm.notes} onChange={(v) => setDormContractForm((f) => ({ ...f, notes: v }))} />
                <Input label="등록자" value={dormContractForm.registeredBy} onChange={(v) => setDormContractForm((f) => ({ ...f, registeredBy: v }))} />
                <Input label="등록일" type="date-text" value={dormContractForm.createdAt} onChange={(v) => setDormContractForm((f) => ({ ...f, createdAt: v }))} />
                <Input label="수정일" type="date-text" value={dormContractForm.updatedAt} onChange={(v) => setDormContractForm((f) => ({ ...f, updatedAt: v }))} />
              </div>
            </div>
          </div>,
          () => setShowDormContractForm(false),
          saveDormContract,
          theme.accentColor
        )}

        {showNewHireForm && modalWrap(
          "신입사원 등록/수정",
          <div className="space-y-6">
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기본정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="이름" value={newHireForm.name} onChange={(v) => setNewHireForm((f) => ({ ...f, name: v }))} />
                <SelectInput label="성별" value={newHireForm.gender} onChange={(v) => setNewHireForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여"]} />
                <Input label="부서" value={newHireForm.department} onChange={(v) => setNewHireForm((f) => ({ ...f, department: v }))} />
                <Input label="연락처" value={newHireForm.phone} onChange={(v) => setNewHireForm((f) => ({ ...f, phone: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기숙사 배치</h4>
              <FilteredDormSelector
                value={newHireForm.dormId}
                onChange={(dormId, dorm) => {
                  setNewHireForm((f) => ({
                    ...f,
                    dormId,
                    site: dorm?.site || f.site,
                    gender: dorm?.gender || f.gender,
                    buildingName: dorm?.buildingName || f.buildingName,
                    address: dorm?.address || f.address,
                    dong: dorm ? stripDongHoSuffix(dorm.dong) : f.dong,
                    roomHo: dorm ? stripDongHoSuffix(dorm.roomHo) : f.roomHo,
                    공동현관: dorm?.공동현관 || f.공동현관,
                    세대현관: dorm?.세대현관 || f.세대현관,
                    managerUserId: dormId ? f.managerUserId : "",
                  }));
                  if (!dormId) {
                    setAssignManagerToDorm(false);
                  }
                }}
                currentUser={currentUser}
                operationalDorms={operationalDorms}
                defaultSite={newHireForm.site}
                defaultGender={newHireForm.gender}
                label="기숙사"
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mt-4">
                <Input label="주소" value={newHireForm.address} onChange={(v) => setNewHireForm((f) => ({ ...f, address: v }))} readOnly />
                <Input label="건물명" value={newHireForm.buildingName} onChange={(v) => setNewHireForm((f) => ({ ...f, buildingName: v }))} readOnly />
                <Input label="동" value={formatDong(newHireForm.dong)} onChange={(v) => setNewHireForm((f) => ({ ...f, dong: v }))} readOnly />
                <Input label="호수" value={formatRoomHo(newHireForm.roomHo)} onChange={(v) => setNewHireForm((f) => ({ ...f, roomHo: v }))} readOnly />
                <Input label="공동현관" value={newHireForm.공동현관} onChange={(v) => setNewHireForm((f) => ({ ...f, 공동현관: v }))} readOnly />
                <Input label="세대현관" value={newHireForm.세대현관} onChange={(v) => setNewHireForm((f) => ({ ...f, 세대현관: v }))} readOnly />
              </div>
              <label className={`${theme.darkMode ? "inline-flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 mt-4" : "inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 mt-4"}`}>
                <input
                  type="checkbox"
                  checked={newHireForm.managerUserId ? true : false}
                  onChange={(e) => {
                    if (e.target.checked && !newHireForm.dormId) {
                      alert("기숙사 배정 후 담당자로 지정할 수 있습니다.");
                      return;
                    }
                    if (e.target.checked && newHireForm.dormId) {
                      setNewHireForm((f) => ({ ...f, managerUserId: `${f.dormId}_manager` }));
                    } else {
                      setNewHireForm((f) => ({ ...f, managerUserId: "" }));
                    }
                  }}
                  disabled={!newHireForm.dormId}
                  className="h-4 w-4"
                />
                <span className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>기숙사 담당자로 지정</span>
              </label>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>거주정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="입실일" type="date-text" value={newHireForm.moveInDate} onChange={(v) => setNewHireForm((f) => ({ ...f, moveInDate: v }))} />
                <Input label="퇴실일" type="date-text" value={newHireForm.moveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, moveOutDate: v }))} />
                <Input label="예상입실일" type="date-text" value={newHireForm.expectedMoveInDate} onChange={(v) => setNewHireForm((f) => ({ ...f, expectedMoveInDate: v }))} />
                <Input label="예상퇴실일" type="date-text" value={newHireForm.expectedMoveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, expectedMoveOutDate: v }))} />
                <Input label="실제퇴실일" type="date-text" value={newHireForm.actualMoveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, actualMoveOutDate: v }))} />
                <Input label="천안이동일" type="date-text" value={newHireForm.cheonanMoveDate} onChange={(v) => setNewHireForm((f) => ({ ...f, cheonanMoveDate: v }))} />
                <div className="space-y-1">
                  <SelectInput
                    label="거주상태"
                    value={newHireForm.residenceStatus}
                    onChange={(v) => setNewHireForm((f) => ({ ...f, residenceStatus: v as NewHireResidenceStatus | "자동선택" }))}
                    options={["자동선택", "대기중", "거주중", "만료예정", "연장", "퇴실"]}
                  />
                  <div className="text-xs text-slate-500">자동선택 시 날짜 기준으로 자동 계산됩니다. 직접 선택하면 수동값이 우선 적용됩니다.</div>
                  {newHireForm.residenceStatus === "자동선택" && (
                    <div className="text-xs text-slate-500">자동계산: {calculateNewHireResidenceStatus(newHireForm)}</div>
                  )}
                </div>
                <div className="space-y-1">
                  <SelectInput
                    label="입주유형"
                    value={newHireForm.moveInType}
                    onChange={(v) => setNewHireForm((f) => ({ ...f, moveInType: v as MoveInType | "자동선택" }))}
                    options={["자동선택", "대기자", "신규", "재입주", "연장"]}
                  />
                  <div className="text-xs text-slate-500">자동선택 시 날짜 기준으로 자동 계산됩니다. 직접 선택하면 수동값이 우선 적용됩니다.</div>
                  {newHireForm.moveInType === "자동선택" && (
                    <div className="text-xs text-slate-500">자동계산: {calculateMoveInType(newHireForm, newHires)}</div>
                  )}
                </div>
                <Input label="연장사유" value={newHireForm.extensionReason} onChange={(v) => setNewHireForm((f) => ({ ...f, extensionReason: v }))} />
                <Input label="특이사항 메모" value={newHireForm.notes} onChange={(v) => setNewHireForm((f) => ({ ...f, notes: v }))} />
                <Input label="등록일" type="date-text" value={newHireForm.createdAt} onChange={(v) => setNewHireForm((f) => ({ ...f, createdAt: v }))} />
                <Input label="수정일" type="date-text" value={newHireForm.updatedAt} onChange={(v) => setNewHireForm((f) => ({ ...f, updatedAt: v }))} />
              </div>
            </div>
          </div>,
          () => setShowNewHireForm(false),
          saveNewHire,
          theme.accentColor
        )}

        {showAssignDormForNewHire && assigningNewHireId && modalWrap(
          "기숙사 배정",
          <div className="space-y-6">
            <FilteredDormSelector
              value=""
              onChange={(dormId, dorm) => {
                if (!dorm) return;
                const capacityInfo = dormCapacityInfo.find(info => info.dormId === dormId);
                if (capacityInfo && !capacityInfo.available) {
                  if (!window.confirm(`현재 정원 ${capacityInfo.capacity}명 중 ${capacityInfo.currentResidents}명이 거주 중입니다. 그래도 배정하시겠습니까?`)) return;
                }
                const newHire = newHires.find(h => h.id === assigningNewHireId);
                if (!newHire) return;
                const updatedNewHire = {
                  ...newHire,
                  dormId,
                  site: dorm.site,
                  gender: dorm.gender,
                  buildingName: dorm.buildingName,
                  address: dorm.address,
                  dong: stripDongHoSuffix(dorm.dong),
                  roomHo: stripDongHoSuffix(dorm.roomHo),
                  공동현관: dorm.공동현관,
                  세대현관: dorm.세대현관,
                  updatedAt: new Date().toISOString(),
                };
                setNewHires(prev => prev.map(h => h.id === assigningNewHireId ? updatedNewHire : h));
                setOccupants(prev => upsertOccupantFromNewHire(updatedNewHire, prev));
                setShowAssignDormForNewHire(false);
                setAssigningNewHireId(null);
              }}
              currentUser={currentUser}
              operationalDorms={operationalDorms}
              defaultSite={newHires.find(h => h.id === assigningNewHireId)?.site}
              defaultGender={newHires.find(h => h.id === assigningNewHireId)?.gender}
              label="기숙사 선택"
            />
          </div>,
          () => {
            setShowAssignDormForNewHire(false);
            setAssigningNewHireId(null);
          },
          () => {},
          theme.accentColor
        )}

        {showOccupantForm && modalWrap(
          "입주자 등록/수정",
          <div className="space-y-6">
            {/* 기본정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950/50 p-4" : "rounded-2xl border border-slate-200 bg-slate-50/50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기본정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="이름" value={occupantForm.employeeName} onChange={(v) => setOccupantForm((f) => ({ ...f, employeeName: v }))} />
                <SelectInput label="성별" value={occupantForm.gender} onChange={(v) => setOccupantForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여", "기타"]} />
                <Input label="부서" value={occupantForm.department} onChange={(v) => setOccupantForm((f) => ({ ...f, department: v }))} />
                <Input label="연락처" value={occupantForm.phone} onChange={(v) => setOccupantForm((f) => ({ ...f, phone: v }))} />
              </div>
            </div>

            {/* 거주정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950/50 p-4" : "rounded-2xl border border-slate-200 bg-slate-50/50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>거주정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SelectInput label="지역" value={occupantForm.site || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
                <SearchableSelect 
                  label="기숙사" 
                  value={occupantForm.dormId} 
                  onChange={(v) => {
                    setOccupantForm((f) => ({ ...f, dormId: v }));
                    if (!v) setAssignManagerToDorm(false);
                  }} 
                  options={["", ...getAccessibleOperationalDorms(currentUser, operationalDorms).filter((d) => !occupantForm.site || d.site === occupantForm.site).map((d) => d.id)]} 
                  displayOptions={["미배정", ...getAccessibleOperationalDorms(currentUser, operationalDorms).filter((d) => !occupantForm.site || d.site === occupantForm.site).map((d) => `${d.site} ${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)}`)]} 
                />
                <Input label="입실일" type="date-text" value={occupantForm.moveInDate} onChange={(v) => setOccupantForm((f) => ({ ...f, moveInDate: v }))} />
                <Input label="거주기한" type="date-text" value={occupantForm.moveOutDueDate} onChange={(v) => setOccupantForm((f) => ({ ...f, moveOutDueDate: v }))} />
                <Input label="예상입실일" type="date-text" value={occupantForm.expectedMoveInDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, expectedMoveInDate: v }))} />
                <Input label="예상퇴실일" type="date-text" value={occupantForm.expectedMoveOutDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, expectedMoveOutDate: v }))} />
                <Input label="실제퇴실일" type="date-text" value={occupantForm.actualMoveOutDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, actualMoveOutDate: v }))} />
                <SelectInput label="상태" value={occupantForm.status} onChange={(v) => setOccupantForm((f) => ({ ...f, status: v as Occupant["status"] }))} options={["거주중", "만료예정", "퇴실", "천안이동", "신규입주"]} />
              </div>
            </div>

            {/* 운영정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950/50 p-4" : "rounded-2xl border border-slate-200 bg-slate-50/50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>운영정보</h4>
              <div className="grid grid-cols-1 gap-4">
                <label className={`${theme.darkMode ? "inline-flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3" : "inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"}`}>
                  <input
                    type="checkbox"
                    checked={assignManagerToDorm}
                    onChange={(e) => setAssignManagerToDorm(e.target.checked)}
                    disabled={!occupantForm.dormId}
                    className="h-4 w-4"
                  />
                  <span className={`${theme.darkMode ? "text-sm text-slate-300" : "text-sm text-slate-700"}`}>입주자 등록 시 해당 기숙사 관리자 자동 지정</span>
                </label>
                {!occupantForm.dormId && (
                  <div className="text-xs text-rose-500">기숙사를 선택해야 담당자 자동 지정이 가능합니다.</div>
                )}
              </div>
            </div>

            {/* 메모 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950/50 p-4" : "rounded-2xl border border-slate-200 bg-slate-50/50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>메모</h4>
              <div className="grid grid-cols-1 gap-4">
                <Input label="비고" value={occupantForm.notes} onChange={(v) => setOccupantForm((f) => ({ ...f, notes: v }))} />
              </div>
            </div>
          </div>,
          () => setShowOccupantForm(false),
          saveOccupant,
          theme.accentColor
        )}

        {showInventoryForm && modalWrap(
          "비품 등록/수정",
          <div className="space-y-6">
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>기숙사 선택</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SearchableSelect
                  label="기숙사"
                  value={inventoryForm.dormId}
                  onChange={(v) => {
                    const selected = operationalDorms.find((d) => d.id === v);
                    setInventoryForm((f) => ({
                      ...f,
                      dormId: v,
                      site: selected?.site || f.site,
                      dormAddress: selected?.address || f.dormAddress,
                      buildingName: selected?.buildingName || f.buildingName,
                      dong: selected ? stripDongHoSuffix(selected.dong) : f.dong,
                      roomHo: selected ? stripDongHoSuffix(selected.roomHo) : f.roomHo,
                      managerName: selected?.managerUserId ? users.find(u => u.id === selected.managerUserId)?.displayName || f.managerName : f.managerName,
                    }));
                  }}
                  options={operationalDorms.map((d) => d.id)}
                  displayOptions={operationalDorms.map((d) => `${d.site} ${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)}`)}
                />
                <SelectInput label="지역" value={inventoryForm.site} onChange={(v) => setInventoryForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
                <Input label="주소" value={inventoryForm.dormAddress} onChange={(v) => setInventoryForm((f) => ({ ...f, dormAddress: v }))} />
                <Input label="건물명" value={inventoryForm.buildingName} onChange={(v) => setInventoryForm((f) => ({ ...f, buildingName: v }))} />
                <Input label="동" value={inventoryForm.dong} onChange={(v) => setInventoryForm((f) => ({ ...f, dong: stripDongHoSuffix(v) }))} />
                <Input label="호수" value={inventoryForm.roomHo} onChange={(v) => setInventoryForm((f) => ({ ...f, roomHo: stripDongHoSuffix(v) }))} />
                <Input label="담당자" value={inventoryForm.managerName} onChange={(v) => setInventoryForm((f) => ({ ...f, managerName: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>비품 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="비품명" value={inventoryForm.itemName} onChange={(v) => setInventoryForm((f) => ({ ...f, itemName: v }))} />
                <Input label="수량" type="number" value={String(inventoryForm.quantity)} onChange={(v) => setInventoryForm((f) => ({ ...f, quantity: Number(v || 0) }))} />
                <Input label="모델명" value={inventoryForm.modelName} onChange={(v) => setInventoryForm((f) => ({ ...f, modelName: v }))} />
                <Input label="제조사" value={inventoryForm.maker} onChange={(v) => setInventoryForm((f) => ({ ...f, maker: v }))} />
                <SelectInput label="비품상태" value={inventoryForm.status} onChange={(v) => setInventoryForm((f) => ({ ...f, status: v as InventoryItem["status"] }))} options={["정상", "고장", "노후", "매각", "폐기"]} />
                <Input label="설치위치" value={inventoryForm.installationLocation} onChange={(v) => setInventoryForm((f) => ({ ...f, installationLocation: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>구매 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="구매일" type="date-text" value={inventoryForm.purchaseDate} onChange={(v) => setInventoryForm((f) => ({ ...f, purchaseDate: v }))} />
                <Input label="구매금액" type="number" value={String(inventoryForm.purchaseAmount)} onChange={(v) => setInventoryForm((f) => ({ ...f, purchaseAmount: Number(v || 0) }))} />
                <Input label="지급일" type="date-text" value={inventoryForm.issuedDate} onChange={(v) => setInventoryForm((f) => ({ ...f, issuedDate: v }))} />
                <Input label="증빙파일" value={inventoryForm.proofFile} onChange={(v) => setInventoryForm((f) => ({ ...f, proofFile: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>매각/폐기 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="매각일" type="date-text" value={inventoryForm.soldDate} onChange={(v) => setInventoryForm((f) => ({ ...f, soldDate: v }))} />
                <Input label="매각금액" type="number" value={String(inventoryForm.soldAmount)} onChange={(v) => setInventoryForm((f) => ({ ...f, soldAmount: Number(v || 0) }))} />
                <Input label="폐기일" type="date-text" value={inventoryForm.disposalDate} onChange={(v) => setInventoryForm((f) => ({ ...f, disposalDate: v }))} />
                <Input label="처리사유" value={inventoryForm.disposalReason} onChange={(v) => setInventoryForm((f) => ({ ...f, disposalReason: v }))} />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>메모</h4>
              <div className="grid grid-cols-1 gap-4">
                <Input label="비고" value={inventoryForm.notes} onChange={(v) => setInventoryForm((f) => ({ ...f, notes: v }))} />
              </div>
            </div>
          </div>,
          () => setShowInventoryForm(false),
          saveInventory,
          theme.accentColor
        )}

        {showLeaseForm && modalWrap(
          "신규계약 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Input label="주소명" value={leaseForm.addressName} onChange={(v) => setLeaseForm((f) => ({ ...f, addressName: v }))} />
            <Input label="동" value={leaseForm.dong} onChange={(v) => setLeaseForm((f) => ({ ...f, dong: v }))} />
            <Input label="호수" value={leaseForm.ho} onChange={(v) => setLeaseForm((f) => ({ ...f, ho: v }))} />
            <Input label="평수" value={leaseForm.pyeong} onChange={(v) => setLeaseForm((f) => ({ ...f, pyeong: v }))} />
            <Input label="계약금액" value={leaseForm.contractAmount} onChange={(v) => setLeaseForm((f) => ({ ...f, contractAmount: v }))} />
            <Input label="계약기간" value={leaseForm.contractPeriod} onChange={(v) => setLeaseForm((f) => ({ ...f, contractPeriod: v }))} />
            <Input label="계약일" type="date-text" value={leaseForm.contractDate} onChange={(v) => setLeaseForm((f) => ({ ...f, contractDate: v, dateKey: v }))} />
            <Input label="선납계약금" type="number" value={String(leaseForm.prepaymentDeposit)} onChange={(v) => setLeaseForm((f) => ({ ...f, prepaymentDeposit: Number(v || 0) }))} />
            <Input label="부동산명" value={leaseForm.realEstateName} onChange={(v) => setLeaseForm((f) => ({ ...f, realEstateName: v }))} />
            <Input label="잔금일" type="date-text" value={leaseForm.balanceDate} onChange={(v) => setLeaseForm((f) => ({ ...f, balanceDate: v }))} />
            <SelectInput label="지역" value={leaseForm.site} onChange={(v) => setLeaseForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SelectInput label="성별" value={leaseForm.gender} onChange={(v) => setLeaseForm((f) => ({ ...f, gender: v as "남" | "여" }))} options={["남", "여"]} />
            <Input label="참고사항" value={leaseForm.notes} onChange={(v) => setLeaseForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowLeaseForm(false),
          saveLease,
          theme.accentColor
        )}

        {showSaleForm && modalWrap(
          "비품매각 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Input label="일자" type="date-text" value={saleForm.saleDate} onChange={(v) => setSaleForm((f) => ({ ...f, saleDate: v }))} />
            <Input label="품목" value={saleForm.itemName} onChange={(v) => setSaleForm((f) => ({ ...f, itemName: v }))} />
            <Input label="단가" type="number" value={String(saleForm.unitPrice)} onChange={(v) => setSaleForm((f) => ({ ...f, unitPrice: Number(v || 0) }))} />
            <Input label="수량" type="number" value={String(saleForm.quantity)} onChange={(v) => setSaleForm((f) => ({ ...f, quantity: Number(v || 0), totalAmount: Number(v || 0) * saleForm.unitPrice }))} />
            <Input label="매각업체" value={saleForm.buyerCompany} onChange={(v) => setSaleForm((f) => ({ ...f, buyerCompany: v }))} />
            <Input label="비고" value={saleForm.notes} onChange={(v) => setSaleForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowSaleForm(false),
          saveSale,
          theme.accentColor
        )}

        {showDefectForm && modalWrap(
            "하자접수 등록/수정",
            (<div className="space-y-6">
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>접수 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input
                  label="기숙사 관리자명"
                  value={defectForm.dormManagerName}
                  onChange={(v) => setDefectForm((f) => ({ ...f, dormManagerName: v }))}
                  readOnly={currentUser?.role === "maintenance_reporter" || isViewer}
                />
                {currentUser?.role !== "maintenance_reporter" ? (
                  <>
                    <SelectInput
                      label="상황"
                      value={defectForm.defectStatus}
                      onChange={(v) =>
                        setDefectForm((f) => ({
                          ...f,
                          defectStatus: v as DefectRequest["defectStatus"],
                        }))
                      }
                      options={["접수", "진행중", "완료"]}
                      disabled={isViewer}
                    />
                    <Input
                      label="점검자"
                      value={defectForm.inspectorName}
                      onChange={(v) => setDefectForm((f) => ({ ...f, inspectorName: v }))}
                      readOnly={isViewer}
                    />
                  </>
                ) : (
                  <Input label="상황" value={defectForm.defectStatus} onChange={() => {}} readOnly />
                )}
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>위치 정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>도로명주소</label>
                  <div className="flex gap-2">
                    <input
                      value={defectForm.roadAddress}
                      readOnly
                      className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 px-3 py-3 outline-none bg-slate-950" : "w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none bg-slate-50"}`}
                    />
                    {currentUser?.role !== "viewer" && !isMaintenanceReporterWithDorm && (
                      <button
                        type="button"
                        onClick={() => openAddressSearch((roadAddress) => setDefectForm((f) => ({ ...f, roadAddress })))}
                        className={`${theme.darkMode ? "shrink-0 rounded-2xl border border-slate-600 bg-slate-950 px-4 py-3 hover:bg-slate-950" : "shrink-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 hover:bg-slate-50"}`}
                      >
                        주소찾기
                      </button>
                    )}
                  </div>
                </div>
                <Input
                  label="건물명"
                  value={defectForm.buildingName}
                  onChange={(v) => setDefectForm((f) => ({ ...f, buildingName: v }))}
                  readOnly={isViewer || isMaintenanceReporterWithDorm}
                />
                <Input
                  label="동"
                  value={defectForm.dong}
                  onChange={(v) => setDefectForm((f) => ({ ...f, dong: v }))}
                  readOnly={isViewer || isMaintenanceReporterWithDorm}
                />
                <Input
                  label="호수"
                  value={defectForm.ho}
                  onChange={(v) => setDefectForm((f) => ({ ...f, ho: v }))}
                  readOnly={isViewer || isMaintenanceReporterWithDorm}
                />
                <Input
                  label="공동현관"
                  value={defectForm.공동현관}
                  onChange={(v) => setDefectForm((f) => ({ ...f, 공동현관: v }))}
                  readOnly={isViewer || isMaintenanceReporterWithDorm}
                />
                <Input
                  label="세대현관"
                  value={defectForm.세대현관}
                  onChange={(v) => setDefectForm((f) => ({ ...f, 세대현관: v }))}
                  readOnly={isViewer || isMaintenanceReporterWithDorm}
                />
              </div>
            </div>

            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>접수/완료 내용</h4>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>하자신청내용</label>
                  <textarea
                    value={defectForm.requestText}
                    onChange={(e) => setDefectForm((f) => ({ ...f, requestText: e.target.value }))}
                    rows={6}
                    readOnly={isViewer}
                    className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 px-3 py-3 outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none focus:border-slate-400"}`}
                  />
                </div>
                {currentUser?.role !== "maintenance_reporter" && (
                  <div>
                    <label className={`${theme.darkMode ? "mb-2 block text-sm font-medium text-slate-300" : "mb-2 block text-sm font-medium text-slate-700"}`}>완료내용</label>
                    <textarea
                      value={defectForm.completeText}
                      onChange={(e) => setDefectForm((f) => ({ ...f, completeText: e.target.value }))}
                      rows={4}
                      readOnly={isViewer}
                      className={`${theme.darkMode ? "w-full rounded-2xl border border-slate-600 px-3 py-3 outline-none focus:border-slate-400" : "w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none focus:border-slate-400"}`}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-sm" : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"}`}>
                <div className={`${theme.darkMode ? "mb-2 flex items-center gap-2 text-sm font-medium text-slate-300" : "mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"}`}>
                  <Camera className="h-4 w-4" /> 접수 이미지
                </div>
                <div className="flex flex-wrap gap-3">
                  {defectForm.requestPhotoDataUrls.map((src, idx) => (
                    <div key={idx} className="relative">
                      <img src={src} alt={`request-${idx}`} className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200" />
                      <a href={src} download={`request-photo-${idx + 1}.png`} className="absolute bottom-1 left-1 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
                        다운로드
                      </a>
                      {!isViewer && (
                        <button
                          type="button"
                          onClick={() => setDefectForm((f) => ({ ...f, requestPhotoDataUrls: f.requestPhotoDataUrls.filter((_, i) => i !== idx) }))}
                          className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {!isViewer && (
                    <button
                      type="button"
                      onClick={() => defectRequestPhotoInputRef.current?.click()}
                      className={`${theme.darkMode ? "flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-600 text-slate-500 hover:bg-slate-950" : "flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"}`}
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  )}
                </div>
                <input ref={defectRequestPhotoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleDefectRequestPhotos(e.target.files)} />
              </div>

              {currentUser?.role !== "maintenance_reporter" && (
                <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-sm" : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"}`}>
                  <div className={`${theme.darkMode ? "mb-2 flex items-center gap-2 text-sm font-medium text-slate-300" : "mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"}`}>
                    <Camera className="h-4 w-4" /> 완료 이미지
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {defectForm.completionPhotoDataUrls.map((src, idx) => (
                      <div key={idx} className="relative">
                        <img src={src} alt={`completion-${idx}`} className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200" />
                        <a href={src} download={`completion-photo-${idx + 1}.png`} className="absolute bottom-1 left-1 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
                          다운로드
                        </a>
                        {!isViewer && (
                          <button
                            type="button"
                            onClick={() => setDefectForm((f) => ({ ...f, completionPhotoDataUrls: f.completionPhotoDataUrls.filter((_, i) => i !== idx) }))}
                            className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {!isViewer && (
                      <button
                        type="button"
                        onClick={() => defectCompletionPhotoInputRef.current?.click()}
                        className={`${theme.darkMode ? "flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-600 text-slate-500 hover:bg-slate-950" : "flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"}`}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <input ref={defectCompletionPhotoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleDefectCompletionPhotos(e.target.files)} />
                </div>
              )}
            </div>
          </div>),
          () => setShowDefectForm(false),
          saveDefect,
          theme.accentColor,
          !canFileDefect(currentUser)
        )}
        {showMilitaryPersonnelForm && modalWrap(
          "군인 인원 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input label="이름" value={militaryPersonnelForm.name} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, name: v }))} />
            <Input label="직급" value={militaryPersonnelForm.rank} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, rank: v }))} />
            <div>
              <SearchableSelect
                label="부서(검색 또는 선택)"
                value={militaryPersonnelForm.unit || ""}
                onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, unit: v }))}
                options={militaryCodeValues.departments || []}
                displayOptions={militaryCodeValues.departments || []}
              />
              <Input label="부서 직접입력 (선택)" value={militaryPersonnelForm.unit} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, unit: v }))} />
            </div>
            <Input label="연락처" value={militaryPersonnelForm.phone} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, phone: v }))} />
            <Input label="생년월일" type="date-text" value={militaryPersonnelForm.birthDate} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, birthDate: v }))} />
            <Input label="전역일" type="date-text" value={militaryPersonnelForm.dischargeDate} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, dischargeDate: v }))} />
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">계산 모드</label>
              <select
                value={militaryPersonnelForm.calculationMode || "auto"}
                onChange={(e) => setMilitaryPersonnelForm((f) => ({ ...f, calculationMode: e.target.value as "auto" | "manual" }))}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
              >
                <option value="auto">자동계산</option>
                <option value="manual">수동관리</option>
              </select>
            </div>
            {militaryPersonnelForm.calculationMode === "manual" ? (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">현재구분</label>
                  <select
                    value={militaryPersonnelForm.manualCategory || ""}
                    onChange={(e) => setMilitaryPersonnelForm((f) => ({ ...f, manualCategory: e.target.value as "예비군" | "민방위" | "대상아님" | "" }))}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
                  >
                    <option value="">선택하세요</option>
                    <option value="예비군">예비군</option>
                    <option value="민방위">민방위</option>
                    <option value="대상아님">대상아님</option>
                  </select>
                </div>
                <Input label="연차" type="number" value={militaryPersonnelForm.manualYear || ""} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, manualYear: v }))} />
              </>
            ) : (
              <div className="space-y-3 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                <div className="text-sm font-medium text-slate-700">자동 판정 결과</div>
                <div className="text-sm text-slate-600">기준연도: {effectiveMilitaryReferenceYear || new Date().getFullYear()}</div>
                <div className="text-sm text-slate-600">현재구분: {getMilitaryCategory(militaryPersonnelForm, effectiveMilitaryReferenceYear) || "-"}</div>
                <div className="text-sm text-slate-600">훈련연차: {getTrainingYear(militaryPersonnelForm, effectiveMilitaryReferenceYear) || "-"}</div>
              </div>
            )}
            <Input label="군별" value={militaryPersonnelForm.serviceBranch} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, serviceBranch: v }))} />
            <div>
              <SelectInput label="재직상태" value={militaryPersonnelForm.status || ""} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, status: v }))} options={militaryCodeValues.employmentStatus || [""]} />
            </div>
            <div className="flex items-end gap-3">
              <label className="mb-2 block text-sm font-medium text-slate-700">동원여부</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="mobilization" checked={!!militaryPersonnelForm.mobilization} onChange={() => setMilitaryPersonnelForm((f) => ({ ...f, mobilization: true }))} />동원</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="mobilization" checked={!militaryPersonnelForm.mobilization} onChange={() => setMilitaryPersonnelForm((f) => ({ ...f, mobilization: false }))} />동원미지정</label>
              </div>
            </div>
            <Input label="비고" value={militaryPersonnelForm.notes} onChange={(v) => setMilitaryPersonnelForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowMilitaryPersonnelForm(false),
          saveMilitaryPersonnel,
          theme.accentColor
        )}
        {showMilitaryTrainingForm && modalWrap(
          "훈련 기록 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">훈련 대상자</label>
              <select
                value={militaryTrainingForm.personnelId}
                onChange={(e) => setMilitaryTrainingForm((f) => ({ ...f, personnelId: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
              >
                <option value="">선택하세요</option>
                {militaryPersonnel.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} ({person.rank})
                  </option>
                ))}
              </select>
            </div>
            <Input label="훈련명(제목)" value={militaryTrainingForm.subject} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, subject: v }))} />
            <div>
              <SelectInput label="훈련유형" value={militaryTrainingForm.trainingType || ""} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, trainingType: v }))} options={militaryCodeValues.trainingType || [""]} />
            </div>
            <div>
              <SelectInput label="차수" value={militaryTrainingForm.trainingRound || ""} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, trainingRound: v }))} options={militaryCodeValues.trainingRound || [""]} />
            </div>
            <Input label="훈련예정일" type="date-text" value={militaryTrainingForm.trainingDate} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, trainingDate: v }))} />
            <Input label="이수일" type="date-text" value={militaryTrainingForm.completionDate || ""} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, completionDate: v }))} />
            <Input label="이수시간" type="number" value={String(militaryTrainingForm.trainingHours || 0)} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, trainingHours: Number(v) || 0 }))} />
            <div>
              <SelectInput label="상태" value={militaryTrainingForm.status || ""} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, status: v }))} options={militaryCodeValues.trainingStatus || [""]} />
            </div>
            <Input label="비고" value={militaryTrainingForm.notes} onChange={(v) => setMilitaryTrainingForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowMilitaryTrainingForm(false),
          saveMilitaryTraining,
          theme.accentColor
        )}
        {showMilitaryNoticeForm && modalWrap(
          "공지 등록/수정",
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Input label="제목" value={militaryNoticeForm.title} onChange={(v) => setMilitaryNoticeForm((f) => ({ ...f, title: v }))} />
              <Input label="구분" value={militaryNoticeForm.category} onChange={(v) => setMilitaryNoticeForm((f) => ({ ...f, category: v }))} />
              <Input label="게시일" type="date-text" value={militaryNoticeForm.publishedDate} onChange={(v) => setMilitaryNoticeForm((f) => ({ ...f, publishedDate: v }))} />
              <Input label="만료일" type="date-text" value={militaryNoticeForm.expiresDate} onChange={(v) => setMilitaryNoticeForm((f) => ({ ...f, expiresDate: v }))} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">통보 대상자</label>
              <select
                multiple
                value={militaryNoticeForm.personnelIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                  setMilitaryNoticeForm((f) => ({ ...f, personnelIds: selected }));
                }}
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
                size={Math.min(8, militaryPersonnel.length || 4)}
              >
                {militaryPersonnel.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} ({person.rank})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Input label="내용" value={militaryNoticeForm.content} onChange={(v) => setMilitaryNoticeForm((f) => ({ ...f, content: v }))} />
            </div>
          </div>,
          () => setShowMilitaryNoticeForm(false),
          saveMilitaryNotice,
          theme.accentColor
        )}
        {showMilitaryReportForm && modalWrap(
          "보고서 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input label="제목" value={militaryReportForm.title} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, title: v }))} />
            <Input label="보고일" type="date-text" value={militaryReportForm.reportDate} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, reportDate: v }))} />
            <Input label="종류" value={militaryReportForm.type} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, type: v }))} />
            <Input label="작성자" value={militaryReportForm.author} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, author: v }))} />
            <Input label="상태" value={militaryReportForm.status} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, status: v }))} />
            <Input label="비고" value={militaryReportForm.notes} onChange={(v) => setMilitaryReportForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowMilitaryReportForm(false),
          saveMilitaryReport,
          theme.accentColor
        )}
        {showUserForm && canManageUsers(currentUser) && modalWrap(
          "계정 등록/수정",
          <div className="space-y-6">
            {/* 계정정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>계정정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Input label="로그인 아이디" value={userForm.username} onChange={(v) => setUserForm((f) => ({ ...f, username: v }))} />
                <Input label="비밀번호" type="password" value={userForm.password} onChange={(v) => setUserForm((f) => ({ ...f, password: v }))} />
                <Input label="표시이름" value={userForm.displayName} onChange={(v) => setUserForm((f) => ({ ...f, displayName: v }))} />
              </div>
            </div>

            {/* 권한정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>권한정보</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SelectInput label="권한" value={getRoleLabel(userForm.role)} onChange={(v) => setUserForm((f) => ({ ...f, role: getRoleValue(v) }))} options={["관리자", "뷰어", "하자처리 담당자", "기숙사 관리자"]} />
                <SelectInput label="지역 권한" value={userForm.siteAccess} onChange={(v) => setUserForm((f) => ({ ...f, siteAccess: v as Site | "전체" }))} options={["전체", "평택", "천안"]} />
                <SelectInput label="성별 권한" value={userForm.genderAccess || "전체"} onChange={(v) => setUserForm((f) => ({ ...f, genderAccess: v as "남" | "여" | "전체" }))} options={["전체", "남", "여"]} />
              </div>
            </div>

            {/* 담당 기숙사 정보 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>담당 기숙사 정보</h4>
              <SearchableSelect
                label="기숙사"
                value={userForm.dormId || ""}
                onChange={(dormId) => {
                  const dorm = visibleDorms.find((d) => d.id === dormId);
                  setUserForm((f) => ({
                    ...f,
                    dormId,
                    siteAccess: dorm ? dorm.site : f.siteAccess,
                    roadAddress: dorm ? dorm.address : f.roadAddress,
                    buildingName: dorm ? dorm.buildingName : f.buildingName,
                    dong: dorm ? stripDongHoSuffix(dorm.dong) : f.dong,
                    roomHo: dorm ? stripDongHoSuffix(dorm.roomHo) : f.roomHo,
                    공동현관: dorm ? dorm.공동현관 : f.공동현관,
                    세대현관: dorm ? dorm.세대현관 : f.세대현관,
                  }));
                }}
                options={visibleDorms.map((d) => d.id)}
                displayOptions={visibleDorms.map((d) => `${d.site} ${d.buildingName} ${formatDong(d.dong)}-${formatRoomHo(d.roomHo)} (${d.address})`)}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 mt-4">
                <Input label="도로명 주소" value={userForm.roadAddress || ""} onChange={(v) => setUserForm((f) => ({ ...f, roadAddress: v }))} readOnly />
                <Input label="건물명" value={userForm.buildingName || ""} onChange={(v) => setUserForm((f) => ({ ...f, buildingName: v }))} readOnly />
                <Input label="동" value={formatDong(userForm.dong || "")} onChange={(v) => setUserForm((f) => ({ ...f, dong: v }))} readOnly />
                <Input label="호" value={formatRoomHo(userForm.roomHo || "")} onChange={(v) => setUserForm((f) => ({ ...f, roomHo: v }))} readOnly />
                <Input label="공동현관" value={userForm.공동현관 || ""} onChange={(v) => setUserForm((f) => ({ ...f, 공동현관: v }))} readOnly />
                <Input label="세대현관" value={userForm.세대현관 || ""} onChange={(v) => setUserForm((f) => ({ ...f, 세대현관: v }))} readOnly />
              </div>
            </div>

            {/* 활성 상태 섹션 */}
            <div className={`${theme.darkMode ? "rounded-2xl border border-slate-700 bg-slate-950 p-4" : "rounded-2xl border border-slate-200 bg-slate-50 p-4"}`}>
              <h4 className={`${theme.darkMode ? "mb-3 text-sm font-semibold text-slate-300" : "mb-3 text-sm font-semibold text-slate-700"}`}>활성 상태</h4>
              <SelectInput label="활성 여부" value={userForm.isActive ? "활성" : "비활성"} onChange={(v) => setUserForm((f) => ({ ...f, isActive: v === "활성", manualActiveOverride: v === "활성" }))} options={["활성", "비활성"]} />
            </div>
          </div>,
          () => setShowUserForm(false),
          saveUser,
          theme.accentColor
        )}
      </div>
    </div>
  );
}

function modalWrap(title: string, body: React.ReactNode, onClose: () => void, onSave: () => void, accentColor: string, saveDisabled = false) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="text-xl font-semibold">{title}</h3></div><button onClick={onClose} className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"><ChevronRight className="h-5 w-5 rotate-45" /></button></div>
        {body}
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-2xl border border-slate-300 px-4 py-2 hover:bg-slate-50">취소</button><button onClick={onSave} disabled={saveDisabled} className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-white ${saveDisabled ? "opacity-50 cursor-not-allowed" : ""}`} style={{ backgroundColor: accentColor }}><Save className="h-4 w-4" /> 저장</button></div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>;
}

function CompactField({ label, value, className = "", labelClassName = "", valueClassName = "" }: { label: string; value: string; className?: string; labelClassName?: string; valueClassName?: string }) {
  return <div className={`rounded-lg bg-slate-50 p-2 ${className}`}><div className={`font-semibold uppercase tracking-wide text-slate-400 text-[0.625rem] leading-4 whitespace-normal ${labelClassName}`}>{label}</div><div className={`mt-1 text-slate-700 text-[0.75rem] leading-5 whitespace-normal ${valueClassName}`}>{value}</div></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <div className="lg:col-span-2"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label><select translate="no" lang="en" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate">{options.map((option) => <option translate="no" className="notranslate" key={option} value={option}>{option || "미선택"}</option>)}</select></div>;
}

function SearchableSelect({ label, value, onChange, options, displayOptions }: { label: string; value: string; onChange: (v: string) => void; options: string[]; displayOptions?: string[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredIndices = options
    .map((option, index) => ({ option, index }))
    .filter(({ option, index }) => {
      const displayText = displayOptions ? displayOptions[index] : option;
      return displayText.toLowerCase().includes(searchTerm.toLowerCase());
    });

  const selectedDisplay = displayOptions ? displayOptions[options.indexOf(value)] : value;

  return (
    <div className="relative notranslate" translate="no" lang="en">
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={selectedDisplay || ""}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate"
          translate="no"
          placeholder="검색해서 선택하세요"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2 notranslate"
          translate="no"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-slate-300 bg-white shadow-lg notranslate" translate="no">
          {filteredIndices.map(({ option, index }) => {
            const displayText = displayOptions ? displayOptions[index] : option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setSearchTerm("");
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-50 notranslate"
                translate="no"
              >
                {displayText}
              </button>
            );
          })}
          {filteredIndices.length === 0 && (
            <div className="px-3 py-2 text-slate-500">검색 결과가 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, onBlur, type = "text", readOnly = false, placeholder }: { label: string; value: string; onChange?: (v: string) => void; onBlur?: () => void; type?: string; readOnly?: boolean; placeholder?: string }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (type === "date-text") {
      // 숫자 자리 입력 시 YYYY-MM-DD로 변환
      if (/^\d{8}$/.test(v)) {
        v = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
      }
    }
    onChange?.(v);
  };
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><input type={type === "date-text" ? "date" : type} value={value} onChange={handleChange} onBlur={onBlur} readOnly={readOnly} placeholder={type === "date-text" ? undefined : placeholder} className={`w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none ${readOnly ? 'bg-slate-50' : 'focus:border-slate-400'}`} /></div>;
}

function SelectInput({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: string[]; disabled?: boolean }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><select translate="no" lang="en" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400 notranslate ${disabled ? "bg-slate-100 text-slate-400" : ""}`}>{options.map((option) => <option translate="no" className="notranslate" key={option || "blank"} value={option}>{option || "미선택"}</option>)}</select></div>;
}
