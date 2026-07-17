import type { SystemSettings, MenuItem } from "../types";

export function mergeMenus(current: unknown, defaults: MenuItem[]): MenuItem[] {
  if (!Array.isArray(current) || (current as MenuItem[]).length === 0) return defaults;

  const mergedById = new Map<string, MenuItem>(defaults.map((item) => [item.id, item]));
  (current as MenuItem[]).forEach((item) => {
    if (!item || typeof item.id !== "string") return;
    const defaultItem = mergedById.get(item.id);
    mergedById.set(item.id, defaultItem ? { ...defaultItem, ...item } : item);
  });

  // tabKey 기준 중복 제거 (구버전 저장 데이터로 인한 메뉴 중복 방지, 기본 정의 우선)
  const defaultIdByTab = new Map<string, string>(defaults.map((item) => [item.tabKey, item.id]));
  const byTab = new Map<string, MenuItem>();
  Array.from(mergedById.values()).forEach((item) => {
    const existing = byTab.get(item.tabKey);
    if (!existing) {
      byTab.set(item.tabKey, item);
      return;
    }
    const defaultId = defaultIdByTab.get(item.tabKey);
    if (defaultId && item.id === defaultId) {
      byTab.set(item.tabKey, item);
    }
  });

  return Array.from(byTab.values()).sort((a, b) => a.order - b.order);
}

export function useSavedOrDefaultArray<T>(current: unknown, defaults: T[]): T[] {
  if (!Array.isArray(current) || (current as T[]).length === 0) return defaults;
  return current as T[];
}

export function getDefaultSystemSettings(): SystemSettings {
  return {
    menus: [
      { id: "1", groupName: "기본정보", menuName: "대시보드", tabKey: "dashboard", isVisible: true, order: 1, requiredRoles: ["admin", "viewer", "dorm_manager", "maintenance_reporter"] },
      { id: "2", groupName: "기숙사관리", menuName: "기숙사", tabKey: "dorms", isVisible: true, order: 1, requiredRoles: ["admin", "viewer", "maintenance_reporter"] },
      { id: "3", groupName: "기숙사관리", menuName: "입주자", tabKey: "occupants", isVisible: true, order: 2, requiredRoles: ["admin", "viewer"] },
      { id: "4", groupName: "기숙사관리", menuName: "신규계약", tabKey: "dormContracts", isVisible: true, order: 3, requiredRoles: ["admin", "viewer"] },
      { id: "5", groupName: "기숙사관리", menuName: "신입사원", tabKey: "newHires", isVisible: true, order: 4, requiredRoles: ["admin", "viewer"] },
      { id: "6", groupName: "운영관리", menuName: "청소관리", tabKey: "cleaningReports", isVisible: true, order: 5, requiredRoles: ["admin", "viewer", "maintenance_reporter"] },
      { id: "7", groupName: "운영관리", menuName: "하자접수", tabKey: "defects", isVisible: true, order: 6, requiredRoles: ["admin", "viewer", "dorm_manager", "maintenance_reporter"] },
      { id: "8", groupName: "자산관리", menuName: "비품현황", tabKey: "inventory", isVisible: true, order: 1, requiredRoles: ["admin", "viewer"] },
      { id: "9", groupName: "자산관리", menuName: "임차현황", tabKey: "leases", isVisible: false, order: 2, requiredRoles: ["admin", "viewer"] },
      { id: "10", groupName: "자산관리", menuName: "비품매각", tabKey: "sales", isVisible: false, order: 3, requiredRoles: ["admin", "viewer"] },
      { id: "11", groupName: "운영관리", menuName: "운영시뮬레이션", tabKey: "simulation", isVisible: true, order: 1, requiredRoles: ["admin", "viewer"] },
      { id: "12", groupName: "운영관리", menuName: "정산관리", tabKey: "settlementManagement", isVisible: true, order: 2, requiredRoles: ["admin", "viewer"] },
      { id: "13", groupName: "운영관리", menuName: "알림관리", tabKey: "notificationManagement", isVisible: true, order: 3, requiredRoles: ["admin", "viewer", "maintenance_reporter", "dorm_manager"] },
      { id: "14", groupName: "운영관리", menuName: "문서관리", tabKey: "documentManagement", isVisible: true, order: 4, requiredRoles: ["admin", "viewer"] },
      { id: "25", groupName: "운영관리", menuName: "입주전 점검", tabKey: "preMoveInInspection", isVisible: true, order: 5, requiredRoles: ["admin", "viewer"] },
      { id: "15", groupName: "운영관리", menuName: "보고서", tabKey: "reportManagement", isVisible: true, order: 5, requiredRoles: ["admin", "viewer"] },
      { id: "26", groupName: "시험관리", menuName: "시험 대시보드", tabKey: "examDashboard", isVisible: true, order: 1, requiredRoles: ["admin", "viewer"] },
      { id: "27", groupName: "시험관리", menuName: "인력현황", tabKey: "examPersonnel", isVisible: true, order: 2, requiredRoles: ["admin", "viewer"] },
      { id: "28", groupName: "시험관리", menuName: "시험 응시관리", tabKey: "examApplications", isVisible: true, order: 3, requiredRoles: ["admin", "viewer"] },
      { id: "29", groupName: "시험관리", menuName: "PM 인증관리", tabKey: "examPmCertifications", isVisible: true, order: 4, requiredRoles: ["admin", "viewer"] },
      { id: "30", groupName: "시험관리", menuName: "D.M 인증관리", tabKey: "examDmCertifications", isVisible: true, order: 5, requiredRoles: ["admin", "viewer"] },
      { id: "31", groupName: "시험관리", menuName: "연간목표", tabKey: "examAnnualTargets", isVisible: true, order: 6, requiredRoles: ["admin", "viewer"] },
      { id: "32", groupName: "시험관리", menuName: "월간실적", tabKey: "examMonthlyResults", isVisible: true, order: 7, requiredRoles: ["admin", "viewer"] },
      { id: "33", groupName: "시험관리", menuName: "인증 기준관리", tabKey: "examRules", isVisible: true, order: 8, requiredRoles: ["admin", "viewer"] },
      { id: "34", groupName: "시험관리", menuName: "시험 보고서", tabKey: "examReports", isVisible: true, order: 9, requiredRoles: ["admin", "viewer"] },
      { id: "35", groupName: "시험관리", menuName: "Excel 가져오기", tabKey: "examExcelImport", isVisible: true, order: 10, requiredRoles: ["admin", "viewer"] },
      { id: "16", groupName: "군대관리", menuName: "군인대시보드", tabKey: "militaryDashboard", isVisible: true, order: 1, requiredRoles: ["admin", "viewer"] },
      { id: "17", groupName: "군대관리", menuName: "인사관리", tabKey: "personnelManagement", isVisible: true, order: 2, requiredRoles: ["admin", "viewer"] },
      { id: "18", groupName: "군대관리", menuName: "훈련기록", tabKey: "trainingRecords", isVisible: true, order: 3, requiredRoles: ["admin", "viewer"] },
      { id: "19", groupName: "군대관리", menuName: "공지사항", tabKey: "militaryNotices", isVisible: true, order: 4, requiredRoles: ["admin", "viewer"] },
      { id: "20", groupName: "군대관리", menuName: "보고서", tabKey: "militaryReports", isVisible: true, order: 5, requiredRoles: ["admin", "viewer"] },
      { id: "24", groupName: "군대관리", menuName: "군대설정", tabKey: "militarySettings", isVisible: true, order: 6, requiredRoles: ["admin"] },
      { id: "21", groupName: "시스템", menuName: "사용자관리", tabKey: "users", isVisible: true, order: 1, requiredRoles: ["admin"] },
      { id: "22", groupName: "시스템", menuName: "시스템설정", tabKey: "settings", isVisible: true, order: 2, requiredRoles: ["admin"] },
      { id: "36", groupName: "시스템", menuName: "권한관리", tabKey: "permissions", isVisible: true, order: 3, requiredRoles: ["admin"] },
      { id: "23", groupName: "시스템", menuName: "휴지통관리", tabKey: "recycleBin", isVisible: true, order: 4, requiredRoles: ["admin"] },
    ],
    fields: [
      { id: "f1", tabKey: "dorms", fieldName: "건물명", fieldKey: "buildingName", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f2", tabKey: "dorms", fieldName: "주소", fieldKey: "address", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 2 },
      { id: "f3", tabKey: "newHires", fieldName: "이름", fieldKey: "name", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f4", tabKey: "newHires", fieldName: "연락처", fieldKey: "phone", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 2 },
      { id: "f5", tabKey: "occupants", fieldName: "부서", fieldKey: "department", isVisible: true, isRequired: false, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f6", tabKey: "dormContracts", fieldName: "임대인명", fieldKey: "landlordName", isVisible: true, isRequired: false, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f7", tabKey: "cleaningReports", fieldName: "청소상태", fieldKey: "cleanStatus", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f8", tabKey: "defects", fieldName: "하자상태", fieldKey: "defectStatus", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: false, order: 1 },
      { id: "f9", tabKey: "users", fieldName: "권한", fieldKey: "role", isVisible: true, isRequired: true, isReadOnly: false, adminOnlyEdit: true, order: 1 },
    ],
    permissions: [
      { role: "admin", tabKey: "dashboard", canView: true, canCreate: true, canEdit: true, canDelete: true },
      { role: "viewer", tabKey: "dashboard", canView: true, canCreate: false, canEdit: false, canDelete: false },
      { role: "admin", tabKey: "dorms", canView: true, canCreate: true, canEdit: true, canDelete: true },
      { role: "viewer", tabKey: "dorms", canView: true, canCreate: false, canEdit: false, canDelete: false },
      { role: "admin", tabKey: "newHires", canView: true, canCreate: true, canEdit: true, canDelete: true },
      { role: "viewer", tabKey: "newHires", canView: true, canCreate: false, canEdit: false, canDelete: false },
      { role: "admin", tabKey: "users", canView: true, canCreate: true, canEdit: true, canDelete: true },
      { role: "viewer", tabKey: "users", canView: false, canCreate: false, canEdit: false, canDelete: false },
      { role: "maintenance_reporter", tabKey: "defects", canView: true, canCreate: true, canEdit: true, canDelete: false },
      { role: "dorm_manager", tabKey: "defects", canView: true, canCreate: true, canEdit: false, canDelete: false },
    ],
    codeValues: [
      { id: "1", codeType: "dormStatus", codeKey: "occupied", codeName: "사용중", order: 1, isActive: true, colorCode: "#DCFCE7" },
      { id: "2", codeType: "dormStatus", codeKey: "expiring", codeName: "만료예정", order: 2, isActive: true, colorCode: "#FEF3C7" },
      { id: "3", codeType: "dormStatus", codeKey: "terminated", codeName: "해지", order: 3, isActive: true, colorCode: "#FEE2E2" },
      { id: "4", codeType: "dormStatus", codeKey: "vacant", codeName: "공실", order: 4, isActive: true, colorCode: "#E5E7EB" },
      { id: "5", codeType: "residenceStatus", codeKey: "living", codeName: "거주중", order: 1, isActive: true, colorCode: "#DCFCE7" },
      { id: "6", codeType: "residenceStatus", codeKey: "moveOut", codeName: "퇴실", order: 2, isActive: true, colorCode: "#F3F4F6" },
      { id: "7", codeType: "residenceStatus", codeKey: "extension", codeName: "연장", order: 3, isActive: true, colorCode: "#FEF3C7" },
      { id: "8", codeType: "residenceStatus", codeKey: "expiring", codeName: "만료예정", order: 4, isActive: true, colorCode: "#FEF3C7" },
      { id: "9", codeType: "cleaningStatus", codeKey: "notSubmitted", codeName: "미제출", order: 1, isActive: true, colorCode: "#F3F4F6" },
      { id: "10", codeType: "cleaningStatus", codeKey: "submitted", codeName: "제출완료", order: 2, isActive: true, colorCode: "#E0E7FF" },
      { id: "11", codeType: "cleaningStatus", codeKey: "confirmed", codeName: "확인완료", order: 3, isActive: true, colorCode: "#DCFCE7" },
      { id: "12", codeType: "cleaningStatus", codeKey: "poor", codeName: "불량", order: 4, isActive: true, colorCode: "#FEE2E2" },
      { id: "13", codeType: "cleaningStatus", codeKey: "reClean", codeName: "재청소요청", order: 5, isActive: true, colorCode: "#FBBF24" },
      { id: "14", codeType: "defectStatus", codeKey: "received", codeName: "접수", order: 1, isActive: true, colorCode: "#DBEAFE" },
      { id: "15", codeType: "defectStatus", codeKey: "inProgress", codeName: "진행중", order: 2, isActive: true, colorCode: "#E0E7FF" },
      { id: "16", codeType: "defectStatus", codeKey: "completed", codeName: "완료", order: 3, isActive: true, colorCode: "#DCFCE7" },
      { id: "17", codeType: "site", codeKey: "pyeongTaek", codeName: "평택", order: 1, isActive: true },
      { id: "18", codeType: "site", codeKey: "cheonan", codeName: "천안", order: 2, isActive: true },
      { id: "19", codeType: "gender", codeKey: "male", codeName: "남", order: 1, isActive: true },
      { id: "20", codeType: "gender", codeKey: "female", codeName: "여", order: 2, isActive: true },
      { id: "21", codeType: "gender", codeKey: "other", codeName: "기타", order: 3, isActive: true },
      { id: "22", codeType: "contractStatus", codeKey: "active", codeName: "진행중", order: 1, isActive: true, colorCode: "#DCFCE7" },
      { id: "23", codeType: "contractStatus", codeKey: "ended", codeName: "종료", order: 2, isActive: true, colorCode: "#F3F4F6" },
      { id: "24", codeType: "contractStatus", codeKey: "extended", codeName: "연장", order: 3, isActive: true, colorCode: "#FEF3C7" },
      { id: "25", codeType: "contractStatus", codeKey: "terminated", codeName: "해지", order: 4, isActive: true, colorCode: "#FEE2E2" },
    ],
    screenSettings: [
      {
        id: "s1",
        tabKey: "dorms",
        visibleColumns: ["site", "buildingName", "address", "dong", "roomHo", "leaseStatus"],
        columnOrder: ["site", "buildingName", "address", "dong", "roomHo", "leaseStatus"],
        defaultFilter: { site: "전체" },
      },
      {
        id: "s2",
        tabKey: "occupants",
        visibleColumns: ["employeeName", "gender", "department", "phone", "status"],
        columnOrder: ["employeeName", "gender", "department", "phone", "status"],
        defaultFilter: { status: "전체" },
      },
      {
        id: "s3",
        tabKey: "newHires",
        visibleColumns: ["name", "phone", "department", "buildingName", "dong", "roomHo"],
        columnOrder: ["name", "phone", "department", "buildingName", "dong", "roomHo"],
        defaultFilter: { site: "전체" },
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}
