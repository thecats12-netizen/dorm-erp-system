import { useMemo, useState } from "react";
import {
  safeParseBackup, adaptToCanonical, validateCanonical, verifyChecksum, checkMilitaryIntegrity,
  planRestore, MILITARY_KEYS, MILITARY_KEY_LABELS, MODULE_LABELS,
  type CanonicalBackup, type CanonicalModules, type Selection, type PolicyChoice, type RestorePlan, type RestoreTargetKey, type RestorePolicy,
} from "../../services/backupService";

type ExecResult = { ok: boolean; message: string };
type Props = {
  darkMode: boolean;
  isAdmin: boolean;
  currentTenantId: string;
  getCurrentModules: () => CanonicalModules;
  onExecuteRestore: (backup: CanonicalBackup, plan: RestorePlan, selection: Selection, policy: PolicyChoice) => Promise<ExecResult>;
  onToast?: (msg: string) => void;
};

type Step = "idle" | "inspect" | "select" | "plan" | "executing" | "result";
// P0 선택 복원 지원 모듈: 기숙사·운영·군대(8키). system/audit 복원은 P0 미지원(백업엔 포함되나 선택 복원 대상 아님).
const MODULE_KEYS: Array<"dorm" | "operational"> = ["dorm", "operational"];

export default function RestoreWizard({ darkMode, isAdmin, currentTenantId, getCurrentModules, onExecuteRestore, onToast }: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [backup, setBackup] = useState<CanonicalBackup | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [policy, setPolicy] = useState<PolicyChoice>({});
  const [result, setResult] = useState<ExecResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const btn = `inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm font-semibold ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`;
  const primary = "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

  const onFile = async (file: File | undefined) => {
    setFileErr(null); setResult(null);
    if (!file) return;
    const text = await file.text();
    const parsed = safeParseBackup(text);
    if (!parsed.ok) { setFileErr(parsed.error); setBackup(null); setStep("idle"); return; }
    const cb = adaptToCanonical(parsed.value);
    const val = validateCanonical(cb);
    if (val.errors.length) { setFileErr(val.errors.join(" / ")); setBackup(null); setStep("idle"); return; }
    setBackup(cb); setSelection({}); setPolicy({}); setStep("inspect");
  };

  const integrity = useMemo(() => (backup?.modules.military ? checkMilitaryIntegrity(backup.modules.military) : null), [backup]);
  const chk = useMemo(() => (backup ? verifyChecksum(backup) : { checked: false, ok: true }), [backup]);

  const plan: RestorePlan | null = useMemo(() => {
    if (!backup) return null;
    return planRestore(getCurrentModules(), backup, selection, policy);
    // getCurrentModules 는 렌더 시점 스냅샷(READ-ONLY, DB write 없음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backup, selection, policy]);

  const toggleSel = (k: RestoreTargetKey) => setSelection((s) => ({ ...s, [k]: !s[k] }));
  const setPol = (k: RestoreTargetKey, p: RestorePolicy) => setPolicy((s) => ({ ...s, [k]: p }));

  const anySelected = Object.values(selection).some(Boolean);
  // tenant 안전: 백업 tenantId 가 있고 현재와 다르면 불일치(차단). tenantId 없으면 legacy(단일 tenant 허용).
  const isLegacyNoTenant = !!backup && !backup.tenantId;
  const tenantMismatch = !!backup && !!backup.tenantId && backup.tenantId !== currentTenantId;

  // "선택 항목 복원" → 재확인 모달만 연다(실제 write 없음).
  const requestExecute = () => {
    if (!backup || !plan) return;
    if (tenantMismatch) { onToast?.("다른 조직의 백업 파일은 복원할 수 없습니다."); return; }
    if (plan.hasBlocking) { onToast?.("차단 항목이 있어 복원할 수 없습니다. 경고를 확인하세요."); return; }
    if (plan.willWriteTargets.length === 0) { onToast?.("복원(쓰기)할 항목이 없습니다."); return; }
    setConfirmOpen(true);
  };
  // 재확인 모달의 "복원 실행" → 실제 executor 호출. 취소 시 이 함수는 호출되지 않음(write 0).
  const runExecute = async () => {
    if (!backup || !plan) return;
    setConfirmOpen(false);
    setStep("executing");
    const r = await onExecuteRestore(backup, plan, selection, policy);
    setResult(r); setStep("result");
    onToast?.(r.message);
  };

  const reset = () => { setStep("idle"); setBackup(null); setSelection({}); setPolicy({}); setResult(null); setFileErr(null); setConfirmOpen(false); };

  if (!isAdmin) return (
    <section className={`rounded-3xl border p-5 ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
      <h3 className="text-base font-semibold">선택 복원</h3>
      <p className="mt-1 text-sm text-slate-400">관리자만 사용할 수 있습니다.</p>
    </section>
  );

  return (
    <section className={`rounded-3xl border p-5 ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
      <h3 className="mb-1 text-base font-semibold">백업 파일 검사 · 선택 복원</h3>
      <p className="mb-4 text-sm text-slate-500">파일을 선택해도 즉시 복원되지 않습니다. 검사 → 선택 → 미리보기(변경 없음) → 최종 확인 후에만 복원됩니다.</p>

      <div className="mb-3">
        <label className={btn}>백업 파일 선택
          <input type="file" accept=".json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        </label>
        {backup && <button type="button" className={`${btn} ml-2`} onClick={reset}>초기화</button>}
      </div>
      {fileErr && <div className="mb-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{fileErr}</div>}

      {backup && step !== "idle" && (
        <>
          {/* 검사 요약(READ-ONLY) */}
          <div className={`mb-3 rounded-2xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              <div>포맷: <b>{backup.sourceFormat}</b></div>
              <div>생성일: <b>{backup.generatedAt ? backup.generatedAt.slice(0, 19).replace("T", " ") : "알 수 없음"}</b></div>
              <div>schemaVersion: <b>{backup.schemaVersion}</b></div>
              <div>무결성: <b>{chk.checked ? (chk.ok ? "정상" : "불일치⚠") : "체크섬 없음"}</b></div>
              <div>tenant: <b>{backup.tenantId ?? "-"}</b></div>
            </div>
            <div className="mt-2">포함: {Object.entries(backup.recordCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "(없음)"}</div>
            <div className="mt-1 text-amber-600 dark:text-amber-400">백업되지 않음: {backup.completeness.excluded.join(" / ")}</div>
            {(backup.modules.system || backup.modules.audit) && (
              <div className="mt-1 text-slate-500">기본·설정 / 변경 이력(감사 로그): <b>백업 포함 · 현재 버전 복원 미지원</b></div>
            )}
            {tenantMismatch && (
              <div className="mt-1 font-semibold text-rose-600 dark:text-rose-400">⚠ 다른 조직의 백업 파일입니다(현재 tenant 와 불일치). 복원할 수 없습니다.</div>
            )}
            {isLegacyNoTenant && (
              <div className="mt-1 text-slate-500">이 파일은 tenant 정보가 없는 legacy 백업입니다(단일 조직 환경에서 복원 허용).</div>
            )}
            {integrity && (
              <div className={`mt-1 ${integrity.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                군대 무결성: {integrity.ok ? "정상" : `문제(중복인사 ${integrity.dupPersonnelId}, 중복훈련 ${integrity.dupTrainingId}, orphan ${integrity.orphanTraining}, 미지정 ${integrity.emptyPersonnelId})`}
              </div>
            )}
          </div>

          {/* 모듈/세부 선택 */}
          <div className="mb-3 space-y-2">
            <div className="text-sm font-semibold">복원할 항목 선택</div>
            {MODULE_KEYS.filter((k) => backup.modules[k]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!selection[k]} onChange={() => toggleSel(k)} />
                {MODULE_LABELS[k]}
              </label>
            ))}
            {backup.modules.military && (
              <div className="rounded-2xl border border-slate-200 p-2 dark:border-slate-700">
                <div className="mb-1 text-sm font-semibold">{MODULE_LABELS.military}(세부)</div>
                <div className="grid grid-cols-2 gap-1">
                  {MILITARY_KEYS.map((mk) => (
                    <label key={mk} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!selection[mk]} onChange={() => toggleSel(mk)} />
                      {MILITARY_KEY_LABELS[mk]}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Dry-run 미리보기(변경 없음) */}
          {anySelected && plan && (
            <div className={`mb-3 overflow-auto rounded-2xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <table className="w-full text-left text-xs">
                <thead className={darkMode ? "bg-slate-800" : "bg-slate-100"}>
                  <tr><th className="px-2 py-1">항목</th><th className="px-2 py-1">현재</th><th className="px-2 py-1">백업</th><th className="px-2 py-1">정책</th><th className="px-2 py-1">동작</th><th className="px-2 py-1">비고</th></tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.key} className={r.blocked ? "bg-rose-50 dark:bg-rose-950/30" : ""}>
                      <td className="px-2 py-1">{r.label}</td>
                      <td className="px-2 py-1">{r.currentCount}</td>
                      <td className="px-2 py-1">{r.backupCount}</td>
                      <td className="px-2 py-1">
                        {r.conflict ? (
                          <select value={r.chosenPolicy} onChange={(e) => setPol(r.key, e.target.value as RestorePolicy)} className={`rounded border px-1 ${darkMode ? "bg-slate-900 border-slate-600" : "bg-white border-slate-300"}`}>
                            <option value="SKIP">건너뛰기</option>
                            <option value="REPLACE">{r.key === "dorm" || r.key === "operational" ? "적용(추가·갱신)" : "덮어쓰기"}</option>
                            <option value="MERGE">병합</option>
                          </select>
                        ) : r.chosenPolicy}
                      </td>
                      <td className="px-2 py-1">{r.blocked ? "차단" : r.action === "skip" ? "건너뜀" : r.action === "restore-replace" ? ((r.key === "dorm" || r.key === "operational") ? "복원(적용·기존행 유지)" : "복원(교체)") : "복원(병합)"}</td>
                      <td className="px-2 py-1 text-amber-600 dark:text-amber-400">{r.warnings.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-2 py-1 text-[0.7rem] text-slate-400">※ 기숙사·운영 복원은 백업 데이터를 추가·갱신하며, 백업에 없는 기존 행은 삭제하지 않습니다(병합형). 군대 각 항목은 선택 항목 전체가 교체됩니다.</div>
            </div>
          )}

          {anySelected && plan && (
            <div className="flex items-center gap-2">
              <button type="button" className={primary} disabled={step === "executing" || plan.hasBlocking || tenantMismatch || plan.willWriteTargets.length === 0} onClick={requestExecute}>
                {step === "executing" ? "복원 중…" : `선택 항목 복원(${plan.willWriteTargets.length})`}
              </button>
              {plan.hasBlocking && <span className="text-xs text-rose-500">차단 항목이 있어 복원할 수 없습니다.</span>}
              {tenantMismatch && <span className="text-xs text-rose-500">다른 조직 백업이라 복원할 수 없습니다.</span>}
              <span className="text-xs text-slate-400">복원 전 현재 상태가 자동 스냅샷되며, 실패 시 되돌립니다.</span>
            </div>
          )}

          {/* 실제 복원 재확인 모달 — "복원 실행" 눌러야만 executor 호출(취소 시 write 0) */}
          {confirmOpen && plan && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
              <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
                <h4 className="mb-2 text-lg font-semibold">복원을 실행할까요?</h4>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-slate-500">
                  <li><b>실제 데이터가 변경됩니다.</b></li>
                  <li>선택한 항목만 복원됩니다({plan.willWriteTargets.length}개).</li>
                  <li>기숙사·운영은 기존 행을 삭제하지 않고 추가·갱신합니다.</li>
                  <li>복원 중에는 창을 닫거나 새로고침하지 마세요.</li>
                  <li>실행 전 현재 상태의 되돌림(rollback) 스냅샷을 생성합니다.</li>
                </ul>
                <div className="flex justify-end gap-2">
                  <button type="button" className={btn} onClick={() => setConfirmOpen(false)}>취소</button>
                  <button type="button" className={primary} onClick={() => void runExecute()}>복원 실행</button>
                </div>
              </div>
            </div>
          )}

          {step === "result" && result && (
            <div className={`mt-3 rounded-2xl border px-4 py-2 text-sm ${result.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"}`}>
              {result.message}
            </div>
          )}
        </>
      )}
    </section>
  );
}
