# 시험관리 — 스테이징 배포 · UAT · 운영 승인 런북 (13단계)

> 이 문서는 **운영자가 직접 실행**하는 절차서다. AI는 코드/문서만 준비했고, 스테이징 배포·UAT·운영 배포는 수행하지 않았다.
> 관련: `docs/exam-security-audit.md`, `supabase/diagnostics/exam_security_audit.sql`, `supabase/diagnostics/verify_employee_license_plan.sql`.

## 0. 현재 저장소 상태(사실)
- 브랜치: **main** · 변경 **18건 전부 미커밋**(먼저 브랜치 분리 + 리뷰 필요, 승인 전 push 금지).
- `.env` **미추적**(양호), 추적: `.env.example`만.
- 스크립트: `build`, `lint`(대용량 App.tsx로 OOM 이력), `dev`, `preview`. **test/type-check 스크립트 없음**.
- Supabase 환경: `.env` 단일 URL — **스테이징/운영 분리 미확인**(아래 1에서 반드시 분리).

## 1. 환경 분리 (필수 · 미충족 시 운영 배포 차단)
| 항목 | 로컬 | 스테이징 | 운영 |
|---|---|---|---|
| Supabase 프로젝트 | dev | **staging(별도)** | prod(별도) |
| URL/anon key | dev | staging 값 | prod 값 |
| service_role | 미사용(클라) | 서버/Edge만 | 서버/Edge만 |
| Vercel | preview | staging 프로젝트/브랜치 | production 브랜치 |
| 도메인 | localhost | staging.도메인 | 운영 도메인 |
| 데이터 | 합성 | **익명화 합성** | 실데이터 |
- ⚠️ 스테이징이 운영 Supabase를 공유하면 **운영 배포 차단**. 반드시 별도 프로젝트.

## 2. 브랜치·커밋 (승인 전 push 금지)
```
git checkout -b release/exam-stabilization-13
git add -A            # .env 는 gitignore 로 제외됨(확인)
git commit -m "exam: 자동 라이선스/자동입력/보안검수 안정화(1~12단계)"
# 스테이징 배포용 브랜치로 PR → 리뷰 → staging 배포. 운영(main) 직접 반영 금지.
```
- 커밋 전 확인: `.env` 미추적, service_role 부재, dist/build 산출물 미포함.

## 3. 마이그레이션 적용 순서 (스테이징 먼저 · 자동 실행 금지)
Supabase SQL Editor에서 **순서대로 수동 실행**:
1. (선행 확인) `20260712*`~`20260724*` 적용 상태 확인.
2. **`20260726000000_employee_license_plan.sql`** ← **필수**(라이선스 테이블 + `exam_rules.required_months` + base_date + CHECK). 미적용 시 인증기준 "취득 기한" 저장 실패.
3. (선택) `20260727000000_exam_rules_retest_months.sql` — 규칙 마법사(P2) 도입 시.
4. 검증: `verify_employee_license_plan.sql`, `exam_security_audit.sql` 실행 → RLS true·DELETE 정책 0·anon 0·search_path 고정 확인.
- rollback: 각 `supabase/rollback/*` 파일. 적용 전 `create table backup_exam_rules_YYYYMMDD as select * from public.exam_rules;`.

## 4. UAT 테스트 데이터(익명화 · 실개인정보 금지)
- tenant: 회사A/회사B(격리 검증용). 사용자: super_admin/admin/manager/operator/viewer/사용자정의/비활성/초대대기.
- 인력: 신규입사·Single~DM 각 단계·만료예정·만료·재시험·기한초과·퇴사·계획누락·중복검증.
- 생성: `npm run generate-sample`(기존 스크립트) 또는 SQL seed(tenant='staging').

## 5. UAT 시나리오 체크리스트(운영자 수행 · 각 항목 통과/실패 기록)
- **로그인/계정**: 로그인·세션유지·만료·로그아웃·비활성 차단·초대·역할적용·tenant 전환제한.
- **인력**: 등록→**계획 자동생성**·사번중복차단·검색·수정·비활성·복구·Excel·감사로그·viewer 등록불가.
- **응시**: 사원선택→자동입력·추천단계·점수·합격/불합격·**퇴사자 신규 차단(신규 구현)**·중복차단·저장·감사로그.
- **PM**: 후보·추천·취득/만료일(말일보정)·인증번호·**승인→다음 단계 활성화**·감사로그.
- **DM**: 후보·조건·**승인→최종 단계 완료(fallback 포함)**·인증번호·감사로그.
- **목표/실적**: 자동집계·달성률(0나눗셈/100%초과)·**대시보드=보고서=목표=실적 수치 일치**.
- **기준/규칙**: 코드제안·중복차단·비활성·(마법사=P2 미구현) · tenant 격리.
- **대시보드/보고서**: 카드·드릴다운·**라이선스 자동화 현황/오류**·필터·Excel·PDF.
- **권한**: 역할별 로그인 실검증(버튼+URL+API).
- **tenant 격리**: A→B 조회/생성/수정/삭제/파일/보고서 차단(1건 유출=P0).
- **파일/Excel/PDF/모바일/성능/브라우저/보안/감사로그**: §20~§27 항목.

## 6. 백업·rollback
- 백업: Git 태그(`v-exam-13`)·직전 커밋·Supabase DB 백업·RLS/함수 정의·환경변수 목록·`backup_exam_rules_*`.
- rollback: 프론트=Vercel 이전 배포 즉시 롤백 / DB=`supabase/rollback/*` / 판단자·순서·사용자공지·로그보존 명시.
- ⚠️ 백업 완료 미확인 시 **운영 배포 승인 보류**.

## 7. 모니터링
로그인 실패율·API 오류율·RLS 거부·자동화 실패(`exam_audit_logs`/`security_audit_logs`·`writeAutomationLog`)·파일/Excel/PDF 실패·응답시간·인증번호 충돌·비정상 다운로드. 기존 감사로그/자동화 이력 재사용.

## 8. 운영 배포 체크리스트(요약)
코드(커밋·build·디버그 제거·.env 미추적) / Supabase(백업·마이그레이션·RLS·Storage·Auth redirect) / Vercel(prod 브랜치·환경변수·도메인·HTTPS·preview↔prod 분리) / 업무(관리자계정·기준정보·규칙·교육) / 보안(service_role 미노출·tenant 격리·파일권한·마스킹·감사로그) / 운영(백업·rollback·모니터링·책임자·승인자·배포시간).

## 9. STAGING 표시(선택)
`import.meta.env.VITE_APP_ENV==='staging'`일 때 작은 배지 노출을 권장하나, **이번 단계에서는 App.tsx 변경 회귀 위험으로 미구현**. 도입 시 최소 컴포넌트로 추가.
