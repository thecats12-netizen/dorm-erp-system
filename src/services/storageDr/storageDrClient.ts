// ============================================================================
// Storage DR — 프런트 클라이언트(Edge Function 호출 경계).
//  · service_role/provider credential 을 프런트가 갖지 않는다. supabase.functions.invoke 가
//    현재 "로그인 세션(JWT)"을 자동으로 실어 보낸다 → 서버가 신원/관리자/테넌트를 판정.
//  · provider 설정 여부는 서버 status 응답(providerEnabled)으로만 판단한다(클라이언트 boolean 불신).
//  · 모든 호출 실패는 fail-closed(비활성/안내)로 처리.
// ============================================================================
import { supabase, isSupabaseAvailable } from "../supabaseService";

export type StorageDrJob = {
  id?: string; status?: string; total?: number; archived?: number; skipped?: number; failed?: number;
  total_bytes?: number; started_at?: string; finished_at?: string; request_id?: string;
};
export type StorageDrStatusResult = { providerConfigured: boolean; jobs: StorageDrJob[] };

async function invoke(action: "status" | "archive" | "restore", extra?: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> | null; error?: string }> {
  if (!isSupabaseAvailable() || !supabase) return { ok: false, data: null, error: "unavailable" };
  try {
    const body: Record<string, unknown> = { action, ...extra };
    if (action !== "status") body.requestId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const { data, error } = await supabase.functions.invoke("storage-dr", { body });
    if (error) return { ok: false, data: null, error: error.message };
    return { ok: true, data: (data as Record<string, unknown>) ?? null };
  } catch (e) { return { ok: false, data: null, error: (e as Error).message }; }
}

// 서버 상태 조회 → provider 설정 여부 + 최근 작업. 실패 시 fail-closed(미설정).
export async function fetchStorageDrStatus(): Promise<StorageDrStatusResult> {
  const r = await invoke("status");
  if (!r.ok || !r.data || r.data.ok !== true) return { providerConfigured: false, jobs: [] };
  return { providerConfigured: r.data.providerEnabled === true, jobs: Array.isArray(r.data.jobs) ? (r.data.jobs as StorageDrJob[]) : [] };
}

export async function startStorageDrArchive(): Promise<{ ok: boolean; message: string }> {
  const r = await invoke("archive");
  if (!r.ok) return { ok: false, message: r.error === "unavailable" ? "파일 백업 저장소가 설정되지 않았습니다." : "파일 백업을 시작하지 못했습니다." };
  const job = (r.data?.job as StorageDrJob) || {};
  return { ok: r.data?.ok === true, message: `파일 백업: 총 ${job.total ?? 0}건 중 ${job.archived ?? 0}건 보관${job.failed ? `, ${job.failed}건 실패` : ""}.` };
}

export async function startStorageDrRestore(): Promise<{ ok: boolean; message: string }> {
  const r = await invoke("restore");
  if (!r.ok) return { ok: false, message: "파일 복원을 시작하지 못했습니다." };
  const job = (r.data?.job as StorageDrJob) || {};
  return { ok: r.data?.ok === true, message: `파일 복원: 총 ${job.total ?? 0}건 중 ${job.archived ?? 0}건 복원${job.failed ? `, ${job.failed}건 실패` : ""}.` };
}
