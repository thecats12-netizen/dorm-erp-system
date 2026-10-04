import { useEffect, useMemo, useState } from "react";
import { EXAM_DR_DATASETS, preflightExamDependencies, type ExamBackup } from "../exam-management/services/examDrService";

// 시험관리 선택 복원 섹션(격리) — 서버 RPC(exam_dr_restore) 경계를 사용. 파일 로드/검사는 RestoreWizard 가 담당.
//  · 파일 선택·미리보기만으로 DB write 없음. 최종 확인 모달 후에만 onRestore(RPC) 실행.
//  · RPC 미가용(예: migration 미적용 환경)이면 fail-closed: 선택/실행 비활성 + 안내.
export type ExamRestoreExec = { ok: boolean; idempotent?: boolean; code?: string; message: string; postVerifyOk?: boolean; postVerifyIssues?: string[] };
type Props = {
  darkMode: boolean;
  examBackup: ExamBackup;                       // backup.modules.exam
  disabled?: boolean;                           // tenant mismatch 등 상위 차단
  probeAvailable: () => Promise<boolean>;       // 서버 RPC 가용성
  getDbPresentTables: () => Promise<string[]>;  // 현재 DB 에 행이 있는 exam 테이블(dependency 충족 판단)
  onRestore: (datasetKeys: string[], examBackup: ExamBackup) => Promise<ExamRestoreExec>;
  onToast?: (m: string) => void;
};

export default function ExamRestoreSection({ darkMode, examBackup, disabled, probeAvailable, getDbPresentTables, onRestore, onToast }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [dbPresent, setDbPresent] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExamRestoreExec | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try { const a = await probeAvailable(); if (alive) setAvailable(a); } catch { if (alive) setAvailable(false); }
      try { const t = await getDbPresentTables(); if (alive) setDbPresent(new Set(t)); } catch { /* 무시(미충족으로 간주) */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dataset 별 백업 건수(테이블 합).
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of EXAM_DR_DATASETS) c[d.key] = d.tables.reduce((s, t) => s + (examBackup[t]?.length ?? 0), 0);
    return c;
  }, [examBackup]);

  const selectedKeys = EXAM_DR_DATASETS.filter((d) => sel[d.key]).map((d) => d.key);
  const preflight = useMemo(() => preflightExamDependencies(selectedKeys, examBackup, dbPresent), [selectedKeys, examBackup, dbPresent]);
  const blocked = !!disabled || available === false;
  const canRun = !blocked && selectedKeys.length > 0 && preflight.ok && !running;

  const card = darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white";
  const primary = "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

  const run = async () => {
    setConfirmOpen(false); setRunning(true); setResult(null);
    try {
      const r = await onRestore(selectedKeys, examBackup);
      setResult(r);
      onToast?.(r.message + (r.ok && r.postVerifyOk === false ? " (사후 검증 실패)" : ""));
    } finally { setRunning(false); }
  };

  const depMsg = (() => {
    if (preflight.ok) return null;
    const parents = new Set(preflight.missing.map((m) => m.missingParent));
    const need: string[] = [];
    if ([...parents].some((p) => ["exam_lines","exam_categories","exam_groups","exam_levels","exam_parts","exam_processes","exam_equipment"].includes(p))) need.push("기준정보");
    if (parents.has("exam_personnel")) need.push("인원");
    if ([...parents].some((p) => ["exam_rules","exam_annual_targets","exam_equipment_stage_rules"].includes(p))) need.push("규칙/대상");
    if ([...parents].some((p) => ["exam_sessions","exam_applications"].includes(p))) need.push("신청/결과");
    return `선택한 항목 복원에 필요한 ${[...new Set(need)].join(" / ") || "선행"} 데이터가 현재 DB에도 없고 선택 백업에도 없습니다.`;
  })();

  return (
    <div className={`mt-4 rounded-2xl border p-3 ${card}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">시험관리 선택 복원
        {available === false && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">· 서버 복구 기능이 준비되지 않았습니다</span>}
        {available === null && <span className="text-xs font-normal text-slate-400">· 확인 중…</span>}
      </div>
      <div className="space-y-1">
        {EXAM_DR_DATASETS.map((d) => (
          <label key={d.key} className={`flex items-center gap-2 text-sm ${blocked ? "opacity-50" : ""}`}>
            <input type="checkbox" disabled={blocked} checked={!!sel[d.key]} onChange={() => setSel((s) => ({ ...s, [d.key]: !s[d.key] }))} />
            <span>{d.label}</span>
            <span className="text-xs text-slate-400">{counts[d.key] ?? 0}건</span>
          </label>
        ))}
      </div>
      <div className="mt-1 text-[0.7rem] text-slate-400">정책: 적용(추가·갱신) — 기존 시험 데이터를 삭제하지 않고 백업값으로 추가·갱신합니다.</div>
      {depMsg && <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{depMsg}</div>}
      {result && (
        <div className={`mt-2 rounded-xl border px-3 py-1.5 text-xs ${result.ok && result.postVerifyOk !== false ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"}`}>
          {result.message}{result.ok && result.postVerifyOk === false ? " — 사후 데이터 검증에 실패했습니다(로그 확인 필요)." : ""}
        </div>
      )}
      <div className="mt-3">
        <button type="button" className={primary} disabled={!canRun} onClick={() => setConfirmOpen(true)}>{running ? "복원 중…" : "시험관리 복원"}</button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-2 text-lg font-semibold">시험관리 선택 항목을 복원합니다</h4>
            <ul className="mb-4 space-y-0.5 text-sm text-slate-500">
              {selectedKeys.map((k) => { const d = EXAM_DR_DATASETS.find((x) => x.key === k)!; return <li key={k}>{d.label} — {counts[k] ?? 0}건 적용(추가·갱신)</li>; })}
            </ul>
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
