// 단계 기준 정합성 검사 — 미리보기/감사 전용 모달(조회만 · 저장/적용 버튼 없음).
//  설비별 인증단계 기준으로 계산한 "예상 required_equipment_ids/선행단계"를 현재 공정별 달성기준과 비교 표시.
//  ⚠ UUID 비노출(장비명/코드). DB 수정 없음.
import { useEffect, useMemo, useState } from "react";
import { runCriteriaAudit } from "../services/certificationCriteriaAuditService";
import type { AuditStatus, CriteriaAuditRow } from "../types/criteriaAudit";

type Props = { darkMode: boolean; tenantId: string; onClose: () => void };

const STATUS_TONE: Record<AuditStatus, string> = {
  "정상": "bg-emerald-100 text-emerald-700",
  "미등록": "bg-slate-200 text-slate-600",
  "필수설비 누락": "bg-rose-100 text-rose-700",
  "불필요 설비 포함": "bg-amber-100 text-amber-700",
  "선행단계 오류": "bg-rose-100 text-rose-700",
  "min_equipment_count 사용 위험": "bg-orange-100 text-orange-700",
  "criteria 중복": "bg-purple-100 text-purple-700",
  "단계 설비 미등록": "bg-slate-300 text-slate-700",
  "정책확인필요": "bg-yellow-100 text-yellow-700",
};

export default function CriteriaAuditModal({ darkMode, tenantId, onClose }: Props) {
  const [rows, setRows] = useState<CriteriaAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fGroup, setFGroup] = useState(""); const [fCat, setFCat] = useState(""); const [fProc, setFProc] = useState("");
  const [fStage, setFStage] = useState(""); const [fStatus, setFStatus] = useState("");
  const [sel, setSel] = useState<CriteriaAuditRow | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try { const r = await runCriteriaAudit(tenantId); if (!alive) return; if (!r.ok) setError(r.message ?? "불러오지 못했습니다."); setRows(r.rows); }
      catch (e) { if (alive) setError((e as { message?: string })?.message || "오류가 발생했습니다."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  const opts = (key: keyof CriteriaAuditRow) => Array.from(new Set(rows.map((r) => String(r[key])))).filter(Boolean).sort();
  const filtered = useMemo(() => rows.filter((r) =>
    (!fGroup || r.groupName === fGroup) && (!fCat || r.categoryName === fCat) && (!fProc || r.processName === fProc) &&
    (!fStage || r.stageName === fStage) && (!fStatus || r.status === fStatus)
  ), [rows, fGroup, fCat, fProc, fStage, fStatus]);

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const inp = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-xs outline-none" : "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none";
  const th = "whitespace-nowrap px-2.5 py-2 text-left font-medium";
  const td = "whitespace-nowrap px-2.5 py-2";
  const names = (arr: { name: string }[]) => arr.length ? arr.map((x) => x.name).join(", ") : "-";
  const badge = (s: AuditStatus) => <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${STATUS_TONE[s]}`}>{s}</span>;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-6 w-full max-w-6xl rounded-3xl p-5 shadow-xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">단계 기준 정합성 검사</h3>
            <p className="text-xs text-slate-500">설비별 인증단계 → 예상 필수설비/선행단계를 현재 공정별 달성기준과 비교합니다. (조회 전용 · 저장/적용 없음 · 장비명 표시)</p>
          </div>
          <button className={inp} onClick={onClose}>닫기</button>
        </div>

        {/* 요약 */}
        {!loading && !error && (
          <div className="mb-3 flex flex-wrap gap-1.5">{summary.map(([s, n]) => <span key={s} className="flex items-center gap-1">{badge(s as AuditStatus)}<span className="text-xs text-slate-500">{n}</span></span>)}</div>
        )}

        {/* 필터 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} className={inp}><option value="">그룹: 전체</option>{opts("groupName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fCat} onChange={(e) => setFCat(e.target.value)} className={inp}><option value="">제품군: 전체</option>{opts("categoryName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fProc} onChange={(e) => setFProc(e.target.value)} className={inp}><option value="">공정: 전체</option>{opts("processName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fStage} onChange={(e) => setFStage(e.target.value)} className={inp}><option value="">단계: 전체</option>{opts("stageName").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inp}><option value="">상태: 전체</option>{opts("status").map((v) => <option key={v} value={v}>{v}</option>)}</select>
          <span className="text-xs text-slate-400">총 {filtered.length}건</span>
        </div>

        {error && <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>}
        {loading ? <div className="py-10 text-center text-sm text-slate-500">검사 중…</div> : (
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
                  <tr>{["그룹", "제품군", "공정", "단계", "단계설비", "현재", "예상", "현재선행", "예상선행", "상태"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.key} className={`cursor-pointer border-t ${darkMode ? "border-slate-700 hover:bg-slate-800/50" : "border-slate-100 hover:bg-slate-50"} ${sel?.key === r.key ? (darkMode ? "bg-slate-800" : "bg-blue-50") : ""}`} onClick={() => setSel(r)}>
                      <td className={td}>{r.groupName}</td><td className={td}>{r.categoryName}</td><td className={td}>{r.processName}</td>
                      <td className={td}>{r.stageName}</td>
                      <td className={`${td} text-center`}>{r.stageEquip.length}{r.isSingle && r.stageEquip.length >= 2 ? " (OR)" : ""}</td>
                      <td className={`${td} text-center`}>{r.currentExists ? r.currentRequired.length : "-"}</td>
                      <td className={`${td} text-center`}>{r.expectedEquip.length}</td>
                      <td className={td}>{names(r.currentPrereqNames.map((n) => ({ name: n })))}</td>
                      <td className={td}>{names(r.expectedPrereqNames.map((n) => ({ name: n })))}</td>
                      <td className={td}>{badge(r.status)}</td>
                    </tr>
                  ))}
                  {!filtered.length && <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">해당 조건의 항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* 상세 */}
            <div className={`max-h-[56vh] overflow-auto rounded-xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"}`}>
              {!sel ? <p className="text-slate-500">행을 선택하면 현재/예상 기준과 차이를 표시합니다.</p> : (
                <div className="space-y-2">
                  <div className="font-semibold">{sel.processName} · {sel.stageName} {badge(sel.status)}</div>
                  <div><div className="text-slate-500">단계 설비(설비별 인증단계)</div><div>{names(sel.stageEquip)}</div></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="text-slate-500">현재 필수설비</div><div>{sel.currentExists ? names(sel.currentRequired) : "미등록"}</div></div>
                    <div><div className="text-slate-500">예상 필수설비</div><div>{sel.isSingle && sel.singleNeedsGroups ? `아무 1개(OR): ${names(sel.expectedEquip)}` : names(sel.expectedEquip)}</div></div>
                    <div><div className="text-slate-500">현재 선행단계</div><div>{names(sel.currentPrereqNames.map((n) => ({ name: n })))}</div></div>
                    <div><div className="text-slate-500">예상 선행단계</div><div>{names(sel.expectedPrereqNames.map((n) => ({ name: n })))}</div></div>
                    <div><div className="text-slate-500">min_equipment_count</div><div>{sel.currentMinEquipmentCount ?? "-"}</div></div>
                    <div><div className="text-slate-500">criteria 행 수</div><div>{sel.currentRowCount}</div></div>
                  </div>
                  {sel.missing.length > 0 && <div className="text-rose-600">+ 추가 필요: {names(sel.missing)}</div>}
                  {sel.extra.length > 0 && <div className="text-amber-600">− 제거 검토: {names(sel.extra)}</div>}
                  {sel.flags.length > 0 && <div><div className="text-slate-500">감지</div><div className="flex flex-wrap gap-1">{sel.flags.map((f) => badge(f))}</div></div>}
                  {sel.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-slate-500">{sel.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                  <p className="pt-1 text-[0.65rem] text-slate-400">※ 미리보기 전용 — 자동 저장/적용하지 않습니다. 실제 반영은 공정별 달성기준 화면에서 수동 등록/수정하세요.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
