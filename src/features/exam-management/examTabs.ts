// 시험관리(대메뉴) 하위 탭 키/제목 — 컴포넌트와 분리(공유 상수/함수).
export type ExamTabKey =
  | "examDashboard"
  | "examPersonnel"
  | "examApplications"
  | "examPmCertifications"
  | "examDmCertifications"
  | "examAnnualTargets"
  | "examMonthlyResults"
  | "examRules"
  | "examReports"
  | "examExcelImport";

export const EXAM_TAB_KEYS: ExamTabKey[] = [
  "examDashboard",
  "examPersonnel",
  "examApplications",
  "examPmCertifications",
  "examDmCertifications",
  "examAnnualTargets",
  "examMonthlyResults",
  "examRules",
  "examReports",
  "examExcelImport",
];

// 화면 표시용 한글 제목(개발용 코드값/영문 변수명 노출 금지).
export const EXAM_TAB_TITLES: Record<ExamTabKey, string> = {
  examDashboard: "시험 대시보드",
  examPersonnel: "인력현황",
  examApplications: "시험 응시관리",
  examPmCertifications: "PM 인증관리",
  examDmCertifications: "D.M 인증관리",
  examAnnualTargets: "연간목표",
  examMonthlyResults: "월간실적",
  examRules: "인증 기준관리",
  examReports: "시험 보고서",
  examExcelImport: "Excel 가져오기",
};

export const isExamTab = (tab: string): tab is ExamTabKey => (EXAM_TAB_KEYS as string[]).includes(tab);
export const examTabTitle = (tab: ExamTabKey): string => EXAM_TAB_TITLES[tab];
