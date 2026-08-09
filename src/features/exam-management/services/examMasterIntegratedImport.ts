// 통합 Excel 등록 — 한 파일의 여러 시트를 FK 의존 순서로 분석/저장. 개별 탭 resolver 와 동일한
//  신계층(그룹→제품군→공정→장비) + scoped 신규/수정 판정 + 부모 오류 시 하위 처리보류.
//  ⚠ 08_설비별인증단계 / 09_공정별달성기준 은 커스텀 테이블 → 통합 등록 미지원(개별 화면에서 등록).
import * as XLSX from "xlsx";
import { EXAM_ENTITY_CONFIGS, type ExamEntityConfig } from "../examMasterConfigs";
import { listExamRows, upsertExamRow, writeExamAudit, findScopedExistingId, type ExamRow, type ExamMasterTable } from "./examMasterService";

// FK 의존 처리 순서(상위 → 하위).
const IMPORT_ORDER = ["groups", "categories", "processes", "equipment", "levels", "rules"] as const;
type CfgKey = (typeof IMPORT_ORDER)[number];

// 시트 별칭: 신규 표준 + 구버전. 정규화 후 매칭.
const SHEET_ALIASES: Record<CfgKey, string[]> = {
  groups: ["01_그룹", "그룹", "02_그룹"],
  categories: ["02_제품군", "제품군", "01_제품군"],
  processes: ["04_공정", "공정", "03_공정"],
  equipment: ["05_장비목록", "장비목록", "05_장비", "장비"],
  levels: ["06_인증레벨", "인증레벨", "인증 레벨"],
  rules: ["07_인증규칙", "인증규칙", "인증 규칙"],
};
// 커스텀 테이블 시트(통합 등록 미지원 → 처리보류 표시).
const HOLD_SHEET_ALIASES: Record<string, string[]> = {
  "설비별 인증단계": ["08_설비별인증단계", "설비별인증단계", "설비별 인증단계"],
  "공정별 달성기준": ["09_공정별달성기준", "공정별달성기준", "공정별 달성기준"],
};

const norm = (s: string) => String(s ?? "").replace(new RegExp("[​-‍﻿]", "g"), "").replace(/\s+/g, "").trim().toLowerCase();
const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
const txt = (v: unknown) => String(v ?? "").trim();
// "코드 · 이름 · 경로…" → 코드/이름(앞 두 세그먼트).
const parseRef = (v: unknown) => { const p = String(v ?? "").replace(/\s+/g, " ").trim().split("·").map((s) => s.trim()); return { code: p[0] || "", name: p[1] || p[0] || "" }; };

export type RowAction = "new" | "update" | "dup" | "error" | "hold";
export type RowPlan = { rowNo: number; action: RowAction; reason?: string; payload?: ExamRow };
export type SheetPlan = { key: CfgKey; title: string; sheetName: string | null; total: number; counts: Record<RowAction, number>; rows: RowPlan[] };
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
  const [groups, cats, procs, levels] = await Promise.all([
    listExamRows("exam_groups", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_categories", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_processes", tenantId).catch(() => [] as ExamRow[]),
    listExamRows("exam_levels", tenantId).catch(() => [] as ExamRow[]),
  ]);
  // 해석용 풀(기존 + 앞 시트 신규를 계속 누적). code/name/부모FK 만 있으면 됨.
  const pool: Record<CfgKey, ExamRow[]> = { groups: [...groups], categories: [...cats], processes: [...procs], equipment: [], levels: [...levels], rules: [] };
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

  // 상위 시트 오류 → 하위 시트 처리보류 표시(상위에 error 가 있으면 그 아래 계층은 보류 경고).
  const holdSheets: string[] = [];
  const errAbove = (idx: number) => sheets.slice(0, idx).some((s) => s.counts.error > 0 && (s.key === "groups" || s.key === "categories" || s.key === "processes"));
  sheets.forEach((s, i) => { if (i > 0 && s.total > 0 && errAbove(i) && (s.key === "categories" || s.key === "processes" || s.key === "equipment")) holdSheets.push(s.title); });

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
  return { created, updated, skipped, errors, message: `생성 ${created} · 수정 ${updated} · 보류 ${skipped} · 오류 ${errors}` };
}
