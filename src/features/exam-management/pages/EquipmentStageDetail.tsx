// 설비 단계 상세(표시 전용) — 선택된 직원/단계의 설비 목록. 계산/DB 없음(패널이 만든 rows 를 렌더만).
//  · 상태: 취득(초록 약) / 미취득(회색) / 만료(기존 상태색). 주력 = stage rule is_core_equipment.
//  · PC=테이블, 모바일=세로 카드(억지 압축 없음).
export type EquipmentDetailRow = {
  equipmentId: string;
  name: string;
  acquired: boolean;
  acquiredDate: string;   // "-" 가능
  expiryDate: string;     // "-" 가능
  core: boolean;
};

const today = new Date().toISOString().slice(0, 10);
const isExpired = (r: EquipmentDetailRow) => r.acquired && r.expiryDate !== "-" && r.expiryDate < today;

export default function EquipmentStageDetail({ darkMode, stageLabel, rows }: { darkMode: boolean; stageLabel: string; rows: EquipmentDetailRow[] }) {
  if (rows.length === 0) {
    return <div className={`rounded-xl border px-3 py-4 text-xs text-slate-500 ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}>대상 설비가 없습니다.</div>;
  }
  const statusBadge = (r: EquipmentDetailRow) => {
    const exp = isExpired(r);
    const cls = exp ? "bg-rose-100 text-rose-700" : r.acquired ? "bg-emerald-50 text-emerald-700" : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-500");
    return <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${cls}`}>{exp ? "만료" : r.acquired ? "취득" : "미취득"}</span>;
  };
  const coreBadge = (core: boolean) => core
    ? <span className={`rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${darkMode ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700"}`}>주력</span>
    : <span className="text-slate-400">-</span>;
  const acquiredCount = rows.filter((r) => r.acquired).length;

  return (
    <div className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}>
      <div className="mb-2 text-xs font-semibold text-slate-500">{stageLabel} 설비 상세 <span className="font-normal text-slate-400">({acquiredCount}/{rows.length} 취득)</span></div>

      {/* PC: 테이블 */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-xs">
          <thead className={darkMode ? "text-slate-400" : "text-slate-500"}>
            <tr>{["설비명", "상태", "취득일", "만료일", "주력"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.equipmentId} className={`border-t ${darkMode ? "border-slate-800" : "border-slate-200"}`}>
                <td className="px-2 py-1.5">{r.name}</td>
                <td className="px-2 py-1.5">{statusBadge(r)}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.acquiredDate}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.expiryDate}</td>
                <td className="px-2 py-1.5">{coreBadge(r.core)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일: 세로 카드 */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.equipmentId} className={`rounded-lg border p-2.5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{r.name}</span>
              {statusBadge(r)}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1 text-[0.7rem] text-slate-500">
              <span>취득일: <span className="text-slate-700 dark:text-slate-300">{r.acquiredDate}</span></span>
              <span>만료일: <span className="text-slate-700 dark:text-slate-300">{r.expiryDate}</span></span>
              <span className="col-span-2">주력: {coreBadge(r.core)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
