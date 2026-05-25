import { saveJson, loadJson } from "./storageService";
import type { Dorm } from "\.\./types";
import { DORMS_KEY } from "./storageService";

export const loadDorms = (tenantId = "default") => loadJson<Dorm[]>(DORMS_KEY, [], tenantId);
export const saveDorms = (dorms: Dorm[], tenantId = "default") => saveJson(DORMS_KEY, dorms, tenantId);
