// ============================================================================
// 자동 라이선스 관리 — employee_license_plan 서비스(신규, 순수계산 + Supabase 영속).
//
// [원칙]
//  · 기존 시험관리 기능/화면/함수는 건드리지 않는다. 이 파일은 신규 확장 계층이다.
//  · 라이선스 단계(Single→M1→…→PM→DM)의 순서/기한은 코드에 하드코딩하지 않는다.
//    exam_levels(rank_order) + exam_rules(required_months, prerequisite_level_id) "데이터"에서 유도한다.
//  · 기한 계산은 반드시 month 단위(30일 계산 금지). 입사일 또는 선행 취득일 + required_months 개월.
//  · Supabase 미설정/미적용 환경에서도 죽지 않는다(가드 후 빈 결과 반환).
//  · service_role_key 미사용. RLS(admin·동일 tenant)가 서버 최종 방어.
// ============================================================================
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";

// ── 상태값(요구사항 16) ──────────────────────────────────────────────
export type LicensePlanStatus = "waiting" | "active" | "completed" | "expired" | "cancel";
export const LICENSE_PLAN_STATUS_LABEL: Record<LicensePlanStatus, string> = {
  waiting: "진행대기",
  active: "진행중",
  completed: "취득완료",
  expired: "기한초과",
  cancel: "취소",
};

// ── 테이블 행 타입(요구사항 15) ──────────────────────────────────────
export type EmployeeLicensePlan = {
  id: string;
  tenant_id: string;
  organization_id?: string | null;
  employee_id: string;
  license_level: string;
  rule_id?: string | null;
  status: LicensePlanStatus;
  join_date?: string | null;
  base_date?: string | null;      // 이 단계 기준일(첫=입사일, 후속=직전 취득일). null=기준일 미확정
  target_date?: string | null;
  completed_date?: string | null;
  required_months?: number | null;
  previous_license?: string | null;
  next_license?: string | null;
  is_active?: boolean;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

// 느슨한 입력 행(exam_levels / exam_rules 는 자유형이라 Record 로 받는다).
type Row = Record<string, unknown>;
const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const nowIso = () => new Date().toISOString();
export const todayYmd = (): string => new Date().toISOString().slice(0, 10);

// 날짜 문자열 → YYYY-MM-DD 정규화(구분자 . - / 허용). 실패 시 "".
export function toYmd(v: unknown): string {
  const s = asText(v);
  if (!s) return "";
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s.slice(0, 10);
}

// ── 월(month) 단위 계산 — 30일 계산 금지(요구사항 4·5) ────────────────
// baseYmd + months 개월. 목표월 말일 초과 시 말일로 clamp(예: 1/31 + 1개월 = 2/28).
export function addMonths(baseYmd: string, months: number): string {
  const ymd = toYmd(baseYmd);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !Number.isFinite(months)) return "";
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const idx = (mo - 1) + Math.trunc(months);
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;                       // 0..11
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

// 목표취득일 = 기준일 + required_months 개월. 값 없으면 "".
export function computeTargetDate(baseYmd: unknown, requiredMonths: unknown): string {
  const base = toYmd(baseYmd);
  const n = Number(requiredMonths);
  if (!base || !Number.isFinite(n)) return "";
  return addMonths(base, n);
}

// 두 날짜(YYYY-MM-DD) 사이 개월(정수). from→to. 형식 오류 시 null.
export function monthsBetween(fromYmd: string, toYmdStr: string): number | null {
  const a = toYmd(fromYmd); const b = toYmd(toYmdStr);
  const ra = a.match(/^(\d{4})-(\d{2})-(\d{2})$/); const rb = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ra || !rb) return null;
  let mm = (Number(rb[1]) - Number(ra[1])) * 12 + (Number(rb[2]) - Number(ra[2]));
  if (Number(rb[3]) < Number(ra[3])) mm -= 1;
  return mm;
}

// 오늘 기준 남은 개월(목표취득일까지). 음수면 기한 초과. 목표 없으면 null.
export function remainingMonths(targetDate: unknown, today: string = todayYmd()): number | null {
  const t = toYmd(targetDate);
  if (!t) return null;
  return monthsBetween(today, t);
}

// 기한 초과 여부: 미완료(active/waiting) + 목표취득일 < 오늘.
export function isOverdue(plan: Pick<EmployeeLicensePlan, "status" | "target_date" | "completed_date">, today: string = todayYmd()): boolean {
  if (plan.status === "completed" || plan.status === "cancel") return false;
  const t = toYmd(plan.target_date);
  if (!t) return false;
  return t < today && !toYmd(plan.completed_date);
}

// ── 데이터 기반 라이선스 사다리(ladder) 유도 — 하드코딩 금지 ──────────
// exam_levels(rank_order, code/name) 중 "활성 exam_rules 규칙이 존재하는 단계"만 순서대로 나열한다.
//  → 관리자가 인증 기준관리에서 규칙을 등록/수정하면 사다리와 기한이 바뀐다(코드 수정 불필요).
export type LadderStep = {
  level_id: string;
  level_code: string;         // license_level 에 저장할 코드(code 우선, 없으면 name)
  level_name: string;
  rank_order: number;
  required_months: number | null;
  rule_id: string | null;
  prerequisite_level_id: string | null;
};

const activeRow = (r: Row): boolean => !r.deleted_at && r.is_active !== false;

// levels: exam_levels 행, rules: exam_rules 행(취득기준). 규칙이 있는 레벨만 rank_order 순으로.
export function buildLadder(levels: Row[], rules: Row[]): LadderStep[] {
  const rulesByLevel = new Map<string, Row>();
  (Array.isArray(rules) ? rules : []).filter(activeRow).forEach((r) => {
    const lid = asText(r.level_id);
    if (!lid) return;
    // 동일 레벨에 규칙이 여러 개면 effective_date(있으면) 최신 → created_at 최신 우선.
    const prev = rulesByLevel.get(lid);
    if (!prev) { rulesByLevel.set(lid, r); return; }
    const key = (x: Row) => toYmd(x.effective_date) || asText(x.created_at);
    if (key(r) >= key(prev)) rulesByLevel.set(lid, r);
  });

  const steps: LadderStep[] = (Array.isArray(levels) ? levels : [])
    .filter(activeRow)
    .filter((lv) => rulesByLevel.has(asText(lv.id)))       // 규칙이 설정된 단계만 사다리에 포함
    .map((lv) => {
      const rule = rulesByLevel.get(asText(lv.id))!;
      const rm = Number(rule.required_months);
      return {
        level_id: asText(lv.id),
        level_code: asText(lv.code) || asText(lv.name),
        level_name: asText(lv.name) || asText(lv.code),
        rank_order: Number(lv.rank_order) || 0,
        required_months: Number.isFinite(rm) ? rm : null,
        rule_id: asText(rule.id) || null,
        prerequisite_level_id: asText(rule.prerequisite_level_id) || null,
      };
    })
    .sort((a, b) => a.rank_order - b.rank_order);

  return steps;
}

// ── 공정별 인증 규칙 정밀 연동(요구사항 4) ────────────────────────────
// 직원 범위: process_id → part_id → group_id/category_id 역추적(마스터 행에서).
export type EmployeeScope = { processId: string; partId: string; groupId: string; categoryId: string; resolved: boolean };
export function resolveEmployeeScope(emp: Row, processes: Row[], parts: Row[], groups: Row[]): EmployeeScope {
  const processId = asText(emp.process_id);
  const proc = processes.find((p) => asText(p.id) === processId);
  const partId = asText(emp.part_id) || asText(proc?.part_id);
  const part = parts.find((p) => asText(p.id) === partId);
  const groupId = asText(part?.group_id);
  const group = groups.find((g) => asText(g.id) === groupId);
  const categoryId = asText(group?.category_id) || asText(part?.category_id);
  return { processId, partId, groupId, categoryId, resolved: !!processId };
}

// 직원 범위에 맞는 규칙만으로 사다리 구성. 규칙 매칭 우선순위(요구사항 4):
//   3순위(가장 구체) rule.process_id === 직원 process_id
//   2순위           rule.process_id 없음 & rule.group_id === 직원 group_id
//   1순위           rule.process_id/group_id 없음 & rule.category_id === 직원 category_id
//  ※ 범위가 전혀 지정되지 않은 규칙(process/group/category 모두 없음)은 tenant 전체이므로 계획 생성에 사용하지 않는다.
//    processId 가 없으면(legacy 미연결) 빈 사다리 → 계획 생성 안 함.
export function buildLadderForScope(levels: Row[], rules: Row[], scope: EmployeeScope): LadderStep[] {
  if (!scope.resolved) return [];
  const key = (x: Row) => toYmd(x.effective_date) || asText(x.created_at);
  const bestByLevel = new Map<string, { rule: Row; rank: number }>();
  for (const r of (Array.isArray(rules) ? rules : []).filter(activeRow)) {
    const lid = asText(r.level_id); if (!lid) continue;
    const rp = asText(r.process_id), rg = asText(r.group_id), rc = asText(r.category_id);
    let rank = -1;
    if (rp && rp === scope.processId) rank = 3;
    else if (!rp && rg && scope.groupId && rg === scope.groupId) rank = 2;
    else if (!rp && !rg && rc && scope.categoryId && rc === scope.categoryId) rank = 1;
    if (rank < 0) continue; // 범위 밖 or 완전 공통(tenant 전체) 규칙 → 제외
    const prev = bestByLevel.get(lid);
    if (!prev || rank > prev.rank || (rank === prev.rank && key(r) >= key(prev.rule))) bestByLevel.set(lid, { rule: r, rank });
  }
  return (Array.isArray(levels) ? levels : []).filter(activeRow)
    .filter((lv) => bestByLevel.has(asText(lv.id)))
    .map((lv) => {
      const rule = bestByLevel.get(asText(lv.id))!.rule;
      const rm = Number(rule.required_months);
      return {
        level_id: asText(lv.id), level_code: asText(lv.code) || asText(lv.name), level_name: asText(lv.name) || asText(lv.code),
        rank_order: Number(lv.rank_order) || 0, required_months: Number.isFinite(rm) ? rm : null,
        rule_id: asText(rule.id) || null, prerequisite_level_id: asText(rule.prerequisite_level_id) || null,
      };
    })
    .sort((a, b) => a.rank_order - b.rank_order);
}

// ── Supabase 영속 계층 ────────────────────────────────────────────────
const TABLE = "employee_license_plan";

// 직원 1명의 계획 행 로드(미삭제).
export async function loadPlansForEmployee(employeeId: string, tenantId: string): Promise<EmployeeLicensePlan[]> {
  if (!isSupabaseAvailable() || !supabase || !employeeId) return [];
  const { data, error } = await supabase
    .from(TABLE).select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId).is("deleted_at", null);
  if (error) return [];
  return ((data as EmployeeLicensePlan[]) || []).sort((a, b) => asText(a.created_at).localeCompare(asText(b.created_at)));
}

// tenant 전체 계획 로드(대시보드 집계용, 미삭제).
export async function loadAllPlans(tenantId: string): Promise<EmployeeLicensePlan[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const { data, error } = await supabase
    .from(TABLE).select("*").eq("tenant_id", tenantId).is("deleted_at", null);
  if (error) return [];
  return (data as EmployeeLicensePlan[]) || [];
}

export type GeneratePlanResult = { created: number; skipped: number; ladder: number; error?: string };

// 직원 등록/수정 후 자동 라이선스 계획 생성(요구사항 1·6·7·8).
//  - 사다리(buildLadder)를 순서대로 생성. 앞 단계 미완료면 다음 단계는 'waiting'(요구사항 6).
//  - 첫 단계는 'active' + 목표취득일(입사일 + required_months). 나머지는 'waiting' + 목표 미정(활성화 시 계산).
//  - 이미 존재하는 (employee, level) 행은 건드리지 않는다(idempotent, 재실행/재저장 안전).
export async function generatePlanForEmployee(
  employeeId: string, tenantId: string, hireDate: unknown,
  ladder: LadderStep[], actorId?: string, organizationId?: string | null
): Promise<GeneratePlanResult> {
  if (!isSupabaseAvailable() || !supabase) return { created: 0, skipped: 0, ladder: ladder.length, error: "Supabase 미설정" };
  if (!employeeId || ladder.length === 0) return { created: 0, skipped: 0, ladder: ladder.length };

  const existing = await loadPlansForEmployee(employeeId, tenantId);
  const existingLevels = new Set(existing.map((p) => p.license_level));
  const join = toYmd(hireDate) || null;

  let created = 0; let skipped = 0; let firstError: string | undefined;
  for (let i = 0; i < ladder.length; i++) {
    const step = ladder[i];
    if (existingLevels.has(step.level_code)) { skipped += 1; continue; }  // 기존 행 보존
    const isFirst = i === 0;
    const status: LicensePlanStatus = isFirst ? "active" : "waiting";     // 앞 단계 미완료 → 대기
    // 첫 단계 기준일 = 입사일. 후속 단계는 직전 취득일이 없으므로 기준일 미확정(null) + 목표 미정.
    const base = isFirst ? join : null;
    const target = isFirst ? computeTargetDate(base, step.required_months) || null : null;
    const payload = {
      tenant_id: tenantId,
      organization_id: organizationId ?? null,
      employee_id: employeeId,
      license_level: step.level_code,
      rule_id: step.rule_id,
      status,
      join_date: join,
      base_date: base,
      target_date: target,
      completed_date: null,
      required_months: step.required_months,
      previous_license: i > 0 ? ladder[i - 1].level_code : null,
      next_license: i < ladder.length - 1 ? ladder[i + 1].level_code : null,
      created_by: actorId || null,
      updated_by: actorId || null,
      updated_at: nowIso(),
    };
    // 중복은 위 existingLevels 로 이미 skip → insert 사용(부분 유니크 인덱스와의 ON CONFLICT 추론 오류 42P10 회피).
    //  동시 저장 경합으로 유니크 위반(23505) 발생 시엔 이미 존재하는 것이므로 skip 처리.
    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) {
      if ((error as { code?: string }).code === "23505") { skipped += 1; continue; }
      firstError = firstError || error.message; continue;
    }
    created += 1;
  }
  return { created, skipped, ladder: ladder.length, error: firstError };
}

// exam_levels + exam_rules 를 읽어 데이터 기반 사다리를 만든다(하드코딩 금지). 페이지 훅에서 재사용.
export async function loadLadder(tenantId: string): Promise<LadderStep[]> {
  if (!isSupabaseAvailable() || !supabase) return [];
  const [lv, ru] = await Promise.all([
    supabase.from("exam_levels")
      .select("id, code, name, rank_order, is_active, deleted_at")
      .eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_rules")
      .select("id, level_id, prerequisite_level_id, required_months, effective_date, is_active, deleted_at, created_at")
      .eq("tenant_id", tenantId).is("deleted_at", null),
  ]);
  if (lv.error || ru.error) return [];
  return buildLadder((lv.data as Row[]) || [], (ru.data as Row[]) || []);
}

// 직원 1명의 공정 범위에 맞는 사다리 로드(요구사항 4). 직원 process_id 미연결 → 빈 사다리(계획 생성 안 함).
export async function loadScopedLadder(employeeId: string, tenantId: string): Promise<{ ladder: LadderStep[]; scope: EmployeeScope | null }> {
  if (!isSupabaseAvailable() || !supabase || !employeeId) return { ladder: [], scope: null };
  const [emp, lv, ru, pr, pa, gr] = await Promise.all([
    supabase.from("exam_personnel").select("id, process_id, part_id").eq("tenant_id", tenantId).eq("id", employeeId).is("deleted_at", null).limit(1),
    supabase.from("exam_levels").select("id, code, name, rank_order, is_active, deleted_at").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_rules").select("id, level_id, prerequisite_level_id, required_months, process_id, group_id, category_id, effective_date, is_active, deleted_at, created_at").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_processes").select("id, part_id").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_parts").select("id, group_id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_groups").select("id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
  ]);
  const empRow = (emp.data as Row[] | null)?.[0];
  if (!empRow) return { ladder: [], scope: null };
  const scope = resolveEmployeeScope(empRow, (pr.data as Row[]) || [], (pa.data as Row[]) || [], (gr.data as Row[]) || []);
  return { ladder: buildLadderForScope((lv.data as Row[]) || [], (ru.data as Row[]) || [], scope), scope };
}

// 편의: 공정 범위 사다리 로드 + 계획 생성을 한 번에(인력현황 단건 저장 훅용). 비차단 호출을 전제로 한다.
//  ※ 공정 미연결/공정에 맞는 규칙 없음 → 사다리 0 → 계획 생성 없음(tenant 전체 무차별 생성 방지).
export async function generatePlanForEmployeeAuto(
  employeeId: string, tenantId: string, hireDate: unknown, actorId?: string, organizationId?: string | null
): Promise<GeneratePlanResult> {
  const { ladder } = await loadScopedLadder(employeeId, tenantId);
  return generatePlanForEmployee(employeeId, tenantId, hireDate, ladder, actorId, organizationId);
}

// 한 단계 취득 완료 처리 + 다음 단계 자동 활성화(요구사항 5·7·10·11).
//  - completedLevel 을 'completed' + completed_date 로 확정.
//  - 다음 단계('waiting')를 'active' 로 전환하고 목표취득일 = 선행 취득일(completedDate) + 다음 required_months.
export type AdvanceResult = { completed: boolean; activatedNext?: string | null; error?: string };
export async function completeStageAndActivateNext(
  employeeId: string, tenantId: string, completedLevel: string,
  completedDate: unknown, actorId?: string
): Promise<AdvanceResult> {
  if (!isSupabaseAvailable() || !supabase) return { completed: false, error: "Supabase 미설정" };
  const done = toYmd(completedDate) || todayYmd();
  const plans = await loadPlansForEmployee(employeeId, tenantId);
  const current = plans.find((p) => p.license_level === completedLevel);
  if (!current) return { completed: false, error: "해당 단계 계획이 없습니다." };
  if (current.status === "cancel") return { completed: false, error: "취소된 단계입니다." };

  // 멱등: 이미 동일 취득일로 완료된 단계면 재실행 skip(동일 승인 이벤트 중복 방지). 취득일이 다르면 갱신 허용.
  const alreadyDone = current.status === "completed" && toYmd(current.completed_date) === done;
  if (!alreadyDone) {
    const { error } = await supabase.from(TABLE)
      .update({ status: "completed", completed_date: done, updated_by: actorId || null, updated_at: nowIso() })
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("license_level", completedLevel);
    if (error) return { completed: false, error: error.message };
  }

  // 2) 다음 단계 활성화 + 기준일/목표취득일 재계산(선행 취득일 기준). 이미 active/completed 면 덮어쓰지 않음(멱등).
  const nextLevel = current.next_license || plans.find((p) => p.previous_license === completedLevel)?.license_level || null;
  if (!nextLevel) return { completed: true, activatedNext: null };   // 마지막 단계(DM) → 추가 생성 없음
  const next = plans.find((p) => p.license_level === nextLevel);
  if (next && next.status === "waiting") {                            // waiting 일 때만 활성화(중복 활성/역행 방지)
    const nextTarget = computeTargetDate(done, next.required_months) || null;   // 선행 취득일 + 다음 기한
    const { error } = await supabase.from(TABLE)
      .update({ status: "active", base_date: done, target_date: nextTarget, updated_by: actorId || null, updated_at: nowIso() })
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("license_level", nextLevel);
    if (error) return { completed: true, activatedNext: null, error: error.message };
  }
  return { completed: true, activatedNext: nextLevel };
}

// PM/DM 승인 훅용: 인증 단계 level_id(uuid)로 완료 처리 + 다음 단계 활성화.
//  - plan.license_level 은 buildLadder 와 동일 규칙(code || name)으로 exam_levels 에서 해석해 매칭한다.
//  - 사원은 personnel_id(우선) 또는 employee_no(폴백)로 exam_personnel.id 를 확정한다.
//  - 매칭 실패/미확정은 비차단(오류 반환만) — 기존 승인 저장 흐름을 막지 않는다.
export async function completeStageByLevelId(
  employeeRef: { personnelId?: string | null; employeeNo?: string | null },
  tenantId: string, levelId: unknown, completedDate: unknown, actorId?: string,
  opts?: { fallbackFinal?: boolean }   // [P1] DM 전용: level_id 미매칭 시 "최종 단계" 완료로 폴백
): Promise<AdvanceResult> {
  if (!isSupabaseAvailable() || !supabase) return { completed: false, error: "Supabase 미설정" };

  // 1) employee_id 확정(personnel_id 우선, 없으면 사번으로 조회)
  let employeeId = asText(employeeRef.personnelId);
  if (!employeeId && asText(employeeRef.employeeNo)) {
    const { data } = await supabase.from("exam_personnel").select("id")
      .eq("tenant_id", tenantId).eq("employee_no", asText(employeeRef.employeeNo)).is("deleted_at", null).limit(1);
    employeeId = asText((data as Array<{ id?: string }> | null)?.[0]?.id);
  }
  if (!employeeId) return { completed: false, error: "사원 정보를 찾을 수 없습니다." };

  // 2) level_id → license_level 코드(buildLadder 와 동일: code || name). level_id 없으면 폴백 경로로.
  const lid = asText(levelId);
  let code = "";
  if (lid) {
    const { data: lv } = await supabase.from("exam_levels").select("id, code, name")
      .eq("tenant_id", tenantId).eq("id", lid).limit(1);
    const row = (lv as Array<{ code?: string; name?: string }> | null)?.[0];
    code = asText(row?.code) || asText(row?.name);
  }
  if (code) {
    const res = await completeStageAndActivateNext(employeeId, tenantId, code, completedDate, actorId);
    if (res.completed || !opts?.fallbackFinal) return res;   // 매칭 성공 or 폴백 불필요 → 그대로 반환
  }

  // 3) [P1] DM 완료 확실화: 코드 미매칭/미확정 시 "다음 단계 없는 최종 단계"(active/waiting)를 완료 처리.
  //    본 프로젝트에서 라이선스 마지막 단계(DM)는 next_license 가 null 이므로 이를 완료로 확정한다.
  if (opts?.fallbackFinal) {
    const plans = await loadPlansForEmployee(employeeId, tenantId);
    const final = plans.find((p) => !p.next_license && (p.status === "active" || p.status === "waiting"));
    if (final) return completeStageAndActivateNext(employeeId, tenantId, final.license_level, completedDate, actorId);
    return { completed: false, error: "완료할 최종 단계가 없습니다." };
  }
  return { completed: false, error: code ? "해당 단계 계획이 없습니다." : "인증 단계 코드를 찾을 수 없습니다." };
}

// 계획 상태 수동 변경(라이선스 계획 화면). status 는 DB CHECK(waiting/active/completed/expired/cancel) 만 허용.
//  completed 로 바꾸면 completed_date 를 오늘로 채운다(비면). tenant + id 스코프, RLS 최종 방어.
export async function updatePlanStatus(
  planId: string, tenantId: string, status: LicensePlanStatus, actorId?: string, completedDate?: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseAvailable() || !supabase || !planId) return { ok: false, error: "Supabase 미설정" };
  const patch: Record<string, unknown> = { status, updated_by: actorId || null, updated_at: nowIso() };
  if (status === "completed") patch.completed_date = toYmd(completedDate) || todayYmd();
  const { error } = await supabase.from(TABLE).update(patch).eq("tenant_id", tenantId).eq("id", planId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// 매일 자동 계산(요구사항 17): 미완료 + 목표취득일 경과 → 'expired'. (남은개월은 조회 시 파생계산)
//  - active/waiting 중 target_date < today 이고 completed_date 없으면 expired 로 갱신.
//  - 되돌림 안전: 이미 expired/completed/cancel 은 제외. 반환은 갱신 건수.
export async function recomputeExpiredPlans(tenantId: string, today: string = todayYmd()): Promise<{ updated: number; error?: string }> {
  if (!isSupabaseAvailable() || !supabase) return { updated: 0, error: "Supabase 미설정" };
  const { data, error } = await supabase
    .from(TABLE).select("id, status, target_date, completed_date")
    .eq("tenant_id", tenantId).is("deleted_at", null).in("status", ["active", "waiting"]);
  if (error) return { updated: 0, error: error.message };
  const overdueIds = ((data as EmployeeLicensePlan[]) || [])
    .filter((p) => isOverdue(p, today))
    .map((p) => p.id);
  if (overdueIds.length === 0) return { updated: 0 };
  const { error: upErr } = await supabase.from(TABLE)
    .update({ status: "expired", updated_at: nowIso() })
    .in("id", overdueIds);
  if (upErr) return { updated: 0, error: upErr.message };
  return { updated: overdueIds.length };
}

// ── 조회 파생(순수) — 상세탭/보고서/대시보드에서 공통 사용 ─────────────
export type PlanView = EmployeeLicensePlan & { remaining_months: number | null; overdue: boolean };
export function decoratePlans(plans: EmployeeLicensePlan[], today: string = todayYmd()): PlanView[] {
  return (Array.isArray(plans) ? plans : []).map((p) => ({
    ...p,
    remaining_months: p.status === "completed" ? null : remainingMonths(p.target_date, today),
    overdue: isOverdue(p, today),
  }));
}

// 대시보드 카드 집계(요구사항 19). 버킷은 미완료(active/waiting) 기준 남은개월/기한으로 분류.
export type PlanSummary = {
  overdue: number;      // 기한 초과
  within30d: number;    // 30일 이내
  within1m: number;     // 1개월 이내
  within3m: number;     // 3개월 이내
  completed: number;    // 완료
  active: number;       // 진행중
  waiting: number;      // 대기
  total: number;
};
export function summarizePlans(plans: EmployeeLicensePlan[], today: string = todayYmd()): PlanSummary {
  const s: PlanSummary = { overdue: 0, within30d: 0, within1m: 0, within3m: 0, completed: 0, active: 0, waiting: 0, total: 0 };
  for (const p of Array.isArray(plans) ? plans : []) {
    if (p.status === "cancel") continue;
    s.total += 1;
    if (p.status === "completed") { s.completed += 1; continue; }
    if (p.status === "active") s.active += 1;
    if (p.status === "waiting") s.waiting += 1;
    if (isOverdue(p, today) || p.status === "expired") { s.overdue += 1; continue; }
    const t = toYmd(p.target_date);
    if (!t) continue;
    const days = Math.round((new Date(t).getTime() - new Date(today).getTime()) / 86400000);
    if (days <= 30) s.within30d += 1;
    const rm = remainingMonths(t, today);
    if (rm !== null && rm <= 1) s.within1m += 1;
    if (rm !== null && rm <= 3) s.within3m += 1;
  }
  return s;
}
