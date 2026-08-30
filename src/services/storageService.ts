export const USERS_KEY = "dorm-users-v4";
export const DORMS_KEY = "dorm-master-v4";
export const OCCUPANTS_KEY = "dorm-occupants-v4";
export const INVENTORY_KEY = "dorm-inventory-v4";
export const LEASES_KEY = "dorm-leases-v4";
export const DORM_CONTRACTS_KEY = "dorm-contracts-v4";
export const NEW_HIRES_KEY = "dorm-new-hires-v4";
export const SALES_KEY = "dorm-sales-v4";
export const DEFECTS_KEY = "dorm-defects-v4";
export const CLEANING_REPORTS_KEY = "dorm-cleaning-reports-v4";
export const CLEANING_SETTINGS_KEY = "dorm-cleaning-settings-v4";
export const AUDIT_LOGS_KEY = "dorm-audit-logs-v4";
export const MILITARY_PERSONNEL_KEY = "military-personnel-v4";
export const MILITARY_TRAINING_KEY = "military-training-v4";
export const MILITARY_NOTICES_KEY = "military-notices-v4";
export const MILITARY_REPORTS_KEY = "military-reports-v4";
export const MILITARY_SETTINGS_KEY = "military-settings-v4";
export const MILITARY_TRAINING_RULES_KEY = "military-training-rules-v1";
export const MILITARY_CODE_VALUES_KEY = "military-code-values-v1";
export const MILITARY_TRAINING_AUTOCREATE_KEY = "military-training-autocreate-v1";
export const THEME_KEY = "dorm-theme-v4";
export const SYSTEM_SETTINGS_KEY = "dorm-system-settings-v4";
export const SETTLEMENT_RECORDS_KEY = "dorm-settlement-records-v4";
export const AUTH_KEY = "dorm-auth-v4";
export const CUSTOM_TEMPLATES_KEY = "customTemplates";

export const STORAGE_KEYS = {
  USERS_KEY,
  DORMS_KEY,
  OCCUPANTS_KEY,
  INVENTORY_KEY,
  LEASES_KEY,
  DORM_CONTRACTS_KEY,
  NEW_HIRES_KEY,
  SALES_KEY,
  DEFECTS_KEY,
  CLEANING_REPORTS_KEY,
  CLEANING_SETTINGS_KEY,
  AUDIT_LOGS_KEY,
  MILITARY_PERSONNEL_KEY,
  MILITARY_TRAINING_KEY,
  MILITARY_NOTICES_KEY,
  MILITARY_REPORTS_KEY,
  MILITARY_SETTINGS_KEY,
  MILITARY_TRAINING_RULES_KEY,
  MILITARY_CODE_VALUES_KEY,
  MILITARY_TRAINING_AUTOCREATE_KEY,
  THEME_KEY,
  SYSTEM_SETTINGS_KEY,
  SETTLEMENT_RECORDS_KEY,
  AUTH_KEY,
  CUSTOM_TEMPLATES_KEY,
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear?(): void;
}

const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";
let adapter: StorageAdapter = {
  getItem: (key) => (isBrowser ? localStorage.getItem(key) : null),
  setItem: (key, value) => {
    if (!isBrowser) return;
    localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (!isBrowser) return;
    localStorage.removeItem(key);
  },
  clear: () => {
    if (!isBrowser) return;
    localStorage.clear();
  },
};

export const setStorageAdapter = (nextAdapter: StorageAdapter) => {
  adapter = nextAdapter;
};

export const getStorageKey = (key: string, tenantId = "default") =>
  tenantId && tenantId !== "default" ? `${tenantId}:${key}` : key;

export const safeParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

export const loadJson = <T>(key: string, fallback: T, tenantId = "default"): T => {
  if (!isBrowser) return fallback;
  const stored = adapter.getItem(getStorageKey(key, tenantId));
  return safeParse<T>(stored, fallback);
};

// localStorage 저장. 용량 초과(QuotaExceededError) 등 실패 시에도 예외를 던지지 않고
// 경고만 출력하여 앱 동작이 중단되지 않도록 한다. 성공 여부를 boolean 으로 반환.
export const saveJson = <T>(key: string, value: T, tenantId = "default"): boolean => {
  if (!isBrowser) return false;
  try {
    adapter.setItem(getStorageKey(key, tenantId), JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storage] 로컬 저장 실패 (${key}) — 용량 초과 가능:`, e);
    return false;
  }
};

export const removeJson = (key: string, tenantId = "default") => {
  if (!isBrowser) return;
  adapter.removeItem(getStorageKey(key, tenantId));
};

// [군대관리 2E] 개인정보(PII) 포함 군대 데이터 — 브라우저 persistent storage 금지 대상.
//  personnel/training/notices/reports 는 PII(연락처/생년월일/군번/계좌 등)를 담을 수 있어 localStorage 에 저장/복원하지 않는다.
//  settings/rules/codeValues/autocreate 는 PII 가 없어 cache 유지(아래 목록에서 제외).
export const MILITARY_SENSITIVE_KEYS = [
  MILITARY_PERSONNEL_KEY, MILITARY_TRAINING_KEY, MILITARY_NOTICES_KEY, MILITARY_REPORTS_KEY,
] as const;

// legacy(v1) 민감 키 — 과거 버전이 남겼을 수 있는 평문 PII 잔재까지 청소.
const MILITARY_SENSITIVE_LEGACY_KEYS = ["military-personnel-v1", "military-training-v1", "military-notices-v1", "military-reports-v1"] as const;

// 민감 군대 캐시만 정확히 제거(현재 v4 + legacy v1 · logout/계정전환/legacy purge). localStorage.clear 사용 금지 — 타 모듈/설정 보존.
export const purgeMilitarySensitiveCache = (tenantId = "default") => {
  if (!isBrowser) return;
  [...MILITARY_SENSITIVE_KEYS, ...MILITARY_SENSITIVE_LEGACY_KEYS].forEach((k) => adapter.removeItem(getStorageKey(k, tenantId)));
};

export const migrateLocalStorageKeys = (migrations: Array<{ oldKey: string; newKey: string }>, tenantId = "default") => {
  if (!isBrowser) return;

  migrations.forEach(({ oldKey, newKey }) => {
    const oldStorageKey = getStorageKey(oldKey, tenantId);
    const newStorageKey = getStorageKey(newKey, tenantId);
    const oldValue = adapter.getItem(oldStorageKey);
    const newValue = adapter.getItem(newStorageKey);

    if (oldValue && !newValue) {
      adapter.setItem(newStorageKey, oldValue);
    }
  });
};
