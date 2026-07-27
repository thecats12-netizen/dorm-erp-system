// ⚠ 임시 · 보안 검증 전용 · DEV 전용 · 제거 가능 코드 (운영 빌드/ UI 에 노출되지 않음).
//   목적: 현재 로그인 세션(anon/authenticated · 예: viewer)의 권한으로 exam_certification_history 에
//         INSERT / UPDATE / DELETE 를 각 1회 시도하고 blocked/allowed + 오류코드 + 한글을 console 에 출력.
//   원칙: service_role 미사용(앱 supabase 클라이언트=현재 세션) · 테스트 tenant/테스트 시드 행만 대상 ·
//         기존 행 훼손 방지. INSERT/UPDATE/DELETE "실패(blocked)"가 정상 결과.
//   실행: DEV 서버에서 아무 dev 진입 파일에 임시로 `import "이 파일 경로";` 를 추가(테스트 후 제거)하면
//         window.__examHistoryRlsTest 가 준비됨. 브라우저 콘솔에서:
//         __examHistoryRlsTest({ tenantId: 'test' })  (seed 기본값 사용)
//   ※ 검증이 끝나면 이 파일과 임시 import 를 삭제하세요.
import { supabase } from "../../../services/supabaseService";

const BLOCKED_TENANTS = new Set(["", "default", "prod", "production", "main", "운영"]);

// seed-test-data.sql 기본 UUID(테스트 tenant='test'). 실제 값이 다르면 opts 로 override.
const DEFAULTS = {
  tenantId: "test",
  personnelId: "a5100000-0000-4000-8000-000000000034", // 테스트직원 D
  processId: "a5100000-0000-4000-8000-000000000003",   // 테스트 공정
  historyRowId: "a5100000-0000-4000-8000-000000000081", // 시드 history 행(UPDATE/DELETE 대상)
};

type Opts = Partial<typeof DEFAULTS>;
type PgErr = { code?: string; message?: string } | null;

function ko(code?: string): string {
  switch (code) {
    case "42501": return "권한 없음(RLS 정책 차단) — 정상";
    case "PGRST301": return "인증/권한 오류 — 정상";
    case "23503": return "참조 무결성(FK) 위반 — RLS 이전 단계 차단(순수 RLS 확인엔 유효 personnelId 필요)";
    case "23502": return "필수값(NOT NULL) 누락 — RLS 이전 단계 차단";
    case undefined: return "오류 코드 없음";
    default: return `기타 오류(${code})`;
  }
}
function line(op: "insert" | "update" | "delete", blocked: boolean, err: PgErr, note?: string): void {
  const code = err?.code;
  console.log(`history ${op}: ${blocked ? "blocked" : "allowed"}` + (code ? ` [${code}] ${ko(code)}` : "") + (note ? ` (${note})` : "") + (err?.message ? ` · msg: ${err.message}` : ""));
}

export async function runHistoryRlsSecurityTest(opts?: Opts): Promise<void> {
  if (!import.meta.env.DEV) { console.warn("[secTest] DEV 전용입니다."); return; }
  if (!supabase) { console.warn("[secTest] supabase 미설정."); return; }
  const o = { ...DEFAULTS, ...(opts ?? {}) };
  if (BLOCKED_TENANTS.has(o.tenantId)) { console.error("[secTest] 운영/기본 tenant 금지:", o.tenantId); return; }
  console.log(`[secTest] exam_certification_history RLS 점검 시작 (tenant='${o.tenantId}') — INSERT/UPDATE/DELETE 는 blocked 가 정상`);

  // (probe) 현재 세션이 대상 행을 SELECT 로 볼 수 있는지(=조회 권한 확인). UPDATE/DELETE 차단과 구분용.
  const probe = await supabase.from("exam_certification_history").select("id").eq("tenant_id", o.tenantId).eq("id", o.historyRowId).limit(1);
  const visible = !probe.error && !!probe.data?.length;
  console.log(`history select(probe): ${visible ? "visible" : "not-visible"}${probe.error ? ` [${(probe.error as PgErr)?.code}]` : ""}`);

  // 1) INSERT (차단 기대). 테스트 시드 값으로 유효 행 구성 → 순수 RLS 로만 차단되도록.
  const insRow = {
    tenant_id: o.tenantId, personnel_id: o.personnelId, process_id: o.processId,
    certification_type: "SECTEST", source_type: "sectest", status: "test",
    metadata: { __sectest__: "1" },
  };
  const ins = await supabase.from("exam_certification_history").insert(insRow).select("id");
  const insBlocked = !!ins.error || !(ins.data && ins.data.length);
  line("insert", insBlocked, ins.error as PgErr);
  // 혹시 INSERT 가 허용됐다면(비정상) 즉시 정리 시도(테스트 행만).
  if (!insBlocked && ins.data?.[0]?.id) {
    await supabase.from("exam_certification_history").delete().eq("id", ins.data[0].id).eq("tenant_id", o.tenantId);
    console.warn("[secTest] ⚠ INSERT 가 허용됨(비정상). 생성된 테스트 행을 정리했습니다.");
  }

  // 2) UPDATE (차단 기대) — 테스트 tenant + 시드 행만 대상. RLS UPDATE 정책 부재 → 0행/거부 = blocked.
  const upd = await supabase.from("exam_certification_history").update({ reason: "sectest-update" })
    .eq("tenant_id", o.tenantId).eq("id", o.historyRowId).select("id");
  const updBlocked = !!upd.error || !(upd.data && upd.data.length);
  line("update", updBlocked, upd.error as PgErr, visible && updBlocked && !upd.error ? "조회는 되나 수정 0행 = RLS 차단" : undefined);

  // 3) DELETE (차단 기대) — 동일 대상. RLS DELETE 정책 부재 → 0행/거부 = blocked.
  const del = await supabase.from("exam_certification_history").delete()
    .eq("tenant_id", o.tenantId).eq("id", o.historyRowId).select("id");
  const delBlocked = !!del.error || !(del.data && del.data.length);
  line("delete", delBlocked, del.error as PgErr, visible && delBlocked && !del.error ? "조회는 되나 삭제 0행 = RLS 차단" : undefined);

  console.log(`[secTest] 결과 요약 — insert:${insBlocked ? "blocked" : "ALLOWED(비정상)"} · update:${updBlocked ? "blocked" : "ALLOWED(비정상)"} · delete:${delBlocked ? "blocked" : "ALLOWED(비정상)"}`);
}

// DEV 에서 import 되면 콘솔 호출용으로만 window 에 바인딩(운영 빌드/UI 노출 없음).
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__examHistoryRlsTest = runHistoryRlsSecurityTest;
  console.info("[secTest] window.__examHistoryRlsTest 준비됨(DEV). 예: __examHistoryRlsTest({ tenantId: 'test' })");
}
