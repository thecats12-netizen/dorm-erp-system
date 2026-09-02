import { useEffect, useMemo, useState } from "react";
import { listExamRows, type ExamRow } from "../exam-management/services/examMasterService";
import { DORM_SCOPE_TABS, MILITARY_TABS, isExamTab } from "./permissionCatalog";
import type { ScopeRow } from "./scopeCatalog";

// 사용자 정의 권한 상세보기 — 기숙사/시험/군대 데이터 범위를 사람이 읽는 이름으로 요약.
//  ⚠ UUID/process_id/scope_type 절대 미노출. 시험 공정은 그룹 > 제품군 > 공정 이름으로 변환.
//  서버 강제 상태 배지: 기숙사=적용 중(evaluator), 시험/군대=서버 강제 연결 예정(현재 저장/복원만).
type DormOption = { id: string; label: string; region?: string; gender?: string };
type Props = {
  scopeRows: ScopeRow[];
  permKeys: string[];
  dormOptions: DormOption[];
  tenantId: string;
  darkMode: boolean;
};

const genderLabel = (g?: string) => (g === "남" ? "남성" : g === "여" ? "여성" : g || "");
const FIXED = new Set(["all", "assigned", "region", "tenant", "own"]);

// 업무 영역 섹션(모듈 레벨 · 렌더 내부에서 컴포넌트 생성 금지).
function Section({ title, active, badge, darkMode, children }: { title: string; active: boolean; badge: React.ReactNode; darkMode: boolean; children: React.ReactNode }) {
  const card = darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white";
  return (
    <div className={`rounded-xl border p-2.5 ${card}`}>
      <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold">{title}</span>{active && badge}</div>
      {active ? children : <p className="text-xs text-slate-400">접근 권한 없음</p>}
    </div>
  );
}

export default function RoleDataScopeSummary({ scopeRows, permKeys, dormOptions, tenantId, darkMode }: Props) {
  // 시험 공정 id → 그룹 > 제품군 > 공정 이름.
  const [procPath, setProcPath] = useState<Map<string, { group: string; cat: string; name: string }>>(new Map());
  useEffect(() => {
    let alive = true;
    (async () => {
      const hasProcess = scopeRows.some((r) => r.scope_type === "process" && r.scope_value !== "all");
      if (!hasProcess) return;
      const [procRows, partRows, groupRows, catRows] = await Promise.all([
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_parts", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
      ]);
      if (!alive) return;
      const nm = (r?: ExamRow) => String(r?.name ?? r?.code ?? "").trim();
      const partById = new Map(partRows.map((r) => [String(r.id), r]));
      const groupById = new Map(groupRows.map((r) => [String(r.id), r]));
      const catById = new Map(catRows.map((r) => [String(r.id), r]));
      const m = new Map<string, { group: string; cat: string; name: string }>();
      procRows.forEach((p) => {
        const part = partById.get(String(p.part_id ?? ""));
        const gid = String(p.group_id ?? part?.group_id ?? "");
        const cid = String(p.category_id ?? part?.category_id ?? "");
        m.set(String(p.id), { group: nm(groupById.get(gid)) || "그룹 미지정", cat: nm(catById.get(cid)) || "제품군 미지정", name: nm(p) || "공정" });
      });
      setProcPath(m);
    })();
    return () => { alive = false; };
  }, [scopeRows, tenantId]);

  const areas = useMemo(() => {
    const tabs = permKeys.map((k) => k.split(".")[0]);
    return {
      dorm: tabs.some((t) => DORM_SCOPE_TABS.has(t)),
      exam: tabs.some((t) => isExamTab(t)),
      military: tabs.some((t) => t !== "militarySettings" && MILITARY_TABS.has(t)),
    };
  }, [permKeys]);

  const val = (t: string) => scopeRows.filter((r) => r.scope_type === t).map((r) => r.scope_value);
  const readOnly = scopeRows.some((r) => r.action_scope === "read");

  // 기숙사 요약
  const dormSummary = useMemo(() => {
    const dormV = val("dorm"); const regionV = val("region"); const genderV = val("gender");
    const ids = dormV.filter((v) => !FIXED.has(v));
    if (dormV.includes("assigned")) return { mode: "담당 기숙사만", items: [] as string[] };
    if (ids.length) return { mode: "직접 선택", items: dormOptions.filter((d) => ids.includes(d.id)).map((d) => d.label) };
    if (regionV.length || genderV.length) return { mode: "조건 선택", items: [regionV.length ? `지역: ${regionV.join(", ")}` : "", genderV.length ? `성별: ${genderV.map(genderLabel).join(", ")}` : ""].filter(Boolean) };
    return { mode: "전체 기숙사", items: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRows, dormOptions]);

  // 시험 요약(그룹 > 제품군 > 공정)
  const examTree = useMemo(() => {
    const procV = val("process");
    if (procV.includes("all")) return { all: true, groups: [] as Array<{ group: string; cats: Array<{ cat: string; procs: string[] }> }> };
    const ids = procV.filter((v) => v !== "all");
    const byGroup = new Map<string, Map<string, string[]>>();
    ids.forEach((pid) => {
      const p = procPath.get(pid);
      const group = p?.group ?? "알 수 없는 공정"; const cat = p?.cat ?? ""; const name = p?.name ?? "알 수 없는 공정";
      const g = byGroup.get(group) ?? byGroup.set(group, new Map()).get(group)!;
      (g.get(cat) ?? g.set(cat, []).get(cat)!).push(name);
    });
    const groups = Array.from(byGroup.entries()).map(([group, cats]) => ({ group, cats: Array.from(cats.entries()).map(([cat, procs]) => ({ cat, procs })) }));
    return { all: false, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRows, procPath]);

  // 군대 요약(부서명)
  const deptV = val("military_department");

  const okBadge = <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6rem] font-medium text-emerald-700 ring-1 ring-emerald-200">접근 범위 적용 중</span>;
  const pendingBadge = <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6rem] font-medium text-amber-700 ring-1 ring-amber-200">서버 강제 연결 예정</span>;
  const pendingNote = <p className="mt-1 text-[0.65rem] text-amber-600">⚠ 이 데이터 범위는 현재 권한 설정값으로 저장되며, 서버 접근 제어는 후속 보안 단계에서 연결됩니다.</p>;

  return (
    <div className="space-y-2">
      <Section title="기숙사관리 데이터 범위" active={areas.dorm} badge={okBadge} darkMode={darkMode}>
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <div className="font-medium">{dormSummary.mode}{readOnly ? " · 조회 전용" : ""}</div>
          {dormSummary.items.length > 0 && <ul className="ml-3 mt-0.5 list-disc text-slate-500">{dormSummary.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
        </div>
      </Section>

      <Section title="시험관리 데이터 범위" active={areas.exam} badge={pendingBadge} darkMode={darkMode}>
        {examTree.all ? (
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">전체 시험 공정</div>
        ) : examTree.groups.length === 0 ? (
          <div className="text-xs text-slate-400">선택한 공정 없음</div>
        ) : (
          <ul className="space-y-1">
            {examTree.groups.flatMap((g) => g.cats.flatMap((c) => c.procs.map((p) => ({ group: g.group, cat: c.cat, proc: p, key: `${g.group}|${c.cat}|${p}` }))))
              .map((b) => (
                <li key={b.key} className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-200">{b.group}</span>
                  <span className="text-slate-300">›</span>
                  <span className="text-slate-500">{b.cat || "제품군"}</span>
                  <span className="text-slate-300">›</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{b.proc}</span>
                </li>
              ))}
          </ul>
        )}
        {pendingNote}
      </Section>

      <Section title="군대관리 데이터 범위" active={areas.military} badge={pendingBadge} darkMode={darkMode}>
        {deptV.length === 0 ? (
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">전체 부서</div>
        ) : (
          <div className="text-xs">
            <div className="font-medium text-slate-600 dark:text-slate-300">선택한 부서</div>
            <ul className="ml-3 mt-0.5 list-disc text-slate-500">{deptV.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        )}
        {pendingNote}
      </Section>
    </div>
  );
}
