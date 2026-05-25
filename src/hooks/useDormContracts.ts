import { useMemo } from "react";
import type { DormContract } from "\.\./types";

export function useDormContracts(dormContracts: DormContract[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return dormContracts.filter((contract) => contract.address.toLowerCase().includes(lowered) || contract.buildingName.toLowerCase().includes(lowered) || contract.dong.toLowerCase().includes(lowered));
  }, [dormContracts, search]);
}
