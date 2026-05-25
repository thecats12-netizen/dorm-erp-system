import { useMemo } from "react";
import type { CleaningReport } from "\.\./types";

export function useCleaningReports(cleaningReports: CleaningReport[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return cleaningReports.filter((report) => report.buildingName.toLowerCase().includes(lowered) || report.reporterName.toLowerCase().includes(lowered));
  }, [cleaningReports, search]);
}
