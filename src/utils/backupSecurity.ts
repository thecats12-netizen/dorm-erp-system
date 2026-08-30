// 일반 백업(비민감) 보안 유틸 — 계정/인증/개인정보/민감 군대 데이터는 백업/복원에서 제외한다.
//  (전체 민감 백업은 향후 서버 기반 Enterprise 트랙에서 별도 구현)

export const GENERAL_BACKUP_SCHEMA_VERSION = 2;
export const GENERAL_BACKUP_TYPE = "general";
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024; // 10MB

// 일반 백업에 허용되는 top-level key = "설정/기준정보(config)"만 — 개인정보(이름/전화/주소 등)를 담지 않는 것만.
//  ⚠ dorms/inventory/leases/sales/defects/cleaningReports 등 운영 collection 은 담당자명/전화/주소(PII)를 포함하므로 제외(fail-closed).
//     users/auth/occupants/newHires/dormContracts/auditLogs/군대 인사·훈련·공지·보고서도 제외.
export const GENERAL_BACKUP_DATA_KEYS = [
  "systemSettings", "theme", "customTemplates", "cleaningSettings",
  "militarySettings", "militaryTrainingRules", "militaryCodeValues", "militaryTrainingAutoConfig",
] as const;
export type GeneralBackupDataKey = (typeof GENERAL_BACKUP_DATA_KEYS)[number];

// 각 key 기대 타입("array" | "object") — 복원 시 타입 검증(잘못된 구조 주입 방지).
export const GENERAL_BACKUP_KEY_TYPES: Record<GeneralBackupDataKey, "array" | "object"> = {
  customTemplates: "array", militaryTrainingRules: "array",
  systemSettings: "object", theme: "object", cleaningSettings: "object",
  militarySettings: "object", militaryCodeValues: "object", militaryTrainingAutoConfig: "object",
};

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// prototype pollution 방어: 어느 depth 든 __proto__/prototype/constructor key 가 있으면 true.
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export function hasDangerousKeys(v: unknown, depth = 0): boolean {
  if (depth > 12 || v === null || typeof v !== "object") return false;
  for (const k of Object.keys(v as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) return true;
    if (hasDangerousKeys((v as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

// src(일반 백업 data 또는 legacy top-level)에서 allowlist + 타입 일치 key 만 추출(비민감 · fail-closed).
export function pickGeneralBackupData(src: Record<string, unknown>): Partial<Record<GeneralBackupDataKey, unknown>> {
  const out: Partial<Record<GeneralBackupDataKey, unknown>> = {};
  for (const k of GENERAL_BACKUP_DATA_KEYS) {
    const val = src[k];
    if (val === undefined) continue;
    const t = GENERAL_BACKUP_KEY_TYPES[k];
    if (t === "array" ? Array.isArray(val) : isPlainObject(val)) out[k] = val;
  }
  return out;
}
