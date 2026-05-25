import { useMemo } from "react";
import type { InventoryItem } from "\.\./types";

export function useInventory(inventory: InventoryItem[], search: string) {
  return useMemo(() => {
    const lowered = search.toLowerCase();
    return inventory.filter((item) => item.itemName.toLowerCase().includes(lowered) || item.managerName.toLowerCase().includes(lowered));
  }, [inventory, search]);
}
