import { useState } from "react";
import {
  buildDrBackup, serializeDrBackup, P0_EXCLUDED, MODULE_LABELS, MILITARY_KEY_LABELS, MILITARY_KEYS,
  type DormModuleData, type OperationalModuleData, type MilitaryModuleData, type SystemModuleData, type AuditModuleData,
} from "../../services/backupService";

// DR(재해복구) 백업 생성 패널 — 관리자 전용. 포함/제외를 명확히 표시하고 PII 경고 후 다운로드.
// 라이브 데이터는 App 이 getLiveData 로 주입(백업서비스는 순수 함수).
type LiveData = {
  tenantId: string; appVersion?: string;
  dorm?: DormModuleData; operational?: OperationalModuleData; military?: MilitaryModuleData; system?: SystemModuleData; audit?: AuditModuleData;
};

type Props = {
  darkMode: boolean;
  isAdmin: boolean;
  getLiveData: () => LiveData;
  onToast?: (msg: string) => void;
};

export default function DrBackupPanel({ darkMode, isAdmin, getLiveData, onToast }: Props) {
  const [warnOpen, setWarnOpen] = useState(false);
  const card = darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50";
  const btn = `inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`;

  const doDownload = () => {
    try {
      const live = getLiveData();
      const cb = buildDrBackup(live);
      const json = serializeDrBackup(cb);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "").slice(0, 13);
      a.href = url; a.download = `hts-dr-backup-${stamp}.json`; a.click();
      URL.revokeObjectURL(url);
      const total = Object.values(cb.recordCounts).reduce((s, n) => s + n, 0);
      onToast?.(`재해복구 백업을 내려받았습니다(총 ${total.toLocaleString()}건). 안전한 곳에 보관하세요.`);
    } catch {
      onToast?.("재해복구 백업 생성 중 오류가 발생했습니다.");
    } finally {
      setWarnOpen(false);
    }
  };

  // 완전성 미리보기(건수만, PII 미노출)
  const preview = (() => {
    try { const cb = buildDrBackup(getLiveData()); return cb.recordCounts; } catch { return {}; }
  })();

  return (
    <section className={`rounded-3xl border p-5 ${card}`}>
      <h3 className={`mb-1 text-base font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>전체 재해복구 백업</h3>
      <p className="mb-4 text-sm text-slate-500">장애·데이터 소실 대비용. 운영 데이터와 개인정보가 포함됩니다(관리자 전용).</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-3 dark:border-emerald-800/50 dark:bg-emerald-950/30">
          <div className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ 백업됨</div>
          <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
            <li>{MODULE_LABELS.dorm}(기숙사/입주자/신입사원/계약)</li>
            <li>{MODULE_LABELS.operational}(청소/하자/비품/정산 · 사진 제외)</li>
            <li>{MODULE_LABELS.military}: {MILITARY_KEYS.map((k) => MILITARY_KEY_LABELS[k]).join(", ")}</li>
            <li>{MODULE_LABELS.system} · {MODULE_LABELS.audit}</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
          <div className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">! 백업되지 않음(현재 제외)</div>
          <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
            {P0_EXCLUDED.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      </div>

      {Object.keys(preview).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(preview).map(([k, v]) => (
            <span key={k} className={`rounded-full px-2 py-0.5 text-[0.7rem] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{k} {v as number}</span>
          ))}
        </div>
      )}

      <div className="mt-4">
        <button type="button" className={btn} disabled={!isAdmin} onClick={() => setWarnOpen(true)}>재해복구 백업 다운로드</button>
        {!isAdmin && <span className="ml-2 text-xs text-slate-400">관리자만 사용할 수 있습니다.</span>}
      </div>

      {warnOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setWarnOpen(false)}>
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-2 text-lg font-semibold">개인정보 포함 백업</h4>
            <p className="mb-1 text-sm text-slate-500">이 백업에는 <b>개인정보 및 운영 데이터</b>가 포함됩니다. 외부 유출 시 위험하므로 <b>안전한 장소</b>에만 보관하세요.</p>
            <p className="mb-5 text-xs text-slate-400">시험관리·사용자 계정/권한·첨부파일 원본은 포함되지 않습니다.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setWarnOpen(false)}>취소</button>
              <button type="button" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900" onClick={doDownload}>동의하고 다운로드</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
