import type { AuditLog } from "../types";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseDateValue = (value: string | number | Date): Date | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateTimeKorea = (value: string | number | Date): string => {
  const date = parseDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).format(date);
};

export const formatDateOnly = (value: string | number | Date): string => {
  const date = parseDateValue(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
};

export const formatActionLabel = (action?: string): string => {
  if (!action) return "";
  const map: Record<string, string> = {
    create: "등록",
    update: "수정",
    delete: "삭제",
    statusChange: "상태변경",
    restore: "복구",
    login: "로그인",
    logout: "로그아웃",
  };
  return map[action] || action;
};

export const formatAuditTarget = (log: Pick<AuditLog, "targetType">): string => {
  const map: Record<string, string> = {
    dorm: "기숙사",
    dormContract: "기숙사 계약",
    occupant: "입주자",
    newHire: "신입사원",
    cleaningReport: "청소 보고서",
    defect: "하자 접수",
    inventory: "비품",
    lease: "임대 계약",
    militaryNotice: "공지",
    militaryPersonnel: "군인",
    militaryReport: "보고서",
    militaryTraining: "훈련 기록",
    militaryTrainingRule: "훈련 규칙",
    sales: "매출 기록",
    settlementRecord: "정산 기록",
    user: "사용자",
    dorms: "기숙사 목록",
  };
  return map[log.targetType] || String(log.targetType);
};

export const formatUserDisplay = (
  user?: string | { displayName?: string; name?: string; email?: string; username?: string }
): string => {
  if (!user) return "-";
  if (typeof user === "string") {
    const trimmed = user.trim();
    if (uuidRegex.test(trimmed)) {
      return "관리자";
    }
    return trimmed || "-";
  }

  if (user.displayName?.trim()) return user.displayName.trim();
  if (user.name?.trim()) return user.name.trim();
  if (user.email?.trim()) return user.email.trim();
  if (user.username?.trim()) return user.username.trim();
  return "관리자";
};
