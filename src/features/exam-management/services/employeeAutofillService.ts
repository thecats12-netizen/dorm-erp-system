// 시험관리 사원 자동입력 서비스(신규 · 조회 전용).
//  - 사원 선택 시 사원/PM/DM 인증/라이선스 계획/규칙을 "병렬 최소 요청"으로 조회해 자동입력 payload 반환(N+1 금지).
//  - 실제 테이블만 사용: exam_personnel, pm_certifications, dm_certifications, employee_license_plan, exam_rules.
//    (존재하지 않는 employee_certifications 는 사용하지 않음.)
//  - tenant_id 조건 필수. service_role_key 미사용. snake_case(DB) → camelCase(payload) 명시 매핑.
//  - 인증 컬럼은 프로젝트별 편차가 있어 select("*") + 방어적 접근(존재하지 않는 컬럼 추측/에러 방지).
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { loadPlansForEmployee, remainingMonths, isOverdue, todayYmd, addMonths } from "./licensePlanService";
import { calculatePmLevel, calculateDmLevel } from "./examAutomationService";
import type { EmployeeAutofill } from "../types/employeeLookup";

type Row = Record<string, unknown>;
const asText = (v: unknown): string => (v == null ? "" : String(v).trim());
const ymd = (v: unknown): string | null => { const s = asText(v); return s ? s.slice(0, 10) : null; };
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// 사원 id 로 자동입력 정보를 한 번에 조회. 실패/미존재 시 null.
export async function loadEmployeeAutofill(employeeId: string, tenantId: string): Promise<EmployeeAutofill | null> {
  if (!isSupabaseAvailable() || !supabase || !employeeId || !tenantId) return null;
  try {
    const [personRes, pmRes, dmRes, rulesRes, appsRes, plans] = await Promise.all([
      supabase.from("exam_personnel").select("*").eq("tenant_id", tenantId).eq("id", employeeId).is("deleted_at", null).limit(1),
      supabase.from("pm_certifications").select("*").eq("tenant_id", tenantId).eq("personnel_id", employeeId).is("deleted_at", null),
      supabase.from("dm_certifications").select("*").eq("tenant_id", tenantId).eq("personnel_id", employeeId).is("deleted_at", null),
      supabase.from("exam_rules").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("exam_applications").select("*").eq("tenant_id", tenantId).eq("personnel_id", employeeId).is("deleted_at", null),
      loadPlansForEmployee(employeeId, tenantId),
    ]);

    const person = ((personRes.data as Row[]) || [])[0];
    if (!person) return null;
    const pmCerts = (pmRes.data as Row[]) || [];
    const dmCerts = (dmRes.data as Row[]) || [];
    const rules = (rulesRes.data as Row[]) || [];
    const apps = (appsRes.data as Row[]) || [];
    const today = todayYmd();

    // [P1] 재시험 가능일: 최근 불합격/취소 응시 발생일 + 재시험 대기(기본 3개월, 달력 개월). 없으면 null.
    const RETEST_GAP_MONTHS = 3;
    const failDates = apps
      .filter((a) => /불합격|취소/.test(asText(a.status)))
      .map((a) => ymd(a.practical_pass_date) || ymd(a.written_pass_date) || ymd(a.updated_at))
      .filter((d): d is string => !!d)
      .sort();
    const lastFail = failDates.length ? failDates[failDates.length - 1] : null;
    const retestAvailableDate = lastFail ? (addMonths(lastFail, RETEST_GAP_MONTHS) || null) : null;

    // 라이선스 계획 요약
    const active = plans.find((p) => p.status === "active") || null;
    const lastCompleted = [...plans]
      .filter((p) => p.status === "completed")
      .sort((a, b) => asText(b.completed_date).localeCompare(asText(a.completed_date)))[0] || null;

    // 최신 승인 인증(취득일 내림차순)
    const approvedPm = pmCerts
      .filter((c) => asText(c.approval_status) === "승인" && c.is_active !== false)
      .sort((a, b) => asText(b.acquired_date).localeCompare(asText(a.acquired_date)));
    const latestPm = approvedPm[0] || null;
    const approvedDm = dmCerts
      .filter((c) => asText(c.approval_status) === "승인" && c.is_active !== false)
      .sort((a, b) => asText(b.acquired_date).localeCompare(asText(a.acquired_date)));
    const latestDm = approvedDm[0] || null;

    // 현재 레벨: 저장값 우선, 없으면 기존 계산 엔진 재사용(하드코딩 없음).
    const pmLevel = asText(person.current_pm_level) || calculatePmLevel(person, pmCerts, rules).value;
    const dmLevel = asText(latestDm?.dm_level) || asText(latestDm?.dm_stage) || calculateDmLevel(person, dmCerts, rules).value;

    return {
      employee: {
        id: asText(person.id),
        employeeNo: asText(person.employee_no),
        name: asText(person.name),
        group: (person.group_name as string) ?? null,
        productFamily: (person.product_group as string) ?? null,
        part: (person.part_name as string) ?? null,
        process: (person.process_id as string) ?? null,
        position: (person.position as string) ?? null,
        joinDate: ymd(person.hire_date),
        employmentStatus: (person.employment_status as string) ?? null,
      },
      licenseSummary: {
        currentStage: active ? active.license_level : (lastCompleted ? lastCompleted.license_level : null),
        nextStage: active ? (active.next_license ?? null) : null,
        activePlanId: active ? active.id : null,
        targetDate: active ? (active.target_date ?? null) : null,
        remainingMonths: active ? remainingMonths(active.target_date, today) : null,
        overdue: active ? isOverdue(active, today) : false,
        retestAvailableDate, // [P1] 최근 불합격/취소 + 재시험 대기(개월)
      },
      pmSummary: {
        currentLevel: pmLevel || null,
        eligibleLevel: active ? (active.next_license ?? null) : null,
        acquiredDate: latestPm ? ymd(latestPm.acquired_date) : null,
        expiryDate: latestPm ? ymd(latestPm.expiry_date) : null,
      },
      dmSummary: {
        currentLevel: dmLevel || null,
        eligibleLevel: null, // exam_rules 기반 추천은 다음 단계(DM 등록 단순화)에서 연결
        processCount: latestDm && latestDm.process_count != null ? num(latestDm.process_count) : (approvedDm.length || null),
        equipmentCount: latestDm && latestDm.equipment_count != null ? num(latestDm.equipment_count) : null,
        dualMulti: person.dual_multi === true || latestDm?.dual_multi === true,
      },
    };
  } catch (err) {
    const e = err as { code?: unknown; message?: string; details?: unknown; hint?: unknown };
    console.error("[employeeAutofill] 조회 실패:", { code: e?.code ?? "(unknown)", message: e?.message, details: e?.details ?? "(none)", hint: e?.hint ?? "(none)" });
    return null;
  }
}
