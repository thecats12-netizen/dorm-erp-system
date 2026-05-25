import { saveJson, loadJson } from "./storageService";
import type { Occupant } from "\.\./types";
import { OCCUPANTS_KEY } from "./storageService";

export const loadOccupants = (tenantId = "default") => loadJson<Occupant[]>(OCCUPANTS_KEY, [], tenantId);
export const saveOccupants = (occupants: Occupant[], tenantId = "default") => saveJson(OCCUPANTS_KEY, occupants, tenantId);
