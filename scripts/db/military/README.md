# 군대관리 부서 scope / RLS DB 스크립트

군대관리의 부서(military_department) 데이터 범위 강제와 RLS/GRANT 롤아웃 관련 SQL 보관소입니다.
실행 안전 원칙은 상위 [`scripts/db/README.md`](../README.md)를 먼저 읽어 주세요.
테스트 매트릭스: [`docs/db/military/`](../../../docs/db/military/). 배경 문서: [`docs/db/military/supabase-military-rls-README.md`](../../../docs/db/military/supabase-military-rls-README.md).

> ⚠️ **경고**
> - `archive/`의 `supabase-military-rls-policy-v2.sql`, `supabase-military-rls-policy-v3.sql` → **ARCHIVED_DO_NOT_USE** (최종본 `applied/supabase-military-phaseD-final-rls.sql`로 대체).
> - `staging/supabase-military-rls-local-setup.sql` → **STAGING_ONLY** (local 전용).
> - 모든 `rollback/*` → **ROLLBACK_DO_NOT_RUN** (승인 없이 실행 금지).

## 적용 상태 표

| 파일 | 분류 | 상태 | 환경 | 재실행 | 관련 rollback | 비고 |
|---|---|---|---|---|---|---|
| applied/supabase-military-phaseA-additive.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | (별도 phase rollback) | can_read_military_raw + sanitized RPC 기반. 적용일 UNKNOWN |
| applied/supabase-military-phaseB-rpc-v2.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | — | sanitized RPC v2. 적용일 UNKNOWN |
| applied/supabase-military-phaseD-final-rls.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | rollback/…-phaseD-rollback.sql | FINAL RLS(admin-only raw + viewer=RPC). 적용일 UNKNOWN |
| applied/supabase-military-grant-hardening.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | rollback/…-grant-rollback.sql | table GRANT hardening. 적용일 UNKNOWN |
| applied/supabase-military-dept-scope-apply.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | rollback/…-dept-scope-rollback.sql | 부서 scope helper+RPC. postcheck 확인(CMP/CVD). 적용일 UNKNOWN |
| applied/supabase-military-viewer-sanitized-read.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | rollback/…-viewer-rollback.sql | viewer sanitized read 경로. 적용일 UNKNOWN |
| verification/supabase-military-dept-scope-precheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-dept-scope-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | CMP=33/CVD=8/41 확인 근거 |
| verification/supabase-military-grant-diagnosis.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | GRANT 진단 |
| verification/supabase-military-grant-precheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-grant-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-phase-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | phase 통합 검증 |
| verification/supabase-military-phaseA-precheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-phaseD-precheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-phaseD-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-rls-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-rls-probe.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | RLS 접근 probe |
| verification/supabase-military-viewer-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | — |
| verification/supabase-military-viewer-probe.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | viewer 경로 probe |
| rollback/supabase-military-dept-scope-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (dept-scope-apply 되돌림) | — |
| rollback/supabase-military-grant-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (grant-hardening 되돌림) | — |
| rollback/supabase-military-phaseD-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (phaseD-final-rls 되돌림) | — |
| rollback/supabase-military-rls-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (rls 정책 되돌림) | — |
| rollback/supabase-military-viewer-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (viewer 경로 되돌림) | — |
| archive/supabase-military-rls-policy-v2.sql | archive | ARCHIVED_DO_NOT_USE | UNKNOWN | 금지 | — | 구버전 정책(phaseD로 대체) |
| archive/supabase-military-rls-policy-v3.sql | archive | ARCHIVED_DO_NOT_USE | UNKNOWN | 금지 | — | 구버전 정책(phaseD로 대체) |
| staging/supabase-military-rls-local-setup.sql | staging | STAGING_ONLY | local | Production 금지 | — | local 검증 셋업 |

> 적용일/적용자가 확인되지 않은 항목은 `UNKNOWN`으로 둡니다(추측 금지).
> `applied/` 6개 중 dept-scope는 postcheck로 확인됐고, 나머지는 롤아웃 정황상 적용으로 보이나 파일 자체에 기록이 없어 적용일/적용자는 UNKNOWN입니다.
