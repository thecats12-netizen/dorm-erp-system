// 인증단계 단일 기준 resolver — 화면 표기명(Single Job/M1~M4/…)과 실제 DB identity(exam_levels.id/code/name)를 분리.
//  현재 활성 master 예: Y072/Single, Y073/Multi 1, Y074/Multi 2, Y075/Multi 3, Y076/Multi 4, DM/DM, SENIOR_DM/Senior DM, MAESTRO/Maestro.
//  ⚠ 문자열을 새 DB 값으로 저장하지 않는다. alias 는 UI/legacy 호환 resolve 용이며 exam_levels 에 새 row 를 만들지 않는다.
//  우선순위: 1) level_id FK  2) code exact  3) name exact  4) 아래 alias exact map  5) 실패(null). fuzzy 금지.
import type { ExamRow } from "../services/examMasterService";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

// alias(입력, 소문자) → 그 단계의 canonical code/name 후보(소문자). code 또는 name 어느 쪽이든 정확 일치하면 채택.
const LEVEL_ALIAS: Record<string, string[]> = {
  "single job": ["single", "y072"], "singlejob": ["single", "y072"], "single": ["single", "y072"], "single_job": ["single", "y072"],
  "m1": ["multi 1", "y073"], "multi 1": ["multi 1", "y073"], "multi1": ["multi 1", "y073"],
  "m2": ["multi 2", "y074"], "multi 2": ["multi 2", "y074"], "multi2": ["multi 2", "y074"],
  "m3": ["multi 3", "y075"], "multi 3": ["multi 3", "y075"], "multi3": ["multi 3", "y075"],
  "m4": ["multi 4", "y076"], "multi 4": ["multi 4", "y076"], "multi4": ["multi 4", "y076"],
  "d.m": ["dm"], "dm": ["dm"],
  "senior dm": ["senior dm", "senior_dm"], "senior_dm": ["senior dm", "senior_dm"],
  "master": ["maestro"], "maestro": ["maestro"],
};

// 입력(코드/이름/화면 alias/level_id)을 현재 활성 exam_levels 의 level_id 로 해석. 실패 시 null(호출부에서 안전 처리).
export function normalizeCertificationLevel(input: unknown, levels: ExamRow[]): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const active = (levels || []).filter((l) => l.is_active !== false && !l.deleted_at);
  // 1) level_id FK: 입력이 이미 활성 master 의 id 면 그대로.
  if (active.some((l) => String(l.id) === s)) return s;
  const key = norm(s);
  const uniq = (list: ExamRow[]) => Array.from(new Set(list.map((m) => String(m.id))));
  // 2) code exact
  let ids = uniq(active.filter((l) => norm(l.code) === key));
  if (ids.length === 1) return ids[0];
  // 3) name exact
  ids = uniq(active.filter((l) => norm(l.name) === key));
  if (ids.length === 1) return ids[0];
  // 4) alias exact map → canonical code/name 정확 일치
  const alias = LEVEL_ALIAS[key];
  if (alias) {
    for (const canon of alias) {
      ids = uniq(active.filter((l) => norm(l.code) === canon || norm(l.name) === canon));
      if (ids.length === 1) return ids[0];
    }
  }
  return null; // fuzzy 매칭 금지
}

// 시험 응시행 취득 완료 판정(응시관리 canonical 과 동일 기준). 새 판정식 아님.
export function isApplicationAcquired(a: ExamRow): boolean {
  if (a?.cert_status_manual === true && (a.cert_status === "취득" || a.cert_status === "미취득")) return a.cert_status === "취득";
  return String(a?.status ?? "") === "인증 취득" || !!a?.practical_pass_date || !!a?.cert_acquired_date;
}

// 사원의 "취득 완료한 인증단계 level_id 집합"(FK 우선 · legacy category_code alias resolve). 옵션: 공정(process_id) scope.
export function acquiredLevelIds(
  apps: ExamRow[], employeeNo: string, levels: ExamRow[], opts?: { processId?: string | null; excludeAppId?: string },
): Set<string> {
  const out = new Set<string>();
  const emp = String(employeeNo ?? ""); if (!emp) return out;
  const pid = String(opts?.processId ?? "");
  for (const a of apps || []) {
    if (a.deleted_at) continue;
    if (String(a.employee_no ?? "") !== emp) continue;
    if (opts?.excludeAppId && String(a.id ?? "") === String(opts.excludeAppId)) continue;
    if (!isApplicationAcquired(a)) continue;
    if (pid && a.process_id && String(a.process_id) !== pid) continue; // 공정 scope(양쪽 존재 시)
    const lid = String(a.level_id ?? "");
    const resolved = lid ? normalizeCertificationLevel(lid, levels) : normalizeCertificationLevel(a.category_code, levels);
    if (resolved) out.add(resolved);
  }
  return out;
}
