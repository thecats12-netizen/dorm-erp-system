import { useMemo } from "react";
import type { DefectRequest } from "\.\./types";

export function useDefects(defects: DefectRequest[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return defects.filter((defect) => defect.requestText.toLowerCase().includes(lowered) || defect.reporterName.toLowerCase().includes(lowered));
  }, [defects, search]);
}
