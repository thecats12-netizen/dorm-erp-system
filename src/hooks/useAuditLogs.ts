import { useMemo } from "react";
import type { AuditLog } from "\.\./types";

export function useAuditLogs(auditLogs: AuditLog[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return auditLogs.filter(
      (log) =>
        log.targetType.toLowerCase().includes(lowered) ||
        log.actionType.toLowerCase().includes(lowered) ||
        log.changedBy.toLowerCase().includes(lowered)
    );
  }, [auditLogs, search]);
}
