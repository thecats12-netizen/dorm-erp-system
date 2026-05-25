import { useMemo } from "react";
import type { Occupant } from "\.\./types";

export function useOccupants(occupants: Occupant[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return occupants.filter((occupant) => occupant.employeeName.toLowerCase().includes(lowered) || occupant.department.toLowerCase().includes(lowered));
  }, [occupants, search]);
}
