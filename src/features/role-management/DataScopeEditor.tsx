import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "../../types";
import { listExamRows, type ExamRow } from "../exam-management/services/examMasterService";
import { loadRoleScopes, saveRoleScopes } from "./customRoleScopeService";
import { loadRolePermissions } from "./customRolePermissionService";
import { DORM_SCOPE_TABS, MILITARY_TABS, isExamTab, ACTION_LABEL, type ActionKey } from "./permissionCatalog";
import { OWNER_VALUES, type ScopeRow, type ActionScope } from "./scopeCatalog";

// 사용자 정의 권한의 "업무별 데이터 접근 범위" 설정(2차 UI).
//  - 조직(organization) 범위는 UI 미노출(한 회사 운영). 기존 저장값/ tenant 격리/ RLS 는 불변(숨김만).
//  - 업무 영역(기숙사/시험/군대)은 메뉴·기능 권한에서 해당 메뉴를 선택한 경우에만 카드 표시.
//  - 저장 구조(custom_role_scopes: region/gender/dorm/process/owner)와 기존 evaluator 는 그대로 재사용.
//  - ⚠ 시험 process scope 는 아직 Production exam RLS 에 강제 연결되지 않음 → "저장/복원"까지만(과장 표현 금지).
type DormOption = { id: string; label: string; region?: string; gender?: string };
type Props = {
  roleId: string | null;
  roleName: string;
  tenantId: string;
  actorId: string;
  darkMode: boolean;
  dormOptions: DormOption[];
  dormsLoading?: boolean;
  menus?: MenuItem[];        // 군대 요약(탭→메뉴명) 용
  militaryDeptOptions?: string[]; // 군대 부서 옵션(이름) — 기준정보 ∪ 인사 unit
  permissionKeys?: string[]; // 상위 공유 draft(현재 화면 선택) — 업무영역 판정 SoT(저장 전에도 즉시 반영)
  permissionsDirty?: boolean; // 메뉴·기능 권한 미저장 변경 여부
  reloadSignal?: number;     // (fallback) 메뉴·기능 권한 저장 시 +1
  onToast?: (m: string) => void;
  appConfirm: (title: string, message: string, opts?: { confirmText?: string; cancelText?: string; tone?: "default" | "danger" }) => Promise<boolean>;
};

const toggleIn = (set: Set<string>, v: string) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n; };
const genderLabel = (g?: string) => (g === "남" ? "남성" : g === "여" ? "여성" : g || "");

type ExamNode = { id: string; name: string };
type ExamCombo = { key: string; gid: string; cid: string; pid: string };
let comboSeq = 0;
const newComboKey = () => `c${++comboSeq}`;

export default function DataScopeEditor({ roleId, roleName, tenantId, actorId, darkMode, dormOptions, dormsLoading = false, menus = [], militaryDeptOptions = [], permissionKeys, permissionsDirty = false, reloadSignal = 0, onToast, appConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permKeys, setPermKeys] = useState<string[]>([]);
  // 업무영역 판정 SoT = 상위 공유 draft(현재 화면 선택). 상위 미제공 시에만 자체 로드값(permKeys) 폴백.
  const effectiveKeys = permissionKeys ?? permKeys;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dormSearch, setDormSearch] = useState("");

  // 시험 계층 데이터(그룹/제품군/공정) — 저장값은 process_id 만.
  const [groupsList, setGroupsList] = useState<ExamNode[]>([]);
  const [catsByGroup, setCatsByGroup] = useState<Map<string, ExamNode[]>>(new Map());
  const [procByGroupCat, setProcByGroupCat] = useState<Map<string, ExamNode[]>>(new Map());
  const [procMeta, setProcMeta] = useState<Map<string, { gid: string; cid: string; name: string }>>(new Map());

  // 선택 상태
  const [org, setOrg] = useState("all");                 // 숨김 · 기존값 보존
  const [dormChoice, setDormChoice] = useState<"all" | "assigned" | "condition" | "select">("all");
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [genders, setGenders] = useState<Set<string>>(new Set());
  const [dormIds, setDormIds] = useState<Set<string>>(new Set());
  const [examMode, setExamMode] = useState<"all" | "select">("all");
  const [examCombos, setExamCombos] = useState<ExamCombo[]>([]);
  const [deptMode, setDeptMode] = useState<"all" | "select">("all");   // 군대 부서
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set());
  const [deptSearch, setDeptSearch] = useState("");
  const [owner, setOwner] = useState("all");             // 고급 · 미강제 안내
  const [readOnly, setReadOnly] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [initialKey, setInitialKey] = useState("");

  const loadPerms = async () => {
    if (!roleId) return;
    const p = await loadRolePermissions(roleId, tenantId).catch(() => ({ keys: [] as string[] }));
    setPermKeys(p.keys || []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!roleId) return;
      setLoading(true);
      const [scopes, perms, procRows, partRows, groupRows, catRows] = await Promise.all([
        loadRoleScopes(roleId, tenantId),
        loadRolePermissions(roleId, tenantId).catch(() => ({ keys: [] as string[] })),
        listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_parts", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
        listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
      ]);
      if (!alive) return;
      setPermKeys((perms as { keys: string[] }).keys || []);

      // 시험 계층 맵 구성. 공정의 실제 (group_id, category_id) = 신규 컬럼 우선, 없으면 part 로 보완(레거시).
      const nm = (r?: ExamRow) => String(r?.name ?? r?.code ?? "").trim();
      const partById = new Map(partRows.map((r) => [String(r.id), r]));
      const gList: ExamNode[] = groupRows.filter((g) => g.is_active !== false).map((g) => ({ id: String(g.id), name: nm(g) || String(g.id) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
      const cByG = new Map<string, ExamNode[]>();
      catRows.filter((c) => c.is_active !== false).forEach((c) => {
        const gid = String(c.group_id ?? "");
        if (!gid) return;
        (cByG.get(gid) ?? cByG.set(gid, []).get(gid)!).push({ id: String(c.id), name: nm(c) || String(c.id) });
      });
      cByG.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name, "ko")));
      const pByGC = new Map<string, ExamNode[]>();
      const pMeta = new Map<string, { gid: string; cid: string; name: string }>();
      procRows.filter((p) => p.is_active !== false).forEach((p) => {
        const part = partById.get(String(p.part_id ?? ""));
        const gid = String(p.group_id ?? part?.group_id ?? "");
        const cid = String(p.category_id ?? part?.category_id ?? "");
        const name = nm(p) || String(p.id);
        const key = `${gid}|${cid}`;
        (pByGC.get(key) ?? pByGC.set(key, []).get(key)!).push({ id: String(p.id), name });
        pMeta.set(String(p.id), { gid, cid, name });
      });
      pByGC.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name, "ko")));
      setGroupsList(gList); setCatsByGroup(cByG); setProcByGroupCat(pByGC); setProcMeta(pMeta);

      // 저장 범위 복원.
      const rows = scopes.rows;
      const val = (t: string) => rows.filter((r) => r.scope_type === t).map((r) => r.scope_value);
      const FIXED = new Set(["all", "assigned", "region", "tenant", "own"]);
      setOrg(val("organization")[0] || "all");
      const rg = new Set(val("region")); const gd = new Set(val("gender"));
      setRegions(rg); setGenders(gd);
      const dormV = val("dorm");
      const dIds = new Set(dormV.filter((v) => !FIXED.has(v)));
      setDormIds(dIds);
      // 기숙사 모드 복원: assigned > 직접선택 > 조건(지역/성별) > 전체
      if (dormV.includes("assigned")) setDormChoice("assigned");
      else if (dIds.size > 0) setDormChoice("select");
      else if (rg.size > 0 || gd.size > 0) setDormChoice("condition");
      else setDormChoice("all");
      // 시험 복원: process='all' → 전체 / 그 외 process_id → 조합
      const procV = val("process");
      if (procV.includes("all")) { setExamMode("all"); setExamCombos([]); }
      else if (procV.length > 0) {
        setExamMode("select");
        setExamCombos(procV.filter((v) => v !== "all").map((pid) => {
          const m = pMeta.get(pid);
          return { key: newComboKey(), gid: m?.gid || "", cid: m?.cid || "", pid };
        }));
      } else { setExamMode("all"); setExamCombos([]); }
      // 군대 부서 복원(scope_type='military_department', scope_value=부서명)
      const deptV = val("military_department");
      setDeptSel(new Set(deptV));
      setDeptMode(deptV.length > 0 ? "select" : "all");
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

  // 메뉴·기능 권한 저장(reloadSignal) 시 permission 재로드 → 업무 영역 카드 자동 반영.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (reloadSignal > 0) { loadPerms().catch(() => {}); } }, [reloadSignal]);

  // 실행 중 menus(권한 트리와 동일 SoT)에서 업무별 tab 집합을 파생 — anchor tabKey 로 그룹을 식별(한글명 판별 아님).
  //  하드코딩(permissionCatalog) 집합과 union → 기본 설정/커스터마이즈(그룹명 변경·탭 이동) 어느 쪽이든 정확.
  const areaTabs = useMemo(() => {
    const tabsByGroup = new Map<string, string[]>();
    menus.forEach((m) => { const g = String(m.groupName); (tabsByGroup.get(g) ?? tabsByGroup.set(g, []).get(g)!).push(String(m.tabKey)); });
    const groupContaining = (pred: (t: string) => boolean) => { for (const m of menus) if (pred(String(m.tabKey))) return String(m.groupName); return null; };
    const setFor = (g: string | null) => new Set<string>((g && tabsByGroup.get(g)) || []);
    return {
      dorm: setFor(groupContaining((t) => t === "dorms" || t === "occupants")),
      exam: setFor(groupContaining((t) => t.startsWith("exam"))),
      military: setFor(groupContaining((t) => t === "militaryDashboard")),
    };
  }, [menus]);

  // 업무 영역 활성 판정: 저장 permission 중 하나라도 해당 업무 tab 이면 활성(action 종류 무관). militarySettings(NON_GRANTABLE) 제외.
  const areas = useMemo(() => {
    const tabs = effectiveKeys.map((k) => k.split(".")[0]);
    return {
      dorm: tabs.some((t) => DORM_SCOPE_TABS.has(t) || areaTabs.dorm.has(t)),
      exam: tabs.some((t) => isExamTab(t) || areaTabs.exam.has(t)),
      military: tabs.some((t) => t !== "militarySettings" && (MILITARY_TABS.has(t) || areaTabs.military.has(t))),
      any: effectiveKeys.length > 0,
    };
  }, [effectiveKeys, areaTabs]);

  // 군대관리 메뉴/기능 한글 요약(선택된 permission 만 · NON_GRANTABLE 는 애초에 permKeys 에 없음).
  const militarySummary = useMemo(() => {
    const nameByTab = new Map(menus.map((m) => [String(m.tabKey), m.menuName]));
    const byTab = new Map<string, ActionKey[]>();
    effectiveKeys.forEach((k) => {
      const i = k.lastIndexOf("."); if (i < 0) return;
      const tab = k.slice(0, i); const action = k.slice(i + 1) as ActionKey;
      if (tab === "militarySettings" || !(MILITARY_TABS.has(tab) || areaTabs.military.has(tab))) return;
      (byTab.get(tab) ?? byTab.set(tab, []).get(tab)!).push(action);
    });
    return Array.from(byTab.entries()).map(([tab, actions]) => ({
      menu: nameByTab.get(tab) || tab,
      actions: actions.map((a) => ACTION_LABEL[a] || a).join(" / "),
    }));
  }, [effectiveKeys, menus, areaTabs]);

  // 현재 선택 → 저장 행.
  const buildRows = (): ScopeRow[] => {
    const action: ActionScope = readOnly ? "read" : "all";
    const vf = validFrom ? new Date(validFrom).toISOString() : null;
    const vu = validUntil ? new Date(validUntil).toISOString() : null;
    const rows: ScopeRow[] = [];
    const push = (scope_type: ScopeRow["scope_type"], scope_value: string) =>
      rows.push({ scope_type, scope_value, action_scope: action, valid_from: vf, valid_until: vu });
    if (org && org !== "all") push("organization", org);            // 숨김이지만 기존값 보존
    if (areas.dorm) {
      if (dormChoice === "assigned") push("dorm", "assigned");
      else if (dormChoice === "condition") { regions.forEach((r) => push("region", r)); genders.forEach((g) => push("gender", g)); }
      else if (dormChoice === "select") dormIds.forEach((d) => push("dorm", d));
    }
    if (areas.exam) {
      if (examMode === "all") push("process", "all");
      else { const seen = new Set<string>(); examCombos.forEach((c) => { if (c.pid && !seen.has(c.pid)) { seen.add(c.pid); push("process", c.pid); } }); }
    }
    if (areas.military && deptMode === "select") deptSel.forEach((d) => push("military_department", d));
    if (owner && owner !== "all") push("owner", owner);
    return rows;
  };

  const currentKey = useMemo(() => JSON.stringify(buildRows()), [org, dormChoice, regions, genders, dormIds, examMode, examCombos, deptMode, deptSel, owner, readOnly, validFrom, validUntil, areas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading && roleId && initialKey === "") setInitialKey(currentKey); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // ── 시험 조합 조작 ──
  const addCombo = () => setExamCombos((cs) => [...cs, { key: newComboKey(), gid: "", cid: "", pid: "" }]);
  const removeCombo = (key: string) => setExamCombos((cs) => cs.filter((c) => c.key !== key));
  const setComboGroup = (key: string, gid: string) => setExamCombos((cs) => cs.map((c) => c.key === key ? { ...c, gid, cid: "", pid: "" } : c));
  const setComboCat = (key: string, cid: string) => setExamCombos((cs) => cs.map((c) => c.key === key ? { ...c, cid, pid: "" } : c));
  const setComboProc = (key: string, pid: string) => {
    if (pid && examCombos.some((c) => c.key !== key && c.pid === pid)) { onToast?.("이미 추가된 공정 조합입니다."); return; }
    setExamCombos((cs) => cs.map((c) => c.key === key ? { ...c, pid } : c));
  };

  const inputCls = darkMode ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-900";
  const cardCls = `rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-white"}`;
  const chip = (on: boolean) => `rounded-lg px-3 py-1.5 text-xs min-h-[36px] ${on ? "bg-slate-900 text-white" : darkMode ? "border border-slate-600 text-slate-300" : "border border-slate-300 text-slate-600"}`;
  const radio = (on: boolean) => `flex-1 rounded-xl border px-3 py-2 text-xs min-h-[44px] text-center ${on ? "border-blue-500 bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200" : darkMode ? "border-slate-600 text-slate-300" : "border-slate-300 text-slate-600"}`;
  const radioOff = `flex-1 rounded-xl border px-3 py-2 text-xs min-h-[44px] text-center opacity-60 cursor-not-allowed ${darkMode ? "border-slate-700 text-slate-500" : "border-slate-200 text-slate-400"}`;
  const needBadge = <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[0.65rem] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">메뉴 권한 필요</span>;
  const hintNote = (biz: string) => <p className="mt-2 text-[0.7rem] text-slate-400">위 <b>메뉴·기능 권한</b>에서 {biz} 메뉴를 선택하고 저장하면 자동 활성화됩니다.</p>;
  const sel = `w-full rounded-xl border px-3 py-2 text-sm min-h-[44px] ${inputCls}`;

  const visibleDormOptions = useMemo(() => {
    const q = dormSearch.trim().toLowerCase();
    if (!q) return dormOptions;
    return dormOptions.filter((d) => `${d.label} ${d.region ?? ""} ${d.gender ?? ""}`.toLowerCase().includes(q));
  }, [dormOptions, dormSearch]);
  // 지역/성별 옵션 = 실제 기숙사 데이터에서 중복 제거(+ 저장된 값 보존 표시). 하드코딩 아님.
  const regionOpts = useMemo(() => {
    const s = new Set<string>(); dormOptions.forEach((d) => { if (d.region) s.add(d.region); }); regions.forEach((r) => s.add(r));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [dormOptions, regions]);
  const genderOpts = useMemo(() => {
    const s = new Set<string>(); dormOptions.forEach((d) => { if (d.gender) s.add(d.gender); }); genders.forEach((g) => s.add(g));
    return Array.from(s);
  }, [dormOptions, genders]);
  const visibleDept = useMemo(() => {
    const q = deptSearch.trim().toLowerCase();
    return q ? militaryDeptOptions.filter((d) => d.toLowerCase().includes(q)) : militaryDeptOptions;
  }, [militaryDeptOptions, deptSearch]);

  // 저장 전 요약(개발용 값 미노출 · 세 업무 항상 표시, 권한 없으면 "권한 없음").
  const summary = useMemo(() => {
    const out: Array<{ area: string; items: string[] }> = [];
    if (!areas.dorm) out.push({ area: "기숙사관리", items: ["권한 없음"] });
    else {
      const items: string[] = [];
      if (dormChoice === "all") items.push("전체 기숙사");
      else if (dormChoice === "assigned") items.push("담당 기숙사");
      else if (dormChoice === "condition") {
        regions.forEach((r) => items.push(`지역: ${r}`)); genders.forEach((g) => items.push(`성별: ${genderLabel(g)}`));
        if (!items.length) items.push("조건 미선택");
      } else { dormOptions.filter((d) => dormIds.has(d.id)).forEach((d) => items.push(d.label)); if (!items.length) items.push("선택 없음"); }
      out.push({ area: "기숙사관리", items });
    }
    if (!areas.exam) out.push({ area: "시험관리", items: ["권한 없음"] });
    else {
      const items: string[] = [];
      if (examMode === "all") items.push("전체 시험관리");
      else examCombos.forEach((c) => {
        const g = groupsList.find((x) => x.id === c.gid)?.name;
        const ct = (catsByGroup.get(c.gid) || []).find((x) => x.id === c.cid)?.name;
        const p = c.pid ? procMeta.get(c.pid)?.name : undefined;
        const parts = [g, ct, p].filter(Boolean);
        items.push(parts.length ? parts.join(" > ") : "미완성 조합");
      });
      if (!items.length) items.push("선택 없음");
      out.push({ area: "시험관리", items });
    }
    if (!areas.military) out.push({ area: "군대관리", items: ["권한 없음"] });
    else {
      const items = militarySummary.length ? militarySummary.map((m) => `${m.menu}: ${m.actions}`) : ["메뉴·기능 권한 기준"];
      if (deptMode === "select") items.push(deptSel.size ? `부서: ${Array.from(deptSel).join(", ")}` : "부서: 선택 없음");
      else items.push("부서: 전체");
      out.push({ area: "군대관리", items });
    }
    return out;
  }, [areas, dormChoice, regions, genders, dormIds, dormOptions, examMode, examCombos, groupsList, catsByGroup, procMeta, militarySummary, deptMode, deptSel]);

  if (!roleId) return <div className={`rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>먼저 권한을 저장한 뒤 데이터 범위를 설정할 수 있습니다.</div>;
  if (loading) return <div className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</div>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">업무별 데이터 접근 범위입니다. 해당 업무의 메뉴·기능 권한이 없으면 비활성 상태로 표시되며, 메뉴 권한을 저장하면 즉시 활성화됩니다.</p>

      {/* ── 기숙사관리 ── */}
      <section className={cardCls} aria-disabled={!areas.dorm}>
        <div className="mb-1 flex items-center gap-2"><h5 className="text-sm font-semibold">기숙사관리 접근 범위</h5>{!areas.dorm && needBadge}</div>
        {!areas.dorm ? (
          <div>
            <p className="mb-2 text-xs text-slate-500">기숙사관리 메뉴 권한을 먼저 선택하면 아래 데이터 범위를 설정할 수 있습니다.</p>
            <div className="flex flex-wrap gap-1.5">
              {["전체 기숙사", "담당 기숙사", "지역·성별 조건", "기숙사 직접 선택"].map((l) => <span key={l} className={radioOff}>{l}</span>)}
            </div>
            {hintNote("기숙사관리")}
          </div>
        ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">이 권한이 접근할 수 있는 기숙사 데이터를 설정합니다.</p>
          <div className="flex flex-wrap gap-1.5">
            {([["all", "전체 기숙사"], ["assigned", "담당 기숙사"], ["condition", "조건으로 선택"], ["select", "기숙사 직접 선택"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setDormChoice(v)} className={radio(dormChoice === v)}>{label}</button>
            ))}
          </div>
          {dormChoice === "assigned" && (
            <div className="mt-2 text-xs text-slate-400">
              <p>이 권한이 배정된 사용자의 프로필에 지정된 담당 기숙사만 접근합니다.</p>
              <p className="mt-0.5">사용자별 담당 기숙사는 <b>시스템 &gt; 사용자관리</b>의 프로필 설정을 따릅니다. (권한 자체는 특정 기숙사 하나에 고정되지 않습니다.)</p>
            </div>
          )}
          {dormChoice === "condition" && (
            <div className="mt-3 space-y-2">
              <div><span className="mb-1 block text-xs text-slate-500">지역 {regions.size > 0 && <span className="text-slate-400">· {regions.size}개 선택</span>}</span>
                {regionOpts.length === 0 ? <span className="text-xs text-slate-400">등록된 지역이 없습니다. 기숙사관리 &gt; 기숙사의 지역 값을 확인해 주세요.</span>
                : <div className="flex flex-wrap gap-1">{regionOpts.map((r) => (
                    <button key={r} type="button" onClick={() => setRegions((s) => toggleIn(s, r))} className={chip(regions.has(r))}>{r}</button>))}</div>}</div>
              <div><span className="mb-1 block text-xs text-slate-500">성별 {genders.size > 0 && <span className="text-slate-400">· {genders.size}개 선택</span>}</span>
                {genderOpts.length === 0 ? <span className="text-xs text-slate-400">등록된 성별 값이 없습니다. 기숙사관리 &gt; 기숙사의 성별 설정을 확인해 주세요.</span>
                : <div className="flex flex-wrap gap-1">{genderOpts.map((g) => (
                    <button key={g} type="button" onClick={() => setGenders((s) => toggleIn(s, g))} className={chip(genders.has(g))}>{genderLabel(g)}</button>))}</div>}</div>
              <p className="text-[0.7rem] text-slate-400">선택한 지역·성별 조건의 기숙사 데이터에 접근합니다.</p>
            </div>
          )}
          {dormChoice === "select" && (
            <div className={`mt-3 rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {dormsLoading ? <div className="px-3 py-4 text-center text-xs text-slate-400">기숙사 목록을 불러오는 중입니다.</div>
              : dormOptions.length === 0 ? <div className="px-3 py-4 text-center text-xs text-slate-400">등록된 기숙사가 없습니다. <b>기숙사관리 &gt; 기숙사</b>에서 먼저 기숙사를 등록해 주세요.</div>
              : <>
                  <div className="flex flex-wrap items-center gap-2 border-b p-2 dark:border-slate-700">
                    <input value={dormSearch} onChange={(e) => setDormSearch(e.target.value)} placeholder="기숙사명·지역·성별 검색" className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs outline-none ${inputCls}`} />
                    <span className="whitespace-nowrap text-[0.7rem] text-slate-400">선택 {dormIds.size}개</span>
                    <button type="button" onClick={() => setDormIds(new Set(dormOptions.map((d) => d.id)))} className="rounded-lg border border-slate-300 px-2 py-1 text-[0.7rem] dark:border-slate-600">전체 선택</button>
                    <button type="button" onClick={() => setDormIds(new Set())} className="rounded-lg border border-slate-300 px-2 py-1 text-[0.7rem] dark:border-slate-600">선택 해제</button>
                  </div>
                  <div className="max-h-52 overflow-y-auto p-2">
                    {visibleDormOptions.length === 0 ? <div className="px-1 py-2 text-xs text-slate-400">검색 결과 없음</div>
                    : visibleDormOptions.map((d) => {
                      const on = dormIds.has(d.id); const sub = [d.region, genderLabel(d.gender)].filter(Boolean).join(" · ");
                      return (
                        <label key={d.id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 ${on ? (darkMode ? "bg-blue-950/30" : "bg-blue-50") : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                          <input type="checkbox" checked={on} onChange={() => setDormIds((s) => toggleIn(s, d.id))} className="h-4 w-4 shrink-0" />
                          <span className="min-w-0"><span className="block truncate text-xs font-medium">{d.label}</span>{sub && <span className="block truncate text-[0.7rem] text-slate-400">{sub}</span>}</span>
                        </label>);
                    })}
                  </div>
                </>}
            </div>
          )}
        </>
        )}
      </section>

      {/* ── 시험관리 ── */}
      <section className={cardCls} aria-disabled={!areas.exam}>
        <div className="mb-1 flex items-center gap-2"><h5 className="text-sm font-semibold">시험관리 접근 범위</h5>{!areas.exam && needBadge}</div>
        {!areas.exam ? (
          <div>
            <p className="mb-2 text-xs text-slate-500">시험관리 메뉴 권한을 먼저 선택하면 그룹·제품군·공정 접근 범위를 설정할 수 있습니다.</p>
            <div className="flex flex-wrap gap-1.5">
              {["전체 시험관리", "선택한 그룹/제품군/공정만"].map((l) => <span key={l} className={radioOff}>{l}</span>)}
            </div>
            {hintNote("시험관리")}
          </div>
        ) : (
        <>
          <p className="mb-2 text-[0.7rem] text-slate-400">현재는 접근 범위를 저장·복원합니다. 실제 시험 데이터 접근 강제는 후속 보안 단계에서 연결됩니다.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setExamMode("all")} className={radio(examMode === "all")}>전체 시험관리</button>
            <button type="button" onClick={() => setExamMode("select")} className={radio(examMode === "select")}>선택한 그룹/제품군/공정만</button>
          </div>
          {examMode === "all" && <p className="mt-2 text-xs text-slate-400">모든 그룹·제품군·공정을 대상으로 합니다(추후 추가되는 공정 포함).</p>}
          {examMode === "select" && (
            <div className="mt-3 space-y-2">
              {examCombos.length === 0 && <p className="text-xs text-slate-400">아래 “접근 범위 추가”로 그룹 &gt; 제품군 &gt; 공정 조합을 추가하세요.</p>}
              {examCombos.map((c, i) => {
                const cats = catsByGroup.get(c.gid) || [];
                const procs = procByGroupCat.get(`${c.gid}|${c.cid}`) || [];
                return (
                  <div key={c.key} className={`rounded-xl border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <div className="mb-1 flex items-center justify-between"><span className="text-xs font-medium text-slate-500">접근 범위 {i + 1}</span>
                      <button type="button" onClick={() => removeCombo(c.key)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">삭제</button></div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <select value={c.gid} onChange={(e) => setComboGroup(c.key, e.target.value)} className={sel}>
                        <option value="">그룹 선택</option>
                        {groupsList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      <select value={c.cid} onChange={(e) => setComboCat(c.key, e.target.value)} disabled={!c.gid} className={`${sel} ${!c.gid ? "opacity-50" : ""}`}>
                        <option value="">{c.gid ? "제품군 선택" : "그룹 먼저"}</option>
                        {cats.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                      </select>
                      <select value={c.pid} onChange={(e) => setComboProc(c.key, e.target.value)} disabled={!c.cid} className={`${sel} ${!c.cid ? "opacity-50" : ""}`}>
                        <option value="">{c.cid ? "공정 선택" : "제품군 먼저"}</option>
                        {procs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={addCombo} className={`w-full rounded-xl border border-dashed px-3 py-2 text-xs min-h-[44px] ${darkMode ? "border-slate-600 text-slate-300" : "border-slate-300 text-slate-600"}`}>+ 접근 범위 추가</button>
            </div>
          )}
        </>
        )}
      </section>

      {/* ── 군대관리 ── */}
      <section className={cardCls} aria-disabled={!areas.military}>
        <div className="mb-1 flex items-center gap-2"><h5 className="text-sm font-semibold">군대관리 접근 범위</h5>{!areas.military && needBadge}</div>
        {!areas.military ? (
          <div>
            <p className="mb-2 text-xs text-slate-500">군대관리 메뉴 권한을 먼저 선택하면 부서 범위를 설정할 수 있습니다.</p>
            <div className="flex flex-wrap gap-1.5">
              {["전체 부서", "선택한 부서만"].map((l) => <span key={l} className={radioOff}>{l}</span>)}
            </div>
            <div className={`mt-2 rounded-xl border px-3 py-2 text-xs text-slate-400 opacity-60 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>부서 검색 (비활성)</div>
            {hintNote("군대관리")}
          </div>
        ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">이 권한이 사용할 군대관리 부서 범위를 설정합니다. 군대관리는 현재 메뉴·기능 권한을 기준으로 접근을 관리합니다.</p>
          {militarySummary.length > 0 ? (
            <ul className="space-y-0.5 text-xs">
              {militarySummary.map((m) => (
                <li key={m.menu}><span className="font-medium">{m.menu}</span><span className="text-slate-500">: {m.actions}</span></li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-400">선택된 군대관리 메뉴·기능이 없습니다.</p>}

          {/* 부서 데이터 접근 범위 */}
          <div className={`mt-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            <span className="mb-1 block text-xs font-medium text-slate-500">데이터 접근 범위(부서)</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setDeptMode("all")} className={radio(deptMode === "all")}>전체 부서</button>
              <button type="button" onClick={() => setDeptMode("select")} className={radio(deptMode === "select")}>선택한 부서만</button>
            </div>
            <p className="mt-2 text-[0.7rem] text-slate-400">현재 부서 범위는 권한 설정값으로 저장됩니다. 실제 군대관리 데이터의 서버 강제 제한은 후속 보안 단계에서 연결됩니다.</p>
            {deptMode === "select" && (
              <div className={`mt-2 rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                {militaryDeptOptions.length === 0 ? <div className="px-3 py-4 text-center text-xs text-slate-400">등록된 부서가 없습니다.</div>
                : <>
                    <div className="flex flex-wrap items-center gap-2 border-b p-2 dark:border-slate-700">
                      <input value={deptSearch} onChange={(e) => setDeptSearch(e.target.value)} placeholder="부서 검색" className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs outline-none ${inputCls}`} />
                      <span className="whitespace-nowrap text-[0.7rem] text-slate-400">선택 {deptSel.size}개</span>
                      <button type="button" onClick={() => setDeptSel(new Set(militaryDeptOptions))} className="rounded-lg border border-slate-300 px-2 py-1 text-[0.7rem] dark:border-slate-600">전체 선택</button>
                      <button type="button" onClick={() => setDeptSel(new Set())} className="rounded-lg border border-slate-300 px-2 py-1 text-[0.7rem] dark:border-slate-600">선택 해제</button>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-2">
                      {visibleDept.length === 0 ? <div className="px-1 py-2 text-xs text-slate-400">검색 결과 없음</div>
                      : visibleDept.map((d) => {
                        const on = deptSel.has(d);
                        return (
                          <label key={d} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 ${on ? (darkMode ? "bg-blue-950/30" : "bg-blue-50") : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                            <input type="checkbox" checked={on} onChange={() => setDeptSel((s) => toggleIn(s, d))} className="h-4 w-4 shrink-0" />
                            <span className="truncate text-xs">{d}</span>
                          </label>);
                      })}
                    </div>
                  </>}
              </div>
            )}
          </div>
        </>
        )}
      </section>

      {/* ── 조회 전용 / 적용 기간 ── */}
      <label className="flex items-center gap-2"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="h-4 w-4" /><span>조회 전용(쓰기 권한을 새로 부여하지 않음)</span></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-1 block text-slate-500">적용 시작일</span><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`} /></label>
        <label className="block"><span className="mb-1 block text-slate-500">적용 종료일</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`} /></label>
      </div>

      {/* ── 고급 설정(본인 데이터 범위 · 미강제) ── */}
      <div className={cardCls}>
        <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium">
          <span>고급 설정</span><span className="text-xs text-slate-400">{advancedOpen ? "접기" : "펼치기"}</span>
        </button>
        {advancedOpen && (
          <div className="mt-2">
            <span className="mb-1 block text-xs text-slate-500">본인 데이터 범위</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`w-full rounded-xl border px-3 py-2 ${inputCls}`}>
              {OWNER_VALUES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="mt-1 block rounded-lg bg-amber-50 px-2 py-1 text-[0.7rem] text-amber-700">※ 설정값은 저장되지만 일부 화면에서는 아직 적용되지 않을 수 있습니다.</span>
          </div>
        )}
      </div>

      {/* ── 요약 + 저장 ── */}
      {summary.length > 0 && (
        <div className={`rounded-2xl border px-3 py-2 text-xs ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}>
          <div className="mb-1 font-semibold text-slate-500">설정 요약</div>
          {summary.map((s) => (
            <div key={s.area} className="mb-1"><span className="font-medium">{s.area}</span>
              <ul className="ml-3 list-disc text-slate-500">{s.items.map((it, idx) => <li key={idx}>{it}</li>)}</ul></div>
          ))}
        </div>
      )}

      {permissionsDirty && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">메뉴·기능 권한에 저장되지 않은 변경사항이 있습니다. 먼저 <b>메뉴·기능 권한 저장</b>을 눌러 주세요.</p>
      )}
      <div className="flex items-center justify-between">
        {dirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">변경사항 있음</span> : <span />}
        <button type="button" onClick={save} disabled={saving || !dirty || permissionsDirty} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[44px]">데이터 범위 저장</button>
      </div>
    </div>
  );
}
