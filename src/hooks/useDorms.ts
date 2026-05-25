import { useMemo } from "react";
import type { Dorm } from "\.\./types";

export function useDorms(dorms: Dorm[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return dorms.filter((dorm) => dorm.buildingName.toLowerCase().includes(lowered) || dorm.address.toLowerCase().includes(lowered));
  }, [dorms, search]);
}
