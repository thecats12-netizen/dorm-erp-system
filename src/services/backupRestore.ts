// ============================================================================
// DR 선택 복원 orchestrator — 의존성 주입(DI) 순수 함수. App 과 테스트가 동일 알고리즘 사용.
//  · Supabase/React 를 직접 import 하지 않는다(모든 부수효과는 deps 로 주입) → mock 테스트 가능.
//  · 순서 보장: lock ON → snapshot → save → fetch(재조회) → integrity 검증 → hydration → (finally) lock OFF.
//  · 실패 시 rollback(스냅샷 재적용/재저장/재조회/hydration). rollback 까지 실패하면 "복구 확인 필요"(성공 표기 금지).
// ============================================================================
import { MILITARY_KEYS, DORM_DATASET_KEYS, OPERATIONAL_RESTORE_DATASET_KEYS, mergeById, type CanonicalBackup, type RestorePlan, type MilitaryModuleData, type DormModuleData, type OperationalModuleData } from "./backupService";

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
  // 기숙사/운영(세부 dataset 단위, upsert 기반). snapshot* 는 비선택 dataset 보존·롤백용 현재 상태.
  snapshotDorm?: () => DormModuleData;
  applyDormState: (d: DormModuleData) => void;
  saveDorm: (d: DormModuleData, userId: string) => Promise<void>;
  snapshotOperational?: () => OperationalModuleData;
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
  // dataset 단위 롤백용 현재 상태 스냅샷(복원 시작 전).
  const snapDorm = deps.snapshotDorm?.();
  const snapOp = deps.snapshotOperational?.();

  deps.setLock(true); L("lock:on");
  try {
    // 1) 군대 8키(선택 키만 교체/병합)
    const bm = backup.modules.military as unknown as Record<string, unknown> | undefined;
    const milRows = MILITARY_KEYS.filter((mk) => { const r = rowOf(mk); return r && !r.blocked && r.action !== "skip"; });
    if (bm && milRows.length) {
      const cur = deps.snapshotMilitary() as unknown as Record<string, unknown>;
      const next: Record<string, unknown> = { ...cur };            // in-memory 반영용(화면 state): 전체 키 유지
      // [비선택 불변식] 영속 payload 에는 "선택한 군대 키"만 담는다.
      //   saveMilitary(=단일 JSONB blob 을 DB 재조회 후 key-merge: {...기존DB, ...payload})가
      //   payload 에 없는 비선택 키를 "최신 DB 값" 그대로 보존 → 앱 메모리(하이드레이션 기본값)로 덮어쓰는 결함 차단.
      const savePayload: Record<string, unknown> = {};
      if (cur.tenantId !== undefined) savePayload.tenantId = cur.tenantId;
      for (const mk of milRows) {
        const r = rowOf(mk)!;
        let val: unknown;
        if (r.action === "restore-replace") val = bm[mk];
        else if (r.action === "restore-merge") { const merged = mergeById(cur[mk] as unknown[], bm[mk] as unknown[]); if (!merged) throw new Error(`${r.label} 병합 불가(ID 누락)`); val = merged; }
        else continue; // 알 수 없는 action 은 영속하지 않는다(안전)
        next[mk] = val; savePayload[mk] = val;
      }
      deps.applyMilitaryState(next as unknown as MilitaryModuleData); L("military:apply");
      await deps.saveMilitary(savePayload as unknown as MilitaryModuleData, uid); L("military:save");
    }
    // 2) 기숙사 — 세부 dataset 단위(선택한 dataset 만). 비선택 dataset: state=현재값 유지, 저장 payload=[](upsert no-op → DB 미변경).
    if (backup.modules.dorm && deps.snapshotDorm) {
      const touched = DORM_DATASET_KEYS.filter((ds) => { const r = rowOf(`dorm.${ds}`); return r && !r.blocked && r.action !== "skip"; });
      if (touched.length) {
        const cur = deps.snapshotDorm() as unknown as Record<string, unknown>;
        const bk = backup.modules.dorm as unknown as Record<string, unknown>;
        const nextState: Record<string, unknown> = { ...cur };           // 비선택 dataset = 현재값 보존
        const savePayload: Record<string, unknown> = { dorms: [], occupants: [], newHires: [], dormContracts: [] };
        for (const ds of touched) {
          const r = rowOf(`dorm.${ds}`)!;
          let val: unknown;
          if (r.action === "restore-replace") val = bk[ds];
          else { const merged = mergeById(cur[ds] as unknown[], bk[ds] as unknown[]); if (!merged) throw new Error(`${r.label} 병합 불가(ID 누락)`); val = merged; }
          nextState[ds] = val; savePayload[ds] = val;
        }
        // 불변식 가드: 비선택 dataset 은 nextState 가 현재값과 동일해야 한다.
        for (const ds of DORM_DATASET_KEYS) if (!touched.includes(ds) && nextState[ds] !== cur[ds]) throw new Error(`비선택 dataset(${ds}) 변경 감지 — 중단`);
        deps.applyDormState(nextState as unknown as DormModuleData); L("dorm:apply");
        await deps.saveDorm(savePayload as unknown as DormModuleData, uid); L("dorm:save");
      }
    }
    // 3) 운영 — 세부 dataset 단위(동일 방식).
    if (backup.modules.operational && deps.snapshotOperational) {
      const touched = OPERATIONAL_RESTORE_DATASET_KEYS.filter((ds) => { const r = rowOf(`operational.${ds}`); return r && !r.blocked && r.action !== "skip"; });
      if (touched.length) {
        const cur = deps.snapshotOperational() as unknown as Record<string, unknown>;
        const bk = backup.modules.operational as unknown as Record<string, unknown>;
        const nextState: Record<string, unknown> = { ...cur };
        const savePayload: Record<string, unknown> = { cleaningReports: [], defects: [], inventory: [], settlementRecords: [], settlementItems: [] };
        for (const ds of touched) {
          const r = rowOf(`operational.${ds}`)!;
          let val: unknown;
          if (r.action === "restore-replace") val = bk[ds];
          else { const merged = mergeById(cur[ds] as unknown[], bk[ds] as unknown[]); if (!merged) throw new Error(`${r.label} 병합 불가(ID 누락)`); val = merged; }
          nextState[ds] = val; savePayload[ds] = val;
        }
        for (const ds of OPERATIONAL_RESTORE_DATASET_KEYS) if (!touched.includes(ds) && nextState[ds] !== cur[ds]) throw new Error(`비선택 dataset(${ds}) 변경 감지 — 중단`);
        deps.applyOperationalState(nextState as unknown as OperationalModuleData); L("op:apply");
        await deps.saveOperational(savePayload as unknown as OperationalModuleData, uid); L("op:save");
      }
    }
    // 4) 재조회 → 무결성 → hydration
    const fetched = await deps.fetchMilitary(); L("fetch");
    if (!deps.verifyMilitary(fetched)) throw new Error("사후 무결성 검증 실패");
    L("verify");
    deps.hydrateMilitary(fetched); L("hydrate");
    return { ok: true, message: "선택한 항목을 복원했습니다. 최신 데이터로 동기화되었습니다.", steps };
  } catch (e) {
    const errMsg = (e as { message?: string })?.message || String(e);
    // rollback: 군대(원자 복원) + 기숙사/운영(선택했던 dataset 만 복원 전 값으로 재적용·재저장).
    //   ※ upsert 특성상 백업으로 "새로 INSERT 된 id"는 물리 삭제가 불가(기존 한계) → state/기존행은 원복, 신규 id 잔존 가능.
    try {
      deps.applyMilitaryState(snap); L("rollback:apply");
      // 롤백도 "복원에서 건드린 군대 키"만 복구 전(snap) 값으로 되돌린다. 비선택 키는 payload 에서 제외 → DB 그대로 보존.
      const milTouched = MILITARY_KEYS.filter((mk) => { const r = rowOf(mk); return r && !r.blocked && r.action !== "skip"; });
      if (milTouched.length) {
        const snapRec = snap as unknown as Record<string, unknown>;
        const rbPayload: Record<string, unknown> = {};
        if (snapRec.tenantId !== undefined) rbPayload.tenantId = snapRec.tenantId;
        for (const mk of milTouched) rbPayload[mk] = snapRec[mk];
        await deps.saveMilitary(rbPayload as unknown as MilitaryModuleData, uid); L("rollback:save");
      }
      // 기숙사 dataset 롤백
      if (snapDorm) {
        const touched = DORM_DATASET_KEYS.filter((ds) => { const r = rowOf(`dorm.${ds}`); return r && !r.blocked && r.action !== "skip"; });
        if (touched.length) {
          const cur = snapDorm as unknown as Record<string, unknown>;
          const payload: Record<string, unknown> = { dorms: [], occupants: [], newHires: [], dormContracts: [] };
          for (const ds of touched) payload[ds] = cur[ds];
          deps.applyDormState(snapDorm); L("rollback:dorm:apply");
          await deps.saveDorm(payload as unknown as DormModuleData, uid); L("rollback:dorm:save");
        }
      }
      // 운영 dataset 롤백
      if (snapOp) {
        const touched = OPERATIONAL_RESTORE_DATASET_KEYS.filter((ds) => { const r = rowOf(`operational.${ds}`); return r && !r.blocked && r.action !== "skip"; });
        if (touched.length) {
          const cur = snapOp as unknown as Record<string, unknown>;
          const payload: Record<string, unknown> = { cleaningReports: [], defects: [], inventory: [], settlementRecords: [], settlementItems: [] };
          for (const ds of touched) payload[ds] = cur[ds];
          deps.applyOperationalState(snapOp); L("rollback:op:apply");
          await deps.saveOperational(payload as unknown as OperationalModuleData, uid); L("rollback:op:save");
        }
      }
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
