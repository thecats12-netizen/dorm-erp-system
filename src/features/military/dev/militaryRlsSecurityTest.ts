// ⚠ 임시 · 보안 검증 전용 · DEV 전용 · 제거 가능 코드 (운영 빌드/UI 에 노출되지 않음).
//   목적: 현재 로그인 세션(anon/authenticated · 예: viewer/dorm_manager)의 권한으로
//         military_module_data 에 SELECT/UPDATE/INSERT/DELETE 를 시도하고 blocked/allowed + 오류코드를 console 출력.
//   원칙: service_role 미사용(앱 supabase 클라이언트=현재 세션). 실제 personnel JSONB 를 훼손하지 않는다.
//         - SELECT: 개수만. UPDATE: updated_at 만(데이터 무손실). INSERT: tenant='other'+_probe → 허용 시 즉시 삭제.
//         - DELETE: 매칭 0행 조건(__probe_none__)으로 "권한만" 확인(실제 행 삭제 없음).
//   ⚠ Production DB 로 로그인된 세션에서 실행 금지. LOCAL/STAGING 세션에서만.
//   실행: DEV 서버에서 임시로 `import "src/features/military/dev/militaryRlsSecurityTest";` 추가 후
//         브라우저 콘솔에서: __militaryRlsTest()   (검증 후 import 와 이 파일 삭제)
import { supabase } from "../../../services/supabaseService";

type PgErr = { code?: string; message?: string } | null;
const ko = (code?: string): string =>
  code === "42501" ? "권한 없음(RLS 차단) — 정상"
  : code === "PGRST301" ? "인증/권한 오류 — 정상"
  : code == null ? "코드 없음" : `기타(${code})`;
const line = (op: string, blocked: boolean, err: PgErr, note?: string): void =>
  console.log(`military ${op}: ${blocked ? "blocked" : "allowed"}` + (err?.code ? ` [${err.code}] ${ko(err.code)}` : "") + (note ? ` (${note})` : ""));

export async function runMilitaryRlsSecurityTest(): Promise<void> {
  if (!supabase) { console.warn("[militaryRlsTest] supabase 미설정"); return; }
  // 안전장치: Production URL 로 보이면 경고(로컬/스테이징에서만 실행 권장)
  try {
    const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
    if (!/localhost|127\.0\.0\.1|staging|test/i.test(url)) {
      console.warn("[militaryRlsTest] ⚠ 현재 URL 이 로컬/스테이징이 아닐 수 있습니다. Production 세션에서 실행 금지.", url.replace(/https?:\/\//, "").slice(0, 24) + "…");
    }
  } catch { /* noop */ }

  // SELECT (개수만)
  const sel = await supabase.from("military_module_data").select("id", { count: "exact", head: true }).eq("tenant_id", "default");
  console.log(`military select: ${sel.error ? `blocked [${(sel.error as PgErr)?.code}] ${ko((sel.error as PgErr)?.code)}` : `allowed (count=${sel.count ?? "?"})`}`);

  // UPDATE (updated_at 만 · 데이터 무손실)
  const upd = await supabase.from("military_module_data").update({ updated_at: new Date().toISOString() }).eq("tenant_id", "default");
  line("update", !!upd.error, upd.error as PgErr);

  // INSERT other tenant (+_probe) → 허용 시 즉시 삭제(오염 방지)
  const ins = await supabase.from("military_module_data").insert({ tenant_id: "other", data: { _probe: true } }).select("id");
  line("insert(other)", !!ins.error, ins.error as PgErr, ins.error ? undefined : "⚠ 허용됨 → 정리 시도");
  if (!ins.error && ins.data?.[0]?.id) { await supabase.from("military_module_data").delete().eq("id", (ins.data[0] as { id: string }).id); }

  // DELETE (매칭 0행 · 권한만 확인 · 실제 행 삭제 없음)
  const del = await supabase.from("military_module_data").delete().eq("tenant_id", "__probe_none__");
  line("delete", !!del.error, del.error as PgErr, del.error ? undefined : "권한 통과(0행)");

  console.log("[militaryRlsTest] 완료 — 기대: viewer/dorm/maint/anon 은 update/insert/delete 전부 blocked, admin 은 update/insert allowed·other insert/delete blocked.");
}

// ── [2G Phase E] Production-safe 검증 (READ-ONLY · 데이터 write 없음 · PII/payload 미출력) ──────────
//   아래 두 함수는 mutation 을 하지 않으므로 Production viewer 세션에서 실행해도 안전(§8/§4).
//   ⚠ 절대 payload.new / data JSONB / PII 값을 console 로 출력하지 않는다. 존재/수신 여부(boolean)만 기록.

// (1) viewer raw SELECT 차단 확인 — 개수만(head). 기대(Phase D 후): viewer=blocked, admin=allowed(count=1).
export async function runMilitaryViewerRawSelectProbe(): Promise<void> {
  if (!supabase) { console.warn("[militaryRawSelectProbe] supabase 미설정"); return; }
  const sel = await supabase.from("military_module_data").select("id", { count: "exact", head: true }).eq("tenant_id", "default");
  if (sel.error) {
    const e = sel.error as PgErr;
    console.log(`military raw SELECT: blocked [${e?.code}] ${ko(e?.code)}  → viewer 라면 PASS`);
  } else {
    console.log(`military raw SELECT: allowed (count=${sel.count ?? "?"})  → viewer 라면 SECURITY FAIL / admin 이라면 정상`);
  }
}

// (2) viewer raw Realtime isolation probe — postgres_changes 구독 후 "수신 여부(boolean)"만 기록.
//   사용법: viewer 세션 콘솔에서  const stop = await __militaryRealtimeProbe();
//           그 후 다른 세션(admin)에서 앱의 정상 저장으로 변경 1회 발생 → 30~60초 대기.
//           기대(Phase D 후): "raw event 수신 = false" (viewer 격리 PASS). true 면 SECURITY FAIL.
//           종료:  stop();
export async function runMilitaryRealtimeIsolationProbe(): Promise<() => void> {
  if (!supabase) { console.warn("[militaryRealtimeProbe] supabase 미설정"); return () => {}; }
  let received = false; // ⚠ payload 는 저장/출력하지 않는다. 수신 사실만.
  const ch = supabase
    .channel("phaseE-viewer-military-probe")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "military_module_data", filter: "tenant_id=eq.default" },
      () => { received = true; console.log("[militaryRealtimeProbe] ⚠ raw event 수신 = true  → viewer 라면 SECURITY FAIL (payload 미출력)"); })
    .subscribe((status) => {
      console.log(`[militaryRealtimeProbe] 구독 상태: ${status}`);
      if (status === "SUBSCRIBED") console.log("[militaryRealtimeProbe] 구독 완료 — 이제 admin 세션에서 정상 저장으로 변경 1회 발생시키고 30~60초 대기하세요.");
    });
  const stop = () => {
    console.log(`[militaryRealtimeProbe] 종료 — 최종: raw event 수신 = ${received}  → viewer 세션에서 false 면 Realtime 격리 PASS`);
    try { supabase!.removeChannel(ch); } catch { /* noop */ }
  };
  return stop;
}

// DEV 콘솔 수동 호출용(자동 실행 아님)
try {
  const w = window as unknown as {
    __militaryRlsTest?: () => Promise<void>;
    __militaryRawSelectProbe?: () => Promise<void>;
    __militaryRealtimeProbe?: () => Promise<() => void>;
  };
  w.__militaryRlsTest = runMilitaryRlsSecurityTest;              // raw mutation 매트릭스(LOCAL/STAGING 권장)
  w.__militaryRawSelectProbe = runMilitaryViewerRawSelectProbe; // raw SELECT 차단(READ-ONLY · Production 안전)
  w.__militaryRealtimeProbe = runMilitaryRealtimeIsolationProbe;// raw Realtime 격리(READ-ONLY · Production 안전)
} catch { /* noop */ }
