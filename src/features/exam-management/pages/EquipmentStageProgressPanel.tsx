// 설비 인증현황 · "단계별 현황" 패널 — 직원별 단계(Single~Multi4) 설비 취득/대상(n/m) 표시.
//  · 계산은 공용 equipmentProgressService(순수 함수) 재사용 — 페이지 내부 중복 계산 없음.
//  · 취득(분자)은 이미 로드된 설비취득 레코드(certs, status="approved")에서 파생 → 추가 DB 조회 없음.
//  · 현재 Level 은 공용 currentCertificationLevelService(canonical · max(확정 취득 응시, 승인 pm 인증, personnel flag)) 결과 사용.
import { Fragment, useCallback, useMemo, useState } from "react";
import type { ExamRow } from "../services/examMasterService";
import { computeEquipmentProgressByPersonnel, type PersonnelEquipmentProgress } from "../services/equipmentProgressService";
import { computeCurrentLevelByPersonnel } from "../services/currentCertificationLevelService";
import EquipmentStageDetail, { type EquipmentDetailRow } from "./EquipmentStageDetail";

type Props = {
  darkMode: boolean;
  personnel: ExamRow[];
  levels: ExamRow[];
  processes: ExamRow[];
  equipment: ExamRow[];        // exam_equipment (설비명 표시용)
  stageRules: ExamRow[];       // exam_equipment_stage_rules (대상 설비 · 분모)
  certs: ExamRow[];            // exam_equipment_certifications (승인=취득 · 분자 파생)
  applications: ExamRow[];     // exam_applications (현재 Level canonical: 확정 취득)
  pmCertifications: ExamRow[]; // pm_certifications (현재 Level canonical: 승인 인증)
};

const S = (v: unknown) => String(v ?? "").trim();

export default function EquipmentStageProgressPanel({ darkMode, personnel, levels, processes, equipment, stageRules, certs, applications, pmCertifications }: Props) {
  const [search, setSearch] = useState("");
  const [fProcess, setFProcess] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [quick, setQuick] = useState<"all" | "incomplete" | "complete">("all");
  const [expanded, setExpanded] = useState<{ personnelId: string; stageIndex: number } | null>(null); // 펼친 셀(직원+단계) 1개만

  const inputCls = darkMode ? "rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-sm outline-none" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none";
  const procName = useMemo(() => new Map(processes.map((r) => [S(r.id), S(r.name) || S(r.code)])), [processes]);
  const procOpts = useMemo(() => processes.filter((r) => r.is_active !== false).map((r) => ({ id: S(r.id), name: S(r.name) || S(r.code) })).sort((a, b) => a.name.localeCompare(b.name, "ko")), [processes]);

  // 취득(분자): approved 설비취득 → personnel_id → Set(equipment_id). 추가 DB 조회 없음.
  const approvedByPerson = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of certs) {
      if (S(c.status) !== "approved") continue;                 // 확정만(반려/취소/대기/후보 제외)
      const pid = S(c.personnel_id), eq = S(c.equipment_id);
      if (!pid || !eq) continue;
      (m.get(pid) ?? m.set(pid, new Set<string>()).get(pid)!).add(eq);
    }
    return m;
  }, [certs]);

  // 공용 순수 서비스로 직원별 단계 progress 계산(공정별 캐시 · N+1 없음).
  const progressByPerson = useMemo(
    () => computeEquipmentProgressByPersonnel({ personnel, levels, stageRules, approvedByPerson }),
    [personnel, levels, stageRules, approvedByPerson],
  );

  // ── 상세 펼침용 파생 데이터(전부 이미 로드된 데이터 가공 · 추가 DB 조회 0) ──
  const equipmentNameById = useMemo(() => new Map(equipment.map((e) => [S(e.id), S(e.name) || S(e.code) || "설비 정보 없음"])), [equipment]);
  // 취득 상세: (personnel_id|equipment_id) → 취득일/만료일. approved 중 취득일 최신 1건.
  const certByPersonEquip = useMemo(() => {
    const m = new Map<string, { acquiredDate: string; expiryDate: string }>();
    for (const c of certs) {
      if (S(c.status) !== "approved") continue;
      const pid = S(c.personnel_id), eq = S(c.equipment_id); if (!pid || !eq) continue;
      const acquiredDate = S(c.acquired_date).slice(0, 10) || S(c.approved_at).slice(0, 10); // canonical 취득일(없으면 승인일)
      const expiryDate = S(c.expiry_date).slice(0, 10);
      const key = `${pid}|${eq}`;
      const prev = m.get(key);
      if (!prev || acquiredDate > prev.acquiredDate) m.set(key, { acquiredDate, expiryDate }); // 취득일 최신 유지
    }
    return m;
  }, [certs]);
  // 주력: stage rule is_core_equipment(active). Multi=해당 level, Single=공정 내 어느 level 이든 core 이면 주력.
  const core = useMemo(() => {
    const byLevel = new Map<string, boolean>();   // `${proc}|${lvl}|${eq}`
    const anyLevel = new Map<string, boolean>();  // `${proc}|${eq}`
    for (const s of stageRules) {
      if (s.deleted_at || (s as { is_active?: unknown }).is_active === false) continue;
      if ((s as { is_core_equipment?: unknown }).is_core_equipment !== true) continue;
      const proc = S(s.process_id), lvl = S(s.level_id), eq = S(s.equipment_id);
      if (!proc || !eq) continue;
      byLevel.set(`${proc}|${lvl}|${eq}`, true);
      anyLevel.set(`${proc}|${eq}`, true);
    }
    return { byLevel, anyLevel };
  }, [stageRules]);

  // 현재 Level: 공용 canonical 서비스(max(확정 exam_applications, 유효 pm_certifications, personnel flag)) 결과 사용.
  const currentLevelByPerson = useMemo(
    () => computeCurrentLevelByPersonnel({ personnel, levels, applications, pmCertifications }),
    [personnel, levels, applications, pmCertifications],
  );
  const currentLevelOf = useCallback((p: ExamRow) => currentLevelByPerson.get(S(p.id))?.currentLevelName || "-", [currentLevelByPerson]);

  const stageLabels = useMemo(() => {
    // selectPmStageLevels 순서와 동일한 라벨(레벨명) — 서비스가 반환한 stageIndex 순서에 맞춘다.
    const first = progressByPerson.values().next().value as PersonnelEquipmentProgress | undefined;
    const levelName = new Map(levels.map((r) => [S(r.id), S(r.name) || S(r.code)]));
    return (first?.stages ?? []).map((s) => levelName.get(s.levelId) || `단계${s.stageIndex + 1}`);
  }, [progressByPerson, levels]);

  // distinct 전체 진행률(단계 scope overlap 중복 방지 — 전 단계 target/acquired 합집합).
  const totals = useMemo(() => {
    const m = new Map<string, { acq: number; tgt: number; complete: boolean }>();
    for (const [pid, prog] of progressByPerson) {
      const tgt = new Set<string>(), acq = new Set<string>();
      for (const s of prog.stages) { for (const id of s.targetEquipmentIds) tgt.add(id); for (const id of s.acquiredEquipmentIds) acq.add(id); }
      m.set(pid, { acq: acq.size, tgt: tgt.size, complete: tgt.size > 0 && acq.size === tgt.size });
    }
    return m;
  }, [progressByPerson]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personnel
      .filter((p) => p.is_active !== false && !p.deleted_at)
      .filter((p) => {
        const pid = S(p.id);
        if (fProcess && S(p.process_id) !== fProcess) return false;
        if (fLevel && currentLevelOf(p) !== fLevel) return false;
        const total = totals.get(pid);
        if (quick === "complete" && !(total?.complete)) return false;
        if (quick === "incomplete" && (total?.complete || !total || total.tgt === 0)) return false; // 미완료 = 대상>0 && 미완
        if (q) { const t = `${S(p.employee_no)} ${S(p.name)}`.toLowerCase(); if (!t.includes(q)) return false; }
        return true;
      });
  }, [personnel, search, fProcess, fLevel, quick, totals, currentLevelOf]);

  const levelFilterOpts = useMemo(() => Array.from(new Set(personnel.map(currentLevelOf).filter((v) => v && v !== "-"))).sort(), [personnel, currentLevelOf]);

  // 펼친 셀(직원+단계)의 설비 상세 rows — 대상/취득/미취득은 progress 서비스 결과만 사용(재계산 없음).
  const detail = useMemo(() => {
    if (!expanded) return null;
    const prog = progressByPerson.get(expanded.personnelId);
    const stage = prog?.stages[expanded.stageIndex];
    if (!stage) return null;
    const person = personnel.find((p) => S(p.id) === expanded.personnelId);
    const proc = S(person?.process_id);
    const isSingle = expanded.stageIndex === 0;               // 서비스 canonical: index 0 = Single(합집합 scope)
    const acquiredSet = new Set(stage.acquiredEquipmentIds);
    const detailRows: EquipmentDetailRow[] = stage.targetEquipmentIds.map((eqid) => {
      const acquired = acquiredSet.has(eqid);
      const c = certByPersonEquip.get(`${expanded.personnelId}|${eqid}`);
      const isCore = isSingle ? !!core.anyLevel.get(`${proc}|${eqid}`) : !!core.byLevel.get(`${proc}|${S(stage.levelId)}|${eqid}`);
      return {
        equipmentId: eqid,
        name: equipmentNameById.get(eqid) || "설비 정보 없음",
        acquired,
        acquiredDate: acquired ? (c?.acquiredDate || "-") : "-",
        expiryDate: acquired ? (c?.expiryDate || "-") : "-",
        core: isCore,
      };
    }).sort((a, b) => (a.acquired === b.acquired ? a.name.localeCompare(b.name, "ko") : (a.acquired ? -1 : 1))); // 취득 먼저, 이름순
    const stageLabel = stageLabels[expanded.stageIndex] ?? `단계 ${expanded.stageIndex + 1}`;
    return { stageLabel, rows: detailRows };
  }, [expanded, progressByPerson, personnel, certByPersonEquip, core, equipmentNameById, stageLabels]);

  const cell = (s: PersonnelEquipmentProgress["stages"][number] | undefined, clickable: boolean, isOpen: boolean) => {
    if (!s || s.targetCount === 0) return <span className="text-slate-400">- / -</span>;
    const pct = s.progressPercent ?? 0;
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="tabular-nums">{s.acquiredCount} / {s.targetCount}</span>
        <span className={`h-1 w-12 overflow-hidden rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-200"}`}>
          <span className={`block h-full ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${Math.round(pct)}%` }} />
        </span>
        {clickable && <span className="text-[0.55rem] text-blue-600 dark:text-blue-400">{isOpen ? "닫기 ▲" : "자세히 ▾"}</span>}
      </span>
    );
  };

  const qBtn = (k: typeof quick, label: string) => (
    <button onClick={() => setQuick(k)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${quick === k ? "bg-blue-600 text-white" : (darkMode ? "border border-slate-600 hover:bg-slate-800" : "border border-slate-300 hover:bg-slate-100")}`}>{label}</button>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {qBtn("all", "전체")}{qBtn("incomplete", "미완료")}{qBtn("complete", "완료")}
        <select value={fProcess} onChange={(e) => setFProcess(e.target.value)} className={inputCls}><option value="">공정: 전체</option>{procOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fLevel} onChange={(e) => setFLevel(e.target.value)} className={inputCls}><option value="">현재 Level: 전체</option>{levelFilterOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색(사번/이름)" className={`${inputCls} min-w-[160px]`} />
      </div>

      {/* 가로 스크롤 컨테이너(모바일에서 5단계 테이블이 깨지지 않도록) */}
      <div className="max-h-[56vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className={`sticky top-0 z-[1] ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"}`}>
            <tr>{["사번", "이름", "공정", "현재 Level", ...stageLabels, "전체"].map((h, i) => <th key={`${h}-${i}`} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pid = S(p.id);
              const prog = progressByPerson.get(pid);
              const total = totals.get(pid);
              const openHere = expanded?.personnelId === pid;
              return (
                <Fragment key={pid}>
                <tr className={`border-t ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.employee_no) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{S(p.name) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{procName.get(S(p.process_id)) || "-"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{currentLevelOf(p)}</td>
                  {(prog?.stages ?? stageLabels.map(() => undefined)).map((s, i) => {
                    const clickable = !!s && s.targetCount > 0;
                    const isOpen = openHere && expanded?.stageIndex === i;
                    return (
                      <td key={i}
                        className={`whitespace-nowrap px-2.5 py-2 ${clickable ? "cursor-pointer select-none" : ""} ${isOpen ? (darkMode ? "bg-slate-800" : "bg-blue-50") : ""}`}
                        onClick={clickable ? () => setExpanded((prev) => (prev && prev.personnelId === pid && prev.stageIndex === i) ? null : { personnelId: pid, stageIndex: i }) : undefined}>
                        {cell(s, clickable, isOpen)}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2.5 py-2">{total && total.tgt > 0 ? <span className="tabular-nums">{total.acq} / {total.tgt} · {Math.round((total.acq / total.tgt) * 100)}%</span> : <span className="text-slate-400">- / -</span>}</td>
                </tr>
                {openHere && detail && (
                  <tr className={darkMode ? "bg-slate-900/60" : "bg-slate-50/60"}>
                    <td colSpan={5 + stageLabels.length} className="px-2.5 py-2">
                      <EquipmentStageDetail darkMode={darkMode} stageLabel={detail.stageLabel} rows={detail.rows} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5 + stageLabels.length} className="px-3 py-10 text-center text-slate-500">표시할 직원이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">총 {rows.length}명 · 대상 설비/취득 설비는 설비별 인증단계(stage rule)와 승인된 설비취득 기준입니다.</div>
    </div>
  );
}
