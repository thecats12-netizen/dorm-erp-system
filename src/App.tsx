import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Camera,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Home,
  LogOut,
  Moon,
  Package,
  Palette,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Users,
  Wrench,
  Save,
} from "lucide-react";

declare global {
  interface Window {
    daum: any;
  }
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

type Gender = "남" | "여" | "기타";
type UserRole = "admin" | "viewer" | "dorm_manager" | "maintenance_reporter";
type Site = "평택" | "천안";

type LoginUser = {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  isActive: boolean;
  siteAccess: Site | "전체";
  dormId?: string;
  createdAt: string;
};

type Dorm = {
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
  prepaymentDeposit: number;
  realEstateName: string;
  balanceDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type Occupant = {
  id: string;
  dormId: string;
  site: Site;
  employeeName: string;
  gender: Gender;
  department: string;
  phone: string;
  moveInDate: string;
  moveOutDueDate: string;
  status: "거주중" | "만료예정" | "퇴실" | "천안이동" | "신규입주";
  isNewHireAssignment: boolean;
  notes: string;
  expectedMoveInDate?: string;
  expectedMoveOutDate?: string;
  actualMoveOutDate?: string;
  createdAt: string;
  updatedAt: string;
};

type InventoryItem = {
  id: string;
  dormId: string;
  managerName: string;
  contractStart: string;
  contractEnd: string;
  dormAddress: string;
  itemName: string;
  quantity: number;
  modelName: string;
  maker: string;
  purchaseAmount: number;
  issuedDate: string;
  soldDate: string;
  notes: string;
  createdAt: string;
};

type LeaseContract = {
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
};

type DormContractStatus = "진행중" | "종료" | "연장" | "해지" | "공실" | "만료예정";
type ContractType = "신규" | "연장" | "재계약" | "변경" | "해지후신규";

type DormContractFormState = Omit<DormContract, "id" | "contractStatus" | "contractType"> & {
  contractStatus: DormContractStatus | "자동선택";
  contractType: ContractType | "자동선택";
};

type DormContract = {
  id: string;
  site: Site;
  address: string;
  buildingName: string;
  dong: string;
  roomHo: string;
  pyeong: string;
  landlordName: string;
  landlordPhone: string;
  realEstateName: string;
  realEstatePhone: string;
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
};

type NewHireResidenceStatus = "거주중" | "퇴실" | "연장" | "만료예정" | "대기중";
type MoveInType = "대기자" | "신규" | "재입주" | "연장";

type NewHireEmployee = {
  id: string;
  site: Site;
  gender: Gender;
  name: string;
  phone: string;
  department: string;
  dormId: string;
  buildingName: string;
  dong: string;
  roomHo: string;
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
  createdAt: string;
  updatedAt: string;
};

type SaleRecord = {
  id: string;
  saleDate: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  buyerCompany: string;
  notes: string;
};

type DefectRequest = {
  id: string;
  receiptDate: string;
  inspectorName: string;
  dormManagerName: string;
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
  completedAt?: string;
};

type ThemeSettings = {
  accentColor: string;
  brandColor: string;
  darkMode: boolean;
  statuses: string[];
  colorMap: Record<string, string>;
};

type TabKey =
  | "dashboard"
  | "dorms"
  | "occupants"
  | "simulation"
  | "inventory"
  | "leases"
  | "sales"
  | "dormContracts"
  | "newHires"
  | "defects"
  | "users";

const AUTH_KEY = "dorm-auth-v4";
const USERS_KEY = "dorm-users-v4";
const DORMS_KEY = "dorm-master-v4";
const OCCUPANTS_KEY = "dorm-occupants-v4";
const INVENTORY_KEY = "dorm-inventory-v4";
const LEASES_KEY = "dorm-leases-v4";
const SALES_KEY = "dorm-sales-v4";
const DEFECTS_KEY = "dorm-defects-v4";
const DORM_CONTRACTS_KEY = "dorm-contracts-v4";
const NEW_HIRES_KEY = "dorm-new-hires-v4";
const THEME_KEY = "dorm-theme-v4";

const themeDefault: ThemeSettings = {
  accentColor: "#2563EB",
  brandColor: "#0F172A",
  darkMode: false,
  statuses: ["사용중", "만료예정", "해지", "공실", "접수", "진행중", "완료", "거주중", "퇴실", "신규입주", "천안이동"],
  colorMap: {
    사용중: "#DCFCE7",
    만료예정: "#FEF3C7",
    해지: "#FEE2E2",
    공실: "#E5E7EB",
    접수: "#DBEAFE",
    진행중: "#E0E7FF",
    완료: "#DCFCE7",
    거주중: "#DCFCE7",
    퇴실: "#F3F4F6",
    신규입주: "#E0F2FE",
    천안이동: "#FCE7F3",
  },
};

const demoUsers: LoginUser[] = [
  {
    id: crypto.randomUUID(),
    username: "admin",
    password: "admin1234",
    role: "admin",
    displayName: "총관리자",
    isActive: true,
    siteAccess: "전체",
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    username: "viewer",
    password: "viewer1234",
    role: "viewer",
    displayName: "조회전용",
    isActive: true,
    siteAccess: "전체",
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    username: "defect1",
    password: "defect1234",
    role: "maintenance_reporter",
    displayName: "기숙사관리자",
    isActive: true,
    siteAccess: "평택",
    createdAt: new Date().toISOString(),
  },
];
function getSafeUsers(): LoginUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return demoUsers;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return demoUsers;

    const valid = parsed.filter(
      (u: any) =>
        u &&
        typeof u.username === "string" &&
        typeof u.password === "string" &&
        typeof u.role === "string"
    );

    if (valid.length === 0) return demoUsers;

    const hasAdmin = valid.some((u: any) => u.username === "admin");
    return hasAdmin ? valid : demoUsers;
  } catch {
    return demoUsers;
  }
}

function DateFilter({ label, yearValue, monthValue, dayValue, onYearChange, onMonthChange, onDayChange }: { 
  label: string; 
  yearValue: string; 
  monthValue: string; 
  dayValue: string; 
  onYearChange: (v: string) => void; 
  onMonthChange: (v: string) => void; 
  onDayChange: (v: string) => void; 
}) {
  const currentYear = new Date().getFullYear();
  const years = ["전체", ...Array.from({ length: 10 }, (_, i) => (currentYear - i).toString())];
  const months = ["전체", ...Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'))];
  const days = ["전체", ...Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'))];

  return <div className="lg:col-span-4"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label><div className="flex gap-2"><select value={yearValue} onChange={(e) => onYearChange(e.target.value)} className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"><option value="전체">연도 전체</option>{years.slice(1).map((year) => <option key={year} value={year}>{year}년</option>)}</select><select value={monthValue} onChange={(e) => onMonthChange(e.target.value)} className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"><option value="전체">월 전체</option>{months.slice(1).map((month) => <option key={month} value={month}>{month}월</option>)}</select><select value={dayValue} onChange={(e) => onDayChange(e.target.value)} className="rounded-2xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-400"><option value="전체">일 전체</option>{days.slice(1).map((day) => <option key={day} value={day}>{day}일</option>)}</select></div></div>;
}

const demoDorms: Dorm[] = [
  {
    id: crypto.randomUUID(),
    site: "평택",
    gender: "남",
    buildingName: "소사벌리더스하임",
    address: "경기도 평택시 비전동 1011 소사벌리더스하임",
    dong: "109동",
    roomHo: "2002호",
    pyeong: "34평",
    capacity: 6,
    contractStart: "2025-05-16",
    contractEnd: "2027-05-16",
    contractAmount: "2000/120",
    leaseStatus: "사용중",
    prepaymentDeposit: 2000000,
    realEstateName: "평택부동산",
    balanceDate: "2025-05-30",
    notes: "남자 기숙사",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    site: "평택",
    gender: "여",
    buildingName: "백석아이파크",
    address: "경기도 평택시 비전동 백석아이파크",
    dong: "108동",
    roomHo: "2202호",
    pyeong: "34평",
    capacity: 6,
    contractStart: "2025-06-01",
    contractEnd: "2026-06-15",
    contractAmount: "1800/110",
    leaseStatus: "만료예정",
    prepaymentDeposit: 1800000,
    realEstateName: "신한부동산",
    balanceDate: "2025-06-20",
    notes: "여자 기숙사",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    site: "천안",
    gender: "남",
    buildingName: "천안센트럴파크",
    address: "충남 천안시 서북구 백석동 천안센트럴파크",
    dong: "101동",
    roomHo: "1501호",
    pyeong: "32평",
    capacity: 6,
    contractStart: "2025-04-01",
    contractEnd: "2027-04-01",
    contractAmount: "2200/130",
    leaseStatus: "사용중",
    prepaymentDeposit: 2200000,
    realEstateName: "천안중앙부동산",
    balanceDate: "2025-04-15",
    notes: "남자 기숙사",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const demoOccupants = (dorms: Dorm[]): Occupant[] => [
  {
    id: crypto.randomUUID(),
    dormId: dorms[0]?.id ?? "",
    site: dorms[0]?.site ?? "평택",
    employeeName: "김민수",
    gender: "남",
    department: "생산1팀",
    phone: "010-1234-5678",
    moveInDate: "2025-05-16",
    moveOutDueDate: "2027-05-16",
    status: "거주중",
    isNewHireAssignment: false,
    notes: "정상 거주",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    dormId: dorms[1]?.id ?? "",
    site: dorms[1]?.site ?? "평택",
    employeeName: "이서연",
    gender: "여",
    department: "품질팀",
    phone: "010-9876-5432",
    moveInDate: "2025-06-10",
    moveOutDueDate: "2026-06-15",
    status: "만료예정",
    isNewHireAssignment: false,
    notes: "계약 만료 근접",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    dormId: dorms[2]?.id ?? "",
    site: dorms[2]?.site ?? "천안",
    employeeName: "박준호",
    gender: "남",
    department: "설비팀",
    phone: "010-5555-2222",
    moveInDate: "2025-04-05",
    moveOutDueDate: "2027-04-01",
    status: "신규입주",
    isNewHireAssignment: true,
    notes: "신입사원 배정",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const demoDormContracts: DormContract[] = [
  {
    id: crypto.randomUUID(),
    site: "평택",
    address: "경기도 평택시 비전동 1011",
    buildingName: "소사벌리더스하임",
    dong: "109동",
    roomHo: "2002호",
    pyeong: "24",
    landlordName: "김철수",
    landlordPhone: "010-1234-5678",
    realEstateName: "평택부동산",
    realEstatePhone: "031-123-4567",
    contractStart: "",
    contractEnd: "",
    contractStatus: "진행중",
    contractAmount: "20,000,000",
    prepaymentDeposit: "2,000,000",
    deposit: "1,000,000",
    monthlyRentOrMaintenance: "120,000",
    contractType: "신규",
    gender: "남",
    notes: "계약 완료",
    registeredBy: "총관리자",
    modifiedBy: "총관리자",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const demoNewHires: NewHireEmployee[] = [
  {
    id: crypto.randomUUID(),
    site: "평택",
    gender: "남",
    name: "정승우",
    phone: "010-1111-2222",
    department: "개발팀",
    dormId: demoDorms[0]?.id ?? "",
    buildingName: "소사벌리더스하임",
    dong: "109동",
    roomHo: "2002호",
    expectedMoveInDate: "",
    moveInDate: "",
    expectedMoveOutDate: "",
    moveOutDate: "",
    actualMoveOutDate: "",
    cheonanMoveDate: "",
    residenceStatus: "거주중",
    moveInType: "신규",
    extensionReason: "",
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const demoInventory: InventoryItem[] = [
  {
    id: crypto.randomUUID(),
    dormId: demoDorms[0]?.id ?? "",
    managerName: "김철수",
    contractStart: "2025-01-01",
    contractEnd: "2026-12-31",
    dormAddress: "경기도 평택시 세교동 123-45",
    itemName: "세탁기",
    quantity: 2,
    modelName: "WA21M8700GV",
    maker: "삼성전자",
    purchaseAmount: 1200000,
    issuedDate: "2025-01-15",
    soldDate: "",
    notes: "기숙사 1층 세탁실 설치",
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    dormId: demoDorms[1]?.id ?? "",
    managerName: "이영희",
    contractStart: "2025-02-01",
    contractEnd: "2026-12-31",
    dormAddress: "경기도 평택시 세교동 456-78",
    itemName: "냉장고",
    quantity: 1,
    modelName: "RT35K5532S8",
    maker: "삼성전자",
    purchaseAmount: 800000,
    issuedDate: "2025-02-10",
    soldDate: "",
    notes: "기숙사 2층 공용 주방 설치",
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    dormId: demoDorms[2]?.id ?? "",
    managerName: "박민수",
    contractStart: "2025-03-01",
    contractEnd: "2026-12-31",
    dormAddress: "충청남도 천안시 동남구 789-01",
    itemName: "에어컨",
    quantity: 3,
    modelName: "AF17T7974WZN",
    maker: "삼성전자",
    purchaseAmount: 1800000,
    issuedDate: "2025-03-20",
    soldDate: "",
    notes: "각 호실별 설치",
    createdAt: new Date().toISOString(),
  },
];

const demoLeases: LeaseContract[] = [
  {
    id: crypto.randomUUID(),
    dateKey: "2025-01-15",
    addressName: "평택 세교동 아파트",
    dong: "101",
    ho: "101",
    pyeong: "24.5",
    contractAmount: "25000000",
    contractPeriod: "24개월",
    contractDate: "2025-01-15",
    prepaymentDeposit: 5000000,
    realEstateName: "평택부동산",
    balanceDate: "2025-02-15",
    site: "평택",
    gender: "남",
    notes: "신규 임대차 계약",
  },
  {
    id: crypto.randomUUID(),
    dateKey: "2025-02-20",
    addressName: "천안 동남구 빌라",
    dong: "202",
    ho: "202",
    pyeong: "19.8",
    contractAmount: "20000000",
    contractPeriod: "24개월",
    contractDate: "2025-02-20",
    prepaymentDeposit: 4000000,
    realEstateName: "천안부동산",
    balanceDate: "2025-03-20",
    site: "천안",
    gender: "여",
    notes: "재계약",
  },
  {
    id: crypto.randomUUID(),
    dateKey: "2025-03-10",
    addressName: "평택 세교동 오피스텔",
    dong: "303",
    ho: "303",
    pyeong: "22.1",
    contractAmount: "22000000",
    contractPeriod: "24개월",
    contractDate: "2025-03-10",
    prepaymentDeposit: 4400000,
    realEstateName: "평택부동산",
    balanceDate: "2025-04-10",
    site: "평택",
    gender: "남",
    notes: "임대차 갱신",
  },
];

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
    status: "거주중",
    isNewHireAssignment: false,
    notes: "",
    expectedMoveInDate: "",
    expectedMoveOutDate: "",
    actualMoveOutDate: "",
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
    buildingName: "",
    dong: "",
    roomHo: "",
    expectedMoveInDate: "",
    moveInDate: "",
    expectedMoveOutDate: "",
    moveOutDate: "",
    actualMoveOutDate: "",
    cheonanMoveDate: "",
    residenceStatus: "자동선택",
    moveInType: "자동선택",
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
    prepaymentDeposit: 0,
    realEstateName: "",
    balanceDate: "",
    notes: "",
  };
}

function inventoryTemplate(): Omit<InventoryItem, "id" | "createdAt"> {
  return {
    dormId: "",
    managerName: "",
    contractStart: "",
    contractEnd: "",
    dormAddress: "",
    itemName: "",
    quantity: 1,
    modelName: "",
    maker: "",
    purchaseAmount: 0,
    issuedDate: "",
    soldDate: "",
    notes: "",
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
    inspectorName: "",
    dormManagerName: "",
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

function userTemplate(): Omit<LoginUser, "id" | "createdAt"> {
  return {
    username: "",
    password: "",
    role: "viewer",
    displayName: "",
    isActive: true,
    siteAccess: "전체",
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

function parseExcelDate(value: unknown) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || !parsed.y) return "";
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${month}-${day}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const date = new Date(trimmed);
    if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
    return trimmed;
  }
  return "";
}

function daysDiff(dateText: string) {
  if (!dateText) return Number.POSITIVE_INFINITY;
  const target = new Date(dateText).getTime();
  const now = new Date().getTime();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
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

  if (contractEnd && daysDiff(contractEnd) <= 30) return "만료예정";
  if (!contractStart) return occupantCount > 0 ? "진행중" : "공실";
  if (contractStart <= today) return occupantCount > 0 ? "진행중" : "공실";
  return occupantCount > 0 ? "진행중" : "공실";
}

function calculateNewHireResidenceStatus(employee: NewHireFormLike): NewHireResidenceStatus {
  const today = new Date().toISOString().slice(0, 10);
  const moveInDate = employee.moveInDate || "";
  const moveOutDate = employee.moveOutDate || "";
  const actualMoveOutDate = employee.actualMoveOutDate || "";
  const hasAddressInfo = Boolean(employee.buildingName?.trim() && employee.dong?.trim() && employee.roomHo?.trim());

  if (!hasAddressInfo) return "대기중";
  if (actualMoveOutDate) return "퇴실";
  if (!moveInDate) return "대기중";
  if (moveInDate > today) return "대기중";
  if (moveOutDate && moveOutDate < today && !actualMoveOutDate) return "연장";
  if (moveOutDate && daysDiff(moveOutDate) <= 30) return "만료예정";
  return "거주중";
}

function calculateMoveInType(
  employee: NewHireFormLike,
  allEmployees: NewHireEmployee[]
): MoveInType {
  const hasAddressInfo = Boolean(employee.buildingName?.trim() && employee.dong?.trim() && employee.roomHo?.trim());
  if (!hasAddressInfo) return "대기자";

  const previousRecords = allEmployees.filter(
    (e) => e.id !== employee.id && e.name === employee.name && e.phone === employee.phone
  );
  if (previousRecords.length === 0) return "신규";

  const moveOutDate = employee.moveOutDate || "";
  const actualMoveOutDate = employee.actualMoveOutDate || "";
  const today = new Date().toISOString().slice(0, 10);
  if (moveOutDate && moveOutDate < today && !actualMoveOutDate) return "연장";

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
  return "변경";
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

function canEditData(user: LoginUser | null) {
  return !!user && user.role === "admin";
}

function canManageUsers(user: LoginUser | null) {
  return user?.role === "admin";
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
  const [newHires, setNewHires] = useState<NewHireEmployee[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [defects, setDefects] = useState<DefectRequest[]>([]);
  const [currentUser, setCurrentUser] = useState<LoginUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin1234" });
  const [loginError, setLoginError] = useState("");
  const [search, setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<Site | "전체">("전체");
  const [selectedDormId, setSelectedDormId] = useState<string>("");
  const [selectedDashboardIds, setSelectedDashboardIds] = useState<string[]>([]);
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
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryYearFilter, setInventoryYearFilter] = useState<string>("전체");
  const [inventoryMonthFilter, setInventoryMonthFilter] = useState<string>("전체");
  const [inventoryDayFilter, setInventoryDayFilter] = useState<string>("전체");
  const [leaseSearch, setLeaseSearch] = useState("");
  const [leaseYearFilter, setLeaseYearFilter] = useState<string>("전체");
  const [leaseMonthFilter, setLeaseMonthFilter] = useState<string>("전체");
  const [leaseDayFilter, setLeaseDayFilter] = useState<string>("전체");
  const [saleSearch, setSaleSearch] = useState("");
  const [defectSearch, setDefectSearch] = useState("");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardSiteFilter, setDashboardSiteFilter] = useState<Site | "전체">("전체");
  const [dormContractSearch, setDormContractSearch] = useState("");
  const [dormContractSiteFilter, setDormContractSiteFilter] = useState<Site | "전체">("전체");
  const [dormContractStatusFilter, setDormContractStatusFilter] = useState<DormContractStatus | "전체">("전체");
  const [newHireSearch, setNewHireSearch] = useState("");
  const [newHireSiteFilter, setNewHireSiteFilter] = useState<Site | "전체">("전체");
  const [newHireGenderFilter, setNewHireGenderFilter] = useState<"남" | "여" | "전체">("전체");
  const [simulationSearch, setSimulationSearch] = useState("");
  const [simulationSiteFilter, setSimulationSiteFilter] = useState<Site | "전체">("전체");
  const [simulationGenderFilter, setSimulationGenderFilter] = useState<"남" | "여" | "전체">("전체");

  const [showDormForm, setShowDormForm] = useState(false);
  const [showOccupantForm, setShowOccupantForm] = useState(false);
  const [showDormContractForm, setShowDormContractForm] = useState(false);
  const [showNewHireForm, setShowNewHireForm] = useState(false);
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [showLeaseForm, setShowLeaseForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showTheme, setShowTheme] = useState(false);

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
  const [dormContractForm, setDormContractForm] = useState<DormContractFormState>(dormContractTemplate());
  const [newHireForm, setNewHireForm] = useState<NewHireFormState>(newHireTemplate());
  const [inventoryForm, setInventoryForm] = useState(inventoryTemplate());
  const [leaseForm, setLeaseForm] = useState(leaseTemplate());
  const [saleForm, setSaleForm] = useState(saleTemplate());
  const [defectForm, setDefectForm] = useState(defectTemplate());
  const [userForm, setUserForm] = useState(userTemplate());

  const defectRequestPhotoInputRef = useRef<HTMLInputElement | null>(null);
const defectCompletionPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const savedDorms = localStorage.getItem(DORMS_KEY);
    const savedOccupants = localStorage.getItem(OCCUPANTS_KEY);
    const savedInventory = localStorage.getItem(INVENTORY_KEY);
    const savedLeases = localStorage.getItem(LEASES_KEY);
    const savedDormContracts = localStorage.getItem(DORM_CONTRACTS_KEY);
    const savedNewHires = localStorage.getItem(NEW_HIRES_KEY);
    const savedSales = localStorage.getItem(SALES_KEY);
    const savedDefects = localStorage.getItem(DEFECTS_KEY);
    const savedAuth = localStorage.getItem(AUTH_KEY);

    const dormSeed = savedDorms ? (JSON.parse(savedDorms) as Dorm[]) : demoDorms;
    setTheme(savedTheme ? { ...themeDefault, ...JSON.parse(savedTheme) } : themeDefault);
    setUsers(getSafeUsers());
    setDorms(dormSeed);
    setOccupants(savedOccupants ? JSON.parse(savedOccupants) : demoOccupants(dormSeed));
    setInventory(savedInventory ? JSON.parse(savedInventory) : demoInventory);
    setLeases(savedLeases ? JSON.parse(savedLeases) : demoLeases);
    setDormContracts(savedDormContracts ? JSON.parse(savedDormContracts) : demoDormContracts);
    setNewHires(savedNewHires ? JSON.parse(savedNewHires) : demoNewHires);
    setSales(savedSales ? JSON.parse(savedSales) : []);
    setDefects(savedDefects ? JSON.parse(savedDefects) : []);
    setCurrentUser(savedAuth ? JSON.parse(savedAuth) : null);
  }, []);

  useEffect(() => localStorage.setItem(THEME_KEY, JSON.stringify(theme)), [theme]);
  useEffect(() => localStorage.setItem(USERS_KEY, JSON.stringify(users)), [users]);
  useEffect(() => localStorage.setItem(DORMS_KEY, JSON.stringify(dorms)), [dorms]);
  useEffect(() => localStorage.setItem(OCCUPANTS_KEY, JSON.stringify(occupants)), [occupants]);
  useEffect(() => localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory)), [inventory]);
  useEffect(() => localStorage.setItem(LEASES_KEY, JSON.stringify(leases)), [leases]);
  useEffect(() => localStorage.setItem(DORM_CONTRACTS_KEY, JSON.stringify(dormContracts)), [dormContracts]);
  useEffect(() => localStorage.setItem(NEW_HIRES_KEY, JSON.stringify(newHires)), [newHires]);
  useEffect(() => localStorage.setItem(SALES_KEY, JSON.stringify(sales)), [sales]);
  useEffect(() => localStorage.setItem(DEFECTS_KEY, JSON.stringify(defects)), [defects]);
  useEffect(() => {
    if (currentUser) localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
    else localStorage.removeItem(AUTH_KEY);
  }, [currentUser]);

  const visibleDorms = useMemo(() => {
    return dorms.filter((d) => {
      if (currentUser?.role === "viewer" || currentUser?.role === "maintenance_reporter") {
        if (currentUser.siteAccess !== "전체" && d.site !== currentUser.siteAccess) return false;
      }

      if (dormSiteFilter !== "전체" && d.site !== dormSiteFilter) return false;
      if (dormGenderFilter !== "전체" && d.gender !== dormGenderFilter) return false;

      if (dormSearch) {
        const text = `${d.site} ${d.gender} ${d.buildingName} ${d.address} ${d.dong} ${d.roomHo}`.toLowerCase();
        if (!text.includes(dormSearch.toLowerCase())) return false;
      }

      return true;
    });
  }, [dorms, currentUser, siteFilter, dormSearch, dormSiteFilter, dormGenderFilter]);

  const visibleDormIds = useMemo(() => new Set(visibleDorms.map((d) => d.id)), [visibleDorms]);

  const visibleDormContracts = useMemo(() => {
    return dormContracts.filter((c) => {
      if (dormContractSiteFilter !== "전체" && c.site !== dormContractSiteFilter) return false;
      if (dormContractStatusFilter !== "전체" && c.contractStatus !== dormContractStatusFilter) return false;
      if (dormContractSearch) {
        const text = `${c.site} ${c.address} ${c.buildingName} ${c.dong} ${c.roomHo} ${c.pyeong} ${c.landlordName} ${c.landlordPhone} ${c.realEstateName} ${c.realEstatePhone} ${c.contractStart} ${c.contractEnd} ${c.contractStatus} ${c.contractAmount} ${c.prepaymentDeposit} ${c.deposit} ${c.monthlyRentOrMaintenance} ${c.contractType} ${c.notes} ${c.registeredBy} ${c.modifiedBy}`.toLowerCase();
        return text.includes(dormContractSearch.toLowerCase());
      }
      return true;
    });
  }, [dormContracts, dormContractSearch, dormContractSiteFilter, dormContractStatusFilter]);

  const visibleNewHires = useMemo(() => {
    return newHires.filter((h) => {
      if (newHireSiteFilter !== "전체" && h.site !== newHireSiteFilter) return false;
      if (newHireGenderFilter !== "전체" && h.gender !== newHireGenderFilter) return false;
      if (newHireSearch) {
        const text = `${h.site} ${h.gender} ${h.name} ${h.phone} ${h.department} ${h.dormId} ${h.buildingName} ${h.dong} ${h.roomHo} ${h.expectedMoveInDate} ${h.moveInDate} ${h.expectedMoveOutDate} ${h.moveOutDate} ${h.actualMoveOutDate} ${h.cheonanMoveDate} ${h.residenceStatus} ${h.moveInType} ${h.extensionReason} ${h.notes}`.toLowerCase();
        return text.includes(newHireSearch.toLowerCase());
      }
      return true;
    });
  }, [newHires, newHireSearch, newHireSiteFilter, newHireGenderFilter]);

  const visibleOccupants = useMemo(() => {
    return occupants.filter((o) => {
      const dorm = dorms.find((d) => d.id === o.dormId);
      if (!dorm || !visibleDormIds.has(dorm.id)) return false;
      if (occupantSiteFilter !== "전체" && dorm.site !== occupantSiteFilter) return false;
      if (occupantGenderFilter !== "전체" && o.gender !== occupantGenderFilter) return false;
      if (occupantStatusFilter !== "전체" && o.status !== occupantStatusFilter) return false;
      const text = `${o.employeeName} ${o.department} ${o.phone} ${o.status}`.toLowerCase();
      return !occupantSearch || text.includes(occupantSearch.toLowerCase());
    });
  }, [occupants, dorms, visibleDormIds, occupantSearch, occupantSiteFilter, occupantGenderFilter, occupantStatusFilter]);

  const visibleUsers = useMemo(() => {
    return users.filter((u) => {
      const text = `${u.displayName} ${u.username}`.toLowerCase();
      return !userSearch || text.includes(userSearch.toLowerCase());
    });
  }, [users, userSearch]);

  const visibleInventory = useMemo(() => {
    return inventory.filter((i) => {
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

      const text = `${i.managerName} ${i.contractStart} ${i.contractEnd} ${i.dormAddress} ${i.itemName} ${i.quantity} ${i.modelName} ${i.maker} ${i.purchaseAmount} ${i.issuedDate} ${i.soldDate} ${i.notes}`.toLowerCase();
      return !inventorySearch || text.includes(inventorySearch.toLowerCase());
    });
  }, [inventory, inventorySearch, inventoryYearFilter, inventoryMonthFilter, inventoryDayFilter]);

  const visibleLeases = useMemo(() => {
    return leases.filter((l) => {
      // 날짜 필터링
      if (leaseYearFilter !== "전체" && l.contractDate) {
        const year = new Date(l.contractDate).getFullYear().toString();
        if (year !== leaseYearFilter) return false;
      }
      if (leaseMonthFilter !== "전체" && l.contractDate) {
        const month = (new Date(l.contractDate).getMonth() + 1).toString().padStart(2, '0');
        if (month !== leaseMonthFilter) return false;
      }
      if (leaseDayFilter !== "전체" && l.contractDate) {
        const day = new Date(l.contractDate).getDate().toString().padStart(2, '0');
        if (day !== leaseDayFilter) return false;
      }

      const text = `${l.addressName} ${l.dong} ${l.ho} ${l.pyeong} ${l.contractAmount} ${l.contractPeriod} ${l.contractDate} ${l.prepaymentDeposit} ${l.realEstateName} ${l.balanceDate} ${l.notes}`.toLowerCase();
      return !leaseSearch || text.includes(leaseSearch.toLowerCase());
    });
  }, [leases, leaseSearch, leaseYearFilter, leaseMonthFilter, leaseDayFilter]);

  const visibleSales = useMemo(() => {
    return sales.filter((s) => {
      const text = `${s.saleDate} ${s.itemName} ${s.unitPrice} ${s.quantity} ${s.totalAmount} ${s.buyerCompany} ${s.notes}`.toLowerCase();
      return !saleSearch || text.includes(saleSearch.toLowerCase());
    });
  }, [sales, saleSearch]);

  const visibleDefects = useMemo(() => {
    const filterDefects = (d: DefectRequest) => {
      const text = `${d.receiptDate} ${d.inspectorName} ${d.dormManagerName} ${d.buildingName} ${d.dong} ${d.ho} ${d["공동현관"]} ${d["세대현관"]} ${d.roadAddress} ${d.detailAddress} ${d.defectStatus} ${d.requestText} ${d.completeText} ${d.reporterName}`.toLowerCase();
      return !defectSearch || text.includes(defectSearch.toLowerCase());
    };

    if (currentUser?.role === "maintenance_reporter") {
      return defects.filter((d) => d.reporterUserId === currentUser.id && filterDefects(d));
    }
    return defects.filter(filterDefects);
  }, [defects, currentUser, defectSearch]);

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
    return [...dorms]
      .filter((d) => d.contractEnd && daysDiff(d.contractEnd) >= 0)
      .sort((a, b) => daysDiff(a.contractEnd) - daysDiff(b.contractEnd))
      .slice(0, 10);
  }, [dorms]);

  const simulationRows = useMemo(() => {
    const build = (site: Site, gender: "남" | "여") => {
      const targetDorms = dorms.filter((d) => d.site === site && d.gender === gender);
      const targetOccupants = occupants.filter((o) => {
        const dorm = dorms.find((d) => d.id === o.dormId);
        return dorm?.site === site && dorm?.gender === gender;
      });
      const to = targetDorms.reduce((sum, d) => sum + d.capacity, 0);
      const current = targetOccupants.filter((o) => ["거주중", "만료예정", "신규입주"].includes(o.status)).length;
      const expireResidents = targetOccupants.filter((o) => o.status === "만료예정").length;
      const earlyDepartures = targetOccupants.filter((o) => o.status === "퇴실").length;
      const cheonanMove = targetOccupants.filter((o) => o.status === "천안이동").length;
      const newMoveIn = targetOccupants.filter((o) => o.status === "신규입주").length;
      const shortage = to - current;
      const expireBuildings = targetDorms.filter((d) => daysDiff(d.contractEnd) <= 60).length;
      const terminated = targetDorms.filter((d) => d.leaseStatus === "해지").length;
      const addLease = shortage > 0 ? Math.ceil(shortage / 6) : 0;
      return {
        key: `${site}-${gender}`,
        site,
        gender,
        dormCount: targetDorms.length,
        residentTo: to,
        currentResidents: current,
        expiredResidents: expireResidents,
        earlyDepartures,
        cheonanMove,
        newMoveIn,
        shortage,
        expireBuildings,
        terminated,
        addLease,
      };
    };
    return [build("평택", "남"), build("평택", "여"), build("천안", "남"), build("천안", "여")];
  }, [dorms, occupants]);

  const visibleDashboard = useMemo(() => {
    return expiringDormsTop10.filter((d) => {
      if (dashboardSiteFilter !== "전체" && d.site !== dashboardSiteFilter) return false;
      const daysUntilExpiry = daysDiff(d.contractEnd);
      const text = `${d.site} ${d.buildingName} ${d.address} ${d.contractEnd} ${daysUntilExpiry}`.toLowerCase();
      return !dashboardSearch || text.includes(dashboardSearch.toLowerCase());
    });
  }, [expiringDormsTop10, dashboardSearch, dashboardSiteFilter]);

  const visibleSimulationRows = useMemo(() => {
    return simulationRows.filter((r) => {
      if (simulationSiteFilter !== "전체" && r.site !== simulationSiteFilter) return false;
      if (simulationGenderFilter !== "전체" && r.gender !== simulationGenderFilter) return false;
      const text = `${r.site} ${r.gender} ${r.dormCount} ${r.residentTo} ${r.currentResidents} ${r.expiredResidents} ${r.earlyDepartures} ${r.cheonanMove} ${r.newMoveIn} ${r.shortage} ${r.expireBuildings} ${r.terminated} ${r.addLease}`.toLowerCase();
      return !simulationSearch || text.includes(simulationSearch.toLowerCase());
    });
  }, [simulationRows, simulationSearch, simulationSiteFilter, simulationGenderFilter]);

  const simulationTotal = useMemo(() => {
    const dormCount = dorms.length;
    const residentTo = dorms.reduce((sum, d) => sum + d.capacity, 0);
    const expireBuildings = dorms.filter((d) => daysDiff(d.contractEnd) <= 60).length;
    const addLease = simulationRows.reduce((sum, r) => sum + r.addLease, 0);
    const maleCount = occupants.filter((o) => o.gender === "남" && ["거주중", "만료예정", "신규입주"].includes(o.status)).length;
    const femaleCount = occupants.filter((o) => o.gender === "여" && ["거주중", "만료예정", "신규입주"].includes(o.status)).length;
    const using = maleCount + femaleCount;
    const usageRate = residentTo ? Math.round((using / residentTo) * 100) : 0;
    return { dormCount, residentTo, expireBuildings, addLease, maleCount, femaleCount, usageRate };
  }, [dorms, occupants, simulationRows]);

  const dashboardStats = useMemo(() => {
    const activeDormIds = new Set(
      dorms
        .filter((d) => d.contractEnd && daysDiff(d.contractEnd) >= 0 && d.leaseStatus !== "해지")
        .map((d) => d.id)
    );
    return {
      dormCount: activeDormIds.size,
      currentResidents: occupants.filter(
        (o) =>
          activeDormIds.has(o.dormId) &&
          ["거주중", "만료예정", "신규입주"].includes(o.status)
      ).length,
      defectsOpen: defects.filter((d) => d.defectStatus !== "완료").length,
      inventoryCount: inventory.length,
      expiringSoon: expiringDormsTop10.length,
    };
  }, [dorms, occupants, defects, inventory.length, expiringDormsTop10.length]);

  const login = () => {
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

  const logout = () => {
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

    const actualStatus =
      dormContractForm.contractStatus === "자동선택"
        ? calculateDormContractStatus(dormContractForm, dorms, occupants)
        : dormContractForm.contractStatus;
    const actualType =
      dormContractForm.contractType === "자동선택"
        ? calculateDormContractType(dormContractForm, dormContracts, editingDormContractId)
        : dormContractForm.contractType;

    const payload: DormContract = {
      id: editingDormContractId || crypto.randomUUID(),
      ...dormContractForm,
      contractStatus: actualStatus,
      contractType: actualType,
      registeredBy: dormContractForm.registeredBy || currentUser?.displayName || "",
      modifiedBy: currentUser?.displayName || dormContractForm.modifiedBy || "",
      createdAt: editingDormContractId ? dormContracts.find((c) => c.id === editingDormContractId)?.createdAt || dormContractForm.createdAt : dormContractForm.createdAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setDormContracts((prev) => (editingDormContractId ? prev.map((c) => (c.id === editingDormContractId ? payload : c)) : [payload, ...prev]));
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

    const dorm = newHireForm.dormId ? dorms.find((d) => d.id === newHireForm.dormId) : null;
    const actualResidenceStatus =
      newHireForm.residenceStatus === "자동선택"
        ? calculateNewHireResidenceStatus(newHireForm)
        : newHireForm.residenceStatus;
    const actualMoveInType =
      newHireForm.moveInType === "자동선택"
        ? calculateMoveInType(newHireForm, newHires)
        : newHireForm.moveInType;

    const payload: NewHireEmployee = {
      id: editingNewHireId || crypto.randomUUID(),
      ...newHireForm,
      residenceStatus: actualResidenceStatus,
      moveInType: actualMoveInType,
      site: newHireForm.site || dorm?.site || "평택",
      createdAt: editingNewHireId ? newHires.find((h) => h.id === editingNewHireId)?.createdAt || newHireForm.createdAt : newHireForm.createdAt || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setNewHires((prev) => (editingNewHireId ? prev.map((h) => (h.id === editingNewHireId ? payload : h)) : [payload, ...prev]));
    setNewHireForm(newHireTemplate());
    setEditingNewHireId(null);
    setShowNewHireForm(false);
  };

  const saveInventory = () => {
    if (!canEditData(currentUser)) return;
    const payload: InventoryItem = {
      id: editingInventoryId || crypto.randomUUID(),
      ...inventoryForm,
      createdAt: editingInventoryId ? inventory.find((i) => i.id === editingInventoryId)?.createdAt || new Date().toISOString() : new Date().toISOString(),
    };
    setInventory((prev) => (editingInventoryId ? prev.map((i) => (i.id === editingInventoryId ? payload : i)) : [payload, ...prev]));
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

    const existing = editingDefectId
      ? defects.find((d) => d.id === editingDefectId)
      : null;

    const today = new Date().toISOString().slice(0, 10);

    const payload: DefectRequest = {
      id: editingDefectId || crypto.randomUUID(),
      ...defectForm,
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

    setDefectForm(defectTemplate());
    setEditingDefectId(null);
    setShowDefectForm(false);
  };

  const saveUser = () => {
    if (!canManageUsers(currentUser)) return;
    if (!userForm.displayName.trim() || !userForm.username.trim()) {
      alert("표시이름과 아이디는 필수입니다.");
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
    setUsers((prev) => (editingUserId ? prev.map((u) => (u.id === editingUserId ? { ...payload, password: userForm.password || u.password } : u)) : [payload, ...prev]));
    setUserForm(userTemplate());
    setEditingUserId(null);
    setShowUserForm(false);
  };

  const uploadDormExcel = async (file: File) => {
    if (!canEditData(currentUser)) return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mappedDorms: Dorm[] = rows.map((r) => ({
      id: crypto.randomUUID(),
      site: String(r["지역"] || r["site"] || "평택") as Site,
      gender: String(r["성별"] || r["gender"] || "남") as "남" | "여",
      buildingName: String(r["건물명"] || r["기숙사명"] || ""),
      address: String(r["주소"] || r["기숙사주소"] || ""),
      dong: String(r["동"] || ""),
      roomHo: String(r["호수"] || r["호"] || ""),
      pyeong: String(r["평수"] || ""),
      capacity: 6,
      managerUserId: undefined,
      contractStart: String(r["계약일"] || r["계약시작"] || ""),
      contractEnd: String(r["만료일"] || r["계약종료"] || ""),
      contractAmount: String(r["계약금액"] || ""),
      leaseStatus: String(r["상태"] || "사용중") as Dorm["leaseStatus"],
      prepaymentDeposit: Number(r["선납계약금"] || 0),
      realEstateName: String(r["부동산명"] || ""),
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
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => ({
      id: crypto.randomUUID(),
      site: String(r["지역"] || r["site"] || "평택") as Site,
      address: String(r["도로명주소"] || r["주소"] || r["address"] || ""),
      buildingName: String(r["건물명"] || r["buildingName"] || ""),
      dong: String(r["동"] || ""),
      roomHo: String(r["호수"] || r["호"] || r["roomHo"] || ""),
      pyeong: String(r["평수"] || r["pyeong"] || ""),
      landlordName: String(r["임대인명"] || r["landlordName"] || ""),
      landlordPhone: String(r["임대인연락처"] || r["landlordPhone"] || ""),
      realEstateName: String(r["부동산명"] || r["realEstateName"] || ""),
      realEstatePhone: String(r["부동산연락처"] || r["realEstatePhone"] || ""),
      contractStart: String(r["계약시작일"] || r["계약시작"] || ""),
      contractEnd: String(r["계약종료일"] || r["계약종료"] || ""),
      contractStatus: String(r["계약상태"] || r["status"] || "진행중") as DormContractStatus,
      contractAmount: String(r["계약금액"] || r["contractAmount"] || ""),
      prepaymentDeposit: String(r["선납금"] || r["prepaymentDeposit"] || ""),
      deposit: String(r["보증금"] || r["deposit"] || ""),
      monthlyRentOrMaintenance: String(r["월세 or 관리비"] || r["월세/관리비"] || r["monthlyRentOrMaintenance"] || ""),
      contractType: String(r["계약유형"] || r["contractType"] || "신규") as ContractType,
      gender: String(r["성별"] || r["gender"] || "남") as Gender,
      notes: String(r["비고"] || r["notes"] || ""),
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
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const mapped = rows.map((r) => {
      const address = String(r["도로명주소"] || r["주소"] || r["address"] || "").trim();
      const matchedDorm = dorms.find(
        (d) => d.address === address || `${d.address} ${d.dong} ${d.roomHo}`.trim() === address || `${d.address}${d.dong}${d.roomHo}` === address
      );
      return {
      id: crypto.randomUUID(),
      site: String(r["지역"] || r["site"] || "평택") as Site,
      gender: String(r["성별"] || r["gender"] || "남") as Gender,
      name: String(r["이름"] || r["name"] || ""),
      phone: String(r["연락처"] || r["phone"] || ""),
      department: String(r["부서"] || r["department"] || ""),
      dormId: matchedDorm?.id || String(r["기숙사ID"] || r["dormId"] || ""),
      buildingName: String(r["건물명"] || r["buildingName"] || matchedDorm?.buildingName || ""),
      dong: String(r["동"] || matchedDorm?.dong || ""),
      roomHo: String(r["호수"] || r["호"] || r["roomHo"] || matchedDorm?.roomHo || ""),
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
    await uploadDormExcel(file);
  };
const exportExcel = () => {
  let rows: Record<string, unknown>[] = [];
  let fileName = "export.xlsx";

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
        const dorm = dorms.find((d) => d.id === o.dormId);
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
      계약일: i.contractStart,
      만료일: i.contractEnd,
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
      등록일: c.createdAt,
      수정일: c.updatedAt,
      등록자: c.registeredBy,
    }));
    fileName = "기숙사계약현황.xlsx";
  } else if (activeTab === "newHires") {
    rows = visibleNewHires.map((h) => {
      const dorm = dorms.find((d) => d.id === h.dormId);
      return {
        지역: h.site,
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
      상세주소: d.detailAddress,
      공동현관: d.공동현관,
      세대현관: d.세대현관,
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

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, fileName);
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

  const openDormEdit = (d: Dorm) => {
    setDormForm({
      site: d.site,
      gender: d.gender,
      buildingName: d.buildingName,
      address: d.address,
      dong: d.dong,
      roomHo: d.roomHo,
      pyeong: d.pyeong,
      capacity: 6,
      managerUserId: d.managerUserId || "",
      contractStart: d.contractStart,
      contractEnd: d.contractEnd,
      contractAmount: d.contractAmount,
      leaseStatus: d.leaseStatus,
      prepaymentDeposit: d.prepaymentDeposit,
      realEstateName: d.realEstateName,
      balanceDate: d.balanceDate,
      notes: d.notes,
    });
    setEditingDormId(d.id);
    setShowDormForm(true);
  };

  const openOccupantEdit = (o: Occupant) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = o;
    setOccupantForm(rest);
    setEditingOccupantId(o.id);
    setShowOccupantForm(true);
  };

  const openDormContractEdit = (c: DormContract) => {
    const { id: _id, ...rest } = c;
    setDormContractForm({ ...rest, contractStatus: "자동선택", contractType: "자동선택" });
    setEditingDormContractId(c.id);
    setShowDormContractForm(true);
  };

  const openNewHireEdit = (h: NewHireEmployee) => {
    const { id: _id, ...rest } = h;
    setNewHireForm({ ...rest, residenceStatus: "자동선택", moveInType: "자동선택" });
    setEditingNewHireId(h.id);
    setShowNewHireForm(true);
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

  const deleteById = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => {
    if (!confirm("삭제할까요?")) return;
    setter((prev) => prev.filter((item) => item.id !== id));
  };

  const selectDormForContext = (dormId: string) => {
    setSelectedDormId(dormId);
    setActiveTab("occupants");
  };

  if (!currentUser) {
    return (
      <div className={`min-h-screen ${theme.darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-100 text-slate-900"} p-6 flex items-center justify-center`}>
        <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ring-1 ${theme.darkMode ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200"}`}>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <Building2 className="h-7 w-7 text-slate-700" />
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
          <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <div className="font-semibold text-slate-800">기본 계정</div>
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
      <div className="mx-auto max-w-[1800px] p-4 md:p-6 lg:p-8">
        <header className="mb-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500"><Building2 className="h-4 w-4" /> 기숙사 운영 통합 시스템</div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">운영관리 대시보드 v4</h1>
              <p className="mt-1 text-sm text-slate-500">기숙사, 입주배정, 비품, 계약, 매각, 하자접수, 운영시뮬레이션까지 한 번에</p>
            </div>
            <div className="flex flex-wrap gap-2">
             <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-700">
               {currentUser.role === "admin" ? (
                 <ShieldCheck className="h-4 w-4" />
               ) : (
                <Eye className="h-4 w-4" />
                )}
               {currentUser.displayName} · {getRoleLabel(currentUser.role)}
           </div>

            {currentUser.role !== "maintenance_reporter" && canEditData(currentUser) && (
               <button
                onClick={() => excelInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
               >
                <Upload className="h-4 w-4" /> 엑셀등록
              </button>
             )}

             {currentUser.role !== "maintenance_reporter" && (
               <button
                 onClick={exportExcel}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" /> 엑셀내보내기
               </button>
              )}

             {currentUser.role !== "maintenance_reporter" && (
               <button
                 onClick={() => setShowTheme((v) => !v)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
               >
                  <Palette className="h-4 w-4" /> 색상 설정
                </button>
             )}

             <button
               onClick={() => setTheme((s) => ({ ...s, darkMode: !s.darkMode }))}
               className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
             >
               <Moon className="h-4 w-4" /> {theme.darkMode ? "라이트모드" : "다크모드"}
             </button>

             <button
                onClick={logout}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
             >
              <LogOut className="h-4 w-4" /> 로그아웃
              </button>
           </div>
          </div>
          <input ref={excelInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadExcel(file); e.currentTarget.value = ""; }} />
        </header>

          {currentUser.role !== "maintenance_reporter" && (
            <section className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
              <StatCard icon={<Home className="h-5 w-5" />} label="기숙사 수" value={`${dashboardStats.dormCount}`} sub="전체 건물" />
             <StatCard icon={<Users className="h-5 w-5" />} label="현 거주자" value={`${dashboardStats.currentResidents}`} sub="거주중+신규입주" />
              <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="하자 미완료" value={`${dashboardStats.defectsOpen}`} sub="접수/진행중" />
             <StatCard icon={<Package className="h-5 w-5" />} label="비품 품목" value={`${dashboardStats.inventoryCount}`} sub="등록 기준" />
             <StatCard icon={<CalendarClock className="h-5 w-5" />} label="만료 근접" value={`${dashboardStats.expiringSoon}`} sub="TOP 10 표시" />
           </section>
         )}

          <section className="mb-6 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
           <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
             {currentUser.role !== "maintenance_reporter" && (
                <>
                  <div className="relative lg:col-span-5">
                   <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                     onChange={(e) => setSearch(e.target.value)}
                     placeholder="건물명, 주소, 입주자, 부서, 비고 검색"
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 outline-none focus:border-slate-400"
                   />
                 </div>

                 <FilterSelect
                    label="지역"
                    value={siteFilter}
                   onChange={(v) => setSiteFilter(v as Site | "전체")}
                   options={["전체", "평택", "천안"]}
                 />
                </>
             )}

    <div className="lg:col-span-5 flex flex-wrap items-end gap-2">
      {currentUser.role === "maintenance_reporter" ? (
        <>
          {tabButton(activeTab, setActiveTab, "defects", <Wrench className="h-4 w-4" />, "하자접수")}
        </>
      ) : (
        <>
          {tabButton(activeTab, setActiveTab, "dashboard", <FileSpreadsheet className="h-4 w-4" />, "대시보드")}
          {tabButton(activeTab, setActiveTab, "dormContracts", <Building2 className="h-4 w-4" />, "기숙사 계약현황")}
          {tabButton(activeTab, setActiveTab, "newHires", <Users className="h-4 w-4" />, "신입사원 명단")}
          {tabButton(activeTab, setActiveTab, "dorms", <Building2 className="h-4 w-4" />, "기숙사")}
          {tabButton(activeTab, setActiveTab, "occupants", <Users className="h-4 w-4" />, "입주자")}
          {tabButton(activeTab, setActiveTab, "simulation", <ClipboardList className="h-4 w-4" />, "운영시뮬레이션")}
          {tabButton(activeTab, setActiveTab, "inventory", <Package className="h-4 w-4" />, "비품현황")}
          {tabButton(activeTab, setActiveTab, "leases", <CalendarClock className="h-4 w-4" />, "신규계약")}
          {tabButton(activeTab, setActiveTab, "sales", <Download className="h-4 w-4" />, "비품매각")}
          {tabButton(activeTab, setActiveTab, "defects", <Wrench className="h-4 w-4" />, "하자접수")}
          {canManageUsers(currentUser) &&
            tabButton(activeTab, setActiveTab, "users", <UserCog className="h-4 w-4" />, "계정관리")}
        </>
      )}
    </div>
  </div>
</section>

        {showTheme && (
          <section className="mb-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 text-lg font-semibold">색상 설정</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ColorEditor label="강조 색상" value={theme.accentColor} onChange={(v) => setTheme((s) => ({ ...s, accentColor: v }))} />
              <ColorEditor label="브랜드 색상" value={theme.brandColor} onChange={(v) => setTheme((s) => ({ ...s, brandColor: v }))} />
            </div>
          </section>
        )}

        {activeTab === "dashboard" && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">만료일 근접 기숙사 TOP 10</h2>
                  <p className="text-sm text-slate-500">주소 기준으로 빠르게 확인</p>
                </div>
                <div className="flex items-center gap-2">
                  <FilterSelect
                    label="지역"
                    value={dashboardSiteFilter}
                    onChange={(v) => setDashboardSiteFilter(v as Site | "전체")}
                    options={["전체", "평택", "천안"]}
                  />
                  <input
                    type="text"
                    placeholder="검색..."
                    value={dashboardSearch}
                    onChange={(e) => setDashboardSearch(e.target.value)}
                    className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                  {canEditData(currentUser) && selectedDashboardIds.length > 0 && (
                    <button
                      onClick={() => {
                        setDorms((prev) => prev.filter((d) => !selectedDashboardIds.includes(d.id)));
                        setSelectedDashboardIds([]);
                      }}
                      className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                    >
                      선택 삭제
                    </button>
                  )}
                  <span className="text-sm text-slate-400">최대 10건</span>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-sm text-center">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={visibleDashboard.length > 0 && selectedDashboardIds.length === visibleDashboard.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDashboardIds(visibleDashboard.map((d) => d.id));
                            else setSelectedDashboardIds([]);
                          }}
                          className="h-5 w-5"
                        />
                      </th>
                      <th className="px-3 py-2">순번</th>
                      <th className="px-3 py-2">지역</th>
                      <th className="px-3 py-2">건물명</th>
                      <th className="px-3 py-2">주소</th>
                      <th className="px-3 py-2">만료일</th>
                      <th className="px-3 py-2">D-Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDashboard.map((d, index) => (
                      <tr
                        key={d.id}
                        onClick={(e) => handleRowClick(e, () => openDormEdit(d))}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedDashboardIds.includes(d.id)}
                            onChange={(e) =>
                              e.target.checked
                                ? setSelectedDashboardIds((prev) => [...prev, d.id])
                                : setSelectedDashboardIds((prev) => prev.filter((id) => id !== d.id))
                            }
                            className="h-5 w-5"
                          />
                        </td>
                        <td className="px-3 py-3 font-medium">{index + 1}</td>
                        <td className="px-3 py-3">{d.site}</td>
                        <td className="px-3 py-3">{d.buildingName}</td>
                        <td className="px-3 py-3">{d.address} {d.dong} {d.roomHo}</td>
                        <td className="px-3 py-3">{d.contractEnd || "-"}</td>
                        <td className="px-3 py-3">{daysDiff(d.contractEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="mb-4 text-lg font-semibold">신입사원 입주배정</div>
              <div className="space-y-3">
                {occupants.filter((o) => o.isNewHireAssignment).map((o) => {
                  const dorm = dorms.find((d) => d.id === o.dormId);
                  return (
                    <div key={o.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{o.employeeName}</div>
                          <div className="text-sm text-slate-500">{o.department}</div>
                        </div>
                        <span
                          className="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-300 dark:ring-slate-400 dark:text-white"
                          style={{ backgroundColor: badgeColor(theme, o.status) }}
                        >
                          {o.status}
                        </span>
                      </div>
                      <div className="mt-3 text-sm text-slate-600">
                        {dorm
                          ? `${dorm.site} · ${dorm.buildingName} · ${dorm.dong} ${dorm.roomHo}`
                          : "미배정"}
                      </div>
                    </div>
                  );
                })}

                {!occupants.some((o) => o.isNewHireAssignment) && (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                    현재 신입사원 배정 데이터가 없습니다.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === "dormContracts" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사 계약현황</h2>
                <p className="text-sm text-slate-500">
                  지역 / 상태 필터와 검색으로 계약 정보를 확인하세요.
                  {selectedDormContractIds.length > 0 && ` 선택된 ${selectedDormContractIds.length}개`}
                </p>
              </div>
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
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
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
                {canEditData(currentUser) && selectedDormContractIds.length > 0 && (
                  <button
                    onClick={() => {
                      if (!confirm("선택한 계약을 삭제할까요?")) return;
                      setDormContracts((prev) => prev.filter((item) => !selectedDormContractIds.includes(item.id)));
                      setSelectedDormContractIds([]);
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
                <thead className="bg-slate-100 text-slate-700">
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
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractStatus}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractAmount}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.prepaymentDeposit}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.deposit}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.monthlyRentOrMaintenance}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.contractType}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.notes}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.createdAt}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{c.updatedAt}</td>
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
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">신입사원 명단</h2>
                <p className="text-sm text-slate-500">
                  지역 / 성별 필터와 검색으로 입주 정보를 관리하세요.
                  {selectedNewHireIds.length > 0 && ` 선택된 ${selectedNewHireIds.length}개`}
                </p>
              </div>
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
                <input
                  type="text"
                  placeholder="검색..."
                  value={newHireSearch}
                  onChange={(e) => setNewHireSearch(e.target.value)}
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
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
                {canEditData(currentUser) && selectedNewHireIds.length > 0 && (
                  <button
                    onClick={() => {
                      if (!confirm("선택한 신입사원을 삭제할까요?")) return;
                      setNewHires((prev) => prev.filter((item) => !selectedNewHireIds.includes(item.id)));
                      setSelectedNewHireIds([]);
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
                <thead className="bg-slate-100 text-slate-700">
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
                  </tr>
                </thead>
                <tbody>
                  {visibleNewHires.map((h, index) => (
                    <tr
                      key={h.id}
                      onClick={(e) => handleRowClick(e, () => openNewHireEdit(h))}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.name}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.phone}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.department}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{dorms.find((d) => d.id === h.dormId)?.address || h.dormId}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.buildingName}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.dong}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.roomHo}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.expectedMoveInDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveInDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.expectedMoveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.actualMoveOutDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.cheonanMoveDate}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.residenceStatus}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.moveInType}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.extensionReason || "-"}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{h.notes || "-"}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(h.createdAt)}</td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs">{formatDateOnly(h.updatedAt)}</td>
                    </tr>
                  ))}
                  {visibleNewHires.length === 0 && (
                    <tr>
                      <td colSpan={canEditData(currentUser) ? 23 : 22} className="px-4 py-12 text-center text-slate-400">
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
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">기숙사별 정보</h2>
                <p className="text-sm text-slate-500">기숙사별 관리자 1명 지정, 최대 인원 6명 관리</p>
              </div>
              <div className="flex items-center gap-2">
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
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
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
                {canEditData(currentUser) && (
                  <button
                    onClick={() => {
                      setDormForm(dormTemplate());
                      setEditingDormId(null);
                      setShowDormForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"
                  >
                    <Plus className="h-4 w-4" /> 기숙사 추가
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {visibleDorms.map((d, index) => {
                const manager = users.find((u) => u.id === d.managerUserId);
                const residentCount = occupancyCountByDorm.get(d.id) || 0;
                return (
                  <div
                    key={d.id}
                    onClick={(e) => handleRowClick(e, () => openDormEdit(d))}
                    role="button"
                    className="rounded-2xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
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
                          className="h-5 w-5 rounded border-slate-300 text-slate-900"
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
                      <div className="text-xs text-slate-500">{d.address} {d.dong} {d.roomHo}</div>
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
                      {canEditData(currentUser) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDormEdit(d);
                          }}
                          className="rounded-xl border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                        >
                          수정
                        </button>
                      )}
                      {canEditData(currentUser) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteById(setDorms, d.id);
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
                        className="rounded-xl border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
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
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">기숙사별 인원 / 입실일</h2><p className="text-sm text-slate-500">선택된 기숙사 기준 입주자 상세 관리</p></div><div className="flex items-center gap-2"><FilterSelect label="지역" value={occupantSiteFilter} onChange={(v) => setOccupantSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} /><FilterSelect label="성별" value={occupantGenderFilter} onChange={(v) => setOccupantGenderFilter(v as Gender | "전체")} options={["전체", "남", "여", "기타"]} /><FilterSelect label="상태" value={occupantStatusFilter} onChange={setOccupantStatusFilter} options={["전체", "거주중", "만료예정", "퇴실", "천안이동", "신규입주"]} /><input type="text" placeholder="검색..." value={occupantSearch} onChange={(e) => setOccupantSearch(e.target.value)} className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400" />{canEditData(currentUser) && selectedOccupantIds.length > 0 && (<button onClick={() => { setOccupants((prev) => prev.filter((o) => !selectedOccupantIds.includes(o.id))); setSelectedOccupantIds([]); }} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">선택 삭제</button>)}{canEditData(currentUser) && <button onClick={() => { setOccupantForm(occupantTemplate()); setEditingOccupantId(null); setShowOccupantForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="h-4 w-4" /> 입주자 추가</button>}</div></div>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">{visibleDorms.map((d) => <button key={d.id} onClick={() => setSelectedDormId(d.id)} className={`rounded-2xl border px-4 py-3 text-left ${selectedDormId === d.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}><div className="font-semibold">{d.buildingName}</div><div className="text-sm text-slate-500">{d.dong} {d.roomHo}</div><div className="mt-2 text-xs text-slate-500">현재 {occupancyCountByDorm.get(d.id) || 0}/6명</div></button>)}</div>
            <div className="overflow-auto">
              <table className="w-full min-w-[1100px] text-sm text-center">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          visibleOccupants.filter((o) => !selectedDormId || o.dormId === selectedDormId).length > 0 &&
                          selectedOccupantIds.length === visibleOccupants.filter((o) => !selectedDormId || o.dormId === selectedDormId).length
                        }
                        onChange={(e) => {
                          if (e.target.checked) setSelectedOccupantIds(visibleOccupants.filter((o) => !selectedDormId || o.dormId === selectedDormId).map((o) => o.id));
                          else setSelectedOccupantIds([]);
                        }}
                        className="h-5 w-5"
                      />
                    </th>
                    <th className="px-3 py-2">지역</th>
                    <th className="px-3 py-2">기숙사</th>
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">성별</th>
                    <th className="px-3 py-2">부서</th>
                    <th className="px-3 py-2">연락처</th>
                    <th className="px-3 py-2">입실일</th>
                    <th className="px-3 py-2">잔여일</th>
                    <th className="px-3 py-2">예상입실일</th>
                    <th className="px-3 py-2">예상퇴실일</th>
                    <th className="px-3 py-2">실제퇴실일</th>
                    <th className="px-3 py-2">비고</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">비고</th>
                    <th className="px-3 py-2">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOccupants.filter((o) => !selectedDormId || o.dormId === selectedDormId).map((o) => {
                    const dorm = dorms.find((d) => d.id === o.dormId);
                    return (
                      <tr
                        key={o.id}
                        onClick={(e) => handleRowClick(e, () => openOccupantEdit(o))}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                        <td className="px-3 py-3">{dorm?.buildingName || "-"}</td>
                        <td className="px-3 py-3">{o.employeeName}</td>
                        <td className="px-3 py-3">{o.gender}</td>
                        <td className="px-3 py-3">{o.department}</td>
                        <td className="px-3 py-3">{o.phone}</td>
                        <td className="px-3 py-3">{o.moveInDate || "-"}</td>
                        <td className="px-3 py-3">{daysBetween(o.moveInDate, o.moveOutDueDate)}</td>
                        <td className="px-3 py-3">{o.expectedMoveInDate || "-"}</td>
                        <td className="px-3 py-3">{o.expectedMoveOutDate || "-"}</td>
                        <td className="px-3 py-3">{o.actualMoveOutDate || "-"}</td>
                        <td className="px-3 py-3">{o.notes}</td>
                        <td className="px-3 py-3">
                          <span
                            className="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-300 dark:ring-slate-400 dark:text-white"
                            style={{ backgroundColor: badgeColor(theme, o.status) }}
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">{o.notes}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-2">
                            {canEditData(currentUser) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOccupantEdit(o);
                                }}
                                className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {canEditData(currentUser) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteById(setOccupants, o.id);
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
                      <td colSpan={16} className="px-4 py-12 text-center text-slate-400">
                        입주자 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "simulation" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">운영 시뮬레이션</h2><p className="text-sm text-slate-500">평택/천안 남녀별 및 전체 합계</p></div><div className="flex items-center gap-2"><FilterSelect label="지역" value={simulationSiteFilter} onChange={(v) => setSimulationSiteFilter(v as Site | "전체")} options={["전체", "평택", "천안"]} /><FilterSelect label="성별" value={simulationGenderFilter} onChange={(v) => setSimulationGenderFilter(v as "남" | "여" | "전체")} options={["전체", "남", "여"]} /><input type="text" placeholder="검색..." value={simulationSearch} onChange={(e) => setSimulationSearch(e.target.value)} className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400" /></div></div>
            <div className="overflow-auto"><table className="w-full min-w-[1400px] text-sm text-center"><thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-2">구분</th><th className="px-3 py-2">기숙사수</th><th className="px-3 py-2">거주자(TO)</th><th className="px-3 py-2">현 거주자</th><th className="px-3 py-2">거주기한 만료자</th><th className="px-3 py-2">중도 퇴거자</th><th className="px-3 py-2">천안이동</th><th className="px-3 py-2">신규입주</th><th className="px-3 py-2">과부족</th><th className="px-3 py-2">임차만기(건물수)</th><th className="px-3 py-2">해지(건물수)</th><th className="px-3 py-2">추가임차(건물수)</th></tr></thead><tbody>{visibleSimulationRows.map((r) => <tr key={r.key} className="border-b border-slate-100"><td className="px-3 py-3 font-medium">{r.site}({r.gender})</td><td className="px-3 py-3">{r.dormCount}</td><td className="px-3 py-3">{r.residentTo}</td><td className="px-3 py-3">{r.currentResidents}</td><td className="px-3 py-3">{r.expiredResidents}</td><td className="px-3 py-3">{r.earlyDepartures}</td><td className="px-3 py-3">{r.cheonanMove}</td><td className="px-3 py-3">{r.newMoveIn}</td><td className="px-3 py-3">{r.shortage}</td><td className="px-3 py-3">{r.expireBuildings}</td><td className="px-3 py-3">{r.terminated}</td><td className="px-3 py-3">{r.addLease}</td></tr>)}<tr className="bg-slate-50 font-semibold"><td className="px-3 py-3">{simulationTotal.residentTo}</td><td className="px-3 py-3">-</td><td className="px-3 py-3">-</td><td className="px-3 py-3">-</td><td className="px-3 py-3">-</td><td className="px-3 py-3">-</td><td className="px-3 py-3">{simulationTotal.expireBuildings}</td><td className="px-3 py-3">-</td><td className="px-3 py-3">{simulationTotal.addLease}</td></tr></tbody></table></div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
              <MiniStat label="남자 총원" value={String(simulationTotal.maleCount)} />
              <MiniStat label="여자 총원" value={String(simulationTotal.femaleCount)} />
              <MiniStat label="사용률" value={`${simulationTotal.usageRate}%`} />
              <MiniStat label="전체 TO" value={String(simulationTotal.residentTo)} />
              <MiniStat label="임차만기 건물" value={String(simulationTotal.expireBuildings)} />
              <MiniStat label="추가임차 필요" value={String(simulationTotal.addLease)} />
            </div>
          </section>
        )}

        {activeTab === "inventory" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">기숙사별 비품현황</h2><p className="text-sm text-slate-500">관리자명, 계약일, 만료일, 주소, 비품명, 수량, 모델, 메이커, 구매액, 지급일, 매각일, 비고</p></div><div className="flex items-center gap-2"><DateFilter label="구매일" yearValue={inventoryYearFilter} monthValue={inventoryMonthFilter} dayValue={inventoryDayFilter} onYearChange={setInventoryYearFilter} onMonthChange={setInventoryMonthFilter} onDayChange={setInventoryDayFilter} /><input type="text" placeholder="검색..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400" />{canEditData(currentUser) && selectedInventoryIds.length > 0 && (<button onClick={() => { setInventory((prev) => prev.filter((i) => !selectedInventoryIds.includes(i.id))); setSelectedInventoryIds([]); }} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">선택 삭제</button>)}{canEditData(currentUser) && <button onClick={() => { setInventoryForm(inventoryTemplate()); setEditingInventoryId(null); setShowInventoryForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="h-4 w-4" /> 비품 추가</button>}</div></div>
            <div className="overflow-auto">
              <table className="w-full min-w-[1500px] text-sm text-center">
                <thead className="bg-slate-100 text-slate-700">
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
                    <th className="px-3 py-2">관리자명</th>
                    <th className="px-3 py-2">계약일</th>
                    <th className="px-3 py-2">만료일</th>
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
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                      <td className="px-3 py-3">{i.managerName}</td>
                      <td className="px-3 py-3">{i.contractStart}</td>
                      <td className="px-3 py-3">{i.contractEnd}</td>
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
                              className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteById(setInventory, i.id);
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
          </section>
        )}

        {activeTab === "leases" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">날짜별 신규계약 현황</h2><p className="text-sm text-slate-500">주소명, 동/호수, 평수, 계약금액, 계약기간, 계약일, 선납계약금, 부동산명, 참고사항, 잔금일</p></div><div className="flex items-center gap-2"><DateFilter label="계약일" yearValue={leaseYearFilter} monthValue={leaseMonthFilter} dayValue={leaseDayFilter} onYearChange={setLeaseYearFilter} onMonthChange={setLeaseMonthFilter} onDayChange={setLeaseDayFilter} /><input type="text" placeholder="검색..." value={leaseSearch} onChange={(e) => setLeaseSearch(e.target.value)} className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400" />{canEditData(currentUser) && selectedLeaseIds.length > 0 && (<button onClick={() => { setLeases((prev) => prev.filter((l) => !selectedLeaseIds.includes(l.id))); setSelectedLeaseIds([]); }} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">선택 삭제</button>)}{canEditData(currentUser) && <button onClick={() => { setLeaseForm(leaseTemplate()); setEditingLeaseId(null); setShowLeaseForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="h-4 w-4" /> 신규계약 추가</button>}</div></div>
            <div className="overflow-auto"><table className="w-full min-w-[1300px] text-sm text-center"><thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-2"><input type="checkbox" checked={visibleLeases.length > 0 && selectedLeaseIds.length === visibleLeases.length} onChange={(e) => { if (e.target.checked) setSelectedLeaseIds(visibleLeases.map((l) => l.id)); else setSelectedLeaseIds([]); }} className="h-5 w-5" /></th><th className="px-3 py-2">구분</th><th className="px-3 py-2">계약일</th><th className="px-3 py-2">주소명</th><th className="px-3 py-2">동</th><th className="px-3 py-2">호수</th><th className="px-3 py-2">평수</th><th className="px-3 py-2">계약금액</th><th className="px-3 py-2">계약기간</th><th className="px-3 py-2">선납계약금</th><th className="px-3 py-2">부동산명</th><th className="px-3 py-2">잔금일</th><th className="px-3 py-2">참고사항</th><th className="px-3 py-2">작업</th></tr></thead><tbody>{visibleLeases.map((l, index) => (
                    <tr
                      key={l.id}
                      onClick={(e) => handleRowClick(e, () => openLeaseEdit(l))}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                              className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {canEditData(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteById(setLeases, l.id);
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
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">비품매각 현황</h2>
                <p className="text-sm text-slate-500">일자, 품목, 단가, 수량, 합계, 매각업체, 비고</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="검색..."
                  value={saleSearch}
                  onChange={(e) => setSaleSearch(e.target.value)}
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                {canEditData(currentUser) && selectedSaleIds.length > 0 && (
                  <button
                    onClick={() => {
                      setSales((prev) => prev.filter((s) => !selectedSaleIds.includes(s.id)));
                      setSelectedSaleIds([]);
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    선택 삭제
                  </button>
                )}
                {canEditData(currentUser) && (
                  <button
                    onClick={() => {
                      setSaleForm(saleTemplate());
                      setEditingSaleId(null);
                      setShowSaleForm(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white"
                  >
                    <Plus className="h-4 w-4" /> 매각 등록
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[1000px] text-sm text-center">
                <thead className="bg-slate-100 text-slate-700">
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
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                              className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
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

        {activeTab === "defects" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">하자접수건</h2>
                <p className="text-sm text-slate-500">
                  접수일, 기숙사관리자명, 주소, 하자신청/완료 내용, 사진 첨부
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="검색..."
                  value={defectSearch}
                  onChange={(e) => setDefectSearch(e.target.value)}
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                {canFileDefect(currentUser) && (
                  <button
                    onClick={() => {
                      setDefectForm({
                        ...defectTemplate(),
                        reporterUserId: currentUser.id,
                        reporterName: currentUser.displayName,
                        dormManagerName: currentUser.username,
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
                <thead className="bg-slate-100 text-slate-700">
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
                    <th className="px-3 py-2 text-center">상세주소</th>
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
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                      <td className="px-3 py-3">{d.detailAddress}</td>
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
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
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
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
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
                              className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}

                          {canManageUsers(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteById(setDefects, d.id);
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
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">계정 및 권한 설정</h2>
                <p className="text-sm text-slate-500">기숙사관리자 1명 지정, 하자접수 전용 계정 추가 생성</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="아이디 또는 표시이름 검색"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />

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
                <thead className="bg-slate-100 text-slate-700">
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
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                        <td className="px-3 py-3">{dorm ? `${dorm.buildingName} ${dorm.dong} ${dorm.roomHo}` : "-"}</td>
                        <td className="px-3 py-3">{u.isActive ? "활성" : "비활성"}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserEdit(u);
                              }}
                              className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"
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

        {showDormForm && modalWrap(
          "기숙사 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectInput label="지역" value={dormForm.site} onChange={(v) => setDormForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SelectInput label="성별" value={dormForm.gender} onChange={(v) => setDormForm((f) => ({ ...f, gender: v as "남" | "여" }))} options={["남", "여"]} />
            <Input label="건물명" value={dormForm.buildingName} onChange={(v) => setDormForm((f) => ({ ...f, buildingName: v }))} />
            <Input label="주소" value={dormForm.address} onChange={(v) => setDormForm((f) => ({ ...f, address: v }))} />
            <Input label="동" value={dormForm.dong} onChange={(v) => setDormForm((f) => ({ ...f, dong: v }))} />
            <Input label="호수" value={dormForm.roomHo} onChange={(v) => setDormForm((f) => ({ ...f, roomHo: v }))} />
            <Input label="평수" value={dormForm.pyeong} onChange={(v) => setDormForm((f) => ({ ...f, pyeong: v }))} />
            <SelectInput label="기숙사 관리자" value={dormForm.managerUserId || ""} onChange={(v) => setDormForm((f) => ({ ...f, managerUserId: v }))} options={["", ...users.filter((u) => u.role === "dorm_manager").map((u) => u.id)]} />
            <Input label="계약시작" type="date-text" value={dormForm.contractStart} onChange={(v) => setDormForm((f) => ({ ...f, contractStart: v }))} />
            <Input label="계약종료" type="date-text" value={dormForm.contractEnd} onChange={(v) => setDormForm((f) => ({ ...f, contractEnd: v }))} />
            <Input label="계약금액" value={dormForm.contractAmount} onChange={(v) => setDormForm((f) => ({ ...f, contractAmount: v }))} />
            <SelectInput label="상태" value={dormForm.leaseStatus} onChange={(v) => setDormForm((f) => ({ ...f, leaseStatus: v as Dorm["leaseStatus"] }))} options={["사용중", "만료예정", "해지", "공실"]} />
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
          "기숙사 계약 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectInput label="지역" value={dormContractForm.site} onChange={(v) => setDormContractForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SelectInput label="성별" value={dormContractForm.gender} onChange={(v) => setDormContractForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여"]} />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">도로명주소</label>
                <button
                  type="button"
                  onClick={() => openAddressSearch((roadAddress) => setDormContractForm((f) => ({ ...f, address: roadAddress })))}
                  className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  주소찾기
                </button>
              </div>
              <input
                value={dormContractForm.address}
                onChange={(e) => setDormContractForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="도로명주소"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
              />
            </div>
            <Input label="건물명" value={dormContractForm.buildingName} onChange={(v) => setDormContractForm((f) => ({ ...f, buildingName: v }))} />
            <Input label="동" value={dormContractForm.dong} onChange={(v) => setDormContractForm((f) => ({ ...f, dong: v }))} />
            <Input label="호수" value={dormContractForm.roomHo} onChange={(v) => setDormContractForm((f) => ({ ...f, roomHo: v }))} />
            <Input label="평수" value={dormContractForm.pyeong} onChange={(v) => setDormContractForm((f) => ({ ...f, pyeong: v }))} />
            <Input label="임대인명" value={dormContractForm.landlordName} onChange={(v) => setDormContractForm((f) => ({ ...f, landlordName: v }))} />
            <Input label="임대인연락처" value={dormContractForm.landlordPhone} onChange={(v) => setDormContractForm((f) => ({ ...f, landlordPhone: v }))} />
            <Input label="부동산명" value={dormContractForm.realEstateName} onChange={(v) => setDormContractForm((f) => ({ ...f, realEstateName: v }))} />
            <Input label="부동산연락처" value={dormContractForm.realEstatePhone} onChange={(v) => setDormContractForm((f) => ({ ...f, realEstatePhone: v }))} />
            <Input label="계약시작일" type="date-text" value={dormContractForm.contractStart} onChange={(v) => setDormContractForm((f) => ({ ...f, contractStart: v }))} />
            <Input label="계약종료일" type="date-text" value={dormContractForm.contractEnd} onChange={(v) => setDormContractForm((f) => ({ ...f, contractEnd: v }))} />
            <SelectInput
              label="계약상태"
              value={dormContractForm.contractStatus}
              onChange={(v) => setDormContractForm((f) => ({ ...f, contractStatus: v as DormContractStatus | "자동선택" }))}
              options={["자동선택", "공실", "진행중", "만료예정", "연장", "종료", "해지"]}
            />
            {dormContractForm.contractStatus === "자동선택" && (
              <div className="col-span-full text-xs text-slate-500">
                자동계산: {calculateDormContractStatus(dormContractForm, dorms, occupants)}
              </div>
            )}
            <Input label="계약금액" value={dormContractForm.contractAmount} onChange={(v) => setDormContractForm((f) => ({ ...f, contractAmount: v }))} />
            <Input label="선납금" value={dormContractForm.prepaymentDeposit} onChange={(v) => setDormContractForm((f) => ({ ...f, prepaymentDeposit: v }))} />
            <Input label="보증금" value={dormContractForm.deposit} onChange={(v) => setDormContractForm((f) => ({ ...f, deposit: v }))} />
            <Input label="월세/관리비" value={dormContractForm.monthlyRentOrMaintenance} onChange={(v) => setDormContractForm((f) => ({ ...f, monthlyRentOrMaintenance: v }))} />
            <SelectInput
              label="계약유형"
              value={dormContractForm.contractType}
              onChange={(v) => setDormContractForm((f) => ({ ...f, contractType: v as ContractType | "자동선택" }))}
              options={["자동선택", "신규", "연장", "재계약", "변경", "해지후신규"]}
            />
            {dormContractForm.contractType === "자동선택" && (
              <div className="col-span-full text-xs text-slate-500">
                자동계산: {calculateDormContractType(dormContractForm, dormContracts, editingDormContractId)}
              </div>
            )}
            <Input label="비고" value={dormContractForm.notes} onChange={(v) => setDormContractForm((f) => ({ ...f, notes: v }))} />
            <Input label="등록자" value={dormContractForm.registeredBy} onChange={(v) => setDormContractForm((f) => ({ ...f, registeredBy: v }))} />
            <Input label="등록일" type="date-text" value={dormContractForm.createdAt} onChange={(v) => setDormContractForm((f) => ({ ...f, createdAt: v }))} />
            <Input label="수정일" type="date-text" value={dormContractForm.updatedAt} onChange={(v) => setDormContractForm((f) => ({ ...f, updatedAt: v }))} />
          </div>,
          () => setShowDormContractForm(false),
          saveDormContract,
          theme.accentColor
        )}

        {showNewHireForm && modalWrap(
          "신입사원 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectInput label="지역" value={newHireForm.site} onChange={(v) => setNewHireForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SelectInput label="성별" value={newHireForm.gender} onChange={(v) => setNewHireForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여"]} />
            <Input label="이름" value={newHireForm.name} onChange={(v) => setNewHireForm((f) => ({ ...f, name: v }))} />
            <Input label="연락처" value={newHireForm.phone} onChange={(v) => setNewHireForm((f) => ({ ...f, phone: v }))} />
            <Input label="부서" value={newHireForm.department} onChange={(v) => setNewHireForm((f) => ({ ...f, department: v }))} />
            <SearchableSelect
              label="도로명주소"
              value={newHireForm.dormId}
              onChange={(v) => {
                const selected = dorms.find((d) => d.id === v);
                setNewHireForm((f) => ({
                  ...f,
                  dormId: v,
                  site: selected?.site || f.site,
                  buildingName: selected?.buildingName || f.buildingName,
                  dong: selected?.dong || f.dong,
                  roomHo: selected?.roomHo || f.roomHo,
                }));
              }}
              options={dorms.filter((d) => !newHireForm.site || d.site === newHireForm.site).map((d) => d.id)}
              displayOptions={dorms.filter((d) => !newHireForm.site || d.site === newHireForm.site).map((d) => d.address || d.buildingName)}
            />
            <Input label="건물명" value={newHireForm.buildingName} onChange={(v) => setNewHireForm((f) => ({ ...f, buildingName: v }))} />
            <Input label="동" value={newHireForm.dong} onChange={(v) => setNewHireForm((f) => ({ ...f, dong: v }))} />
            <Input label="호수" value={newHireForm.roomHo} onChange={(v) => setNewHireForm((f) => ({ ...f, roomHo: v }))} />
            <Input label="예상입실일" type="date-text" value={newHireForm.expectedMoveInDate} onChange={(v) => setNewHireForm((f) => ({ ...f, expectedMoveInDate: v }))} />
            <Input label="입실일" type="date-text" value={newHireForm.moveInDate} onChange={(v) => setNewHireForm((f) => ({ ...f, moveInDate: v }))} />
            <Input label="예상퇴실일" type="date-text" value={newHireForm.expectedMoveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, expectedMoveOutDate: v }))} />
            <Input label="퇴실일" type="date-text" value={newHireForm.moveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, moveOutDate: v }))} />
            <Input label="실제퇴실일" type="date-text" value={newHireForm.actualMoveOutDate} onChange={(v) => setNewHireForm((f) => ({ ...f, actualMoveOutDate: v }))} />
            <Input label="천안이동일" type="date-text" value={newHireForm.cheonanMoveDate} onChange={(v) => setNewHireForm((f) => ({ ...f, cheonanMoveDate: v }))} />
            <SelectInput
              label="거주상태"
              value={newHireForm.residenceStatus}
              onChange={(v) => setNewHireForm((f) => ({ ...f, residenceStatus: v as NewHireResidenceStatus | "자동선택" }))}
              options={["자동선택", "대기중", "거주중", "만료예정", "연장", "퇴실"]}
            />
            {newHireForm.residenceStatus === "자동선택" && (
              <div className="col-span-full text-xs text-slate-500">
                자동계산: {calculateNewHireResidenceStatus(newHireForm)}
              </div>
            )}
            <SelectInput
              label="입주유형"
              value={newHireForm.moveInType}
              onChange={(v) => setNewHireForm((f) => ({ ...f, moveInType: v as MoveInType | "자동선택" }))}
              options={["자동선택", "대기자", "신규", "연장", "재입주"]}
            />
            {newHireForm.moveInType === "자동선택" && (
              <div className="col-span-full text-xs text-slate-500">
                자동계산: {calculateMoveInType(newHireForm, newHires)}
              </div>
            )}
            <Input label="연장사유" value={newHireForm.extensionReason} onChange={(v) => setNewHireForm((f) => ({ ...f, extensionReason: v }))} />
            <Input label="특이사항 메모" value={newHireForm.notes} onChange={(v) => setNewHireForm((f) => ({ ...f, notes: v }))} />
            <Input label="등록일" type="date-text" value={newHireForm.createdAt} onChange={(v) => setNewHireForm((f) => ({ ...f, createdAt: v }))} />
            <Input label="수정일" type="date-text" value={newHireForm.updatedAt} onChange={(v) => setNewHireForm((f) => ({ ...f, updatedAt: v }))} />
          </div>,
          () => setShowNewHireForm(false),
          saveNewHire,
          theme.accentColor
        )}

        {showOccupantForm && modalWrap(
          "입주자 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectInput label="지역" value={occupantForm.site || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, site: v as Site }))} options={["평택", "천안"]} />
            <SearchableSelect 
              label="기숙사" 
              value={occupantForm.dormId} 
              onChange={(v) => setOccupantForm((f) => ({ ...f, dormId: v }))} 
              options={dorms.filter(d => !occupantForm.site || d.site === occupantForm.site).map((d) => d.id)} 
              displayOptions={dorms.filter(d => !occupantForm.site || d.site === occupantForm.site).map((d) => d.buildingName)} 
            />
            <Input label="이름" value={occupantForm.employeeName} onChange={(v) => setOccupantForm((f) => ({ ...f, employeeName: v }))} />
            <SelectInput label="성별" value={occupantForm.gender} onChange={(v) => setOccupantForm((f) => ({ ...f, gender: v as Gender }))} options={["남", "여", "기타"]} />
            <Input label="부서" value={occupantForm.department} onChange={(v) => setOccupantForm((f) => ({ ...f, department: v }))} />
            <Input label="연락처" value={occupantForm.phone} onChange={(v) => setOccupantForm((f) => ({ ...f, phone: v }))} />
            <Input label="입실일" type="date-text" value={occupantForm.moveInDate} onChange={(v) => setOccupantForm((f) => ({ ...f, moveInDate: v }))} />
            <Input label="거주기한" type="date-text" value={occupantForm.moveOutDueDate} onChange={(v) => setOccupantForm((f) => ({ ...f, moveOutDueDate: v }))} />
            <Input label="예상입실일" type="date-text" value={occupantForm.expectedMoveInDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, expectedMoveInDate: v }))} />
            <Input label="예상퇴실일" type="date-text" value={occupantForm.expectedMoveOutDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, expectedMoveOutDate: v }))} />
            <Input label="실제퇴실일" type="date-text" value={occupantForm.actualMoveOutDate || ""} onChange={(v) => setOccupantForm((f) => ({ ...f, actualMoveOutDate: v }))} />
            <SelectInput label="상태" value={occupantForm.status} onChange={(v) => setOccupantForm((f) => ({ ...f, status: v as Occupant["status"] }))} options={["거주중", "만료예정", "퇴실", "천안이동", "신규입주"]} />
            <Input label="비고" value={occupantForm.notes} onChange={(v) => setOccupantForm((f) => ({ ...f, notes: v }))} />
          </div>,
          () => setShowOccupantForm(false),
          saveOccupant,
          theme.accentColor
        )}

        {showInventoryForm && modalWrap(
          "비품 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SearchableSelect
              label="기숙사"
              value={inventoryForm.dormId}
              onChange={(v) => {
                const selected = dorms.find((d) => d.id === v);
                setInventoryForm((f) => ({
                  ...f,
                  dormId: v,
                  dormAddress: selected?.address || f.dormAddress,
                }));
              }}
              options={dorms.map((d) => d.id)}
              displayOptions={dorms.map((d) => d.address)}
            />
            <Input label="관리자명" value={inventoryForm.managerName} onChange={(v) => setInventoryForm((f) => ({ ...f, managerName: v }))} />
            <Input label="계약일" type="date-text" value={inventoryForm.contractStart} onChange={(v) => setInventoryForm((f) => ({ ...f, contractStart: v }))} />
            <Input label="만료일" type="date-text" value={inventoryForm.contractEnd} onChange={(v) => setInventoryForm((f) => ({ ...f, contractEnd: v }))} />
            <Input label="기숙사 주소" value={inventoryForm.dormAddress} onChange={(v) => setInventoryForm((f) => ({ ...f, dormAddress: v }))} />
            <Input label="비품명" value={inventoryForm.itemName} onChange={(v) => setInventoryForm((f) => ({ ...f, itemName: v }))} />
            <Input label="수량" type="number" value={String(inventoryForm.quantity)} onChange={(v) => setInventoryForm((f) => ({ ...f, quantity: Number(v || 0) }))} />
            <Input label="모델명" value={inventoryForm.modelName} onChange={(v) => setInventoryForm((f) => ({ ...f, modelName: v }))} />
            <Input label="메이커" value={inventoryForm.maker} onChange={(v) => setInventoryForm((f) => ({ ...f, maker: v }))} />
            <Input label="구매액" type="number" value={String(inventoryForm.purchaseAmount)} onChange={(v) => setInventoryForm((f) => ({ ...f, purchaseAmount: Number(v || 0) }))} />
            <Input label="지급일" type="date-text" value={inventoryForm.issuedDate} onChange={(v) => setInventoryForm((f) => ({ ...f, issuedDate: v }))} />
            <Input label="매각일" type="date-text" value={inventoryForm.soldDate} onChange={(v) => setInventoryForm((f) => ({ ...f, soldDate: v }))} />
            <Input label="비고" value={inventoryForm.notes} onChange={(v) => setInventoryForm((f) => ({ ...f, notes: v }))} />
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
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    <Input
      label="기숙사관리자명"
      value={defectForm.dormManagerName}
      onChange={(v) => setDefectForm((f) => ({ ...f, dormManagerName: v }))}
      readOnly={currentUser?.role === "maintenance_reporter"}
    />

    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700">도로명주소</label>
      <div className="flex gap-2">
        <input
          value={defectForm.roadAddress}
          readOnly
          className="w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none bg-slate-50"
        />
        <button
          type="button"
          onClick={() => openAddressSearch((roadAddress) =>
            setDefectForm((f) => ({ ...f, roadAddress }))
          )}
          className="shrink-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 hover:bg-slate-50"
        >
          주소찾기
        </button>
      </div>
    </div>

    <Input
      label="건물명"
      value={defectForm.buildingName}
      onChange={(v) => setDefectForm((f) => ({ ...f, buildingName: v }))}
    />

    <Input
      label="상세주소"
      value={defectForm.detailAddress}
      onChange={(v) => setDefectForm((f) => ({ ...f, detailAddress: v }))}
    />

    <Input
      label="공동현관"
      value={defectForm.공동현관}
      onChange={(v) => setDefectForm((f) => ({ ...f, 공동현관: v }))}
    />

    <Input
      label="세대현관"
      value={defectForm.세대현관}
      onChange={(v) => setDefectForm((f) => ({ ...f, 세대현관: v }))}
    />

    {currentUser?.role !== "maintenance_reporter" && (
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
        />

        <Input
          label="점검자"
          value={defectForm.inspectorName}
          onChange={(v) => setDefectForm((f) => ({ ...f, inspectorName: v }))}
        />
      </>
    )}

    {currentUser?.role === "maintenance_reporter" && (
      <Input label="상황" value="접수" onChange={() => {}} />
    )}

    <div className="md:col-span-2 xl:col-span-4">
      <label className="mb-2 block text-sm font-medium text-slate-700">하자신청내용</label>
      <textarea
        value={defectForm.requestText}
        onChange={(e) =>
          setDefectForm((f) => ({ ...f, requestText: e.target.value }))
        }
        rows={6}
        className="w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none focus:border-slate-400"
      />
    </div>

    {currentUser?.role !== "maintenance_reporter" && (
      <div className="md:col-span-2 xl:col-span-4">
        <label className="mb-2 block text-sm font-medium text-slate-700">완료내용</label>
        <textarea
          value={defectForm.completeText}
          onChange={(e) =>
            setDefectForm((f) => ({
              ...f,
              completeText: e.target.value,
            }))
          }
          rows={4}
          className="w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none focus:border-slate-400"
        />
      </div>
    )}

    <div className="xl:col-span-4 rounded-2xl border border-slate-200 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
        <Camera className="h-4 w-4" /> 하자접수 이미지
      </div>

      <div className="flex flex-wrap gap-3">
        {defectForm.requestPhotoDataUrls.map((src, idx) => (
          <div key={idx} className="relative">
            <img
              src={src}
              alt={`request-${idx}`}
              className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
            />
            <a
              href={src}
              download={`request-photo-${idx + 1}.png`}
              className="absolute bottom-1 left-1 rounded bg-black/70 px-2 py-1 text-[10px] text-white"
            >
              다운로드
            </a>
            <button
              type="button"
              onClick={() =>
                setDefectForm((f) => ({
                  ...f,
                  requestPhotoDataUrls: f.requestPhotoDataUrls.filter((_, i) => i !== idx),
                }))
              }
              className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => defectRequestPhotoInputRef.current?.click()}
          className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <input
        ref={defectRequestPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleDefectRequestPhotos(e.target.files)}
      />
    </div>

  {currentUser?.role !== "maintenance_reporter" && (
    <div className="xl:col-span-4 rounded-2xl border border-slate-200 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
        <Camera className="h-4 w-4" /> 완료건 이미지
      </div>

      <div className="flex flex-wrap gap-3">
        {defectForm.completionPhotoDataUrls.map((src, idx) => (
          <div key={idx} className="relative">
            <img
              src={src}
              alt={`completion-${idx}`}
              className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
            />
            <a
              href={src}
              download={`completion-photo-${idx + 1}.png`}
              className="absolute bottom-1 left-1 rounded bg-black/70 px-2 py-1 text-[10px] text-white"
            >
              다운로드
            </a>
            <button
              type="button"
              onClick={() =>
                setDefectForm((f) => ({
                  ...f,
                  completionPhotoDataUrls: f.completionPhotoDataUrls.filter((_, i) => i !== idx),
                }))
              }
              className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => defectCompletionPhotoInputRef.current?.click()}
          className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <input
        ref={defectCompletionPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleDefectCompletionPhotos(e.target.files)}
      />
    </div>
  )}


  </div>,
  () => setShowDefectForm(false),
  saveDefect,
  theme.accentColor
  )}

        {showUserForm && canManageUsers(currentUser) && modalWrap(
          "계정 등록/수정",
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Input label="표시이름" value={userForm.displayName} onChange={(v) => setUserForm((f) => ({ ...f, displayName: v }))} />
            <Input label="로그인 아이디" value={userForm.username} onChange={(v) => setUserForm((f) => ({ ...f, username: v }))} />
            <Input label="비밀번호" type="password" value={userForm.password} onChange={(v) => setUserForm((f) => ({ ...f, password: v }))} />
            <SelectInput label="권한" value={getRoleLabel(userForm.role)} onChange={(v) => setUserForm((f) => ({ ...f, role: getRoleValue(v) }))} options={["관리자", "뷰어", "하자처리 담당자", "기숙사 관리자"]} />
            <SelectInput label="지역 권한" value={userForm.siteAccess} onChange={(v) => setUserForm((f) => ({ ...f, siteAccess: v as Site | "전체" }))} options={["전체", "평택", "천안"]} />
            <SelectInput label="활성 여부" value={userForm.isActive ? "활성" : "비활성"} onChange={(v) => setUserForm((f) => ({ ...f, isActive: v === "활성" }))} options={["활성", "비활성"]} />
          </div>,
          () => setShowUserForm(false),
          saveUser,
          theme.accentColor
        )}
      </div>
    </div>
  );
}

function tabButton(active: TabKey, setActive: (t: TabKey) => void, key: TabKey, icon: React.ReactNode, label: string) {
  return <button onClick={() => setActive(key)} className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm ${active === key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{icon} {label}</button>;
}

function modalWrap(title: string, body: React.ReactNode, onClose: () => void, onSave: () => void, accentColor: string) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="text-xl font-semibold">{title}</h3></div><button onClick={onClose} className="rounded-xl border border-slate-300 p-2 hover:bg-slate-50"><ChevronRight className="h-5 w-5 rotate-45" /></button></div>
        {body}
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-2xl border border-slate-300 px-4 py-2 hover:bg-slate-50">취소</button><button onClick={onSave} className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-white" style={{ backgroundColor: accentColor }}><Save className="h-4 w-4" /> 저장</button></div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</div><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold tracking-tight">{value}</div><div className="mt-1 text-xs text-slate-400">{sub}</div></div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>;
}

function CompactField({ label, value, className = "", labelClassName = "", valueClassName = "" }: { label: string; value: string; className?: string; labelClassName?: string; valueClassName?: string }) {
  return <div className={`rounded-lg bg-slate-50 p-2 ${className}`}><div className={`font-semibold uppercase tracking-wide text-slate-400 text-[0.625rem] leading-4 whitespace-normal ${labelClassName}`}>{label}</div><div className={`mt-1 text-slate-700 text-[0.75rem] leading-5 whitespace-normal ${valueClassName}`}>{value}</div></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <div className="lg:col-span-2"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400">{options.map((option) => <option key={option} value={option}>{option || "미선택"}</option>)}</select></div>;
}

function SearchableSelect({ label, value, onChange, options, displayOptions }: { label: string; value: string; onChange: (v: string) => void; options: string[]; displayOptions?: string[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = options.filter((option, index) => {
    const displayText = displayOptions ? displayOptions[index] : option;
    return displayText.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const selectedDisplay = displayOptions ? displayOptions[options.indexOf(value)] : value;

  return (
    <div className="relative">
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
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400"
          placeholder="검색해서 선택하세요"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-slate-300 bg-white shadow-lg">
          {filteredOptions.map((option) => {
            const displayText = displayOptions ? displayOptions[filteredOptions.indexOf(option)] : option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setSearchTerm("");
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-slate-50"
              >
                {displayText}
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-2 text-slate-500">검색 결과가 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorEditor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3"><div className="font-medium text-slate-700">{label}</div><div className="flex items-center gap-3"><div className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500">{value}</div><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 rounded-md border border-slate-300 bg-white" /></div></div>;
}

function Input({ label, value, onChange, type = "text", readOnly = false, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; readOnly?: boolean; placeholder?: string }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (type === "date-text") {
      // 숫자 자리 입력 시 YYYY-MM-DD로 변환
      if (/^\d{8}$/.test(v)) {
        v = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
      }
    }
    onChange(v);
  };
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><input type={type === "date-text" ? "date" : type} value={value} onChange={handleChange} readOnly={readOnly} placeholder={type === "date-text" ? undefined : placeholder} className={`w-full rounded-2xl border border-slate-300 px-3 py-3 outline-none ${readOnly ? 'bg-slate-50' : 'focus:border-slate-400'}`} /></div>;
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <div><label className="mb-2 block text-sm font-medium text-slate-700">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-400">{options.map((option) => <option key={option || "blank"} value={option}>{option || "미선택"}</option>)}</select></div>;
}
