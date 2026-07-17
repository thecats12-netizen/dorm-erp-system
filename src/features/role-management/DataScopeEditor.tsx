import { useEffect, useMemo, useState } from "react";
import { listExamRefOptions } from "../exam-management/services/examMasterService";
import { loadRoleScopes, saveRoleScopes } from "./customRoleScopeService";
import {
  ORG_VALUES, REGION_VALUES, GENDER_VALUES, DORM_MODE_VALUES, PROCESS_MODE_VALUES, OWNER_VALUES,
  type ScopeRow, type ActionScope,
} from "./scopeCatalog";

// 사용자 정의 권한의 데이터 범위 설정(자체 저장 + 감사로그).
//  - add-only(합집합). 기존 지역/성별/담당기숙사 범위 무변경. alert/confirm 은 appConfirm 위임.
//  - 공정 실제 강제는 exam_user_process_scopes(기존). 여기서는 표시/병합 참고용으로 저장.
type DormOption = { id: string; label: string };
type Props = {
  roleId: string | null;
  roleName: string;
  tenantId: string;
  actorId: string;
  darkMode: boolean;
  dormOptions: DormOption[];
  onToast?: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
};

const toggleIn = (set: Set<string>, v: string) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n; };

export default function DataScopeEditor({ roleId, roleName, tenantId, actorId, darkMode, dormOptions, onToast, appConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processOptions, setProcessOptions] = useState<DormOption[]>([]);
  // 선택 상태
  const [org, setOrg] = useState("all");
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [genders, setGenders] = useState<Set<string>>(new Set());
  const [dormMode, setDormMode] = useState("all");
  const [dormIds, setDormIds] = useState<Set<string>>(new Set());
  const [processMode, setProcessMode] = useState("all");
  const [processIds, setProcessIds] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState("all");
  const [readOnly, setReadOnly] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [initialKey, setInitialKey] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!roleId) return;
      setLoading(true);
      const [scopes, procs] = await Promise.all([loadRoleScopes(roleId, tenantId), listExamRefOptions("exam_processes", tenantId).catch(() => [])]);
      if (!alive) return;
      setProcessOptions(procs as DormOption[]);
      // 로드된 범위를 상태로 복원.
      const rows = scopes.rows;
      const val = (t: string) => rows.filter((r) => r.scope_type === t).map((r) => r.scope_value);
      const FIXED = new Set(["all", "assigned", "region", "tenant", "own"]);
      setOrg(val("organization")[0] || "all");
      setRegions(new Set(val("region")));
      setGenders(new Set(val("gender")));
      const dormV = val("dorm");
      setDormMode(dormV.find((v) => FIXED.has(v)) || (dormV.length ? "select" : "all"));
      setDormIds(new Set(dormV.filter((v) => !FIXED.has(v))));
      const procV = val("process");
      setProcessMode(procV.find((v) => FIXED.has(v)) || (procV.length ? "select" : "all"));
      setProcessIds(new Set(procV.filter((v) => !FIXED.has(v))));
      setOwner(val("owner")[0] || "all");
      setReadOnly(rows.some((r) => r.action_scope === "read"));
      const vf = rows.find((r) => r.valid_from)?.valid_from || "";
      const vu = rows.find((r) => r.valid_until)?.valid_until || "";
      setValidFrom(vf ? vf.slice(0, 10) : "");
      setValidUntil(vu ? vu.slice(0, 10) : "");
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [roleId, tenantId]);

  // 현재 선택 → 저장 행 목록.
  const buildRows = (): ScopeRow[] => {
    const action: ActionScope = readOnly ? "read" : "all";
    const vf = validFrom ? new Date(validFrom).toISOString() : null;
    const vu = validUntil ? new Date(validUntil).toISOString() : null;
    const rows: ScopeRow[] = [];
    const push = (scope_type: ScopeRow["scope_type"], scope_value: string) =>
      rows.push({ scope_type, scope_value, action_scope: action, valid_from: vf, valid_until: vu });
    if (org && org !== "all") push("organization", org);
    regions.forEach((r) => push("region", r));
    genders.forEach((g) => push("gender", g));
    if (dormMode === "select") dormIds.forEach((d) => push("dorm", d));
    else if (dormMode !== "all") push("dorm", dormMode);
    if (processMode === "select") processIds.forEach((p) => push("process", p));
    else if (processMode !== "all") push("process", processMode);
    if (owner && owner !== "all") push("owner", owner);
    return rows;
  };

  const currentKey = useMemo(() => JSON.stringify(buildRows()), [org, regions, genders, dormMode, dormIds, processMode, processIds, owner, readOnly, validFrom, validUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading && roleId && initialKey === "") setInitialKey(currentKey); }, [loading]); // 초기값 스냅샷
  const dirty = initialKey !== "" && currentKey !== initialKey;

  const save = async () => {
    if (saving || !roleId) return;
    const rows = buildRows();
    const ok = await appConfirm("데이터 범위 저장", `'${roleName}' 권한의 데이터 범위를 저장합니다.\n\n총 ${rows.length}개 범위${readOnly ? " · 조회 전용" : ""}\n\n이 권한을 가진 계정에 추가로 허용되는 범위입니다(기존 범위 축소 없음).`, { confirmText: "범위 저장" });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await saveRoleScopes(roleId, tenantId, actorId, rows);
      setInitialKey(currentKey);
      if (res.partialError) onToast?.(`일부 범위 저장 실패: ${res.partialError}`);
      else onToast?.(`데이터 범위를 저장했습니다. (추가 ${res.added} · 해제 ${res.removed})`);
    } catch (e) {
      onToast?.((e as { message?: string })?.message || "데이터 범위 저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  };

  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";
  const chip = (on: boolean) => on ? "bg-slate-900 text-white" : darkMode ? "border border-slate-600 text-slate-300" : "border border-slate-300 text-slate-600";

  if (!roleId) return <div className={`rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>먼저 권한을 저장한 뒤 데이터 범위를 설정할 수 있습니다.</div>;
  if (loading) return <div className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</div>;

  return (
    <div className="space-y-3 text-sm">
      <label className="block"><span className="mb-1 block text-slate-500">조직 범위</span>
        <select value={org} onChange={(e) => {
          const v = e.target.value;
          setOrg(v);
          // [충돌 방지] 전체 조직(all) 선택 시 조건별 범위(지역/성별/기숙사/공정/본인)를 자동 해제.
          if (v === "all") { setRegions(new Set()); setGenders(new Set()); setDormMode("all"); setDormIds(new Set()); setProcessMode("all"); setProcessIds(new Set()); setOwner("all"); }
        }} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`}>
          {ORG_VALUES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <div><span className="mb-1 block text-slate-500">지역 범위 (선택 없으면 추가 없음)</span>
        <div className="flex flex-wrap gap-1">{REGION_VALUES.filter((r) => r.value !== "all").map((r) => (
          <button key={r.value} type="button" onClick={() => setRegions((s) => toggleIn(s, r.value))} className={`rounded-lg px-2 py-1 text-xs ${chip(regions.has(r.value))}`}>{r.label}</button>
        ))}</div>
      </div>

      <div><span className="mb-1 block text-slate-500">성별 범위</span>
        <div className="flex flex-wrap gap-1">{GENDER_VALUES.filter((g) => g.value !== "all").map((g) => (
          <button key={g.value} type="button" onClick={() => setGenders((s) => toggleIn(s, g.value))} className={`rounded-lg px-2 py-1 text-xs ${chip(genders.has(g.value))}`}>{g.label}</button>
        ))}</div>
      </div>

      <label className="block"><span className="mb-1 block text-slate-500">기숙사 범위</span>
        <select value={dormMode} onChange={(e) => setDormMode(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`}>
          {DORM_MODE_VALUES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          <option value="select">직접 선택</option>
        </select>
      </label>
      {dormMode === "select" && (
        <div className={`max-h-32 overflow-y-auto rounded-xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          {dormOptions.length === 0 ? <div className="text-xs text-slate-400">기숙사 없음</div> : dormOptions.map((d) => (
            <label key={d.id} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={dormIds.has(d.id)} onChange={() => setDormIds((s) => toggleIn(s, d.id))} className="h-3.5 w-3.5" />{d.label}</label>
          ))}
        </div>
      )}

      <label className="block"><span className="mb-1 block text-slate-500">시험 공정 범위 <span className="text-xs text-slate-400">(실제 강제는 시험 공정 권한)</span></span>
        <select value={processMode} onChange={(e) => setProcessMode(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`}>
          {PROCESS_MODE_VALUES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="select">직접 선택</option>
        </select>
      </label>
      {processMode === "select" && (
        <div className={`max-h-32 overflow-y-auto rounded-xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          {processOptions.length === 0 ? <div className="text-xs text-slate-400">공정 없음</div> : processOptions.map((p) => (
            <label key={p.id} className="flex items-center gap-2 py-0.5 text-xs"><input type="checkbox" checked={processIds.has(p.id)} onChange={() => setProcessIds((s) => toggleIn(s, p.id))} className="h-3.5 w-3.5" />{p.label}</label>
          ))}
        </div>
      )}

      <label className="block"><span className="mb-1 block text-slate-500">본인 데이터 범위</span>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`}>
          {OWNER_VALUES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="h-4 w-4" /><span>조회 전용(쓰기 권한을 새로 부여하지 않음)</span></label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-1 block text-slate-500">적용 시작일</span><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`} /></label>
        <label className="block"><span className="mb-1 block text-slate-500">적용 종료일</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`} /></label>
      </div>

      <div className="flex items-center justify-between">
        {dirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">변경사항 있음</span> : <span />}
        <button type="button" onClick={save} disabled={saving || !dirty} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">데이터 범위 저장</button>
      </div>
    </div>
  );
}
