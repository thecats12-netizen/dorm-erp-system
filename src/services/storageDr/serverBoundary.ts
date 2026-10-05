// ============================================================================
// Storage DR — 서버측 권한 경계(순수 · DI). Edge Function 과 LOCAL 하네스가 공유한다.
//  · 브라우저는 service_role 을 갖지 않는다. 이 경계는 "신뢰 서버"에서만 실행된다는 전제.
//  · auth.uid() → profiles 로 신원 확인 → 활성 + 관리자(role='admin') → tenant 는 서버가 결정.
//  · client 가 보낸 tenantId 는 절대 신뢰하지 않는다(무시, 스푸핑 기록).
//  · fail-closed: 조금이라도 불명확하면 거부.
// ============================================================================

export type StorageDrAction = "archive" | "restore" | "status";

// 서버가 토큰에서 해석한 호출자 신원(profiles 행).
export type CallerProfile = {
  id: string;
  tenant_id: string | null;
  role: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
};

export type AuthorizeDeps = {
  // JWT(Authorization) → profiles 행. 유효하지 않으면 null. (Edge: auth.getUser + profiles select)
  resolveCaller: (authToken: string) => Promise<CallerProfile | null>;
};

export type AuthorizeInput = {
  authToken?: string | null;
  action: StorageDrAction;
  clientTenantId?: string | null; // 신뢰하지 않음 — 서버 tenant 와 비교만.
};

export type AuthorizeDenyCode = "NO_AUTH" | "INVALID_TOKEN" | "INACTIVE" | "FORBIDDEN" | "NO_TENANT";

export type AuthorizeResult =
  | { ok: true; callerId: string; tenantId: string; tenantSpoofIgnored: boolean; action: StorageDrAction }
  | { ok: false; code: AuthorizeDenyCode; message: string };

const DENY_MSG: Record<AuthorizeDenyCode, string> = {
  NO_AUTH: "인증 정보가 없습니다.",
  INVALID_TOKEN: "로그인 상태를 확인할 수 없습니다. 다시 로그인해주세요.",
  INACTIVE: "비활성 계정입니다.",
  FORBIDDEN: "이 작업은 관리자만 수행할 수 있습니다.",
  NO_TENANT: "회사(테넌트) 정보를 확인할 수 없습니다.",
};

// 파일 백업/복원 요청 권한 판정(아카이브·복원 공통). 반환된 tenantId 로만 실제 작업을 수행해야 한다.
export async function authorizeStorageDrRequest(deps: AuthorizeDeps, input: AuthorizeInput): Promise<AuthorizeResult> {
  const token = (input.authToken || "").trim();
  if (!token) return deny("NO_AUTH");

  let prof: CallerProfile | null = null;
  try { prof = await deps.resolveCaller(token); } catch { return deny("INVALID_TOKEN"); }
  if (!prof || !prof.id) return deny("INVALID_TOKEN");

  // 활성 사용자만(삭제/비활성 거부).
  if (prof.deleted_at || prof.is_active === false) return deny("INACTIVE");
  // 일반 관리자 권한(앱 정의: role === 'admin').
  if (prof.role !== "admin") return deny("FORBIDDEN");

  const tenantId = (prof.tenant_id || "").trim();
  if (!tenantId) return deny("NO_TENANT");

  // client tenant 는 신뢰하지 않는다 — 서버 tenant 로 강제. 불일치는 스푸핑으로 기록.
  const spoof = !!input.clientTenantId && input.clientTenantId.trim() !== tenantId;
  return { ok: true, callerId: prof.id, tenantId, tenantSpoofIgnored: spoof, action: input.action };
}

function deny(code: AuthorizeDenyCode): AuthorizeResult { return { ok: false, code, message: DENY_MSG[code] }; }

// provider(파일 백업 저장소) 미설정 시 archive/restore 를 fail-closed 로 막는다. status 는 허용.
export type ProviderGuard = { allowed: boolean; code?: "PROVIDER_NOT_CONFIGURED"; message?: string };
export function assertProviderConfigured(enabled: boolean, action: StorageDrAction): ProviderGuard {
  if (action === "status") return { allowed: true };
  if (!enabled) return { allowed: false, code: "PROVIDER_NOT_CONFIGURED", message: "파일 백업 저장소가 설정되지 않았습니다. 관리자에게 문의하세요." };
  return { allowed: true };
}

// 특정 object/경로가 요청 tenant 범위인지 서버에서 재확인(교차 테넌트 차단 보조).
//  · contract-files / generated-pdfs: 경로 1번째 폴더 = tenantId (코드상 {tenantId}/...).
//  · cleaning-photos / inventory-proof: 레거시 경로에 tenant 없음 → 경로만으로 판별 불가(true 반환하되
//    서버는 DB 참조(tenant 범위 쿼리)로 소유권을 판별해야 한다. 상위 호출부가 보장).
export function objectPathBelongsToTenant(bucket: string, objectPath: string, tenantId: string): boolean {
  const first = objectPath.split("/")[0] || "";
  if (bucket === "contract-files" || bucket === "generated-pdfs") return first === tenantId;
  return true; // 레거시 공개 버킷은 경로 기반 판별 불가 — DB 참조로 판별.
}
