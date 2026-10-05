/* ============================================================================
 * 전체 DR 백업 생성/검사 — 순수 함수 LOCAL 검증(브라우저/DB 불필요).
 *  · buildDrBackup 메타/checksum/완전성 + 금지 비밀 부재 + 표시 라벨 매핑.
 * ========================================================================== */
import { buildDrBackup, serializeDrBackup, verifyChecksum } from "../../src/services/backupService";
import { displayRecordCountLabel } from "../../src/services/datasetRegistry";

const results: Record<string, { status: "PASS" | "FAIL"; detail: string }> = {};
const ok = (id: string, cond: boolean, detail: string) => { results[id] = { status: cond ? "PASS" : "FAIL", detail }; console.log(`${id} ${cond ? "PASS" : "FAIL"} — ${detail}`); };

// 합성 모듈(전 모듈 + exam/rbac). PII/비밀은 넣지 않는다(백업이 비밀을 "만들지" 않음을 확인하는 용도).
const input = {
  tenantId: "QA-TENANT", appVersion: "v4-qa",
  dorm: { dorms: [{ id: "d1", name: "A동" }], occupants: [{ id: "o1", name: "홍길동" }], newHires: [], dormContracts: [{ id: "k1" }] } as any,
  operational: { cleaningReports: [{ id: "c1", cleanStatus: "완료" }], defects: [], inventory: [], settlementRecords: [], settlementItems: [] } as any,
  military: { militaryPersonnel: [{ id: "m1" }], militaryCodeValues: [{ id: "kv1" }] } as any,
  exam: { exam_personnel: [{ id: "p1" }], exam_processes: [{ id: "pr1" }], exam_results: [{ id: "r1" }] },
  rbac: { profiles: [{ id: "u1", role: "admin" }], custom_role_permissions: [{ id: "rp1" }] },
  system: { systemSettings: { theme: "light" } } as any,
  audit: { auditLogs: [{ id: "a1" }] } as any,
};

const cb = buildDrBackup(input);
const json = serializeDrBackup(cb);

// 1) 메타 필드 완전성
ok("META", cb.formatId === "hts-dr" && cb.schemaVersion === 2 && cb.backupType === "disaster-recovery" && cb.tenantId === "QA-TENANT" && !!cb.generatedAt && cb.appVersion === "v4-qa" && !!cb.recordCounts && typeof cb.checksum === "string" && cb.checksum.length > 0,
  `format=${cb.formatId} schema=${cb.schemaVersion} type=${cb.backupType}`);

// 2) checksum 결정성 + verify
const cb2 = buildDrBackup(input);
const v = verifyChecksum(cb);
ok("CHECKSUM", cb.checksum === cb2.checksum && v.checked && v.ok, `deterministic=${cb.checksum === cb2.checksum} verifyOk=${v.ok}`);

// 3) 금지 비밀/바이너리 부재
const FORBIDDEN = /password|service_role|sb_secret_|eyJhbGciOi|access_token|refresh_token|"session"|api[_-]?secret|signedurl|sign\?token|data:[a-z]+\/[a-z]+;base64,/i;
ok("NO_SECRET", !FORBIDDEN.test(json), `matched=${FORBIDDEN.test(json)}`);

// 4) recordCounts 내부 key 존재(exam:/rbac:) — 저장형식은 내부 key 유지
const keys = Object.keys(cb.recordCounts);
ok("COUNTS_KEYS", keys.some((k) => k.startsWith("exam:")) && keys.some((k) => k.startsWith("rbac:")), `sample=${keys.filter((k) => k.includes(":")).slice(0, 3).join(",")}`);

// 5) 표시 라벨 매핑(사용자에겐 업무명, 내부 key 미노출)
const map = {
  "exam:exam_personnel": "시험관리 · 인원",
  "exam:exam_processes": "시험관리 · 공정",
  "exam:exam_results": "시험관리 · 시험 결과",
  "rbac:profiles": "사용자·권한 · 사용자 프로필",
  "rbac:custom_role_permissions": "사용자·권한 · 역할 권한",
};
let labelOk = true; const bad: string[] = [];
for (const [k, want] of Object.entries(map)) { const got = displayRecordCountLabel(k); if (got !== want) { labelOk = false; bad.push(`${k}→${got}`); } if (/^(exam|rbac):/.test(got)) { labelOk = false; bad.push(`leak:${got}`); } }
ok("LABELS", labelOk, bad.length ? bad.join("; ") : "exam/rbac 모두 업무명으로 표시, 내부 key 미노출");

const fails = Object.values(results).filter((v) => v.status === "FAIL").length;
console.log(`\nTOTAL ${Object.keys(results).length} PASS ${Object.keys(results).length - fails} FAIL ${fails}`);
process.exit(fails ? 1 : 0);
