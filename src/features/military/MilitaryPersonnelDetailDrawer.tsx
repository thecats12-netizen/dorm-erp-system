// 군대관리 v2 1A — 인사관리 개인 상세 Drawer(조회 중심). 마스킹/계산은 App 의 기존 함수를 props 로 재사용(권한 우회 없음).
import { useMemo } from "react";
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice } from "../../types/domain";

type Props = {
  darkMode: boolean;
  person: MilitaryPersonnel | null;
  training: TrainingRecord[];
  notices: MilitaryNotice[];
  deptOf: (p: MilitaryPersonnel) => string;
  maskPhone: (v?: string) => string;    // 기존 App 마스킹 재사용(viewer 마스킹 유지)
  maskBirth: (v?: string) => string;
  formatDate?: (v: string) => string;
  categoryOf?: (p: MilitaryPersonnel) => string;
  trainingYearOf?: (p: MilitaryPersonnel) => number | string;
  trainingStatusOf?: (p: MilitaryPersonnel) => string;
  onClose: () => void;
};

export default function MilitaryPersonnelDetailDrawer({ darkMode, person, training, notices, deptOf, maskPhone, maskBirth, formatDate, categoryOf, trainingYearOf, trainingStatusOf, onClose }: Props) {
  const fmt = (v?: string) => (v ? (formatDate ? formatDate(v) : v) : "-") || "-";
  const alive = (o: { isDeleted?: boolean; isPermanentDeleted?: boolean }) => !o.isDeleted && !o.isPermanentDeleted;

  const myTraining = useMemo(() => (person ? training.filter((t) => t.personnelId === person.id && alive(t)).sort((a, b) => String(b.trainingDate ?? "").localeCompare(String(a.trainingDate ?? ""))) : []), [person, training]);
  const myNotices = useMemo(() => (person ? notices.filter((n) => (n.personnelIds || []).includes(person.id)).sort((a, b) => String(b.publishedDate ?? b.createdAt ?? "").localeCompare(String(a.publishedDate ?? a.createdAt ?? ""))) : []), [person, notices]);

  if (!person) return null;
  const row = (label: string, value: string) => (
    <div className="flex gap-2 py-1 text-sm"><span className="w-24 shrink-0 text-slate-400">{label}</span><span className="break-all text-slate-700 dark:text-slate-200">{value || "-"}</span></div>
  );
  const sectionTitle = "mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400";

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onClick={onClose}>
      <div className={`h-full w-full max-w-md overflow-y-auto p-5 shadow-2xl sm:max-w-md ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{person.name || "-"}</h3>
            <p className="text-sm text-slate-500">{deptOf(person) || "-"} · {person.rank || "-"}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="닫기">✕</button>
        </div>

        <div className={sectionTitle}>기본정보</div>
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          {row("부서", deptOf(person))}
          {row("직급", person.rank || "-")}
          {row("연락처", maskPhone(person.phone))}
          {row("생년월일", maskBirth(person.birthDate))}
          {row("입대일", fmt(person.enlistmentDate))}
          {row("전역일", fmt(person.dischargeDate))}
          {categoryOf && row("현재구분", categoryOf(person) || "-")}
          {trainingYearOf && row("연차", (() => { const y = trainingYearOf(person); return y ? `${y}년차` : "-"; })())}
          {trainingStatusOf && row("이수상태", trainingStatusOf(person) || "-")}
          {row("재직상태", person.status || "-")}
        </div>

        <div className={sectionTitle}>훈련이력 ({myTraining.length})</div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700">
          {myTraining.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">등록된 훈련 이력이 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {myTraining.map((t) => (
                <div key={t.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{t.subject || t.trainingType || "훈련"}</span><span className="text-slate-400">{fmt(t.trainingDate)}</span></div>
                  <div className="mt-0.5 text-slate-500">{t.status || "-"}{t.location ? ` · ${t.location}` : ""}{t.notes ? ` · ${t.notes}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={sectionTitle}>통보이력 ({myNotices.length})</div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700">
          {myNotices.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">등록된 통보 이력이 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {myNotices.map((n) => (
                <div key={n.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{n.title || "통보서"}</span><span className="text-slate-400">{n.sentStatus || (n.publishedDate ? "발송" : "미발송")}</span></div>
                  <div className="mt-0.5 text-slate-500">{n.category || "-"} · 게시 {fmt(n.publishedDate)}{n.expiresDate ? ` · 만료 ${fmt(n.expiresDate)}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {person.notes && (<><div className={sectionTitle}>메모</div><div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{person.notes}</div></>)}
      </div>
    </div>
  );
}
