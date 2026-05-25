import { saveJson, loadJson } from "./storageService";
import type { DefectRequest } from "\.\./types";
import { DEFECTS_KEY } from "./storageService";

export const loadDefects = (tenantId = "default") => loadJson<DefectRequest[]>(DEFECTS_KEY, [], tenantId);
export const saveDefects = (defects: DefectRequest[], tenantId = "default") => saveJson(DEFECTS_KEY, defects, tenantId);
