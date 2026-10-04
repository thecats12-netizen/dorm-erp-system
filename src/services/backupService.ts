// ============================================================================
// DR(재해복구) 백업/복원 서비스 — canonical 모델 + 포맷 감지/어댑터 + 검증 + 복원 계획(dry-run)
//  · READ-ONLY 분석/직렬화 전용. 실제 DB write 는 App(saveDormModule/saveOperationalModule/saveMilitaryModule)이 담당.
//  · P0 포함: 기숙사/운영/군대(8키)/시스템설정/auditLogs.  P0 제외: exam, users/권한, Supabase Storage 원본.
//  · 개인정보(PII) 실제 값은 로그/미리보기에 노출하지 않는다(건수·업무명만).
// ============================================================================
import { hasDangerousKeys, isPlainObject, MAX_BACKUP_BYTES } from "../utils/backupSecurity";

export const DR_FORMAT_ID = "hts-dr";
export const DR_SCHEMA_VERSION = 2; // V2: asset(임차·매각) + operational.preMoveInInspections 추가. v1/legacy 파일도 계속 파싱(하위호환).
export const DR_BACKUP_TYPE = "disaster-recovery";

// P0 canonical 모듈 구조(각 모듈은 선택적 — 백업/복원 단위)
export type DormModuleData = { dorms: unknown[]; occupants: unknown[]; newHires: unknown[]; dormContracts: unknown[] };
// preMoveInInspections 는 V2 추가(선택적) — v1/legacy 백업에는 없을 수 있으므로 optional.
export type OperationalModuleData = { cleaningReports: unknown[]; defects: unknown[]; inventory: unknown[]; settlementRecords: unknown[]; settlementItems: unknown[]; preMoveInInspections?: unknown[] };
// 자산관리(임차·매각) — V2 추가. 현재 localStorage 기반 데이터라 백업엔 담되 선택 복원은 후속(registry.restoreSupported=false).
export type AssetModuleData = { leases: unknown[]; sales: unknown[] };
export type MilitaryModuleData = {
  militaryPersonnel: unknown[]; militaryTrainingRecords: unknown[]; militaryNotices: unknown[]; militaryReports: unknown[];
  militarySettings: Record<string, unknown>; militaryTrainingRules: unknown[]; militaryCodeValues: unknown; militaryTrainingAutoConfig: unknown;
};
export type SystemModuleData = { systemSettings?: unknown; theme?: unknown; customTemplates?: unknown; cleaningSettings?: unknown };
export type AuditModuleData = { auditLogs: unknown[] };

export type CanonicalModules = {
  dorm?: DormModuleData;
  operational?: OperationalModuleData;
  asset?: AssetModuleData;
  military?: MilitaryModuleData;
  system?: SystemModuleData;
  audit?: AuditModuleData;
};

export type SourceFormat = "dr" | "legacy-flat" | "nested-databackup" | "general" | "unknown";

export type CanonicalBackup = {
  formatId: string;
  schemaVersion: number;
  backupType: string;
  generatedAt: string | null;
  tenantId: string | null;
  appVersion: string | null;
  sourceFormat: SourceFormat;
  modules: CanonicalModules;
  recordCounts: Record<string, number>;
  completeness: { included: string[]; excluded: string[] };
  checksum: string | null;
};

// 군대 8키·라벨·모듈 라벨·제외 목록은 dataset registry(단일 소스)에서 가져와 re-export(기존 import 호환 유지).
import { MILITARY_KEYS, MILITARY_KEY_LABELS, MODULE_LABELS, P0_EXCLUDED, type MilitaryKey } from "./datasetRegistry";
export { MILITARY_KEYS, MILITARY_KEY_LABELS, MODULE_LABELS, P0_EXCLUDED };
export type { MilitaryKey };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {});

// 비암호화 무결성 체크섬(손상/변조 감지용, FNV-1a 32bit hex). 안정 직렬화 문자열 기준.
export function integrityChecksum(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
// 모듈 전용 안정 직렬화(키 정렬) → 체크섬 대상
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}

// ── 안전 파싱: 크기 제한 + JSON + prototype-pollution 방어 ─────────────────────
export type SafeParseResult = { ok: true; value: unknown } | { ok: false; error: string };
export function safeParseBackup(text: string, maxBytes = MAX_BACKUP_BYTES * 20): SafeParseResult {
  if (typeof text !== "string" || text.length === 0) return { ok: false, error: "빈 파일입니다." };
  if (text.length > maxBytes) return { ok: false, error: `파일이 너무 큽니다(허용 ${Math.round(maxBytes / 1024 / 1024)}MB 초과).` };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: "JSON 형식이 올바르지 않습니다(손상 가능)." }; }
  if (!isPlainObject(parsed)) return { ok: false, error: "백업 최상위 구조가 객체가 아닙니다." };
  if (hasDangerousKeys(parsed)) return { ok: false, error: "안전하지 않은 키(__proto__ 등)가 포함되어 거부되었습니다." };
  return { ok: true, value: parsed };
}

// ── 포맷 감지 ────────────────────────────────────────────────────────────────
export function detectFormat(raw: unknown): SourceFormat {
  if (!isPlainObject(raw)) return "unknown";
  if (raw.formatId === DR_FORMAT_ID) return "dr";
  if (raw.backupType === "general") return "general";
  const data = isPlainObject(raw.data) ? raw.data : null;
  if (data && (isPlainObject(data.militaryModuleData) || Array.isArray(data.dorms))) return "nested-databackup";
  // legacy flat: 최상위에 업무 배열이 직접 존재(08-30 백업)
  if (Array.isArray(raw.militaryPersonnel) || Array.isArray(raw.dorms) || Array.isArray(raw.occupants)) return "legacy-flat";
  return "unknown";
}

function buildMilitary(src: Record<string, unknown>): MilitaryModuleData | undefined {
  const has = MILITARY_KEYS.some((k) => src[k] !== undefined);
  if (!has) return undefined;
  return {
    militaryPersonnel: asArray(src.militaryPersonnel), militaryTrainingRecords: asArray(src.militaryTrainingRecords),
    militaryNotices: asArray(src.militaryNotices), militaryReports: asArray(src.militaryReports),
    militarySettings: asObj(src.militarySettings), militaryTrainingRules: asArray(src.militaryTrainingRules),
    militaryCodeValues: src.militaryCodeValues ?? {}, militaryTrainingAutoConfig: src.militaryTrainingAutoConfig ?? { enabled: true, targetStatuses: ["재직"] },
  };
}
function buildDorm(src: Record<string, unknown>): DormModuleData | undefined {
  if (![ "dorms", "occupants", "newHires", "dormContracts" ].some((k) => src[k] !== undefined)) return undefined;
  return { dorms: asArray(src.dorms), occupants: asArray(src.occupants), newHires: asArray(src.newHires), dormContracts: asArray(src.dormContracts) };
}
function buildOperational(src: Record<string, unknown>): OperationalModuleData | undefined {
  if (![ "cleaningReports", "defects", "inventory", "settlementRecords", "settlementItems", "preMoveInInspections" ].some((k) => src[k] !== undefined)) return undefined;
  const base: OperationalModuleData = { cleaningReports: asArray(src.cleaningReports), defects: asArray(src.defects), inventory: asArray(src.inventory), settlementRecords: asArray(src.settlementRecords), settlementItems: asArray(src.settlementItems) };
  if (src.preMoveInInspections !== undefined) base.preMoveInInspections = asArray(src.preMoveInInspections); // V2(없으면 생략 → 하위호환)
  return base;
}
function buildAsset(src: Record<string, unknown>): AssetModuleData | undefined {
  if (![ "leases", "sales" ].some((k) => src[k] !== undefined)) return undefined;
  return { leases: asArray(src.leases), sales: asArray(src.sales) };
}
function buildSystem(src: Record<string, unknown>): SystemModuleData | undefined {
  if (![ "systemSettings", "theme", "customTemplates", "cleaningSettings" ].some((k) => src[k] !== undefined)) return undefined;
  return { systemSettings: src.systemSettings, theme: src.theme, customTemplates: src.customTemplates, cleaningSettings: src.cleaningSettings };
}
function buildAudit(src: Record<string, unknown>): AuditModuleData | undefined {
  if (src.auditLogs === undefined) return undefined;
  return { auditLogs: asArray(src.auditLogs) };
}

function computeCounts(m: CanonicalModules): Record<string, number> {
  const c: Record<string, number> = {};
  if (m.dorm) { c["기숙사"] = m.dorm.dorms.length; c["입주자"] = m.dorm.occupants.length; c["신입사원"] = m.dorm.newHires.length; c["계약"] = m.dorm.dormContracts.length; }
  if (m.operational) { c["청소보고서"] = m.operational.cleaningReports.length; c["하자"] = m.operational.defects.length; c["비품"] = m.operational.inventory.length; c["정산기록"] = m.operational.settlementRecords.length; c["정산항목"] = m.operational.settlementItems.length; if (Array.isArray(m.operational.preMoveInInspections)) c["입주전점검"] = m.operational.preMoveInInspections.length; }
  if (m.asset) { c["임차현황"] = m.asset.leases.length; c["비품매각"] = m.asset.sales.length; }
  if (m.military) for (const k of MILITARY_KEYS) if (Array.isArray((m.military as Record<string, unknown>)[k])) c[MILITARY_KEY_LABELS[k]] = ((m.military as Record<string, unknown>)[k] as unknown[]).length;
  if (m.audit) c["감사로그"] = m.audit.auditLogs.length;
  return c;
}

// ── checksum 정규화(단일 소스) ────────────────────────────────────────────────
// 생성(buildDrBackup)과 검증(verifyChecksum)이 "완전히 동일한 canonical 표현"을 해시하도록,
// adaptToCanonical 의 모듈 재구성과 같은 경로(flatten → buildX)를 재사용한다.
//  · raw 라이브 모듈(military.tenantId 등 여분 키/기본값 주입 전) 과
//    파일 parse 후 canonical 모듈이 같은 결과로 수렴 → 정상 파일의 오탐 제거.
//  · idempotent: canonical 입력에 다시 적용해도 동일(이미 canonical → buildX 재적용 시 불변).
export function canonicalizeModulesForChecksum(modules: CanonicalModules): CanonicalModules {
  const flat: Record<string, unknown> = {
    ...asObj(modules.dorm), ...asObj(modules.operational), ...asObj(modules.asset),
    ...asObj(modules.military), ...asObj(modules.system), ...asObj(modules.audit),
  };
  const out: CanonicalModules = {};
  const dorm = buildDorm(flat); if (dorm) out.dorm = dorm;
  const operational = buildOperational(flat); if (operational) out.operational = operational;
  const asset = buildAsset(flat); if (asset) out.asset = asset;
  const military = buildMilitary(flat); if (military) out.military = military;
  const system = buildSystem(flat); if (system) out.system = system;
  const audit = buildAudit(flat); if (audit) out.audit = audit;
  return out;
}

// JSON 직렬화 경계를 동일하게 적용(실제 파일 저장 표현으로 정규화).
//  · undefined/function 제거, Date→ISO, NaN/Infinity→null, sparse array→null 등 JSON.stringify semantics 전체 반영.
//  · 생성(인메모리)과 검증(파일 parse 후)이 "같은 JSON 표현"을 해시하도록 양쪽에서 호출.
//  · 직렬화 불가(순환 참조 등)·top-level undefined 는 조용히 넘기지 않고 throw(fail-closed).
function normalizeJsonForChecksum(value: unknown): unknown {
  let s: string;
  try { const r = JSON.stringify(value); if (r === undefined) throw new Error("JSON 직렬화 결과 undefined"); s = r; }
  catch { throw new Error("checksum 정규화 실패: JSON 직렬화 불가(순환 참조 등)"); }
  return JSON.parse(s);
}
// checksum 단일 소스: raw/parsed modules 모두 canonical→JSON정규화→안정직렬화→FNV 해시.
function checksumOfModules(modules: CanonicalModules): string {
  return integrityChecksum(stableStringify(normalizeJsonForChecksum(canonicalizeModulesForChecksum(modules))));
}

// ── 어댑터: 임의 백업 → canonical ─────────────────────────────────────────────
export function adaptToCanonical(raw: unknown): CanonicalBackup {
  const fmt = detectFormat(raw);
  const root = asObj(raw);
  // 데이터 소스 위치: dr=modules 평탄화, nested=data.*, flat/general=최상위
  let src: Record<string, unknown> = root;
  if (fmt === "nested-databackup") {
    const d = asObj(root.data);
    // nested 는 military 가 data.militaryModuleData 안에 있음 → 평탄화
    const mm = asObj(d.militaryModuleData);
    src = { ...d, ...mm };
  } else if (fmt === "dr") {
    const mods = asObj(root.modules);
    src = { ...asObj(mods.dorm), ...asObj(mods.operational), ...asObj(mods.asset), ...asObj(mods.military), ...asObj(mods.system), ...asObj(mods.audit) };
  } else if (fmt === "general") {
    src = asObj(root.data);
  }
  const modules: CanonicalModules = {};
  const dorm = buildDorm(src); if (dorm) modules.dorm = dorm;
  const operational = buildOperational(src); if (operational) modules.operational = operational;
  const asset = buildAsset(src); if (asset) modules.asset = asset;
  const military = buildMilitary(src); if (military) modules.military = military;
  const system = buildSystem(src); if (system) modules.system = system;
  const audit = buildAudit(src); if (audit) modules.audit = audit;

  const included = Object.keys(modules).map((k) => MODULE_LABELS[k] || k);
  return {
    formatId: typeof root.formatId === "string" ? root.formatId : (fmt === "dr" ? DR_FORMAT_ID : "(legacy)"),
    schemaVersion: typeof root.schemaVersion === "number" ? root.schemaVersion : (fmt === "dr" ? DR_SCHEMA_VERSION : 0),
    backupType: typeof root.backupType === "string" ? root.backupType : fmt,
    generatedAt: (typeof root.generatedAt === "string" && root.generatedAt) || (typeof root.createdAt === "string" && root.createdAt) || null,
    tenantId: typeof root.tenantId === "string" ? root.tenantId : null,
    appVersion: typeof root.appVersion === "string" ? root.appVersion : null,
    sourceFormat: fmt,
    modules,
    recordCounts: computeCounts(modules),
    completeness: { included, excluded: [...P0_EXCLUDED] },
    checksum: typeof root.checksum === "string" ? root.checksum : null,
  };
}

// ── DR 백업 생성(라이브 앱 데이터 → canonical → 직렬화) ──────────────────────
export function buildDrBackup(input: {
  tenantId: string; appVersion?: string;
  dorm?: DormModuleData; operational?: OperationalModuleData; asset?: AssetModuleData; military?: MilitaryModuleData; system?: SystemModuleData; audit?: AuditModuleData;
}): CanonicalBackup {
  const modules: CanonicalModules = {};
  if (input.dorm) modules.dorm = input.dorm;
  if (input.operational) modules.operational = input.operational;
  if (input.asset) modules.asset = input.asset;
  if (input.military) modules.military = input.military;
  if (input.system) modules.system = input.system;
  if (input.audit) modules.audit = input.audit;
  const checksum = checksumOfModules(modules);
  return {
    formatId: DR_FORMAT_ID, schemaVersion: DR_SCHEMA_VERSION, backupType: DR_BACKUP_TYPE,
    generatedAt: new Date().toISOString(), tenantId: input.tenantId, appVersion: input.appVersion ?? null,
    sourceFormat: "dr", modules, recordCounts: computeCounts(modules),
    completeness: { included: Object.keys(modules).map((k) => MODULE_LABELS[k] || k), excluded: [...P0_EXCLUDED] },
    checksum,
  };
}
export function serializeDrBackup(cb: CanonicalBackup): string {
  return JSON.stringify({
    formatId: cb.formatId, schemaVersion: cb.schemaVersion, backupType: cb.backupType,
    generatedAt: cb.generatedAt, tenantId: cb.tenantId, appVersion: cb.appVersion,
    modules: cb.modules, recordCounts: cb.recordCounts, completeness: cb.completeness, checksum: cb.checksum,
  });
}
// 파일 무결성: 저장된 checksum vs 재계산(있을 때만)
export function verifyChecksum(cb: CanonicalBackup): { checked: boolean; ok: boolean } {
  if (!cb.checksum) return { checked: false, ok: true };
  // 재계산 실패(직렬화 불가 등)는 "검증 실패(불일치)"로 fail-closed — 조용한 통과 금지.
  try { return { checked: true, ok: cb.checksum === checksumOfModules(cb.modules) }; }
  catch { return { checked: true, ok: false }; }
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
export type ValidationResult = { errors: string[]; warnings: string[] };
export function validateCanonical(cb: CanonicalBackup): ValidationResult {
  const errors: string[] = []; const warnings: string[] = [];
  if (Object.keys(cb.modules).length === 0) errors.push("복원 가능한 모듈이 없습니다.");
  const chk = verifyChecksum(cb);
  if (chk.checked && !chk.ok) warnings.push("체크섬 불일치(파일이 수정/손상됐을 수 있음).");
  return { errors, warnings };
}

// ── 군대 관계 무결성(personnelId → personnel.id) ─────────────────────────────
export type MilitaryIntegrity = {
  personnel: number; training: number; notices: number; reports: number;
  dupPersonnelId: number; dupTrainingId: number; missingPersonnelId: number; missingTrainingId: number;
  emptyPersonnelId: number; orphanTraining: number; ok: boolean;
};
function dupCount(a: unknown[]): number {
  const m = new Map<string, number>();
  for (const x of a) { const id = String((x as Record<string, unknown>)?.id ?? ""); if (!id) continue; m.set(id, (m.get(id) || 0) + 1); }
  let d = 0; for (const v of m.values()) if (v > 1) d++; return d;
}
function missingIdCount(a: unknown[]): number { return a.filter((x) => !String((x as Record<string, unknown>)?.id ?? "").trim()).length; }
export function checkMilitaryIntegrity(m: MilitaryModuleData): MilitaryIntegrity {
  const P = asArray(m.militaryPersonnel), T = asArray(m.militaryTrainingRecords);
  const pids = new Set(P.map((x) => String((x as Record<string, unknown>)?.id ?? "")).filter(Boolean));
  let emptyPid = 0, orphan = 0;
  for (const t of T) { const pid = String((t as Record<string, unknown>)?.personnelId ?? ""); if (!pid) { emptyPid++; continue; } if (!pids.has(pid)) orphan++; }
  const missingTid = missingIdCount(T), missingPid = missingIdCount(P);
  const dupPid = dupCount(P), dupTid = dupCount(T);
  return {
    personnel: P.length, training: T.length, notices: asArray(m.militaryNotices).length, reports: asArray(m.militaryReports).length,
    dupPersonnelId: dupPid, dupTrainingId: dupTid, missingPersonnelId: missingPid, missingTrainingId: missingTid,
    emptyPersonnelId: emptyPid, orphanTraining: orphan,
    ok: dupPid === 0 && dupTid === 0 && missingPid === 0 && missingTid === 0 && emptyPid === 0 && orphan === 0,
  };
}

// ── 복원 계획(dry-run · DB write 없음) ───────────────────────────────────────
export type RestorePolicy = "REPLACE" | "MERGE" | "SKIP";
// 기숙사/운영 세부 dataset 키(세부 선택 복원 단위). preMoveInInspections 는 restoreSupported=false 라 제외.
export const DORM_DATASET_KEYS = ["dorms", "occupants", "newHires", "dormContracts"] as const;
export type DormDatasetKey = (typeof DORM_DATASET_KEYS)[number];
export const OPERATIONAL_RESTORE_DATASET_KEYS = ["cleaningReports", "defects", "inventory", "settlementRecords", "settlementItems"] as const;
export type OperationalRestoreDatasetKey = (typeof OPERATIONAL_RESTORE_DATASET_KEYS)[number];
export type DormTargetKey = `dorm.${DormDatasetKey}`;
export type OperationalTargetKey = `operational.${OperationalRestoreDatasetKey}`;
// dataset 라벨(= computeCounts recordCounts 키와 정합).
export const DORM_DATASET_LABELS: Record<DormDatasetKey, string> = { dorms: "기숙사", occupants: "입주자", newHires: "신입사원", dormContracts: "계약" };
export const OPERATIONAL_DATASET_LABELS: Record<OperationalRestoreDatasetKey, string> = { cleaningReports: "청소보고서", defects: "하자", inventory: "비품", settlementRecords: "정산기록", settlementItems: "정산항목" };

// 대상 키: 기숙사/운영은 세부 dataset 단위(dorm.*/operational.*), 군대는 8키 개별, system/audit 은 모듈(복원 미지원).
//  · 하위호환: 과거 "dorm"/"operational" 모듈 키도 허용(normalizeSelection 이 세부 키로 확장).
export type RestoreTargetKey = "dorm" | "operational" | "system" | "audit" | MilitaryKey | DormTargetKey | OperationalTargetKey;
export type Selection = Partial<Record<RestoreTargetKey, boolean>>;
export type PolicyChoice = Partial<Record<RestoreTargetKey, RestorePolicy>>;

// [하위호환 adapter] 과거/모듈 단위 selection(dorm/operational=true)을 세부 dataset 키로 확장.
//  · 이미 세부 키로 들어온 경우는 그대로. 모듈 키는 해당 모듈의 restoreSupported dataset 전체를 선택한 것으로 해석.
//  · 군대/system/audit 키는 변경하지 않음.
export function normalizeSelection(selection: Selection, policy: PolicyChoice): { selection: Selection; policy: PolicyChoice } {
  const s: Selection = { ...selection };
  const p: PolicyChoice = { ...policy };
  if (selection.dorm) for (const ds of DORM_DATASET_KEYS) { const k = `dorm.${ds}` as DormTargetKey; if (s[k] === undefined) s[k] = true; if (policy.dorm !== undefined && p[k] === undefined) p[k] = policy.dorm; }
  if (selection.operational) for (const ds of OPERATIONAL_RESTORE_DATASET_KEYS) { const k = `operational.${ds}` as OperationalTargetKey; if (s[k] === undefined) s[k] = true; if (policy.operational !== undefined && p[k] === undefined) p[k] = policy.operational; }
  delete s.dorm; delete s.operational; // 모듈 키는 세부 키로 치환
  return { selection: s, policy: p };
}
export function restoreTargetLabel(key: RestoreTargetKey): string {
  if (key.startsWith("dorm.")) return `기숙사-${DORM_DATASET_LABELS[key.slice(5) as DormDatasetKey] || key.slice(5)}`;
  if (key.startsWith("operational.")) return `운영-${OPERATIONAL_DATASET_LABELS[key.slice(12) as OperationalRestoreDatasetKey] || key.slice(12)}`;
  if ((MILITARY_KEYS as readonly string[]).includes(key)) return MILITARY_KEY_LABELS[key as MilitaryKey];
  return MODULE_LABELS[key] || key;
}

export type PlanRow = {
  key: RestoreTargetKey; label: string;
  currentCount: number; backupCount: number;
  currentEmpty: boolean; backupHasData: boolean;
  defaultPolicy: RestorePolicy;   // empty→REPLACE, 충돌→SKIP
  chosenPolicy: RestorePolicy;
  action: "restore-replace" | "restore-merge" | "skip";
  conflict: boolean;              // 현재도 있고 백업도 있음
  warnings: string[];
  blocked: boolean;              // 무결성 위반 등으로 차단
};
export type RestorePlan = { rows: PlanRow[]; militaryIntegrity: MilitaryIntegrity | null; hasBlocking: boolean; willWriteTargets: RestoreTargetKey[] };

const cnt = (v: unknown): number => (Array.isArray(v) ? v.length : (isPlainObject(v) && Object.keys(v).length > 0 ? 1 : 0));

// current: 현재 앱 데이터(같은 canonical 구조), backup: 복원 원본 canonical, selection/policy: 사용자 선택
export function planRestore(currentMods: CanonicalModules, backupArg: CanonicalBackup, selectionArg: Selection, policyArg: PolicyChoice): RestorePlan {
  const rows: PlanRow[] = [];
  const backup = backupArg; const b = backup.modules;
  // [하위호환] 모듈 키(dorm/operational) → 세부 dataset 키 확장. 이후 로직은 세부 키만 본다.
  const { selection, policy } = normalizeSelection(selectionArg, policyArg);

  // 세부 dataset 행(기숙사/운영) — 선택된 dataset 만, dataset 별 policy/action.
  const pushDatasetRow = (key: RestoreTargetKey, label: string, moduleData: Record<string, unknown> | undefined, bkData: Record<string, unknown> | undefined, dsKey: string) => {
    if (!selection[key]) return;
    if (!bkData) { rows.push({ key, label, currentCount: cnt(moduleData?.[dsKey]), backupCount: 0, currentEmpty: cnt(moduleData?.[dsKey]) === 0, backupHasData: false, defaultPolicy: "SKIP", chosenPolicy: "SKIP", action: "skip", conflict: false, warnings: ["백업에 이 데이터가 없습니다."], blocked: false }); return; }
    const curCount = cnt(moduleData?.[dsKey]); const bkCount = cnt(bkData?.[dsKey]);
    const currentEmpty = curCount === 0, backupHasData = bkCount > 0, conflict = !currentEmpty && backupHasData;
    const def: RestorePolicy = conflict ? "SKIP" : (backupHasData ? "REPLACE" : "SKIP");
    const chosen = policy[key] ?? def;
    rows.push({ key, label, currentCount: curCount, backupCount: bkCount, currentEmpty, backupHasData, defaultPolicy: def, chosenPolicy: chosen, action: chosen === "REPLACE" ? "restore-replace" : chosen === "MERGE" ? "restore-merge" : "skip", conflict, warnings: conflict && chosen === "REPLACE" ? ["이 데이터를 백업값으로 적용(추가·갱신)합니다."] : [], blocked: false });
  };

  const curDorm = currentMods.dorm as Record<string, unknown> | undefined;
  const bkDorm = b.dorm as Record<string, unknown> | undefined;
  for (const ds of DORM_DATASET_KEYS) pushDatasetRow(`dorm.${ds}` as RestoreTargetKey, restoreTargetLabel(`dorm.${ds}` as RestoreTargetKey), curDorm, bkDorm, ds);
  const curOp = currentMods.operational as Record<string, unknown> | undefined;
  const bkOp = b.operational as Record<string, unknown> | undefined;
  for (const ds of OPERATIONAL_RESTORE_DATASET_KEYS) pushDatasetRow(`operational.${ds}` as RestoreTargetKey, restoreTargetLabel(`operational.${ds}` as RestoreTargetKey), curOp, bkOp, ds);

  // system/audit 모듈 단위(복원 미지원 — selection 에 들어오지 않지만 호환상 유지).
  const pushModuleRow = (key: "system" | "audit", curCount: number, bkCount: number) => {
    if (!selection[key]) return;
    if (!(b as Record<string, unknown>)[key]) { rows.push({ key, label: MODULE_LABELS[key], currentCount: curCount, backupCount: 0, currentEmpty: curCount === 0, backupHasData: false, defaultPolicy: "SKIP", chosenPolicy: "SKIP", action: "skip", conflict: false, warnings: ["백업에 이 모듈이 없습니다."], blocked: false }); return; }
    const currentEmpty = curCount === 0, backupHasData = bkCount > 0, conflict = !currentEmpty && backupHasData;
    const def: RestorePolicy = conflict ? "SKIP" : (backupHasData ? "REPLACE" : "SKIP");
    const chosen = policy[key] ?? def;
    rows.push({ key, label: MODULE_LABELS[key], currentCount: curCount, backupCount: bkCount, currentEmpty, backupHasData, defaultPolicy: def, chosenPolicy: chosen, action: chosen === "REPLACE" ? "restore-replace" : chosen === "MERGE" ? "restore-merge" : "skip", conflict, warnings: [], blocked: false });
  };
  const modCount = (m: CanonicalModules[keyof CanonicalModules] | undefined, keys: string[]): number => keys.reduce((s, k) => s + cnt((m as Record<string, unknown> | undefined)?.[k]), 0);
  pushModuleRow("system", modCount(currentMods.system, ["systemSettings", "theme", "customTemplates", "cleaningSettings"]), modCount(b.system, ["systemSettings", "theme", "customTemplates", "cleaningSettings"]));
  pushModuleRow("audit", modCount(currentMods.audit, ["auditLogs"]), modCount(b.audit, ["auditLogs"]));

  // 군대 8키 개별
  let mInteg: MilitaryIntegrity | null = null;
  if (b.military) mInteg = checkMilitaryIntegrity(b.military);
  for (const mk of MILITARY_KEYS) {
    if (!selection[mk]) continue;
    const curV = (currentMods.military as Record<string, unknown> | undefined)?.[mk];
    const bkV = (b.military as Record<string, unknown> | undefined)?.[mk];
    const curCount = cnt(curV), bkCount = cnt(bkV);
    const currentEmpty = curCount === 0, backupHasData = bkCount > 0, conflict = !currentEmpty && backupHasData;
    const def: RestorePolicy = conflict ? "SKIP" : (backupHasData ? "REPLACE" : "SKIP");
    const chosen = policy[mk] ?? def;
    const warnings: string[] = []; let blocked = false;
    if (!b.military) { warnings.push("백업에 군대 데이터가 없습니다."); }
    // 훈련기록 복원 시 군 인사 무결성 게이트
    if (mk === "militaryTrainingRecords" && chosen !== "SKIP" && mInteg) {
      if (mInteg.orphanTraining > 0 || mInteg.emptyPersonnelId > 0) { warnings.push(`대상자 연결 오류(orphan ${mInteg.orphanTraining}, 미지정 ${mInteg.emptyPersonnelId}) — 군 인사 함께 복원 필요`); blocked = true; }
      const personnelSelected = selection.militaryPersonnel && (policy.militaryPersonnel ?? (currentMods.military && cnt((currentMods.military as Record<string, unknown>).militaryPersonnel) > 0 ? "SKIP" : "REPLACE")) !== "SKIP";
      const personnelAlreadyPresent = cnt((currentMods.military as Record<string, unknown> | undefined)?.militaryPersonnel) > 0;
      if (!personnelSelected && !personnelAlreadyPresent) { warnings.push("훈련 기록의 대상자(군 인사)가 현재 없고 함께 복원되지 않습니다."); blocked = true; }
    }
    if (mInteg && (mInteg.dupPersonnelId > 0 || mInteg.dupTrainingId > 0 || mInteg.missingPersonnelId > 0 || mInteg.missingTrainingId > 0) && chosen !== "SKIP") {
      warnings.push("백업에 중복/누락 ID가 있어 복원할 수 없습니다."); blocked = true;
    }
    rows.push({ key: mk, label: MILITARY_KEY_LABELS[mk], currentCount: curCount, backupCount: bkCount, currentEmpty, backupHasData, defaultPolicy: def, chosenPolicy: chosen, action: blocked ? "skip" : (chosen === "REPLACE" ? "restore-replace" : chosen === "MERGE" ? "restore-merge" : "skip"), conflict, warnings, blocked });
  }

  const hasBlocking = rows.some((r) => r.blocked);
  const willWriteTargets = rows.filter((r) => !r.blocked && r.action !== "skip").map((r) => r.key);
  return { rows, militaryIntegrity: mInteg, hasBlocking, willWriteTargets };
}

// MERGE(id 기준): 기존 유지 + 백업으로 upsert. id 없는 항목이 있으면 병합 불가(null 반환 → 소비처가 차단).
export function mergeById(current: unknown[], backup: unknown[]): unknown[] | null {
  const cur = asArray(current), bk = asArray(backup);
  if (cur.some((x) => !String((x as Record<string, unknown>)?.id ?? "").trim()) || bk.some((x) => !String((x as Record<string, unknown>)?.id ?? "").trim())) return null;
  const map = new Map<string, unknown>();
  for (const x of cur) map.set(String((x as Record<string, unknown>).id), x);
  for (const x of bk) map.set(String((x as Record<string, unknown>).id), x); // 백업 우선(upsert)
  return Array.from(map.values());
}
