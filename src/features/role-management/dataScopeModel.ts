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
