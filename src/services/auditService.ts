export type AuditChange = {
  field: string;
  label: string;
  beforeValue: string;
  afterValue: string;
};

export type AuditLogPayload = {
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
  beforeValue?: string;
  afterValue?: string;
  memo?: string;
  changes?: AuditChange[];
  before?: unknown;
  after?: unknown;
};

export const FIELD_LABEL_MAP: Record<string, string> = {
  site: "지역",
  address: "주소",
  buildingName: "건물명",
  dong: "동",
  roomHo: "호수",
  contractStart: "계약시작일",
  contractEnd: "계약종료일",
  contractStatus: "계약상태",
  monthlyRentOrMaintenance: "월세/관리비",
  gender: "성별",
  capacity: "정원",
  leaseStatus: "임차상태",
  status: "상태",
  occupantStatus: "점유자상태",
  moveInDate: "입실일",
  moveOutDate: "퇴실일",
  moveOutDueDate: "예정퇴실일",
  expectedMoveInDate: "예정입실일",
  expectedMoveOutDate: "예정퇴실일",
  actualMoveOutDate: "실제퇴실일",
  moveInType: "입실 유형",
  employeeName: "직원명",
  department: "부서",
  phone: "연락처",
  contractAmount: "계약금",
  prepaymentDeposit: "선금",
  deposit: "보증금",
  realEstateName: "공인중개사",
  dormManagerName: "담당자",
  defectStatus: "하자상태",
  itemName: "품목명",
  purchaseAmount: "구매금액",
  purchaseDate: "구매일",
  cleanStatus: "청소상태",
  reporterName: "보고자",
  notes: "비고",
};

export const getChangedFields = (
  before: any,
  after: any
): AuditChange[] => {
  const changes: AuditChange[] = [];
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  allKeys.forEach((key) => {
    const beforeVal = before?.[key];
    const afterVal = after?.[key];

    if (
      key.startsWith("_") ||
      ["id", "createdAt", "updatedAt", "deletedAt", "deletedBy", "isDeleted"].includes(key)
    ) {
      return;
    }

    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push({
        field: key,
        label: FIELD_LABEL_MAP[key] || key,
        beforeValue: beforeVal !== undefined ? String(beforeVal) : "(없음)",
        afterValue: afterVal !== undefined ? String(afterVal) : "(없음)",
      });
    }
  });

  return changes;
};

export const createAuditLogEntry = (payload: AuditLogPayload) => {
  const computedChanges =
    payload.changes ??
    (payload.before && payload.after ? getChangedFields(payload.before, payload.after) : undefined);

  return {
    id: crypto.randomUUID(),
    changedAt: new Date().toISOString(),
    ...payload,
    beforeValue: payload.beforeValue ?? "",
    afterValue: payload.afterValue ?? "",
    changes: computedChanges,
  };
};
