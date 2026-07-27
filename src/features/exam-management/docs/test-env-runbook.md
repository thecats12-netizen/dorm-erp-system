# 시험관리 인증 구조 — 테스트 환경 실행 & 인수인계 런북

> **목적**: 현재까지 구현된 인증 구조(exam_levels 확장 · 설비 인증 · 설비별 인증단계 · 공정별 달성기준 · Preview · Single~M4 엔진 · 인증 이력 append)를 **테스트 Supabase 프로젝트 + 브라우저**에서 담당자가 안전하게 실행·검증하기 위한 절차 모음.
>
> ⚠ **이 문서는 실행 지침입니다. 이 저장소 환경에서는 DB·브라우저를 실행하지 않았습니다.**
> ⚠ **운영(Production) 프로젝트에는 어떤 migration/seed도 적용하지 마세요.**
>
> 관련 파일: [`verify-schema.sql`](./verify-schema.sql) · [`seed-test-data.sql`](./seed-test-data.sql) · [`cleanup-test-data.sql`](./cleanup-test-data.sql) · [`preview-validation.sql`](./preview-validation.sql) · [`validation-results.md`](./validation-results.md) · [`rls-history-analysis.md`](./rls-history-analysis.md)

---

## [1] 환경 사전 점검 (실제 키 값 출력 금지)

아래를 순서대로 실행하고 **결과만**(설정됨/미설정/실행 가능/실행 불가/테스트 프로젝트 확인 필요) 기록하세요. 키 값 자체는 출력·기록·커밋하지 마세요.

```bash
# Node / 패키지 매니저 (이 프로젝트는 npm · package-lock.json 사용)
node -v                      # 기대: v18+ (Vite 6 기준 v18/20 권장)
npm -v
# Supabase CLI
supabase --version || echo "Supabase CLI 미설치 → npm i -g supabase 또는 scoop/brew"
# Docker (로컬 supabase start 에 필요)
docker --version || echo "Docker 미설치 → 로컬 테스트 DB 기동 불가(원격 테스트 프로젝트 사용)"
# 프로젝트 URL / anon key 존재 여부 (값은 마스킹)
test -f .env && grep -q '^VITE_SUPABASE_URL=' .env && echo "VITE_SUPABASE_URL=설정됨" || echo "VITE_SUPABASE_URL=미설정"
test -f .env && grep -q '^VITE_SUPABASE_ANON_KEY=' .env && echo "VITE_SUPABASE_ANON_KEY=설정됨" || echo "VITE_SUPABASE_ANON_KEY=미설정"
# service_role key / DB 접속정보 존재 여부 (코드/.env 에 저장 금지 — CLI 세션/입력으로만 사용)
grep -RIlq 'service_role' . 2>/dev/null && echo "⚠ service_role 문자열이 리포에 존재 → 즉시 점검" || echo "service_role 코드 미저장(정상)"
# migration 파일 존재
ls supabase/migrations | grep -E '20260747000000|20260747000001|20260748000000|20260749000000|20260750000000' && echo "migration 5종 존재" || echo "migration 누락"
# git working tree
git status --short
# 현재 프로젝트 ref (config.toml) — 운영/테스트 구분 필수
grep project_id supabase/config.toml
```

**판정 규칙**
- `service_role key` 또는 `DB connection string(비밀번호)`이 **없으면 → migration 실행 불가**로 표시. **anon key만으로는 migration 불가**(스키마 변경 권한 없음, RLS/DDL 불가).
- `.env`의 URL이 **운영 프로젝트**를 가리키면 → **테스트 프로젝트 확인 필요**로 표시하고 중단.
- Docker 미설치 + 원격 테스트 프로젝트 미보유 → **실행 불가**.

---

## [2] 테스트 Supabase 프로젝트 준비 (클릭 순서)

1. https://supabase.com/dashboard 접속 · 로그인.
2. **New project** 클릭.
3. Organization 선택 → **Project name** 예시: `hts-erp-exam-TEST`(반드시 이름에 `TEST` 포함).
4. **Region**: 운영과 동일 리전 또는 근접 리전(예: Northeast Asia (Seoul)).
5. **Database Password**: 강력한 값 생성 → **비밀번호 관리자에 안전 보관**(코드/문서/깃 저장 금지).
6. 생성 후 **Project Settings → API**:
   - **Project URL** 확인 → `VITE_SUPABASE_URL` 에 사용.
   - **anon public key** 확인 → `VITE_SUPABASE_ANON_KEY` 에 사용.
   - **service_role key** 확인 → **브라우저/Vite 환경변수에 절대 넣지 말 것**. CLI/서버 작업 시에만 별도로 사용.
7. **Project Settings → Database → Connection string** 확인(migration 시 필요, 비밀번호 포함 → 저장 금지).
8. **운영/테스트 구분 체크리스트** (모두 예여야 진행):
   - [ ] 프로젝트 이름에 `TEST` 포함
   - [ ] Project ref 가 운영 ref 와 **다름**(운영 ref 를 사전에 확인·대조)
   - [ ] 운영 데이터가 들어있지 않은 빈 프로젝트
   - [ ] 이 프로젝트에 실서비스 트래픽이 연결되어 있지 않음
9. **`.env.local` 설정** (기존 변수명 그대로 · 새 이름 만들지 말 것):
   ```dotenv
   # .env.local (git 미추적 — .gitignore 확인)
   VITE_SUPABASE_URL=https://<TEST-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<TEST anon key>
   # ⚠ service_role 은 여기에 넣지 않는다(브라우저 노출 금지)
   ```
10. **깃 유출 방지 확인**:
    ```bash
    git check-ignore .env.local && echo ".env.local 무시됨(정상)" || echo "⚠ .gitignore 에 .env.local 추가 필요"
    git status --short   # .env* 가 스테이지에 없어야 함
    ```

---

## [3] migration 적용 절차

### 적용 순서(선행 의존 포함)
현재 리포지토리 기준 필수 선행 → 신규 5종 순서:

| 순서 | migration | 역할 |
|---|---|---|
| 선행1 | `20260712000000_create_exam_management` | 기본 테이블(exam_levels/processes/equipment/rules/pm_certifications 등) |
| 선행2 | `20260715000000` · `20260716000000` | RLS helper `can_read_exam_master()` / `is_exam_admin()` |
| 선행3 | `20260730000000_exam_rls_custom_permission` | 커스텀 권한(`crp_user_has_permission`) · 감사로그 정책 |
| 선행4 | `20260731000000_exam_master_fields_expansion` | processes.group_id/category_id 등 확장 컬럼 |
| 1 | `20260747000000_exam_levels_tier` | exam_levels: tier/parent_level_id/requires_approval/auto_promote |
| 2 | `20260747000001_exam_levels_seed` | SINGLE/M1~M4 seed |
| 3 | `20260748000000_exam_equipment_stage_rules` | 설비별 인증단계(+btree_gist, exclusion) |
| 4 | `20260749000000_exam_equipment_certifications` | 설비 취득 |
| 5 | `20260750000000_exam_certification_history` | 인증 이력(append-only) |

> `exam_lines`(20260739)·`exam_hierarchy`(20260740)는 **DRAFT**로 표기됨 — 테스트에 필수 아님. `line_id`는 참조만 되며 이번 검증에 불필요.
> **전체 migration을 하나로 합쳐 실행하지 마세요.** 파일 단위로 순서대로, 각 단계 성공 확인 후 다음.

### 방식 A — Supabase CLI (권장)
```bash
supabase login                       # 액세스 토큰 입력
supabase link --project-ref <TEST-ref>   # ⚠ 반드시 TEST ref. 프롬프트에서 DB 비밀번호 입력
supabase migration list              # 로컬 vs 원격 적용 상태 비교(적용 전)
supabase db push                     # 미적용 migration 순서대로 반영
supabase migration list              # 5종이 원격에 적용됐는지 재확인
```
- 실패 시 **즉시 중단**하고 로그 확인. 부분 적용 상태를 기록.
- (로컬 일회용 DB 방식) Docker 보유 시: `supabase start` → `supabase db reset`(로컬 전용, 원격 무관).

### 방식 B — Dashboard SQL Editor
1. Dashboard → **SQL Editor**.
2. 위 표의 **선행 migration이 이미 적용되었는지** `verify-schema.sql` [A] 블록으로 먼저 확인.
3. 신규 5종 파일을 **표 순서대로 한 파일씩** 열어 붙여넣기 → **Run** → 성공 확인 → 다음 파일.
4. 오류 발생 시 **즉시 중단** · 운영 DB 여부 재확인 · 결과 기록.
5. 각 migration 성공 여부를 [`validation-results.md`](./validation-results.md) [4]에 기록.

### 적용 후 확인
[`verify-schema.sql`](./verify-schema.sql) 전체 실행 → [4] 항목 판정.

---

## [8] 브라우저 실행 절차 (Preview)

```bash
npm install
npm run dev        # Vite dev 서버(기본 http://localhost:5173)
```
경로: **시험관리 → 인증 기준관리 → 직원별 인증 Preview** 탭.

31개 시나리오는 [`validation-results.md`](./validation-results.md) [17] 표에 (기대/실제/통과·실패/증빙/비고)로 기록.

## [9] PM 승인 브라우저 검증 (수동 승인만 — 자동화 금지)

경로: **시험관리 → 설비 인증관리(PM 인증관리)**. 기존 화면에서 **수동 승인/반려**만 수행.
- 대기/반려/승인취소 row가 Preview "현재 확정 단계"에 **표시되지 않는지**(=`approval_status='승인'`만 인정).
- 승인 → Preview 재계산 시 확정 단계 반영, `exam_certification_history`에 1건 append.
- 동일 level 재승인(대체) / 상위 level 승인 시 하위 level 이력 유지.
기록: [`validation-results.md`](./validation-results.md) [12][13].

---

## [12] 정적 검증(코드 변경 시에만) & 보안 체크
```bash
npx tsc -b
npx eslint src/features/exam-management/**
npm run build
git diff --stat            # 시험관리(src/features/exam-management, supabase/migrations) 외 변경 없어야 함
git grep -nE 'service_role|SUPABASE_SERVICE' -- ':!*.md' || echo "service_role 코드 미노출(정상)"
git status --short         # .env* 미스테이지 확인
```

> 이번 인수인계 단계는 **문서·SQL·검증 스크립트**가 산출물입니다. 실행 전 코드 수정 금지.
> 실제 검증 중 결함이 확인된 경우에만 시험관리 내부 최소 diff로 수정하고 재검증하세요.
