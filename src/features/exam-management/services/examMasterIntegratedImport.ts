// 통합 Excel 등록 — 한 파일의 여러 시트를 FK 의존 순서로 분석/저장. 개별 탭 resolver 와 동일한
//  신계층(그룹→제품군→공정→장비) + scoped 신규/수정 판정 + 부모 오류 시 하위 처리보류.
//  ⚠ 08_설비별인증단계 / 09_공정별달성기준 은 커스텀 테이블 → 통합 등록 미지원(개별 화면에서 등록).
import * as XLSX from "xlsx";
import { EXAM_ENTITY_CONFIGS, type ExamEntityConfig } from "../examMasterConfigs";
import { listExamRows, upsertExamRow, writeExamAudit, findScopedExistingId, type ExamRow, type ExamMasterTable } from "./examMasterService";
import { listEquipmentStageRules, upsertEquipmentStageRule } from "./equipmentStageRuleService";
import { listProcessCriteriaRules, upsertProcessCriteriaRule } from "./processCriteriaRuleService";
import { formStateToCriteria, type ProcessCriteriaFormState } from "../utils/criteriaFormMapper";
import { normalizeCriteria } from "../engines/criteriaEvaluator";

// FK 의존 처리 순서(상위 → 하위).
const IMPORT_ORDER = ["groups", "categories", "processes", "equipment", "levels", "rules"] as const;
type CfgKey = (typeof IMPORT_ORDER)[number];
type SheetKey = CfgKey | "stage" | "criteria";
// 07/08 커스텀 테이블 시트 별칭(신규 표준 + 구버전 08/09).
const STAGE_ALIASES = ["07_설비별인증단계", "08_설비별인증단계", "설비별인증단계", "설비별 인증단계"];
const CRITERIA_ALIASES = ["08_공정별달성기준", "09_공정별달성기준", "공정별달성기준", "공정별 달성기준"];

// 시트 별칭: 신규 표준 + 구버전. 정규화 후 매칭.
const SHEET_ALIASES: Record<CfgKey, string[]> = {
  groups: ["01_그룹", "그룹", "02_그룹"],
  categories: ["02_제품군", "제품군", "01_제품군"],
  processes: ["03_공정", "04_공정", "공정"],
  equipment: ["04_장비목록", "05_장비목록", "장비목록", "05_장비", "장비"],
  levels: ["05_인증레벨", "06_인증레벨", "인증레벨", "인증 레벨"],
  rules: ["06_인증규칙", "07_인증규칙", "인증규칙", "인증 규칙"],
};
// 통합 등록 미지원 커스텀 시트(→ 처리보류 안내). 현재 08·09 모두 지원 → 비어 있음.
const HOLD_SHEET_ALIASES: Record<string, string[]> = {};

const norm = (s: string) => String(s ?? "").replace(new RegExp("[​-‍﻿]", "g"), "").replace(/\s+/g, "").trim().toLowerCase();
const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
const txt = (v: unknown) => String(v ?? "").trim();
// "코드 · 이름 · 경로…" → 코드/이름(앞 두 세그먼트).
const parseRef = (v: unknown) => { const p = String(v ?? "").replace(/\s+/g, " ").trim().split("·").map((s) => s.trim()); return { code: p[0] || "", name: p[1] || p[0] || "" }; };

export type RowAction = "new" | "update" | "dup" | "error" | "hold";
export type RowPlan = { rowNo: number; action: RowAction; reason?: string; payload?: ExamRow };
export type SheetPlan = { key: SheetKey; title: string; sheetName: string | null; total: number; counts: Record<RowAction, number>; rows: RowPlan[] };
export type IntegratedAnalysis = { sheets: SheetPlan[]; unknownSheets: string[]; holdSheets: string[]; ok: boolean };

const cfgOf = (key: CfgKey) => EXAM_ENTITY_CONFIGS.find((c) => c.key === key) as ExamEntityConfig;
const emptyCounts = (): Record<RowAction, number> => ({ new: 0, update: 0, dup: 0, error: 0, hold: 0 });

// 파일의 시트명 → CfgKey (별칭 정규화 매칭).
function matchSheet(sheetNames: string[], key: CfgKey): string | null {
  const cands = SHEET_ALIASES[key].map(norm);
  return sheetNames.find((sn) => cands.includes(norm(sn))) ?? null;
}

// 코드·이름으로 pool 에서 id 해석(스코프 필터 적용). 0건/다건은 null + 사유.
function resolveRef(pool: ExamRow[], raw: string, scope: (r: ExamRow) => boolean): { id: string | null; err?: "none" | "many" } {
  if (!raw) return { id: null };
  const { code, name } = parseRef(raw);
  const m = pool.filter((r) => scope(r) && r.deleted_at == null && (code && name ? (up(r.code) === up(code) && txt(r.name).toLowerCase() === name.toLowerCase()) : (up(r.code) === up(code || name) || txt(r.name).toLowerCase() === (code || name).toLowerCase())));
  const ids = Array.from(new Set(m.map((r) => String(r.id))));
  if (ids.length === 0) return { id: null, err: "none" };
  if (ids.length > 1) return { id: null, err: "many" };
  return { id: ids[0] };
}

// 통합 분석(미리보기). pool = 기존 DB + 이 파일에서 앞 시트가 만들 신규 행(스코프 해석용). 저장은 하지 않음.
export async function analyzeIntegratedWorkbook(wb: XLSX.WorkBook, tenantId: string): Promise<IntegratedAnalysis> {
  const [groups, cats, procs, levels, rules, equip, stageExisting, criteriaExisting] = await Promise.all([
    listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_rules", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_equipment", tenantId).catch(() => [] as ExamRow[]),
    listEquipmentStageRules(tenantId).catch(() => [] as ExamRow[]),
    listProcessCriteriaRules(tenantId).catch(() => [] as ExamRow[]),
  ]);
  // 해석용 풀(기존 + 앞 시트 신규를 계속 누적). code/name/부모FK 만 있으면 됨.
  //  exam_rules 는 scoped 신규/수정(process+level+rule_type) 판정을 위해 기존 행을 함께 적재.
  const pool: Record<CfgKey, ExamRow[]> = { groups: [...groups], categories: [...cats], processes: [...procs], equipment: [...equip], levels: [...levels], rules: [...rules] };
  const recognized = new Set<string>();
  const sheets: SheetPlan[] = [];

  for (const key of IMPORT_ORDER) {
    const cfg = cfgOf(key); if (!cfg) continue;
    const sheetName = matchSheet(wb.SheetNames, key);
    if (sheetName) recognized.add(norm(sheetName));
    const plan: SheetPlan = { key, title: cfg.title, sheetName, total: 0, counts: emptyCounts(), rows: [] };
    if (!sheetName) { sheets.push(plan); continue; }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
    plan.total = raw.length;
    const seen = new Set<string>(); // 파일 내부 중복(스코프 identity)

    raw.forEach((r, idx) => {
      const rowNo = idx + 2;
      const cell = (label: string) => { const hit = Object.entries(r).find(([k]) => norm(k) === norm(label)); return hit ? txt(hit[1]) : ""; };
      let err = "";
      const rowOut: ExamRow = {};
      // 부모 참조 해석(신계층). 그룹(독립) → 제품군(group_id) → 공정(category_id, group fallback).
      let gId = ""; let cId = ""; let pId = "";
      const grpRaw = cell("그룹") || cell("적용 그룹");
      const catRaw = cell("제품군") || cell("적용 제품군");
      const procRaw = cell("공정") || cell("적용 공정");
      if (key === "categories" || key === "processes" || key === "equipment" || key === "rules") {
        if (grpRaw) { const g = resolveRef(pool.groups, grpRaw, () => true); if (!g.id) err ||= `그룹 ‘${grpRaw}’을(를) 찾을 수 없습니다`; else gId = g.id; }
        else if (key !== "rules") err ||= "그룹이 비어 있습니다";
      }
      if ((key === "processes" || key === "equipment" || key === "rules") && !err && catRaw) {
        const c = resolveRef(pool.categories, catRaw, (r2) => String(r2.group_id ?? "") === gId); if (!c.id) err ||= `제품군 ‘${catRaw}’이(가) 선택 그룹에 없습니다`; else cId = c.id;
      }
      if ((key === "equipment" || key === "rules") && !err && procRaw) {
        const cand = (r2: ExamRow) => cId ? (String(r2.category_id ?? "") === cId || (!r2.category_id && String(r2.group_id ?? "") === gId)) : String(r2.group_id ?? "") === gId;
        const p = resolveRef(pool.processes, procRaw, cand); if (!p.id) err ||= `공정 ‘${procRaw}’을(를) 찾을 수 없습니다`; else pId = p.id;
      }

      // [장비 안전보강] 계층(그룹→제품군→공정→장비)상 공정 없는 장비는 저장 금지(process_id null INSERT 차단).
      if (key === "equipment" && !err && !pId) err ||= "장비를 등록하려면 그룹·제품군·공정을 먼저 지정해야 합니다";
      // 표(config) 비-transient 컬럼 값 채우기(부모 FK 는 위 해석값 사용).
      for (const col of cfg.columns) {
        if (col.transient) continue;
        if (col.key === "group_id") rowOut.group_id = gId || null;
        else if (col.key === "category_id") rowOut.category_id = cId || null;
        else if (col.key === "process_id") rowOut.process_id = pId || null;
        else if (col.type === "ref") {
          const v = cell(col.label);
          if (!v) rowOut[col.key] = null;
          else {
            const rt = col.refTable;
            const rpool = rt === "exam_levels" ? pool.levels : rt === "exam_groups" ? pool.groups : rt === "exam_categories" ? pool.categories : rt === "exam_processes" ? pool.processes : [];
            const rr = resolveRef(rpool, v, () => true);
            if (!rr.id && !err) err = `${col.label} ‘${v}’을(를) 찾을 수 없습니다`;
            rowOut[col.key] = rr.id;
          }
        }
        else if (col.type === "number") { const v = cell(col.label); rowOut[col.key] = v === "" ? null : Number(v.replace(/[^0-9.-]/g, "")); }
        else if (col.type === "boolean") rowOut[col.key] = /^(예|y|yes|true|1|자동|사용|o)$/i.test(cell(col.label));
        else rowOut[col.key] = cell(col.label) || null;
        if (col.required && !err && !String((col.key === "group_id" ? gId : col.key === "category_id" ? cId : col.key === "process_id" ? pId : rowOut[col.key]) ?? "").trim()) err ||= `${col.label} 누락`;
      }
      tenantScope(rowOut, tenantId);

      let action: RowAction; let reason: string | undefined;
      if (err) { action = "error"; reason = err; }
      else {
        // 파일 내부 스코프 중복
        const scopeKey = `${key}|${gId}|${cId}|${pId}|${up(rowOut.code)}`;
        if (seen.has(scopeKey)) { action = "dup"; reason = "파일 내 동일 스코프 코드 중복"; }
        else {
          seen.add(scopeKey);
          const existId = findScopedExistingId(pool[key], String(cfg.table), rowOut);
          if (existId) { action = "update"; rowOut.id = existId; }
          else { action = "new"; }
          // 다음 시트 해석을 위해 풀에 반영(신규는 임시 id 부여).
          const staged: ExamRow = { ...rowOut, id: rowOut.id || `__staged_${key}_${idx}` };
          pool[key] = [...pool[key], staged];
        }
      }
      plan.counts[action]++;
      plan.rows.push({ rowNo, action, reason, payload: action === "new" || action === "update" ? rowOut : undefined });
    });
    sheets.push(plan);
  }

  // ── 08_설비별인증단계(커스텀 테이블) ─────────────────────────────────────────
  // 그룹→제품군→공정→설비→인증단계 해석 후 exam_equipment_stage_rules 로 저장(commit 에서 서비스 재사용).
  const stageSheet = wb.SheetNames.find((sn) => STAGE_ALIASES.map(norm).includes(norm(sn))) ?? null;
  if (stageSheet) recognized.add(norm(stageSheet));
  const stagePlan: SheetPlan = { key: "stage", title: "설비별 인증단계", sheetName: stageSheet, total: 0, counts: emptyCounts(), rows: [] };
  if (stageSheet) {
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[stageSheet], { defval: "" });
    stagePlan.total = raw.length;
    const seen = new Set<string>();
    const ymd = (v: string) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim()); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; };
    raw.forEach((r, idx) => {
      const rowNo = idx + 2;
      const cell = (label: string) => { const hit = Object.entries(r).find(([k]) => norm(k) === norm(label)); return hit ? txt(hit[1]) : ""; };
      let err = "";
      const grpRaw = cell("그룹"), catRaw = cell("제품군"), procRaw = cell("공정"), eqRaw = cell("설비"), lvlRaw = cell("인증단계");
      const g = grpRaw ? resolveRef(pool.groups, grpRaw, () => true) : { id: null as string | null };
      if (!g.id) err = `그룹 ‘${grpRaw}’을(를) 찾을 수 없습니다`;
      const c = !err && catRaw ? resolveRef(pool.categories, catRaw, (r2) => String(r2.group_id ?? "") === g.id) : { id: null as string | null };
      if (!err && !c.id) err = `제품군 ‘${catRaw}’이(가) 선택 그룹에 없습니다`;
      const p = !err && procRaw ? resolveRef(pool.processes, procRaw, (r2) => String(r2.category_id ?? "") === c.id || (!r2.category_id && String(r2.group_id ?? "") === g.id)) : { id: null as string | null };
      if (!err && !p.id) err = `공정 ‘${procRaw}’을(를) 선택 제품군에서 찾을 수 없습니다`;
      const eq = !err && eqRaw ? resolveRef(pool.equipment, eqRaw, (r2) => String(r2.process_id ?? "") === p.id) : { id: null as string | null };
      if (!err && !eq.id) err = `설비 ‘${eqRaw}’을(를) 선택한 공정에서 찾을 수 없습니다`;
      const lv = !err && lvlRaw ? resolveRef(pool.levels, lvlRaw, () => true) : { id: null as string | null };
      if (!err && !lv.id) err = `인증단계 ‘${lvlRaw}’을(를) 찾을 수 없습니다`;
      const coreRaw = cell("주력설비여부");
      if (!err && coreRaw && !/^(y|n|예|아니오|아니요|true|false|o|x)$/i.test(coreRaw)) err = "주력설비여부는 Y/N 이어야 합니다";
      const effFrom = ymd(cell("적용시작일")), effTo = ymd(cell("적용종료일"));
      if (!err && cell("적용시작일") && !effFrom) err = "적용시작일 형식이 올바르지 않습니다(YYYY-MM-DD)";
      if (!err && cell("적용종료일") && !effTo) err = "적용종료일 형식이 올바르지 않습니다(YYYY-MM-DD)";
      if (!err && effFrom && effTo && effFrom > effTo) err = "적용시작일이 종료일보다 늦을 수 없습니다";

      const payload: ExamRow = {
        tenant_id: tenantId, group_id: g.id, category_id: c.id, process_id: p.id, equipment_id: eq.id, level_id: lv.id,
        is_core_equipment: /^(y|예|true|o)$/i.test(coreRaw), effective_from: effFrom || null, effective_to: effTo || null,
        sort_order: cell("정렬") === "" ? null : Number(cell("정렬").replace(/[^0-9.-]/g, "")) || null,
        notes: cell("비고") || null, is_active: !/^(미사용|n|no|false|x)$/i.test(cell("사용여부")),
      };
      let action: RowAction; let reason: string | undefined;
      if (err) { action = "error"; reason = err; }
      else {
        const sk = `${p.id}|${eq.id}|${lv.id}|${effFrom}|${effTo}`;
        if (seen.has(sk)) { action = "dup"; reason = "파일 내 동일 설비·단계·기간 중복"; }
        else {
          seen.add(sk);
          const exist = stageExisting.find((s) => !s.deleted_at && String(s.process_id ?? "") === p.id && String(s.equipment_id ?? "") === eq.id && String(s.level_id ?? "") === lv.id && String(s.effective_from ?? "").slice(0, 10) === effFrom && String(s.effective_to ?? "").slice(0, 10) === effTo);
          if (exist) { action = "update"; payload.id = String(exist.id); } else action = "new";
        }
      }
      stagePlan.counts[action]++;
      stagePlan.rows.push({ rowNo, action, reason, payload: action === "new" || action === "update" ? payload : undefined });
    });
  }
  sheets.push(stagePlan);

  // ── 09_공정별달성기준(exam_rules 달성기준 · criteria jsonb) ──────────────────
  //  criteria 손실 금지: UPDATE 는 기존 criteria 를 original 로 넘겨 formStateToCriteria 가 unknown/groups 보존.
  const critSheetName = wb.SheetNames.find((sn) => CRITERIA_ALIASES.map(norm).includes(norm(sn))) ?? null;
  if (critSheetName) recognized.add(norm(critSheetName));
  const critPlan: SheetPlan = { key: "criteria", title: "공정별 달성기준", sheetName: critSheetName, total: 0, counts: emptyCounts(), rows: [] };
  if (critSheetName) {
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[critSheetName], { defval: "" });
    critPlan.total = raw.length;
    const seen = new Set<string>();
    const rankOf = (id: string) => Number(pool.levels.find((l) => String(l.id) === id)?.rank_order ?? 0);
    const numCell = (v: string): number | "" => { const t = v.trim(); if (t === "") return ""; const n = Number(t.replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : ""; };
    const ymd = (v: string) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim()); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; };
    raw.forEach((r, idx) => {
      const rowNo = idx + 2;
      const cell = (label: string) => { const hit = Object.entries(r).find(([k]) => norm(k) === norm(label)); return hit ? txt(hit[1]) : ""; };
      let err = "";
      const g = cell("그룹") ? resolveRef(pool.groups, cell("그룹"), () => true) : { id: null as string | null };
      if (!g.id) err = `그룹 ‘${cell("그룹")}’을(를) 찾을 수 없습니다`;
      const c = !err && cell("제품군") ? resolveRef(pool.categories, cell("제품군"), (r2) => String(r2.group_id ?? "") === g.id) : { id: null as string | null };
      if (!err && !c.id) err = `제품군 ‘${cell("제품군")}’이(가) 선택 그룹에 없습니다`;
      const p = !err && cell("공정") ? resolveRef(pool.processes, cell("공정"), (r2) => String(r2.category_id ?? "") === c.id || (!r2.category_id && String(r2.group_id ?? "") === g.id)) : { id: null as string | null };
      if (!err && !p.id) err = `공정 ‘${cell("공정")}’을(를) 선택 그룹/제품군에서 찾을 수 없습니다`;
      const lv = !err && cell("인증단계") ? resolveRef(pool.levels, cell("인증단계"), () => true) : { id: null as string | null };
      if (!err && !lv.id) err = `인증단계 ‘${cell("인증단계")}’을(를) 찾을 수 없습니다`;

      // 선행단계(코드 | "코드 · 이름" 혼용) → level id. 인증단계와 동일 resolveRef 사용(코드·이름 파싱 · 동일 master identity).
      //  ⚠ 값이 "Y072 · Single" 처럼 "코드 · 이름" 형태여도 정확 해석(코드-only 조회 실패로 인한 대량 오류 방지). 애매매칭은 resolveRef 가 오류 처리.
      const prereqIds: string[] = [];
      if (!err && cell("선행단계")) {
        for (const token of cell("선행단계").split("|").map((s) => s.trim()).filter(Boolean)) {
          const rr = resolveRef(pool.levels, token, () => true);
          if (!rr.id) { err = rr.err === "many" ? `선행단계 ‘${token}’이(가) 여러 건 존재합니다` : `선행단계 ‘${token}’을(를) 찾을 수 없습니다`; break; }
          if (rr.id === lv.id) { err = "현재 단계 자기 자신은 선행단계로 사용할 수 없습니다"; break; }
          if (lv.id && rankOf(rr.id) >= rankOf(lv.id)) { err = `선행단계 ‘${token}’는 현재 단계의 상위 단계라 사용할 수 없습니다`; break; }
          prereqIds.push(rr.id);
        }
      }
      // 필수설비(코드 | "코드 · 이름" 혼용) → 선택 공정 소속 설비 id. 공정 scope(process_id) 유지(FLASH-CVD/DRAM-CVD 구분).
      const reqIds: string[] = [];
      if (!err && cell("필수설비")) {
        for (const token of cell("필수설비").split("|").map((s) => s.trim()).filter(Boolean)) {
          const rr = resolveRef(pool.equipment, token, (x) => String(x.process_id ?? "") === p.id);
          if (!rr.id) { err = rr.err === "many" ? `필수설비 ‘${token}’이(가) 선택 공정에 여러 건 존재합니다` : `필수설비 ‘${token}’은(는) 선택한 공정 소속이 아닙니다`; break; }
          reqIds.push(rr.id);
        }
      }
      const rate = numCell(cell("최소취득률"));
      if (!err && rate !== "" && (rate < 0 || rate > 100)) err = "취득률은 0~100 사이여야 합니다";
      const nums = { eq: numCell(cell("최소설비수")), core: numCell(cell("최소주력설비수")), ten: numCell(cell("최소근속개월")), el: numCell(cell("단계간경과개월")), cum: numCell(cell("누적경과개월")) };
      if (!err && Object.values(nums).some((n) => n !== "" && (n as number) < 0)) err = "개수/개월은 음수가 될 수 없습니다";
      const effFrom = ymd(cell("적용시작일")), effTo = ymd(cell("적용종료일"));
      if (!err && cell("적용시작일") && !effFrom) err = "적용시작일 형식이 올바르지 않습니다(YYYY-MM-DD)";
      if (!err && effFrom && effTo && effFrom > effTo) err = "적용시작일이 종료일보다 늦을 수 없습니다";

      const form: ProcessCriteriaFormState = {
        operator: /^or$/i.test(cell("조건방식")) ? "OR" : "AND",
        minEquipmentCount: nums.eq, minCoreEquipmentCount: nums.core, minCompletionRate: rate,
        requiredEquipmentIds: reqIds, prerequisiteLevelIds: prereqIds,
        minTenureMonths: nums.ten, minElapsedMonths: nums.el, cumulativeElapsedMonths: nums.cum,
        allowException: /^(y|예|true|o)$/i.test(cell("예외허용")), effectiveFrom: effFrom, effectiveTo: effTo, labelKo: cell("표시문구"),
      };
      let action: RowAction; let reason: string | undefined;
      if (err) { action = "error"; reason = err; }
      else {
        const sk = `${p.id}|${lv.id}|${effFrom}|${effTo}`;
        if (seen.has(sk)) { action = "dup"; reason = "파일 내 동일 공정·단계·기간 중복"; }
        else {
          seen.add(sk);
          // scoped: process+level+동일 기간 → 기존 달성기준 UPDATE(기존 criteria 보존 병합). 없으면 신규.
          const exist = criteriaExisting.find((x) => !x.deleted_at && String(x.process_id ?? "") === p.id && String(x.level_id ?? "") === lv.id && String(normalizeCriteria(x.criteria).effective_from ?? "") === effFrom && String(normalizeCriteria(x.criteria).effective_to ?? "") === effTo);
          const criteria = formStateToCriteria(form, exist ? exist.criteria : {}); // UPDATE 시 unknown/groups 보존
          const payload: ExamRow = { process_id: p.id, level_id: lv.id, notes: cell("관리자메모") || null, is_active: !/^(미사용|n|no|false|x)$/i.test(cell("사용여부")), criteria: criteria as unknown as ExamRow[keyof ExamRow], __reason: cell("변경사유") || undefined };
          if (exist) { action = "update"; payload.id = String(exist.id); } else action = "new";
          critPlan.rows.push({ rowNo, action, reason, payload });
          critPlan.counts[action]++;
          return;
        }
      }
      critPlan.counts[action]++;
      critPlan.rows.push({ rowNo, action, reason });
    });
  }
  sheets.push(critPlan);

  // 상위 시트 오류 → 하위 시트 처리보류 표시(상위에 error 가 있으면 그 아래 계층은 보류 경고).
  const holdSheets: string[] = [];
  const errAbove = (idx: number) => sheets.slice(0, idx).some((s) => s.counts.error > 0 && (s.key === "groups" || s.key === "categories" || s.key === "processes"));
  sheets.forEach((s, i) => { if (i > 0 && s.total > 0 && errAbove(i) && (s.key === "categories" || s.key === "processes" || s.key === "equipment" || s.key === "stage" || s.key === "criteria")) holdSheets.push(s.title); });

  // 미지원(커스텀) 시트 인식 → 별도 보류 안내.
  const unknownSheets: string[] = [];
  for (const sn of wb.SheetNames) {
    if (recognized.has(norm(sn))) continue;
    const isHold = Object.values(HOLD_SHEET_ALIASES).some((a) => a.map(norm).includes(norm(sn)));
    if (isHold) holdSheets.push(sn); else unknownSheets.push(sn);
  }
  return { sheets, unknownSheets, holdSheets, ok: sheets.some((s) => s.counts.new + s.counts.update > 0) };
}

function tenantScope(row: ExamRow, tenantId: string) { row.tenant_id = tenantId; }

// 저장(FK 순서). 상위 시트에 오류가 있으면 하위 계층 시트는 저장 보류. 신규는 임시 id 제거 후 insert.
export type CommitSummary = { created: number; updated: number; skipped: number; errors: number; message: string };
export async function commitIntegratedWorkbook(analysis: IntegratedAnalysis, tenantId: string, userId: string): Promise<CommitSummary> {
  let created = 0, updated = 0, skipped = 0, errors = 0;
  // 신규 임시 id → 실제 id 매핑(부모가 이번에 생성되면 자식이 참조).
  const idRemap = new Map<string, string>();
  const upstreamError = { groups: false, categories: false, processes: false };

  for (const key of IMPORT_ORDER) {
    const plan = analysis.sheets.find((s) => s.key === key); if (!plan || !plan.sheetName) continue;
    // 상위 계층 오류 시 하위 계층 보류.
    if ((key === "categories" && upstreamError.groups) || (key === "processes" && (upstreamError.groups || upstreamError.categories)) || (key === "equipment" && (upstreamError.groups || upstreamError.categories || upstreamError.processes))) {
      skipped += plan.counts.new + plan.counts.update; continue;
    }
    for (const rp of plan.rows) {
      if (rp.action !== "new" && rp.action !== "update") { if (rp.action === "error") errors++; continue; }
      const payload: ExamRow = { ...rp.payload };
      // 부모 FK 가 이번 실행에서 생성된 임시 id 면 실제 id 로 치환.
      for (const f of ["group_id", "category_id", "process_id"]) { const v = String(payload[f] ?? ""); if (v && idRemap.has(v)) payload[f] = idRemap.get(v); }
      const stagedId = typeof payload.id === "string" && payload.id.startsWith("__staged_") ? payload.id : null;
      if (stagedId) delete payload.id;
      try {
        const saved = await upsertExamRow(String(cfgOf(key).table) as ExamMasterTable, payload, tenantId, userId);
        await writeExamAudit(tenantId, userId, String(cfgOf(key).table) as ExamMasterTable, String(saved.id), rp.action === "new" ? "import" : "update", null, saved);
        if (stagedId) idRemap.set(stagedId, String(saved.id));
        if (rp.action === "new") created++; else updated++;
      } catch { errors++; if (key === "groups") upstreamError.groups = true; if (key === "categories") upstreamError.categories = true; if (key === "processes") upstreamError.processes = true; }
    }
  }

  // 08_설비별인증단계 — 상위(그룹/제품군/공정) 오류 시 보류. equipmentStageRuleService 재사용(overlap·audit·RLS 내장).
  const stagePlan = analysis.sheets.find((s) => s.key === "stage");
  if (stagePlan && stagePlan.sheetName) {
    if (upstreamError.groups || upstreamError.categories || upstreamError.processes) {
      skipped += stagePlan.counts.new + stagePlan.counts.update;
    } else {
      for (const rp of stagePlan.rows) {
        if (rp.action !== "new" && rp.action !== "update") { if (rp.action === "error") errors++; continue; }
        const payload: ExamRow = { ...rp.payload };
        for (const f of ["group_id", "category_id", "process_id", "equipment_id"]) { const v = String(payload[f] ?? ""); if (v && idRemap.has(v)) payload[f] = idRemap.get(v); }
        const stagedId = typeof payload.id === "string" && payload.id.startsWith("__staged_") ? payload.id : null;
        if (stagedId) delete payload.id;
        try { await upsertEquipmentStageRule(payload, tenantId, userId); if (rp.action === "new") created++; else updated++; }
        catch { errors++; } // 유효기간 겹침(EXCLUDE) 등 → 오류 집계(원문 비노출)
      }
    }
  }

  // 09_공정별달성기준 — 상위 오류 시 보류. processCriteriaRuleService 재사용(overlap·audit·criteria 보존).
  const critPlan = analysis.sheets.find((s) => s.key === "criteria");
  if (critPlan && critPlan.sheetName) {
    if (upstreamError.groups || upstreamError.categories || upstreamError.processes) {
      skipped += critPlan.counts.new + critPlan.counts.update;
    } else {
      for (const rp of critPlan.rows) {
        if (rp.action !== "new" && rp.action !== "update") { if (rp.action === "error") errors++; continue; }
        const payload: ExamRow = { ...rp.payload };
        for (const f of ["process_id", "level_id"]) { const v = String(payload[f] ?? ""); if (v && idRemap.has(v)) payload[f] = idRemap.get(v); }
        const reason = typeof payload.__reason === "string" ? payload.__reason : undefined; delete payload.__reason;
        try { await upsertProcessCriteriaRule(payload, tenantId, userId, reason ? { reason } : undefined); if (rp.action === "new") created++; else updated++; }
        catch { errors++; } // 기간 겹침 등 → 오류 집계(원문 비노출)
      }
    }
  }
  return { created, updated, skipped, errors, message: `생성 ${created} · 수정 ${updated} · 보류 ${skipped} · 오류 ${errors}` };
}
