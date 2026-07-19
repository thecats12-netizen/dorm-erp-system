// 시험관리 사원 자동입력 서비스(신규 · 조회 전용).
//  - 사원 선택 시 사원/PM/DM 인증/라이선스 계획/규칙을 "병렬 최소 요청"으로 조회해 자동입력 payload 반환(N+1 금지).
//  - 실제 테이블만 사용: exam_personnel, pm_certifications, dm_certifications, employee_license_plan, exam_rules.
//    (존재하지 않는 employee_certifications 는 사용하지 않음.)
//  - tenant_id 조건 필수. service_role_key 미사용. snake_case(DB) → camelCase(payload) 명시 매핑.
//  - 인증 컬럼은 프로젝트별 편차가 있어 select("*") + 방어적 접근(존재하지 않는 컬럼 추측/에러 방지).
import { supabase, isSupabaseAvailable } from "../../../services/supabaseService";
import { loadPlansForEmployee, remainingMonths, isOverdue, todayYmd, addMonths, toYmd, resolveEmployeeScope, buildLadderForScope, type EmployeeLicensePlan } from "./licensePlanService";
import { calculatePmLevel, calculateDmLevel } from "./examAutomationService";
import type { EmployeeAutofill } from "../types/employeeLookup";

type Row = Record<string, unknown>;
const asText = (v: unknown): string => (v == null ? "" : String(v).trim());
const ymd = (v: unknown): string | null => { const s = asText(v); return s ? s.slice(0, 10) : null; };
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

type LicenseSummary = EmployeeAutofill["licenseSummary"];

// 공통 라이선스 요약 계산(순수 함수 · 단건/배치 공용 — 계산 로직 중복 방지).
//  입력: 한 직원의 person/plans/apps + tenant 마스터(levels/rules/processes/parts/groups). DB 접근 없음.
export function computeLicenseSummary(inp: {
  person: Row; plans: EmployeeLicensePlan[]; apps: Row[];
  levels: Row[]; rules: Row[]; processes: Row[]; parts: Row[]; groups: Row[]; today: string;
}): LicenseSummary {
  const { person, plans, apps, levels, rules, processes, parts, groups, today } = inp;

  // 재시험 가능일: 최근 불합격/취소 응시 발생일 + 재시험 대기(기본 3개월). 없으면 null.
  const failDates = apps.filter((a) => /불합격|취소/.test(asText(a.status)))
    .map((a) => ymd(a.practical_pass_date) || ymd(a.written_pass_date) || ymd(a.updated_at))
    .filter((d): d is string => !!d).sort();
  const retestAvailableDate = failDates.length ? (addMonths(failDates[failDates.length - 1], 3) || null) : null;

  // 레벨 마스터: code→{name, rank}(code 우선, 없으면 name).
  const levelByCode = new Map<string, { name: string; rank: number }>();
  levels.filter((l) => l.is_active !== false).forEach((l) => {
    const code = asText(l.code) || asText(l.name);
    if (code) levelByCode.set(code, { name: asText(l.name) || code, rank: Number(l.rank_order) || 0 });
  });
  const rankOf = (code: unknown): number => levelByCode.get(asText(code))?.rank ?? -1;
  const warnings: string[] = [];

  const isAcquiredApp = (a: Row) => !!ymd(a.cert_acquired_date) || asText(a.cert_status) === "취득" || /인증\s*취득|실기\s*합격/.test(asText(a.status));
  const acquiredApps = apps.filter(isAcquiredApp)
    .sort((a, b) => asText(ymd(b.cert_acquired_date) || ymd(b.practical_pass_date)).localeCompare(asText(ymd(a.cert_acquired_date) || ymd(a.practical_pass_date))));
  const completedLevelCodes = plans.filter((p) => p.status === "completed").map((p) => asText(p.license_level)).filter(Boolean);
  const acquiredAppCodes = acquiredApps.map((a) => asText(a.category_code) || asText(a.pm_level) || asText(a.category)).filter(Boolean);
  const allAcquiredCodes = Array.from(new Set([...completedLevelCodes, ...acquiredAppCodes]));
  const acquiredStageCode = allAcquiredCodes.reduce<string | null>((best, c) => (rankOf(c) > rankOf(best ?? "") ? c : best), null);
  const highestAcquiredSortOrder = acquiredStageCode ? rankOf(acquiredStageCode) : null;
  const topAcqRow = acquiredStageCode ? acquiredApps.find((a) => (asText(a.category_code) || asText(a.pm_level) || asText(a.category)) === acquiredStageCode) : null;
  const acquiredDate = topAcqRow ? (ymd(topAcqRow.cert_acquired_date) || ymd(topAcqRow.practical_pass_date))
    : (acquiredStageCode ? ymd(plans.find((p) => asText(p.license_level) === acquiredStageCode && p.status === "completed")?.completed_date) : null);

  const activePlans = plans.filter((p) => p.status === "active").sort((a, b) => rankOf(a.license_level) - rankOf(b.license_level));
  if (activePlans.length > 1) warnings.push("진행 중(ACTIVE) 계획이 2건 이상입니다. 확인이 필요합니다.");
  const active = activePlans[0] || null;
  const activeLevelCodes = activePlans.map((p) => asText(p.license_level));

  const scope = resolveEmployeeScope(person, processes, parts, groups);
  const ladder = buildLadderForScope(levels, rules, scope);
  const excluded = new Set<string>(allAcquiredCodes.map(asText));
  if (active) excluded.add(asText(active.license_level));
  apps.forEach((a) => { const st = asText(a.status); if (!/취소|불합격|미취득/.test(st) && /진행|대기|예정|승인/.test(st)) { const lv = asText(a.category_code) || asText(a.pm_level); if (lv) excluded.add(lv); } });
  const acqRank = acquiredStageCode ? rankOf(acquiredStageCode) : -1;
  const nextCands = ladder.filter((s) => (levelByCode.get(s.level_code)?.rank ?? s.rank_order) > acqRank && !excluded.has(s.level_code));
  let nextRecommendedStageCode: string | null = null; let recommendationReason: string | null = null;
  if (!scope.resolved) recommendationReason = "공정 기준정보가 연결되지 않았습니다.";
  else if (ladder.length === 0) recommendationReason = "공정 기준 인증 규칙이 없습니다.";
  else if (nextCands.length === 0) recommendationReason = acquiredStageCode ? "다음 추천 단계가 없습니다(최종 단계 취득 또는 진행 중)." : "추천할 다음 단계가 없습니다.";
  else { nextRecommendedStageCode = nextCands[0].level_code; recommendationReason = "현재 취득 단계 다음 순서(공정 기준)"; }
  const nextEligibleLevelCodes = nextCands.map((s) => s.level_code);

  if (plans.length === 0) warnings.push(acquiredStageCode ? "시험 취득 이력은 있으나 라이선스 계획이 없습니다." : "라이선스 계획이 없습니다.");
  if (!asText(person.process_id)) warnings.push("공정 기준정보가 연결되지 않았습니다.");
  if (acquiredStageCode && active && rankOf(active.license_level) <= rankOf(acquiredStageCode)) warnings.push("진행 중 단계와 취득 단계가 일치하지 않습니다.");
  const source: LicenseSummary["source"] =
    (completedLevelCodes.length || active) ? (acquiredAppCodes.length ? "mixed" : "license_plan") : (acquiredAppCodes.length ? "exam_application" : "none");

  const activeTargetDate = active ? (active.target_date ?? null) : null;
  const remDays = activeTargetDate && /^\d{4}-\d{2}-\d{2}$/.test(toYmd(activeTargetDate))
    ? Math.round((new Date(toYmd(activeTargetDate)).getTime() - new Date(today).getTime()) / 86400000) : null;
  const latestAppStatus = apps.length ? (asText([...apps].sort((a, b) => asText(b.updated_at).localeCompare(asText(a.updated_at)))[0].status) || null) : null;

  return {
    currentStage: acquiredStageCode || (active ? asText(active.license_level) : null),
    nextStage: nextRecommendedStageCode,
    activePlanId: active ? active.id : null,
    targetDate: activeTargetDate,
    remainingMonths: active ? remainingMonths(active.target_date, today) : null,
    overdue: active ? isOverdue(active, today) : false,
    retestAvailableDate,
    acquiredStageCode,
    acquiredStageName: acquiredStageCode ? (levelByCode.get(acquiredStageCode)?.name ?? acquiredStageCode) : null,
    acquiredDate,
    activeStageCode: active ? asText(active.license_level) : null,
    activeStageName: active ? (levelByCode.get(asText(active.license_level))?.name ?? asText(active.license_level)) : null,
    activeTargetDate,
    remainingDays: remDays,
    isOverdue: active ? isOverdue(active, today) : false,
    nextRecommendedStageCode,
    nextRecommendedStageName: nextRecommendedStageCode ? (levelByCode.get(nextRecommendedStageCode)?.name ?? nextRecommendedStageCode) : null,
    recommendationReason,
    isEligibleForNextStage: !!nextRecommendedStageCode,
    source,
    warnings,
    planStatus: active ? active.status : (plans[0]?.status ?? null),
    applicationStatus: latestAppStatus,
    highestAcquiredSortOrder,
    completedLevelCodes,
    activeLevelCodes,
    nextEligibleLevelCodes,
    acquiredStage: acquiredStageCode,
  };
}

// 여러 직원의 라이선스 요약을 N+1 없이 배치 계산(보드용). tenant 마스터 1회 로드 후 메모리 계산.
export async function loadEmployeeLicenseSummaries(tenantId: string, personnelIds: string[]): Promise<Map<string, LicenseSummary>> {
  const out = new Map<string, LicenseSummary>();
  if (!isSupabaseAvailable() || !supabase || !tenantId) return out;
  const ids = Array.from(new Set(personnelIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const [personsR, plansR, levelsR, rulesR, procR, partR, groupR] = await Promise.all([
    supabase.from("exam_personnel").select("*").eq("tenant_id", tenantId).in("id", ids).is("deleted_at", null),
    supabase.from("employee_license_plan").select("*").eq("tenant_id", tenantId).in("employee_id", ids).is("deleted_at", null),
    supabase.from("exam_levels").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_rules").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_processes").select("id, part_id").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_parts").select("id, group_id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
    supabase.from("exam_groups").select("id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
  ]);
  const persons = (personsR.data as Row[]) || [];
  const empNos = Array.from(new Set(persons.map((p) => asText(p.employee_no)).filter(Boolean)));
  const orParts = [`personnel_id.in.(${ids.join(",")})`];
  if (empNos.length) orParts.push(`employee_no.in.(${empNos.map((e) => `"${e.replace(/["(),]/g, "")}"`).join(",")})`);
  const appsR = await supabase.from("exam_applications").select("*").eq("tenant_id", tenantId).is("deleted_at", null).or(orParts.join(","));
  const apps = (appsR.data as Row[]) || [];
  const plansByEmp = new Map<string, EmployeeLicensePlan[]>();
  ((plansR.data as EmployeeLicensePlan[]) || []).forEach((p) => { const k = asText(p.employee_id); (plansByEmp.get(k) || plansByEmp.set(k, []).get(k)!).push(p); });
  const levels = (levelsR.data as Row[]) || [], rules = (rulesR.data as Row[]) || [];
  const processes = (procR.data as Row[]) || [], partsD = (partR.data as Row[]) || [], groups = (groupR.data as Row[]) || [];
  const today = todayYmd();
  for (const person of persons) {
    const pid = asText(person.id), eno = asText(person.employee_no);
    const empApps = apps.filter((a) => asText(a.personnel_id) === pid || (!!eno && asText(a.employee_no) === eno));
    out.set(pid, computeLicenseSummary({ person, plans: plansByEmp.get(pid) || [], apps: empApps, levels, rules, processes, parts: partsD, groups, today }));
  }
  return out;
}

// 사원 id 로 자동입력 정보를 한 번에 조회. 실패/미존재 시 null.
export async function loadEmployeeAutofill(employeeId: string, tenantId: string): Promise<EmployeeAutofill | null> {
  if (!isSupabaseAvailable() || !supabase || !employeeId || !tenantId) return null;
  try {
    // 1) 사원 먼저 확정(사번 확보) → 응시 이력은 personnel_id OR employee_no 로 매칭한다.
    //    (평면 데이터의 exam_applications.personnel_id 는 null 이고 employee_no 만 있으므로 personnel_id 만으로는 0건이 됨)
    const personRes = await supabase.from("exam_personnel").select("*").eq("tenant_id", tenantId).eq("id", employeeId).is("deleted_at", null).limit(1);
    const person = ((personRes.data as Row[]) || [])[0];
    if (!person) return null;
    const empNo = asText(person.employee_no); // 사번 정규화(앞뒤 공백 제거 · 선행 0 유지 · 숫자변환 금지)
    let appsQuery = supabase.from("exam_applications").select("*").eq("tenant_id", tenantId).is("deleted_at", null);
    appsQuery = empNo ? appsQuery.or(`personnel_id.eq.${employeeId},employee_no.eq.${empNo}`) : appsQuery.eq("personnel_id", employeeId);

    const [pmRes, dmRes, rulesRes, appsRes, plans, levelsRes, procRes, partRes, groupRes] = await Promise.all([
      supabase.from("pm_certifications").select("*").eq("tenant_id", tenantId).eq("personnel_id", employeeId).is("deleted_at", null),
      supabase.from("dm_certifications").select("*").eq("tenant_id", tenantId).eq("personnel_id", employeeId).is("deleted_at", null),
      supabase.from("exam_rules").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
      appsQuery,
      loadPlansForEmployee(employeeId, tenantId),
      supabase.from("exam_levels").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("exam_processes").select("id, part_id").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("exam_parts").select("id, group_id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("exam_groups").select("id, category_id").eq("tenant_id", tenantId).is("deleted_at", null),
    ]);

    const pmCerts = (pmRes.data as Row[]) || [];
    const dmCerts = (dmRes.data as Row[]) || [];
    const rules = (rulesRes.data as Row[]) || [];
    const apps = (appsRes.data as Row[]) || [];
    const levels = (levelsRes.data as Row[]) || [];
    const today = todayYmd();

    // 공통 라이선스 요약(순수 함수 재사용 — 보드/배치와 동일 계산).
    const summary = computeLicenseSummary({
      person, plans, apps, levels, rules,
      processes: (procRes.data as Row[]) || [], parts: (partRes.data as Row[]) || [], groups: (groupRes.data as Row[]) || [],
      today,
    });

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
      licenseSummary: summary,
      pmSummary: {
        currentLevel: pmLevel || null,
        eligibleLevel: summary.nextRecommendedStageCode,
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
