import { useEffect, useMemo, useState } from "react";
import { RBAC_DR_DATASETS, preflightRbacDependencies, type RbacBackup } from "../role-management/rbacDrService";

// 사용자·권한 선택 복원 섹션(격리) — 서버 RPC(rbac_dr_restore) 경계 사용.
//  · 비밀번호/로그인 인증정보는 백업/복원하지 않음. 기존 관리자 권한은 복원 파일로 덮어쓰지 않음(서버 강제).
export type RbacRestoreExec = { ok: boolean; idempotent?: boolean; code?: string; message: string; postVerifyOk?: boolean; postVerifyIssues?: string[] };
type Props = {
  darkMode: boolean;
  rbacBackup: RbacBackup;
  disabled?: boolean;
  probeAvailable: () => Promise<boolean>;
  getDbPresentTables: () => Promise<string[]>;
  onRestore: (datasetKeys: string[], rbacBackup: RbacBackup) => Promise<RbacRestoreExec>;
  onToast?: (m: string) => void;
};

export default function RbacRestoreSection({ darkMode, rbacBackup, disabled, probeAvailable, getDbPresentTables, onRestore, onToast }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [dbPresent, setDbPresent] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RbacRestoreExec | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try { const a = await probeAvailable(); if (alive) setAvailable(a); } catch { if (alive) setAvailable(false); }
      try { const t = await getDbPresentTables(); if (alive) setDbPresent(new Set(t)); } catch { /* 미충족 간주 */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of RBAC_DR_DATASETS) c[d.key] = d.tables.reduce((s, t) => s + (rbacBackup[t]?.length ?? 0), 0);
    return c;
  }, [rbacBackup]);

  const selectedKeys = RBAC_DR_DATASETS.filter((d) => sel[d.key]).map((d) => d.key);
  const preflight = useMemo(() => preflightRbacDependencies(selectedKeys, rbacBackup, dbPresent), [selectedKeys, rbacBackup, dbPresent]);
  const blocked = !!disabled || available === false;
  const canRun = !blocked && selectedKeys.length > 0 && preflight.ok && !running;

  const card = darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white";
  const primary = "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

  const run = async () => {
    setConfirmOpen(false); setRunning(true); setResult(null);
    try {
      const r = await onRestore(selectedKeys, rbacBackup);
      setResult(r);
      onToast?.(r.message + (r.ok && r.postVerifyOk === false ? " (사후 검증 실패)" : ""));
    } finally { setRunning(false); }
  };

  const depMsg = preflight.ok ? null : "선택한 항목 복원에 필요한 '사용자 정의 역할' 데이터가 현재 DB에도 없고 선택 백업에도 없습니다.";

  return (
    <div className={`mt-4 rounded-2xl border p-3 ${card}`}>
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">사용자·권한 선택 복원
        {available === false && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">· 서버 복구 기능이 준비되지 않았습니다</span>}
        {available === null && <span className="text-xs font-normal text-slate-400">· 확인 중…</span>}
      </div>
      <div className="mb-2 text-[0.7rem] text-slate-400">사용자 계정 비밀번호·로그인 인증정보는 백업/복원되지 않습니다. 기존 관리자 계정의 권한은 복원 파일로 덮어쓰지 않습니다.</div>
      <div className="space-y-1">
        {RBAC_DR_DATASETS.map((d) => (
          <label key={d.key} className={`flex items-center gap-2 text-sm ${blocked ? "opacity-50" : ""}`}>
            <input type="checkbox" disabled={blocked} checked={!!sel[d.key]} onChange={() => setSel((s) => ({ ...s, [d.key]: !s[d.key] }))} />
            <span>{d.label}</span>
            <span className="text-xs text-slate-400">{counts[d.key] ?? 0}건</span>
          </label>
        ))}
      </div>
      <div className="mt-1 text-[0.7rem] text-slate-400">정책: 역할·권한·배정=적용(추가·갱신) · 프로필=누락분만 추가(기존 미변경).</div>
      {depMsg && <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{depMsg}</div>}
      {result && (
        <div className={`mt-2 rounded-xl border px-3 py-1.5 text-xs ${result.ok && result.postVerifyOk !== false ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"}`}>
          {result.message}{result.ok && result.postVerifyOk === false ? " — 사후 데이터 검증에 실패했습니다(로그 확인 필요)." : ""}
        </div>
      )}
      <div className="mt-3">
        <button type="button" className={primary} disabled={!canRun} onClick={() => setConfirmOpen(true)}>{running ? "복원 중…" : "사용자·권한 복원"}</button>
      </div>
      {confirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-2 text-lg font-semibold">사용자·권한 선택 항목을 복원합니다</h4>
            <ul className="mb-2 space-y-0.5 text-sm text-slate-500">
              {selectedKeys.map((k) => { const d = RBAC_DR_DATASETS.find((x) => x.key === k)!; return <li key={k}>{d.label} — {counts[k] ?? 0}건</li>; })}
            </ul>
            <p className="mb-4 text-xs text-slate-400">기존 관리자 권한은 변경되지 않으며, 없는 사용자에게 권한이 부여되지 않습니다.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-2xl border px-3 py-1.5 text-sm" onClick={() => setConfirmOpen(false)}>취소</button>
              <button type="button" className={primary} onClick={() => void run()}>복원 실행</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
