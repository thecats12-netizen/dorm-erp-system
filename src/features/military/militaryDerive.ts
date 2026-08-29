// 군대관리 v2 1A — 조치대상/캘린더 파생 계산(순수 함수 · DB 조회 0 · 신규 저장 없음).
//  기존 데이터(인사/훈련/통보)에서만 파생한다. 자동생성/계산식(computeMilitaryStatus 등)은 건드리지 않는다.
import type { MilitaryPersonnel, TrainingRecord, MilitaryNotice } from "../../types/domain";

const ymd = (v: unknown) => String(v ?? "").slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// 로컬 날짜(YYYY-MM-DD) — toISOString(UTC) 사용 시 KST 저녁/새벽에 하루 밀리므로 로컬 컴포넌트로 계산.
export const localYmd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// 오늘(로컬 자정) 기준 날짜차(양수=미래, 0=오늘). 잘못된 날짜는 null. 양쪽 모두 로컬 자정 파싱 → timezone 일관.
const daysFromToday = (dateStr: unknown, today: Date): number | null => {
  const s = ymd(dateStr); if (!isYmd(s)) return null;
  const t0 = new Date(localYmd(today) + "T00:00:00").getTime();
  return Math.round((new Date(s + "T00:00:00").getTime() - t0) / 86400000);
};
const alive = (o: { isDeleted?: boolean; isPermanentDeleted?: boolean }) => !o.isDeleted && !o.isPermanentDeleted;

export type MilitaryActionType = "미이수" | "임박7" | "임박30" | "미발송" | "정보누락";
export type MilitaryActionItem = {
  id: string;
  type: MilitaryActionType;
  personId: string;
  personName: string;
  dept: string;         // 부서(=unit)
  baseDate: string;     // 발생 기준일
  dueDate: string;      // 기한
  status: string;       // 현재 상태
  relInfo: string;      // 관련 정보
  sortKey: string;      // 정렬용(기한/기준일)
};

// 조치대상 파생. 유형별 규칙은 기존 화면 정의와 정합(대시보드 KPI/조치 피드와 동일 개념).
export function buildMilitaryActionItems(input: {
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
  deptOf: (p: MilitaryPersonnel) => string;
  today?: Date;
}): MilitaryActionItem[] {
  const { personnel, training, notices, deptOf } = input;
  const today = input.today ?? new Date();
  const pById = new Map(personnel.map((p) => [p.id, p]));
  const out: MilitaryActionItem[] = [];

  training.filter(alive).forEach((r) => {
    const st = String(r.status ?? "");
    const p = pById.get(r.personnelId);
    const dept = p ? deptOf(p) : "-";
    const rel = r.subject || r.trainingType || "훈련";
    if (/미이수/.test(st)) {
      out.push({ id: `un-${r.id}`, type: "미이수", personId: r.personnelId, personName: p?.name ?? "-", dept, baseDate: ymd(r.trainingDate), dueDate: ymd(r.trainingDate), status: st, relInfo: rel, sortKey: ymd(r.trainingDate) });
      return;
    }
    if (/(완료|이수)/.test(st)) return;             // 완료/이수는 임박 대상 아님
    const d = daysFromToday(r.trainingDate, today);
    if (d === null || d < 0) return;                 // 과거/무효 제외
    const type: MilitaryActionType | null = d <= 7 ? "임박7" : d <= 30 ? "임박30" : null;
    if (!type) return;
    out.push({ id: `soon-${r.id}`, type, personId: r.personnelId, personName: p?.name ?? "-", dept, baseDate: ymd(r.trainingDate), dueDate: ymd(r.trainingDate), status: `D-${d}`, relInfo: rel, sortKey: ymd(r.trainingDate) });
  });

  // 통보서 미발송(대시보드 KPI와 동일 기준: 게시일 미존재)
  notices.forEach((n) => {
    if (ymd(n.publishedDate)) return;
    const names = (n.personnelIds || []).map((id) => pById.get(id)?.name).filter(Boolean).join(", ");
    out.push({ id: `ns-${n.id}`, type: "미발송", personId: (n.personnelIds || [])[0] ?? "", personName: names || "-", dept: "-", baseDate: ymd(n.createdAt), dueDate: ymd(n.expiresDate), status: n.sentStatus || "미발송", relInfo: n.title || "통보서", sortKey: ymd(n.expiresDate) || ymd(n.createdAt) });
  });

  // 정보누락(실제 업무 필수로 이미 쓰는 필드만: 성명/부서/연락처/생년월일/재직상태)
  personnel.filter(alive).forEach((p) => {
    const miss: string[] = [];
    if (!String(p.name ?? "").trim()) miss.push("성명");
    if (!String(p.unit ?? "").trim()) miss.push("부서");
    if (!String(p.phone ?? "").trim()) miss.push("연락처");
    if (!String(p.birthDate ?? "").trim()) miss.push("생년월일");
    if (!String(p.status ?? "").trim()) miss.push("재직상태");
    if (!miss.length) return;
    out.push({ id: `miss-${p.id}`, type: "정보누락", personId: p.id, personName: p.name || "-", dept: deptOf(p), baseDate: ymd(p.updatedAt) || ymd(p.createdAt), dueDate: "", status: "정보 누락", relInfo: miss.join(", "), sortKey: p.name || "" });
  });

  return out;
}

export const ACTION_TYPE_LABEL: Record<MilitaryActionType, string> = {
  "미이수": "교육 미이수", "임박7": "7일 이내 교육", "임박30": "30일 이내 교육", "미발송": "통보서 미발송", "정보누락": "필수정보 누락",
};

export type MilitaryCalEventType = "training" | "completion" | "noticeDue";
export type MilitaryCalEvent = { id: string; date: string; type: MilitaryCalEventType; label: string; personName: string };

// 캘린더 이벤트 파생(기존 훈련일/이수일/통보 만료일 재사용 · 신규 저장 없음).
export function buildMilitaryCalendarEvents(input: {
  personnel: MilitaryPersonnel[];
  training: TrainingRecord[];
  notices: MilitaryNotice[];
}): MilitaryCalEvent[] {
  const pById = new Map(input.personnel.map((p) => [p.id, p]));
  const out: MilitaryCalEvent[] = [];
  input.training.filter(alive).forEach((r) => {
    const nm = pById.get(r.personnelId)?.name ?? "-";
    const subj = r.subject || r.trainingType || "훈련";
    if (isYmd(ymd(r.trainingDate))) out.push({ id: `t-${r.id}`, date: ymd(r.trainingDate), type: "training", label: subj, personName: nm });
    if (isYmd(ymd(r.completionDate))) out.push({ id: `c-${r.id}`, date: ymd(r.completionDate), type: "completion", label: `이수: ${subj}`, personName: nm });
  });
  input.notices.forEach((n) => {
    if (isYmd(ymd(n.expiresDate))) out.push({ id: `n-${n.id}`, date: ymd(n.expiresDate), type: "noticeDue", label: `통보 마감: ${n.title || "통보서"}`, personName: "" });
  });
  return out;
}
