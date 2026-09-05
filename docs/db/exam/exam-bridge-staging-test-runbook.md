# 시험 브리지 staging 테스트 런북 (A~M)

> ⚠ STAGING 전용. Production 금지. 실데이터/PII 조회·출력 금지(성공/거부·row수만 기록).
> 실제 접근은 RLS로 강제됨을 확인하는 것이 목적 — F12/REST 직접 호출로도 검증.

## 0. 사전 준비
1. staging Supabase 신규 프로젝트 생성(Production과 다른 ref/URL/anon key 확인).
2. SQL Editor에서 `scripts/db/exam/staging/exam-bridge-staging-bootstrap.sql` 실행.
3. Authentication → Users에서 7개 계정 생성([test-accounts 문서](exam-bridge-staging-test-accounts.md)).
4. 각 UUID를 `scripts/db/exam/staging/exam-bridge-staging-seed.sql`의 `__T_*_UUID__`에 치환 → 실행(placeholder 남으면 uuid 캐스트 오류로 중단=guard).
5. **브리지 적용 전 baseline 테스트**(A/B/C/L) 먼저 수행 → 기존 동작 확인.
6. `scripts/db/exam/archive/supabase-exam-customrole-bridge-apply.sql` staging에 적용 → `...-postcheck.sql` 확인.
7. A~M 전체 수행.
8. `scripts/db/exam/archive/supabase-exam-customrole-bridge-rollback.sql` staging 적용 → A/B/C/L 재확인(원복).

## 실행 방법(공통)
- 각 계정으로 staging 앱 로그인, 또는 REST 직접 호출:
  `GET  {STAGING_URL}/rest/v1/exam_test_apps?process_id=eq.{PID}&select=id`  (헤더: apikey=anon, Authorization=Bearer {그 계정 access_token})
  `PATCH {STAGING_URL}/rest/v1/exam_test_apps?id=eq.{ROW_ID}`  body `{"label":"x"}` → update 검증
- process id(PID)는 `select id,code from exam_processes` 로 확보(코드만, 값 출력 무방·PII 아님).
- 기록은 **성공/거부(HTTP 200 vs 401/403 또는 0 rows)** 만.

## 테스트 매트릭스

| CASE | 계정 | 실행 | 기대(PASS) | FAIL |
|---|---|---|---|---|
| A | t_admin | 모든 process apps/certs select+update | 전부 성공 | 하나라도 거부 |
| B | t_viewer | 모든 process select | 전부 성공(읽기) / update는 거부 | update 성공 |
| C | t_direct | CMP select+update / CVD select | CMP 성공, CVD 거부(0행/403) | CVD 접근 성공 |
| D | t_custom | CVD select / CMP·ETCH select | CVD만 성공 | CMP/ETCH 성공 |
| E | t_direct(+CMP) 에 custom CVD 추가 배정 후 | CMP+CVD select | 둘 다 성공, ETCH 거부 | ETCH 성공 |
| F | t_custom → user_custom_roles.is_active=false 후 | CVD select | 거부(custom 제거) | 여전히 성공 |
| G | t_custom scope valid_until 과거로 수정 후 | CVD select | 거부(만료) | 성공 |
| H | t_custom_all | CMP/CVD/ETCH select + (신규 process 추가 후) 그것도 select | 전부 성공(미래 포함) | 일부 거부 |
| I | t_custom_all | 아무 process update | 거부(read-all은 쓰기 불가) | update 성공 |
| J | t_no_menu(배정) | CVD select | 거부(메뉴권한 없음) | 성공 |
| K | t_custom | ETCH를 REST/F12 직접 select·update | 거부(RLS) | 성공 |
| L | t_direct(ExamProcessScopeEditor로 저장된 CMP) | CMP select+update | 성공(회귀 없음) | 거부 |
| **M** | **t_coarse** | **exam_test_certs(CVD) update 시도** (apps.update 권한만 보유) | **거부** | **허용=탭 단위 권한 상승** |

## M — coarse permission leakage (가장 중요)
- 배경: 브리지 helper `exam_custom_role_has_perm`는 `exam%` 전체 탭에서 해당 action 존재만 확인(탭 무구분).
- t_coarse: `examApplications.update` 有 + CVD write scope. `examPmCertifications.update` 無.
- 실행: `exam_test_certs`(=PM cert 탭 대응)에서 CVD row **update** 시도.
- **PASS = 거부**(탭 단위로 정확히 제한). **FAIL = 허용**:
  - 판정: **HIGH — 탭 단위 권한 상승**.
  - 조치: **Production apply 금지**. 브리지를 탭 인자 포함(정책 변경 동반) 정밀 설계로 재설계 후 재검증.
- 참고: 현재 설계상 M은 FAIL(허용)될 가능성이 높음 — 이 런북의 핵심 확인 항목.

## 성능(선택)
- `EXPLAIN` 로 `exam_scope_allows`/`exam_custom_role_scope` 경유 쿼리 계획 확인(union 조인).
- 인덱스는 임의 생성 금지 — 필요성만 기록(기존 user_custom_roles/custom_role_scopes/eups 인덱스로 대체로 커버).

## 결과 회신 형식(PII 없이)
```
A: PASS/FAIL   B: …   C: …   D: …   E: …   F: …   G: …
H: …   I: …   J: …   K: …   L: …
M(coarse): PASS(거부) / FAIL(허용)
apply/postcheck: 정상 여부
rollback 후 A/B/C/L: 원복 확인
```
