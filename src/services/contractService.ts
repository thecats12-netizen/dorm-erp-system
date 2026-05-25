import { saveJson, loadJson } from "./storageService";
import type { DormContract } from "\.\./types";
import { DORM_CONTRACTS_KEY } from "./storageService";

export const loadDormContracts = (tenantId = "default") => loadJson<DormContract[]>(DORM_CONTRACTS_KEY, [], tenantId);
export const saveDormContracts = (contracts: DormContract[], tenantId = "default") => saveJson(DORM_CONTRACTS_KEY, contracts, tenantId);
