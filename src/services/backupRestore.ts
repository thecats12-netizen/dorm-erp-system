// ============================================================================
// DR 선택 복원 orchestrator — 의존성 주입(DI) 순수 함수. App 과 테스트가 동일 알고리즘 사용.
//  · Supabase/React 를 직접 import 하지 않는다(모든 부수효과는 deps 로 주입) → mock 테스트 가능.
//  · 순서 보장: lock ON → snapshot → save → fetch(재조회) → integrity 검증 → hydration → (finally) lock OFF.
//  · 실패 시 rollback(스냅샷 재적용/재저장/재조회/hydration). rollback 까지 실패하면 "복구 확인 필요"(성공 표기 금지).
// ============================================================================
import { MILITARY_KEYS, mergeById, type CanonicalBackup, type RestorePlan, type MilitaryModuleData, type DormModuleData, type OperationalModuleData } from "./backupService";

export type RestoreDeps = {
  isAdmin: () => boolean;
  getUserId: () => Promise<string | null>;
  currentTenantId?: string; // 현재 앱 tenant. backup.tenantId 와 불일치 시 write 전 차단(legacy=null 은 허용).
  setLock: (v: boolean) => void;
  // 군대
  snapshotMilitary: () => MilitaryModuleData;      // 현재 상태(롤백 원본)
  applyMilitaryState: (m: MilitaryModuleData) => void;
  saveMilitary: (m: MilitaryModuleData, userId: string) => Promise<void>;
  fetchMilitary: () => Promise<MilitaryModuleData>; // DB 재조회(raw). 실패 시 throw.
  verifyMilitary: (m: MilitaryModuleData) => boolean; // 사후 무결성(false → 검증 실패)
  hydrateMilitary: (m: MilitaryModuleData) => void;  // state 반영(+status ready). 실패 시 throw.
  // 기숙사/운영(모듈 REPLACE, upsert 기반)
  applyDormState: (d: DormModuleData) => void;
  saveDorm: (d: DormModuleData, userId: string) => Promise<void>;
  applyOperationalState: (o: OperationalModuleData) => void;
  saveOperational: (o: OperationalModuleData, userId: string) => Promise<void>;
  log?: (event: string) => void;
};

export type RestoreOutcome = { ok: boolean; message: string; steps: string[]; rolledBack?: boolean; rollbackFailed?: boolean };

export async function runDrRestore(deps: RestoreDeps, backup: CanonicalBackup, plan: RestorePlan): Promise<RestoreOutcome> {
  const steps: string[] = [];
  const L = (e: string) => { steps.push(e); deps.log?.(e); };
  if (!deps.isAdmin()) return { ok: false, message: "관리자만 복원할 수 있습니다.", steps };
  const uid = await deps.getUserId();
  if (!uid) return { ok: false, message: "로그인 세션이 없어 복원할 수 없습니다.", steps };
  if (plan.hasBlocking) return { ok: false, message: "차단 항목이 있어 복원을 중단했습니다.", steps };
  if (plan.willWriteTargets.length === 0) return { ok: false, message: "복원(쓰기)할 항목이 없습니다.", steps };
  // tenant 안전 가드: 백업 tenantId 가 있고 현재 tenant 와 다르면 write 전 차단. legacy(tenantId 없음)는 단일 tenant 구조상 허용.
  if (backup.tenantId && deps.currentTenantId && backup.tenantId !== deps.currentTenantId) {
    return { ok: false, message: "다른 조직의 백업 파일은 복원할 수 없습니다.", steps };
  }

  const rowOf = (k: string) => plan.rows.find((r) => r.key === k);
  const snap = deps.snapshotMilitary();

  deps.setLock(true); L("lock:on");
  try {
    // 1) 군대 8키(선택 키만 교체/병합)
    const bm = backup.modules.military as unknown as Record<string, unknown> | undefined;
    const milRows = MILITARY_KEYS.filter((mk) => { const r = rowOf(mk); return r && !r.blocked && r.action !== "skip"; });
    if (bm && milRows.length) {
      const cur = deps.snapshotMilitary() as unknown as Record<string, unknown>;
      const next: Record<string, unknown> = { ...cur };
      for (const mk of milRows) {
        const r = rowOf(mk)!;
        if (r.action === "restore-replace") next[mk] = bm[mk];
        else if (r.action === "restore-merge") { const merged = mergeById(cur[mk] as unknown[], bm[mk] as unknown[]); if (!merged) throw new Error(`${r.label} 병합 불가(ID 누락)`); next[mk] = merged; }
      }
      deps.applyMilitaryState(next as unknown as MilitaryModuleData); L("military:apply");
      await deps.saveMilitary(next as unknown as MilitaryModuleData, uid); L("military:save");
    }
    // 2) 기숙사(모듈 REPLACE · upsert)
    const dr = rowOf("dorm");
    if (dr && !dr.blocked && dr.action === "restore-replace" && backup.modules.dorm) {
      deps.applyDormState(backup.modules.dorm); L("dorm:apply");
      await deps.saveDorm(backup.modules.dorm, uid); L("dorm:save");
    }
    // 3) 운영(모듈 REPLACE · upsert)
    const op = rowOf("operational");
    if (op && !op.blocked && op.action === "restore-replace" && backup.modules.operational) {
      deps.applyOperationalState(backup.modules.operational); L("op:apply");
      await deps.saveOperational(backup.modules.operational, uid); L("op:save");
    }
    // 4) 재조회 → 무결성 → hydration
    const fetched = await deps.fetchMilitary(); L("fetch");
    if (!deps.verifyMilitary(fetched)) throw new Error("사후 무결성 검증 실패");
    L("verify");
    deps.hydrateMilitary(fetched); L("hydrate");
    return { ok: true, message: "선택한 항목을 복원했습니다. 최신 데이터로 동기화되었습니다.", steps };
  } catch (e) {
    const errMsg = (e as { message?: string })?.message || String(e);
    // rollback(군대 원자 복원). dorm/op 는 upsert 특성상 자동 원복 불가 → 메시지로 안내.
    try {
      deps.applyMilitaryState(snap); L("rollback:apply");
      await deps.saveMilitary(snap, uid); L("rollback:save");
      const rf = await deps.fetchMilitary(); L("rollback:fetch");
      deps.hydrateMilitary(rf); L("rollback:hydrate");
      return { ok: false, message: `복원 실패로 롤백했습니다: ${errMsg}`, steps, rolledBack: true };
    } catch (re) {
      const rmsg = (re as { message?: string })?.message || String(re);
      return { ok: false, message: `복원 실패 + 롤백 실패 — 데이터 복구 확인이 필요합니다: ${errMsg} / rollback: ${rmsg}`, steps, rolledBack: false, rollbackFailed: true };
    }
  } finally {
    deps.setLock(false); L("lock:off");
  }
}
