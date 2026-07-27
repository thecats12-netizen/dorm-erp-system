// PM 후보 생성(배치 · 조회+생성 전용) — 관리자만. Single~M4 엔진 충족 직원을 pm_certifications
//  approval_status='대기'(후보)로 생성. 승인/취득/강등 없음. 생성된 후보는 기존 PM 인증관리에서 승인.
import { useEffect, useState } from "react";
import { loadMyExamPermissions } from "../services/examPermissionService";
import { generatePmCandidates, type PmCandidateResult } from "../services/pmCandidateService";

type Props = { darkMode: boolean; tenantId: string; userId: string; onToast?: (m: string) => void };

export default function PmCandidateGeneratorPage({ darkMode, tenantId, userId, onToast }: Props) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [permLoaded, setPermLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PmCandidateResult | null>(null);
  const [ranAt, setRanAt] = useState<string>("");

  useEffect(() => { let alive = true; loadMyExamPermissions(tenantId).then((pm) => { if (alive) { setIsAdmin(!!pm.isAdmin); setPermLoaded(true); } }).catch(() => { if (alive) setPermLoaded(true); }); return () => { alive = false; }; }, [tenantId]);

  const run = async () => {
    if (!isAdmin || running) return;
    setRunning(true);
    try {
      const r = await generatePmCandidates(tenantId, userId);
      setResult(r); setRanAt(new Date().toLocaleString("ko-KR"));
      onToast?.(r.created > 0 ? `PM 후보 ${r.created}건을 생성했습니다(승인 대기).` : "생성할 신규 PM 후보가 없습니다.");
    } catch { setResult({ created: 0, existing: 0, ineligible: 0, reevalExcluded: 0, confirmedHeld: 0, errors: 1, message: "실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }); }
    finally { setRunning(false); }
  };

  const card = darkMode ? "rounded-2xl border border-slate-700 bg-slate-800/40 p-4" : "rounded-2xl border border-slate-200 bg-white p-4";
  const tiles: { label: string; value: number; cls: string }[] = result ? [
    { label: "생성", value: result.created, cls: "text-emerald-600" },
    { label: "이미 존재", value: result.existing, cls: "text-slate-500" },
    { label: "조건 미충족", value: result.ineligible, cls: "text-slate-500" },
    { label: "재평가 제외", value: result.reevalExcluded, cls: "text-slate-500" },
    { label: "확정 보유", value: result.confirmedHeld, cls: "text-slate-500" },
    { label: "오류", value: result.errors, cls: result.errors ? "text-rose-600" : "text-slate-400" },
  ] : [];

  return (
    <div>
      <div className={`${card} mb-4`}>
        <h3 className="mb-1 text-base font-semibold">PM 후보 생성</h3>
        <p className="text-sm text-slate-500">Single~M4 엔진 결과로 최고 단계(M4)까지 충족한 직원을 <b>PM 후보(승인 대기)</b>로 생성합니다. 승인·취득·강등은 하지 않으며, 생성된 후보는 <b>PM 인증관리</b>에서 관리자가 승인합니다.</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">
          <li>승인 설비만 인정 · 재평가 필요 직원 제외 · PM 미보유 · 기존 대기 후보 없을 때만 생성</li>
          <li>중복 방지: 동일 tenant·직원·공정·단계에 대기 후보가 있으면 생성하지 않음</li>
        </ul>
        <div className="mt-4 flex items-center gap-3">
          {permLoaded && isAdmin ? (
            <button disabled={running} onClick={() => void run()}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${running ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500"}`}>
              {running ? "생성 중…" : "PM 후보 생성"}
            </button>
          ) : permLoaded ? (
            <span className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">관리자만 실행할 수 있습니다(조회 전용).</span>
          ) : (
            <span className="text-xs text-slate-400">권한 확인 중…</span>
          )}
          {ranAt && <span className="text-xs text-slate-400">최근 실행 {ranAt}</span>}
        </div>
      </div>

      {result && (
        <div className={card}>
          <div className="mb-2 text-sm font-medium">실행 결과</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.label} className={`rounded-xl border p-3 text-center ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div className={`text-2xl font-bold ${t.cls}`}>{t.value}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">{result.message}</p>
        </div>
      )}
    </div>
  );
}
