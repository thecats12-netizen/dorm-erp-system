# 시험관리 custom-role DB 스크립트

시험관리 custom-role의 서버측 데이터 범위 강제(RLS/helper/bridge) 관련 SQL 보관소입니다.
실행 안전 원칙은 상위 [`scripts/db/README.md`](../README.md)를 먼저 읽어 주세요.
테스트 매트릭스/runbook: [`docs/db/exam/`](../../../docs/db/exam/).

> ⚠️ **경고**
> - `staging/`의 `exam-bridge-staging-bootstrap.sql`, `exam-bridge-staging-seed.sql` → **STAGING_ONLY · PRODUCTION 실행 절대 금지.**
> - `archive/`의 `supabase-exam-customrole-bridge-apply.sql`, `supabase-exam-customrole-selectfix-apply.sql` → **UNKNOWN_STATUS · 현재 운영 적용본으로 사용 금지.** Production 정의 대조로 적용 이력이 확인될 때만 별도 커밋으로 `applied/`로 승격.

## 적용 상태 표

| 파일 | 분류 | 상태 | 환경 | 재실행 | 관련 rollback | 비고 |
|---|---|---|---|---|---|---|
| applied/supabase-exam-customrole-resource-apply.sql | applied | APPLIED_DO_NOT_RERUN | Production | 금지 | rollback/…-resource-rollback.sql | resource-aware RESTRICTIVE + SELECT 게이트. 적용일/적용자 UNKNOWN |
| verification/supabase-exam-customrole-resource-precheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | 적용 전 상태 조회 |
| verification/supabase-exam-customrole-resource-postcheck.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | 적용 후 검증 |
| verification/supabase-exam-customrole-enforce-audit.sql | verification | SAFE_READ_ONLY | Production | 가능(조회) | — | 강제 상태 감사 |
| rollback/supabase-exam-customrole-resource-rollback.sql | rollback | ROLLBACK_DO_NOT_RUN | Production | 승인 필요 | (resource-apply 되돌림) | 실행 시 resource 강제 제거 |
| staging/exam-bridge-staging-bootstrap.sql | staging | STAGING_ONLY | staging | Production 금지 | — | 빈 staging 스키마/helper 부트스트랩 |
| staging/exam-bridge-staging-seed.sql | staging | STAGING_ONLY | staging | Production 금지 | — | staging 테스트 데이터 시드 |
| archive/supabase-exam-customrole-bridge-apply.sql | archive | UNKNOWN_STATUS | UNKNOWN | 금지 | archive/…-bridge-rollback.sql | 설계안 B(helper union). resource 방식으로 대체 가능성 |
| archive/supabase-exam-customrole-bridge-precheck.sql | archive | SAFE_READ_ONLY | UNKNOWN | 가능(조회) | — | bridge 계열 조회 |
| archive/supabase-exam-customrole-bridge-postcheck.sql | archive | SAFE_READ_ONLY | UNKNOWN | 가능(조회) | — | bridge 계열 조회 |
| archive/supabase-exam-customrole-bridge-snapshot.sql | archive | SAFE_READ_ONLY | UNKNOWN | 가능(조회) | — | helper 정의 스냅샷 |
| archive/supabase-exam-customrole-bridge-rollback.sql | archive | ROLLBACK_DO_NOT_RUN | UNKNOWN | 승인 필요 | (bridge-apply 되돌림) | — |
| archive/supabase-exam-customrole-selectfix-apply.sql | archive | UNKNOWN_STATUS | UNKNOWN | 금지 | archive/…-selectfix-rollback.sql | viewer_all SELECT 수정 v3. resource SELECT 게이트와 중복/대체 가능성 |
| archive/supabase-exam-customrole-selectfix-precheck.sql | archive | SAFE_READ_ONLY | UNKNOWN | 가능(조회) | — | — |
| archive/supabase-exam-customrole-selectfix-postcheck.sql | archive | SAFE_READ_ONLY | UNKNOWN | 가능(조회) | — | — |
| archive/supabase-exam-customrole-selectfix-rollback.sql | archive | ROLLBACK_DO_NOT_RUN | UNKNOWN | 승인 필요 | (selectfix-apply 되돌림) | — |

> 적용일/적용자가 확인되지 않은 항목은 `UNKNOWN`으로 둡니다(추측 금지).
