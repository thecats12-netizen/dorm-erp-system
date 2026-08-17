// 월별 TO 시뮬레이션 내보내기(Excel/PDF/인쇄) — 화면과 동일한 단일 computed model 사용(display != export 방지).
//  · Excel: SheetJS(aoa_to_sheet) 4시트. · PDF/인쇄: window.open + print(브라우저 네이티브 → 한글 깨짐 없음 · A4 가로).
//  · DB 재조회 없음(호출 측에서 계산한 결과만 전달). 원본 데이터 불변.
import * as XLSX from "xlsx";

export type SimExportModel = {
  meta: { year: number; region: string; gender: string; scenarioName: string; vacancyCost: number; printedAt: string; basis: string };
  kpis: Array<{ label: string; value: string }>;
  months: number[];                                   // [1..12]
  rows: Array<{ label: string; values: string[] }>;   // 화면 표와 동일(라벨 + 12개월 표시문자열)
  adjustments: Array<{ ym: string; region: string; gender: string; type: string; quantity: number; repeatUntil: string; notes: string }>;
  terminations: Array<{ site: string; gender: string; dormId: string; month: number; capacity: number; status: string }>;
};

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_");
const esc = (s: string | number) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export function exportSimulationExcel(m: SimExportModel): void {
  const wb = XLSX.utils.book_new();
  const monthHdr = m.months.map((n) => `${n}월`);

  // 시트1: 요약
  const s1: (string | number)[][] = [
    ["월별 TO 시뮬레이션 — 요약"], [],
    ["기준년도", m.meta.year], ["지역", m.meta.region], ["성별", m.meta.gender],
    ["현재 시나리오", m.meta.scenarioName], ["공실 1실 월비용", m.meta.vacancyCost],
    ["계산 기준", m.meta.basis], ["출력일", m.meta.printedAt], [],
    ["KPI", "값"], ...m.kpis.map((k) => [k.label, k.value]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), "시뮬레이션 요약");

  // 시트2: 월별 표(화면과 동일)
  const s2: (string | number)[][] = [["구분", ...monthHdr], ...m.rows.map((r) => [r.label, ...r.values])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), "월별 TO 시뮬레이션");

  // 시트3: 시나리오 조건
  const s3: (string | number)[][] = [["적용년월", "지역", "성별", "유형", "수량", "반복종료", "비고"],
    ...m.adjustments.map((a) => [a.ym, a.region, a.gender, a.type, a.quantity, a.repeatUntil, a.notes])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), "시나리오 조건");

  // 시트4: 임차 해지예정 상세
  const s4: (string | number)[][] = [["지역", "성별", "건물|동|호", "계약상태", "해지예정월", "capacity", "TO 감소량"],
    ...m.terminations.map((t) => [t.site, t.gender, t.dormId, t.status, `${t.month}월`, t.capacity, t.capacity])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), "임차 해지예정 상세");

  XLSX.writeFile(wb, `${safe(`월별TO시뮬레이션_${m.meta.year}_${m.meta.region}_${m.meta.gender}`)}.xlsx`);
}

function buildPrintHtml(m: SimExportModel): string {
  const monthHdr = m.months.map((n) => `<th>${n}월</th>`).join("");
  const bodyRows = m.rows.map((r) => `<tr><td class="lbl">${esc(r.label)}</td>${r.values.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("");
  const kpiHtml = m.kpis.map((k) => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`).join("");
  const adjRows = m.adjustments.length
    ? m.adjustments.map((a) => `<tr><td>${esc(a.ym)}</td><td>${esc(a.region)}</td><td>${esc(a.gender)}</td><td>${esc(a.type)}</td><td>${esc(a.quantity)}</td><td>${esc(a.repeatUntil)}</td><td>${esc(a.notes)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">적용 시나리오 없음</td></tr>`;
  const termRows = m.terminations.length
    ? m.terminations.map((t) => `<tr><td>${esc(t.site)}</td><td>${esc(t.gender)}</td><td>${esc(t.dormId)}</td><td>${esc(t.status)}</td><td>${t.month}월</td><td>${t.capacity}</td><td>-${t.capacity}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">해지 예정 계약 없음</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>월별 TO 시뮬레이션</title>
    <style>
      @page{size:A4 landscape;margin:10mm}
      body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#111;font-size:11px}
      h1{font-size:17px;margin:0 0 2px}h2{font-size:13px;margin:14px 0 4px}
      .sub{color:#555;font-size:11px;margin-bottom:8px}
      .kpis{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .kpi{border:1px solid #cbd5e1;border-radius:6px;padding:4px 9px;min-width:78px}
      .kl{font-size:9px;color:#64748b}.kv{font-size:13px;font-weight:700}
      table{border-collapse:collapse;width:100%;margin-bottom:6px}
      th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:right}
      td.lbl{text-align:left;font-weight:600;white-space:nowrap}
      th{background:#eef2f7;text-align:right}th:first-child{text-align:left}
      td.muted{text-align:center;color:#888}
      tr{page-break-inside:avoid}thead{display:table-header-group}
    </style>
    <h1>월별 TO 시뮬레이션</h1>
    <div class="sub">기준년도 ${m.meta.year} · 지역 ${esc(m.meta.region)} · 성별 ${esc(m.meta.gender)} · 시나리오 ${esc(m.meta.scenarioName)} · 출력 ${esc(m.meta.printedAt)}</div>
    <div class="kpis">${kpiHtml}</div>
    <h2>월별 표</h2>
    <table><thead><tr><th>구분</th>${monthHdr}</tr></thead><tbody>${bodyRows}</tbody></table>
    <h2>시나리오 조건</h2>
    <table><thead><tr><th>적용년월</th><th>지역</th><th>성별</th><th>유형</th><th>수량</th><th>반복종료</th><th>비고</th></tr></thead><tbody>${adjRows}</tbody></table>
    <h2>임차 해지예정 상세</h2>
    <table><thead><tr><th>지역</th><th>성별</th><th>건물|동|호</th><th>계약상태</th><th>해지예정월</th><th>capacity</th><th>TO 감소량</th></tr></thead><tbody>${termRows}</tbody></table>
    <div class="sub" style="margin-top:8px">계산 기준: ${esc(m.meta.basis)}</div>`;
}

// PDF/인쇄 공용: 새 창에 인쇄용 HTML 렌더 후 print(브라우저 대화상자에서 "PDF로 저장" 또는 프린터 선택).
export function printSimulation(m: SimExportModel): void {
  const w = window.open("", "_blank", "width=1180,height=820");
  if (!w) { window.alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요."); return; }
  w.document.write(buildPrintHtml(m));
  w.document.close(); w.focus();
  // 렌더 완료 후 인쇄(폰트/레이아웃 안정화).
  setTimeout(() => { try { w.print(); } catch { /* noop */ } }, 250);
}
