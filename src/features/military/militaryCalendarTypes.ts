// 군대관리 v2 일정관리 v1.5 — 캘린더 파생 타입(프론트 derived 전용 · persistent DB type 아님).
//  ⚠ 신규 persistent collection(militaryScheduleEvents 등) 을 만들지 않는다. 기존 state 에서만 derive.
//  Calendar v2(수동 CRUD/반복/담당자/알림/ICS)를 고려한 확장 가능한 형태로 필드를 둔다(이번엔 read-only).

export type MilitaryCalEventKind = "training" | "notice" | "report" | "personnel";
export type MilitaryCalEventStatus = "normal" | "upcoming" | "dueSoon" | "overdue" | "completed";

export type MilitaryCalendarEvent = {
  id: string;            // derived unique id (예: "train-<recId>")
  sourceId: string;      // 원본 레코드 id
  kind: MilitaryCalEventKind;
  subtype: string;       // 세부 구분(훈련예정/이수/통보마감/통보게시/보고/입대/전역)
  title: string;         // 표시 제목(비민감)
  date: string;          // YYYY-MM-DD (로컬)
  endDate?: string;      // 기간 일정용(현재 미사용 · v2 대비)
  status: MilitaryCalEventStatus;
  dept?: string;         // 부서(=unit · 비민감)
  personnelId?: string;
  personnelName?: string; // sanitized allowlist(이름은 viewer 도 노출 허용) · PII 아님
  description?: string;   // 비민감 요약(자유텍스트/PII 제외)
  actionNeeded: boolean;  // 조치 필요(미이수/미게시/지연/임박) — 조치대상 기준과 정합
  dDay: number | null;    // 오늘 기준 일수(양수=미래 · 0=오늘 · 음수=과거) · 무효날짜=null
  sourceKind: MilitaryCalEventKind; // 원본 메뉴 연계용(kind 와 동일하나 의미 명시)
};

export type MilitaryCalKpi = {
  today: number;
  thisWeek: number;
  within7: number;
  actionNeeded: number;
};
