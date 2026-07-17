// 유효 데이터 범위 병합 모델(순수 함수). add-only: 기존 role 범위 위에 "추가 허용"만.
//  - 기존 지역/성별/담당기숙사 범위를 축소/제거하지 않는다. 컴포넌트는 `기존검사 || scopes.canX(...)` 결합.
//  - 하자접수/기숙사 담당 계정은 애초에 사용자 정의 권한 미배정 → 빈 범위(추가 없음, 보호).
//  - 공정(process) 실제 강제는 exam_user_process_scopes + 기존 RLS 담당. 여기서는 표시/병합 참고용.
import type { ScopeRow, ScopeType } from "./scopeCatalog";

export type EffectiveScopes = {
  hasCustom: boolean;
  readOnly: boolean;                                  // 조회 전용 범위가 하나라도 있으면(쓰기 신규 부여 안 함)
  regions: Set<string>; allRegions: boolean;
  genders: Set<string>; allGenders: boolean;
  dormIds: Set<string>; dormModes: Set<string>;       // 'all'|'assigned'|'region' 등 모드 + 개별 uuid
  processIds: Set<string>; allProcesses: boolean; assignedProcesses: boolean;
  ownerModes: Set<string>;
  canAccessRegion: (region?: string | null) => boolean;
  canAccessGender: (gender?: string | null) => boolean;
  canAccessDormId: (dormId?: string | null) => boolean;
  canAccessProcessId: (processId?: string | null) => boolean;
  raw: ScopeRow[];
};

const FIXED = new Set(["all", "assigned", "region", "tenant", "own", "created_by_me", "assigned_to_me", "approver_me", "남", "여", "평택", "천안"]);

// rows: 로그인 사용자에게 배정된 사용자 정의 권한들의 활성·유효 범위 합집합.
export function buildEffectiveScopes(rows: ScopeRow[] = []): EffectiveScopes {
  const byType = (t: ScopeType) => rows.filter((r) => r.scope_type === t);
  const values = (t: ScopeType) => new Set(byType(t).map((r) => r.scope_value));

  const regionVals = values("region");
  const genderVals = values("gender");
  const dormVals = values("dorm");
  const processVals = values("process");
  const ownerModes = values("owner");

  const allRegions = regionVals.has("all");
  const allGenders = genderVals.has("all");
  const dormModes = new Set(Array.from(dormVals).filter((v) => FIXED.has(v)));
  const dormIds = new Set(Array.from(dormVals).filter((v) => !FIXED.has(v)));
  const allProcesses = processVals.has("all");
  const assignedProcesses = processVals.has("assigned");
  const processIds = new Set(Array.from(processVals).filter((v) => !FIXED.has(v)));

  const readOnly = rows.some((r) => r.action_scope === "read") && !rows.some((r) => r.action_scope === "write" || r.action_scope === "all");

  return {
    hasCustom: rows.length > 0,
    readOnly,
    regions: new Set(Array.from(regionVals).filter((v) => v !== "all")), allRegions,
    genders: new Set(Array.from(genderVals).filter((v) => v !== "all")), allGenders,
    dormIds, dormModes,
    processIds, allProcesses, assignedProcesses,
    ownerModes,
    // 모두 add-only: 사용자 정의 권한이 "추가로" 이 값을 허용하는지.
    canAccessRegion: (region) => allRegions || (!!region && regionVals.has(region)),
    canAccessGender: (gender) => allGenders || (!!gender && genderVals.has(gender)),
    canAccessDormId: (dormId) => dormModes.has("all") || (!!dormId && dormIds.has(dormId)),
    canAccessProcessId: (pid) => allProcesses || (!!pid && processIds.has(pid)),
    raw: rows,
  };
}

// ── 9단계 데이터 범위 접근 판정 ─────────────────────────────────────────────────
//  규칙: 같은 scope_type 내 = 합집합 / 서로 다른 type 간 = 교집합 / '전체 데이터' = 전체 허용 /
//        restrictive 인데 해당 모듈 범위가 하나도 없으면 0건(안전 기본값).
//  active=false(사용자 정의 restrictive 없음) 면 모든 canX 가 true(기존 동작 유지 · 무회귀).
export type DataScopeAccess = {
  active: boolean;
  fullScope: boolean;
  canDorm: (d: { id?: string | null; site?: string | null; gender?: string | null }) => boolean;
  canOccupant: (o: { dormId?: string | null; site?: string | null; gender?: string | null }) => boolean;
  canProcessId: (processId?: string | null) => boolean;
  regionValues: string[]; genderValues: string[]; dormValues: string[]; processValues: string[];
};

export function buildDataScopeAccess(
  restrictiveActive: boolean,
  rows: ScopeRow[],
  opts?: { assignedDormId?: string | null }
): DataScopeAccess {
  const passAll: DataScopeAccess = {
    active: false, fullScope: true,
    canDorm: () => true, canOccupant: () => true, canProcessId: () => true,
    regionValues: [], genderValues: [], dormValues: [], processValues: [],
  };
  if (!restrictiveActive) return passAll; // 기존/additive 계정 → 범위 강제 없음(무회귀)

  const byType = (t: ScopeType) => rows.filter((r) => r.scope_type === t).map((r) => r.scope_value);
  const region = byType("region"); const gender = byType("gender");
  const dorm = byType("dorm"); const process = byType("process"); const org = byType("organization");

  const fullScope = org.includes("all") || org.includes("tenant"); // '전체 데이터' 명시

  const regionSet = new Set(region); const genderSet = new Set(gender);
  const dormIds = new Set(dorm.filter((v) => !["all", "assigned"].includes(v)));
  const dormAll = dorm.includes("all"); const dormAssigned = dorm.includes("assigned");
  const processIds = new Set(process.filter((v) => !["all", "assigned"].includes(v)));
  const processAll = process.includes("all");

  // 차원별 판정(미지정 차원은 제한하지 않음 = 교집합에서 통과).
  const okRegion = (site?: string | null) => region.length === 0 || regionSet.has("all") || (!!site && regionSet.has(site));
  const okGender = (g?: string | null) => gender.length === 0 || genderSet.has("all") || (!!g && genderSet.has(g));
  const okDorm = (dormId?: string | null) =>
    dorm.length === 0 || dormAll
    || (!!dormId && dormIds.has(dormId))
    || (dormAssigned && !!opts?.assignedDormId && dormId === opts.assignedDormId);

  // 기숙사 모듈에 유효 범위가 하나도 없고 전체도 아니면 → 0건(restrictive 안전 기본값).
  const dormModuleHasScope = fullScope || region.length > 0 || gender.length > 0 || dorm.length > 0;

  return {
    active: true,
    fullScope,
    canDorm: (d) => fullScope || (dormModuleHasScope && okRegion(d.site) && okGender(d.gender) && okDorm(d.id)),
    canOccupant: (o) => fullScope || (dormModuleHasScope && okRegion(o.site) && okGender(o.gender) && okDorm(o.dormId)),
    canProcessId: (pid) => fullScope || processAll || (process.length > 0 && !!pid && processIds.has(pid)),
    regionValues: region, genderValues: gender, dormValues: dorm, processValues: process,
  };
}
