// 시험관리 공통 분석 서비스(신규 · 조회 전용).
//  - 대시보드/보고서가 "동일 정본"을 쓰도록, 라이선스 계획(employee_license_plan) 집계는
//    licensePlanService 의 summarizePlans/isOverdue 를 그대로 재사용한다(중복 계산식 금지).
//  - 자동화 오류/확인필요를 계획 데이터에서 도출(§8 중 계획 기반 항목). 인증번호 중복 등 인증 기반 항목은 확장 여지.
//  - tenant 격리: loadAllPlans(tenantId) 가 tenant 로 제한. service_role 미사용.
import { loadAllPlans, summarizePlans, isOverdue, todayYmd, type EmployeeLicensePlan, type PlanSummary } from "./licensePlanService";

export type AutomationIssue = {
  employeeId: string;
  employeeNo?: string;
  name?: string;
  type: string;    // 한글 유형(내부 코드값 미노출)
  stage?: string;
  detail: string;
};

export type LicenseAnalytics = { summary: PlanSummary; issues: AutomationIssue[]; total: number };

type PersonLite = { id?: unknown; employee_no?: unknown; name?: unknown; employment_status?: unknown };
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// 라이선스 계획 기반 통계 + 자동화 오류/확인필요 도출. personnel 로 사번/성명/재직 보강.
export async function loadLicenseAnalytics(tenantId: string, personnel: PersonLite[] = []): Promise<LicenseAnalytics> {
  const plans = await loadAllPlans(tenantId);   // tenant 격리 + soft delete 제외(서비스 내부)
  const summary = summarizePlans(plans);
  const today = todayYmd();

  const byEmpId = new Map<string, PersonLite>();
  personnel.forEach((p) => { const id = s(p.id); if (id) byEmpId.set(id, p); });
  const enrich = (empId: string) => { const per = byEmpId.get(empId); return { employeeNo: per ? s(per.employee_no) : undefined, name: per ? s(per.name) : undefined }; };

  const issues: AutomationIssue[] = [];
  const activeByEmp = new Map<string, number>();

  for (const p of plans as EmployeeLicensePlan[]) {
    const base = { employeeId: p.employee_id, ...enrich(p.employee_id), stage: p.license_level };
    if (p.status === "active") activeByEmp.set(p.employee_id, (activeByEmp.get(p.employee_id) || 0) + 1);
    if (p.status === "completed" && !p.completed_date) issues.push({ ...base, type: "완료일 누락", detail: "완료 상태이나 취득일(completed_date)이 없습니다." });
    if (p.status === "active" && !p.target_date && p.base_date) issues.push({ ...base, type: "목표일 누락", detail: "진행 중이나 목표취득일이 계산되지 않았습니다." });
    if (isOverdue(p, today)) issues.push({ ...base, type: "기한 초과", detail: `목표취득일(${p.target_date}) 경과 · 미완료.` });
    if (p.status === "expired") issues.push({ ...base, type: "만료(기한초과)", detail: "기한 초과로 만료 처리된 단계입니다." });
  }
  // 동일 사원 active 단계가 2개 이상(동시 진행 이상)
  activeByEmp.forEach((cnt, empId) => {
    if (cnt > 1) issues.push({ employeeId: empId, ...enrich(empId), type: "동시 진행 단계", detail: `진행 중(active) 단계가 ${cnt}개 존재합니다.` });
  });
  // 재직 사원인데 계획 미생성
  const empWithPlan = new Set(plans.map((p) => s(p.employee_id)));
  for (const per of personnel) {
    const id = s(per.id); if (!id) continue;
    const inactive = /퇴직|퇴사/.test(s(per.employment_status));
    if (!inactive && !empWithPlan.has(id)) issues.push({ employeeId: id, employeeNo: s(per.employee_no), name: s(per.name), type: "계획 미생성", detail: "재직 사원이나 라이선스 계획이 없습니다." });
  }
  return { summary, issues, total: plans.length };
}
