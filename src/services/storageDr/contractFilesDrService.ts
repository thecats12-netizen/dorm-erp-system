// ============================================================================
// dorm_contract_files 메타데이터 DB DR 데이터셋(별도 · 바이너리 제외).
//  · 계약 첨부파일의 "연결 정보"(storage_path/file_name/mime/size/삭제상태)만 백업·복원한다.
//    실제 바이너리는 Storage DR 아카이브가 담당(JSON 에 바이너리 금지).
//  · tenant 강제: 복원 시 tenant_id 는 호출부가 준 tenantId 로 고정(payload 신뢰 안 함).
//  · 충돌 정책: INSERT-MISSING-ONLY — 기존 id 는 절대 덮어쓰지 않는다(무차별 DELETE 없음).
//  · 롤백: dorm_contract_files 에 DELETE 정책이 없으므로(실제 스키마 확인), 실패/검증실패 시
//    "이번에 삽입한 id"만 soft delete(deleted_at)로 되돌린다(기존 행 불변).
//  · 복원 순서 권장: (1) 이 메타 복원 → (2) Storage 바이너리 복원 → (3) reconciliation.
//    근거: 바이너리 복원 대상 경로(storage_path)는 메타행에서 나온다 → 메타가 먼저 있어야 함.
//  · DI: Supabase 클라이언트를 주입받는다(프런트=세션 클라이언트, 하네스=테스트 클라이언트).
// ============================================================================
import { collectIdsKeyset } from "../paginateIds";

const TABLE = "dorm_contract_files";

// supabase-js 의 최소 구조(버전/런타임 비의존). 체이닝 + await 가능한 쿼리 빌더.
export interface PgQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select(cols?: string): PgQuery;
  eq(col: string, val: unknown): PgQuery;
  gt(col: string, val: unknown): PgQuery;
  is(col: string, val: unknown): PgQuery;
  in(col: string, vals: unknown[]): PgQuery;
  order(col: string, opts: { ascending: boolean }): PgQuery;
  limit(n: number): PgQuery;
}
export type DbClientLike = {
  from(table: string): {
    select: (cols: string) => PgQuery;
    upsert: (rows: unknown[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => PgQuery;
    update: (patch: Record<string, unknown>) => PgQuery;
  };
};

export type ContractFileMeta = {
  id: string;
  tenant_id: string;
  organization_id: string | null;
  contract_id: string;
  storage_path: string;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string | null;
  deleted_at: string | null;
};

const SELECT_COLS = "id,tenant_id,organization_id,contract_id,storage_path,file_name,mime,size_bytes,uploaded_by,created_at,deleted_at";

// 백업: tenant 범위 전체(soft-deleted 포함 — 복구 이력 보존). keyset 완전 수집(fail-closed).
export async function readContractFilesBackup(client: DbClientLike, tenantId: string): Promise<ContractFileMeta[]> {
  if (!client) throw new Error("CONTRACT_FILES_DR_UNAVAILABLE");
  if (!tenantId) throw new Error("CONTRACT_FILES_DR_NO_TENANT");
  const rowsById = new Map<string, ContractFileMeta>();
  await collectIdsKeyset({
    pageSize: 1000, cap: 1_000_000,
    fetchAfter: async (afterId, limit) => {
      let q = client.from(TABLE).select(SELECT_COLS).eq("tenant_id", tenantId).order("id", { ascending: true }).limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error) throw new Error(`CONTRACT_FILES_DR_READ_FAILED: ${error.message}`);
      for (const r of (data || []) as ContractFileMeta[]) rowsById.set(r.id, r);
      return ((data || []) as ContractFileMeta[]).map((r) => r.id);
    },
  });
  return [...rowsById.values()];
}

// 복원 payload 정규화: 실제 존재 컬럼만, id/contract_id/storage_path 필수. 잘못된 행은 fail-closed.
export function buildContractFilesRestorePayload(rows: unknown[]): ContractFileMeta[] {
  if (!Array.isArray(rows)) throw new Error("CONTRACT_FILES_DR_INVALID_SHAPE");
  return rows.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const contract_id = String(r.contract_id ?? "").trim();
    const storage_path = String(r.storage_path ?? "").trim();
    if (!id || !contract_id || !storage_path) throw new Error(`CONTRACT_FILES_DR_MISSING_FIELD at index ${i}`);
    return {
      id, contract_id, storage_path,
      tenant_id: String(r.tenant_id ?? ""),
      organization_id: (r.organization_id as string) ?? null,
      file_name: (r.file_name as string) ?? null,
      mime: (r.mime as string) ?? null,
      size_bytes: typeof r.size_bytes === "number" ? r.size_bytes : (r.size_bytes == null ? null : Number(r.size_bytes) || null),
      uploaded_by: (r.uploaded_by as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      deleted_at: (r.deleted_at as string) ?? null,
    };
  });
}

export type ContractFilesPreflight = { ok: boolean; total: number; toInsert: number; existingSkip: number; issues: string[] };

// Dry-run: 실제 쓰기 없이 삽입/스킵 건수 산출.
export async function preflightContractFilesRestore(client: DbClientLike, tenantId: string, rows: ContractFileMeta[]): Promise<ContractFilesPreflight> {
  if (!client) return { ok: false, total: rows.length, toInsert: 0, existingSkip: 0, issues: ["저장소를 사용할 수 없습니다."] };
  if (!tenantId) return { ok: false, total: rows.length, toInsert: 0, existingSkip: 0, issues: ["테넌트 정보를 확인할 수 없습니다."] };
  const existing = new Set(await fetchExistingIds(client, tenantId));
  let toInsert = 0, existingSkip = 0;
  for (const r of rows) { if (existing.has(r.id)) existingSkip++; else toInsert++; }
  return { ok: true, total: rows.length, toInsert, existingSkip, issues: [] };
}

export type ContractFilesRestoreResult = { ok: boolean; inserted: number; skipped: number; rolledBack: number; message: string; insertedIds: string[] };

// 복원 실행: INSERT-MISSING-ONLY(tenant 강제). 삽입 후 post-verify 실패/예외 시 이번에 삽입한 id 만 soft delete 롤백.
export async function restoreContractFilesMeta(
  client: DbClientLike, tenantId: string, rows: ContractFileMeta[],
  opts: { postVerify?: (insertedIds: string[]) => Promise<boolean> } = {},
): Promise<ContractFilesRestoreResult> {
  if (!client) return { ok: false, inserted: 0, skipped: 0, rolledBack: 0, message: "저장소를 사용할 수 없습니다.", insertedIds: [] };
  if (!tenantId) return { ok: false, inserted: 0, skipped: 0, rolledBack: 0, message: "테넌트 정보를 확인할 수 없습니다.", insertedIds: [] };

  const existing = new Set(await fetchExistingIds(client, tenantId));
  const toInsert = rows.filter((r) => !existing.has(r.id)).map((r) => ({ ...r, tenant_id: tenantId, deleted_at: null })); // tenant 강제 · 복원은 활성
  const skipped = rows.length - toInsert.length;
  if (toInsert.length === 0) return { ok: true, inserted: 0, skipped, rolledBack: 0, message: "추가할 신규 항목이 없습니다(기존 유지).", insertedIds: [] };

  const insertedIds: string[] = [];
  try {
    const { data, error } = await client.from(TABLE).upsert(toInsert, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { id: string }[]) insertedIds.push(r.id);
    if (opts.postVerify) {
      const okv = await opts.postVerify(insertedIds);
      if (!okv) { const rb = await rollbackInserted(client, tenantId, insertedIds, existing); return { ok: false, inserted: 0, skipped, rolledBack: rb, message: `복원 후 검증에 실패하여 새로 추가된 ${rb}건을 되돌렸습니다.`, insertedIds: [] }; }
    }
    return { ok: true, inserted: insertedIds.length, skipped, rolledBack: 0, message: `${insertedIds.length}건을 복원했습니다.`, insertedIds };
  } catch (e) {
    const rollbackIds = insertedIds.length ? insertedIds : toInsert.map((r) => r.id);
    const rolledBack = await rollbackInserted(client, tenantId, rollbackIds, existing);
    return { ok: false, inserted: 0, skipped, rolledBack, message: `복원에 실패했습니다(${(e as Error).message}). 새로 추가된 ${rolledBack}건을 되돌렸습니다.`, insertedIds: [] };
  }
}

// 이번에 삽입된 행만 soft delete(기존 복원-전 행은 절대 건드리지 않음). DELETE 정책 부재 → 물리삭제 대신 deleted_at.
async function rollbackInserted(client: DbClientLike, tenantId: string, candidateIds: string[], preExisting: Set<string>): Promise<number> {
  if (candidateIds.length === 0) return 0;
  try {
    const nowExisting = new Set(await fetchActiveIds(client, tenantId));
    const target = candidateIds.filter((id) => nowExisting.has(id) && !preExisting.has(id));
    if (!target.length) return 0;
    const { error } = await client.from(TABLE).update({ deleted_at: new Date().toISOString() }).in("id", target).eq("tenant_id", tenantId);
    return error ? 0 : target.length;
  } catch { return 0; }
}

// 모든 id(soft-deleted 포함) — INSERT-MISSING 판정용(삭제된 id 도 "있음"으로 보아 재삽입하지 않음).
async function fetchExistingIds(client: DbClientLike, tenantId: string): Promise<string[]> {
  return pageIds(client, tenantId, false);
}
// 활성(미삭제) id — 롤백 대상 판정용.
async function fetchActiveIds(client: DbClientLike, tenantId: string): Promise<string[]> {
  return pageIds(client, tenantId, true);
}
async function pageIds(client: DbClientLike, tenantId: string, activeOnly: boolean): Promise<string[]> {
  return collectIdsKeyset({
    pageSize: 1000, cap: 1_000_000,
    fetchAfter: async (afterId, limit) => {
      let q = client.from(TABLE).select("id").eq("tenant_id", tenantId).order("id", { ascending: true }).limit(limit);
      if (activeOnly) q = q.is("deleted_at", null);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error) throw new Error(`CONTRACT_FILES_DR_IDS_FAILED: ${error.message}`);
      return ((data || []) as { id: string }[]).map((r) => r.id);
    },
  });
}
