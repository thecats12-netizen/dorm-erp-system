import { saveJson, loadJson } from "./storageService";
import type { InventoryItem } from "\.\./types";
import { INVENTORY_KEY } from "./storageService";

export const loadInventoryItems = (tenantId = "default") => loadJson<InventoryItem[]>(INVENTORY_KEY, [], tenantId);
export const saveInventoryItems = (inventory: InventoryItem[], tenantId = "default") => saveJson(INVENTORY_KEY, inventory, tenantId);
