/* Storage DR — UI→Edge wiring 데이터경로 검증(LOCAL).
 * storageDrClient 과 동일한 supabase.functions.invoke(세션 JWT) 경로를 실제로 호출한다.
 * provider ENABLED serve 전제. synthetic STORAGE-DR-WIRE-* · 종료 시 정리. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const URL = process.env.SB_URL || "http://127.0.0.1:55421";
const SECRET = process.env.SB_SECRET || ""; const ANON = process.env.SB_ANON || "";
if (!SECRET || !ANON) { console.error("env"); process.exit(2); }
const admin: SupabaseClient = createClient(URL, SECRET, { auth: { persistSession: false } });
const T = "STORAGE-DR-WIRE-T"; const PW = "Wire-" + Math.random().toString(36).slice(2, 9) + "!A1";
const results: Record<string, boolean> = {};
const ok = (id: string, c: boolean, d: string) => { results[id] = c; console.log(`${id} ${c ? "PASS" : "FAIL"} — ${d}`); };
const made: string[] = [];
async function mkUser(role: string) {
  const email = `wire-${role}-${Math.random().toString(36).slice(2, 7)}@storage-dr-wire.local`;
  const { data } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }); made.push(data!.user!.id);
  await admin.from("profiles").upsert({ id: data!.user!.id, email, display_name: role, role, is_active: true, tenant_id: T });
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: PW });
  return c; // 세션 보유 클라이언트(= UI 의 supabase 와 동일)
}
async function cleanup() { await admin.from("storage_dr_jobs").delete().eq("tenant_id", T); for (const id of made) { await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id); } }
async function main() {
  await cleanup().catch(() => {});
  const adminC = await mkUser("admin"); const viewerC = await mkUser("viewer");
  // status (admin) → providerEnabled true (enabled serve)
  const s = await adminC.functions.invoke("storage-dr", { body: { action: "status" } });
  ok("WIRE-STATUS", !s.error && (s.data as any)?.ok === true && (s.data as any)?.providerEnabled === true, `providerEnabled=${(s.data as any)?.providerEnabled}`);
  // viewer archive → 서버 403(FunctionsHttpError). 데이터경로가 권한을 서버에서 막는지.
  const va = await viewerC.functions.invoke("storage-dr", { body: { action: "archive", requestId: "wire-" + crypto.randomUUID() } });
  ok("WIRE-NONADMIN", !!va.error, `error=${!!va.error}`);
  // admin archive → ok(대상 0건이어도 성공)
  const aa = await adminC.functions.invoke("storage-dr", { body: { action: "archive", requestId: "wire-" + crypto.randomUUID() } });
  ok("WIRE-ADMIN", !aa.error && (aa.data as any)?.ok === true, `ok=${(aa.data as any)?.ok} total=${(aa.data as any)?.job?.total}`);
  await cleanup();
  const fails = Object.values(results).filter((v) => !v).length;
  console.log(`\nTOTAL ${Object.keys(results).length} PASS ${Object.keys(results).length - fails} FAIL ${fails}`);
  process.exit(fails ? 1 : 0);
}
main().catch(async (e) => { console.error("WIRE ERR", e); try { await cleanup(); } catch { /* */ } process.exit(4); });
