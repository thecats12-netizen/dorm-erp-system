# 운영 Supabase 시험관리 안전 적용 런북 (tenant 제한 seed)

> 현재 Supabase는 **다른 메뉴가 사용 중인 운영 프로젝트**입니다. 시험관리 메뉴는 미사용이므로 시험관리 범위 테스트는 가능하나, **모든 tenant의 exam_levels를 바꾸는 전-tenant seed(20260747000001)는 금지**합니다.
>
> ⚠ 이 저장소 환경에서는 DB에 아무것도 적용하지 않았습니다. 아래는 **담당자 실행 지침**입니다.
> 관련 파일: [`seed-exam-levels-for-tenant.sql`](./seed-exam-levels-for-tenant.sql) · [`-rollback.sql`](./seed-exam-levels-for-tenant-rollback.sql) · [`verify-schema.sql`](./verify-schema.sql) · [`seed-test-data.sql`](./seed-test-data.sql) · [`preview-validation.sql`](./preview-validation.sql)

---

## 0. 핵심 사실 (분석 결과)
- `supabase/config.toml` → `[db.migrations] enabled=true`, `schema_paths=[]` ⇒ **`supabase db push`는 `supabase/migrations`의 모든 미적용 파일을 실행**합니다. 여기에는 **20260747000001(전-tenant seed, DRAFT 아님)**이 포함 → db push 하면 **모든 tenant의 exam_levels가 변경**됩니다.
- 동시에 `supabase/migrations`에는 `_DRAFT` 마이그레이션이 10개 이상 + 타임스탬프 없는 `_draft_pm_certifications_proof.sql`이 존재 ⇒ **이 저장소는 애초에 blanket `db push`를 쓰지 않고, 마이그레이션을 선택적으로 수동 적용**하는 구조입니다.
- 따라서 **운영 DB에는 `supabase db push`를 사용하지 않고**, Dashboard SQL Editor로 **필요한 스키마 마이그레이션만 파일 단위로 적용**하고, **전-tenant seed 대신 tenant 제한 seed**를 실행하는 것이 안전합니다.

## [1] 20260747000001 적용 여부 확인
Supabase는 적용 이력을 `supabase_migrations.schema_migrations`에 기록합니다.
```sql
-- 적용 이력 조회(SELECT 전용)
select version, name from supabase_migrations.schema_migrations
 where version in ('20260747000000','20260747000001','20260748000000','20260749000000','20260750000000','20260751000000')
 order by version;
```
또는 CLI: `supabase migration list` (Local vs Remote 비교).

- **미적용(권장 상태)**: 20260747000001이 목록에 **없으면** → 절대 db push 하지 말고 아래 3단계로 진행.
- **이미 적용된 경우**: 20260747000001이 목록에 **있으면** → 전-tenant seed가 이미 실행된 것. 이 seed는 **멱등·비파괴**(기존 행/이름/parent 미변경, 누락 레벨만 INSERT + null parent만 연결)이므로 기존 데이터 손상은 없으나, **다른 tenant에 표준 레벨 행이 생성**되어 있음. 시험관리 미사용 tenant의 참조 데이터일 뿐이라 즉각 위험은 없으나, 원치 않으면 각 비대상 tenant에 대해 [`seed-exam-levels-for-tenant-rollback.sql`](./seed-exam-levels-for-tenant-rollback.sql) 방식(참조 없는 seed 코드만 soft delete)으로 운영자가 수동 정리. **migration history는 임의 조작 금지.**

## [3] 20260747000001 처리 방안 (선택 A)
- **migration 이력 보존 최우선** → 20260747000001 파일은 **수정/삭제하지 않고 그대로 보존**하되, **적용 대상에서 제외**(db push 미사용). 실제 레벨 seed는 [`seed-exam-levels-for-tenant.sql`](./seed-exam-levels-for-tenant.sql)(tenant 한정)로 대체.
- (참고) `supabase migration repair`로 "적용됨" 표시하는 방법도 있으나 **history 조작에 해당하므로 사용하지 않음**.

## [5] 운영 DB 적용 순서 ("일단 db push 후 확인" 금지)
1. **백업/export**: Dashboard → Database → Backups 확인, 또는 시험관리 테이블(`exam_*`, `pm_certifications`) 스키마+데이터 export.
2. **project ref 기록**: `grep project_id supabase/config.toml` / Dashboard ref 메모(운영 ref임을 명시).
3. **현재 migration list 저장**: `supabase migration list > migration-list-before.txt`.
4. **[1] 쿼리로 20260747000001 적용 여부 확인** — 미적용 확인.
5. ⚠ **`supabase db push` 실행 금지**(전-tenant seed + DRAFT 파일까지 실행됨).
6. **스키마 마이그레이션만 수동 적용** — Dashboard SQL Editor에서 아래 파일을 **순서대로 한 개씩** 붙여넣어 실행(20260747000001은 **건너뜀**):
   `20260747000000` → `20260748000000` → `20260749000000` → `20260750000000` → `20260751000000`
7. **[`verify-schema.sql`](./verify-schema.sql)** 실행 → 컬럼/테이블/인덱스/RLS/정책/exclusion/btree_gist/RPC 확인.
8. **target tenant 확인/결정**: 예 `exam-test`(운영 tenant 'default'와 분리). 실제 사용 tenant가 아님을 [context] 쿼리로 확인.
9. **[`seed-exam-levels-for-tenant.sql`](./seed-exam-levels-for-tenant.sql)** 실행(상단 `target_tenant` 지정) → 대상 tenant에만 레벨 생성.
10. **[`seed-test-data.sql`](./seed-test-data.sql)의 `:test_tenant`를 9번과 동일 값으로** 지정해 실행(A~E 등).
11. **Preview 검증**: `npm run dev` → 시험관리 → 인증 기준관리 → 직원별 인증 Preview.
12. **PM 후보 검증**: 인증 기준관리 → PM 후보 생성(관리자) → PM 인증관리에서 대기 후보 확인.
13. **cleanup**: [`cleanup-test-data.sql`](./cleanup-test-data.sql)(테스트 tenant 한정) 실행.
14. **[6] 시험관리 외 테이블 row count 전/후 비교**(아래) → 변화 0 확인.

## [6] 영향도 검증 SELECT (적용 전/후 동일 실행 · 읽기 전용)
```sql
-- (a) 시험관리 외 대표 테이블 row count (프로젝트 실제 테이블명으로 대체 · UPDATE/DELETE/INSERT 금지)
--     예시: 기술사/자산/운영관리 핵심 테이블. 전/후 값이 반드시 동일해야 함.
--   select 'profiles' t, count(*) c from public.profiles
--   union all select 'custom_roles', count(*) from public.custom_roles;   -- 등 프로젝트 실제 테이블
-- (b) tenant별 exam_levels 개수 (대상 외 tenant 값이 전/후 동일해야 함)
select tenant_id, count(*) from public.exam_levels where deleted_at is null group by tenant_id order by tenant_id;
-- (c) 대상 tenant exam_levels
select count(*) from public.exam_levels where tenant_id = :target_tenant and deleted_at is null;
-- (d) 비대상 tenant exam_levels 총합(전/후 동일 = 다른 tenant 영향 0)
select count(*) from public.exam_levels where tenant_id <> :target_tenant;
-- (e) exam_* 신규 테이블 존재
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('exam_equipment_stage_rules','exam_equipment_certifications','exam_certification_history');
-- (f) 기존 pm_certifications / exam_rules 건수(전/후 동일해야 함 — seed는 이 테이블을 건드리지 않음)
select (select count(*) from public.pm_certifications) as pm, (select count(*) from public.exam_rules) as rules;
-- (g) 신규 index / RPC / RLS
select indexname from pg_indexes where schemaname='public' and indexname='ux_pmcert_pending_candidate';
select proname from pg_proc where proname='exam_generate_pm_candidates';
select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename='exam_certification_history';
```
> 비시험관리 테이블에 대한 UPDATE/DELETE/INSERT는 **절대 금지**. 위는 전부 SELECT.

## [11] 사용자가 Dashboard에서 실행할 SQL (순서)
1. [1] 적용 여부 확인 쿼리 → 2. 스키마 5종(747000000/748/749/750/751, **747000001 제외**) 파일 붙여넣기 → 3. `verify-schema.sql` → 4. `seed-exam-levels-for-tenant.sql`(target 지정) → 5. `seed-test-data.sql`(동일 target) → 6. `preview-validation.sql` → 7. [6] 영향도 SELECT → 8. `cleanup-test-data.sql`.

## [12] 실행 금지 SQL / 명령
- `supabase db push` (운영 프로젝트) — 20260747000001 전-tenant seed + DRAFT 파일까지 실행됨.
- 20260747000001_exam_levels_seed.sql (전-tenant · `select distinct tenant_id ...`).
- tenant 조건 없는 exam_levels INSERT/UPDATE, 비시험관리 테이블 INSERT/UPDATE/DELETE, 하드 DELETE of levels.
- `supabase migration repair`로 history 임의 표시.

## [13] rollback 방법
[`seed-exam-levels-for-tenant-rollback.sql`](./seed-exam-levels-for-tenant-rollback.sql): 자동 파괴 없음. (1) 탐지 쿼리로 대상 tenant seed 코드 레벨의 **참조 여부** 확인 → (2) `is_referenced=false` 행만 운영자가 수동 soft delete(주석 해제). 기존/참조 레벨·다른 tenant 레벨 미영향. 테스트 데이터는 `cleanup-test-data.sql`.

## [14] 미검증 항목
migration 실제 적용, seed 실행 결과, Preview/PM 후보 실동작, 영향도 SELECT 전/후 비교, rollback 동작 — **전부 미실행(이 환경엔 운영 접근/브라우저 없음)**. 담당자가 위 절차로 수행.

## [7] 최종 판정 → **B. seed 분리 후 수동 적용 가능**
- `db push`는 20260747000001(전-tenant seed)을 자동 실행하므로 그대로는 불가(→ A 아님).
- 그러나 저장소가 이미 `_DRAFT` 마이그레이션 다수로 **선택적 수동 적용** 구조이므로, Dashboard SQL Editor로 **스키마 5종만 적용 + tenant 제한 seed** 실행 시 **다른 tenant/메뉴 영향 0**으로 운영 DB에 안전 적용 가능(→ 별도 TEST 프로젝트 필수 아님, C 아님).
- 근거: `config.toml`(db push 대상 전체) + `20260747000001`의 `select distinct tenant_id`(전-tenant 원인) vs [`seed-exam-levels-for-tenant.sql`](./seed-exam-levels-for-tenant.sql)의 `where tenant_id = :'target_tenant'`(단일 tenant 한정) + guard(default/prod 차단).
