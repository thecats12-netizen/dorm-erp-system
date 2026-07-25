-- ============================================================================
-- [초안 · 자동 적용 금지] 연간목표(exam_annual_targets) / 월간실적(exam_monthly_results)
--   "라인(line_id)" 축 additive 추가 준비 (ADD ONLY · 무파괴 · 자동 백필 없음)
--
--   ⚠ 이 스크립트는 기존 목표 데이터/통계/집계/식별자를 절대 변경하지 않는다.
--      - 기존 행 UPDATE/DELETE 없음(라인 배정은 (6) 수동·업무결정 블록으로만 · 기본 미실행)
--      - 기존 unique index(텍스트 identity) 삭제·교체·확장 없음(라인은 identity 에 넣지 않는다)
--      - group_id / part_id / part_name / process_id 컬럼·값 무변경
--      - 신규 nullable 컬럼(line_id) + 일반 조회 index 만 추가(add ... if not exists → 멱등)
--   ⚠ Supabase SQL Editor 에서 (0)진단 → (1)컬럼 → (2)index → (3)검증 순. (6)라인 배정은 "수동·선택".
--   ⚠ RLS: 두 목표 테이블은 이미 시험 마스터 RLS 대상(20260712/20260716). 컬럼 추가는 RLS 무영향.
--           exam_lines 조회는 자체 RLS(can_read_exam_master)로 이미 보호됨(20260739).
--
--   [실측 관계 분석 — 핵심]
--    · exam_lines 는 "독립 축"이다. exam_categories / exam_groups / exam_parts 어디에도 line FK 가 없다.
--      line_id 를 참조하는 곳은 exam_rules(line_id + category_id + group_id + process_id) 뿐이다.
--    · 즉 목표(제품군/그룹)로부터 라인을 "결정적으로" 역추적할 경로가 DB 에 존재하지 않는다.
--      └ 그룹 → 라인 은 exam_rules 를 통해 보면 1:N(같은 group_id 에 서로 다른 line_id 규칙이 존재 가능).
--      └ product_group/part_name 같은 "텍스트 이름 → 라인" 매핑은 금지(P3F/P3D/TSV 문자열 추정 금지).
--    ⇒ 결론: 기존 목표의 line_id 자동 백필은 불가능(비결정적). 전량 NULL(=공통)로 두는 것이 안전하며,
--      이는 exam_rules 의 "line_id null = 공통" 관례와 일치한다. 라인 배정은 향후 UI/업무 결정 사항.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────
-- (0) 사전 진단(SELECT 전용) — 적용 전 상태/관계 확인. 데이터 변경 없음.
-- ────────────────────────────────────────────────────────────────────────
-- (0-1) 대상 테이블 + exam_lines 존재
-- select to_regclass('public.exam_annual_targets')  as annual_exists,
--        to_regclass('public.exam_monthly_results') as monthly_exists,
--        to_regclass('public.exam_lines')           as lines_exists;
--
-- (0-2) 제품 계층(카테고리/그룹/파트)에 line 연결 컬럼이 "없음"을 확인(있으면 결과 행이 나옴)
-- select table_name, column_name from information_schema.columns
--  where table_schema='public'
--    and table_name in ('exam_categories','exam_groups','exam_parts')
--    and column_name ilike '%line%';
--   -- 기대: 0행 (라인은 제품 계층과 FK 로 연결되어 있지 않음 → 결정적 백필 불가 근거)
--
-- (0-3) 라인 목록(배정 시 참고할 id)
-- select id, code, name, sort_order from public.exam_lines where deleted_at is null order by sort_order;
--
-- (0-4) 목표 전체 행 수
-- select count(*) as annual_rows  from public.exam_annual_targets  where deleted_at is null;
-- select count(*) as monthly_rows from public.exam_monthly_results where deleted_at is null;


-- ────────────────────────────────────────────────────────────────────────
-- (1) line_id(nullable FK → exam_lines) 신규 추가 — 두 테이블. on delete set null.
-- ────────────────────────────────────────────────────────────────────────
begin;

alter table public.exam_annual_targets
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

alter table public.exam_monthly_results
  add column if not exists line_id uuid references public.exam_lines(id) on delete set null;

commit;


-- ────────────────────────────────────────────────────────────────────────
-- (2) 일반 조회 index — (tenant_id, line_id) 부분 index. 기존 unique index 는 손대지 않는다.
-- ────────────────────────────────────────────────────────────────────────
begin;

create index if not exists ix_annual_targets_line  on public.exam_annual_targets  (tenant_id, line_id) where deleted_at is null;
create index if not exists ix_monthly_results_line on public.exam_monthly_results (tenant_id, line_id) where deleted_at is null;

commit;

-- [참고 · unique index] 라인은 orthogonal 축이라 기존 텍스트 identity
--   (tenant_id, year, group_name, product_group, part_name, level_id) 에 포함하지 않는다.
--   "라인별 목표"를 강제하려면 향후 업무 규칙 확정 후 별도 DRAFT 로 부분 unique index 를 검토한다
--   (예: where line_id is not null). 지금 만들면 규칙을 조기 고정 → 보류.


-- ────────────────────────────────────────────────────────────────────────
-- (3) 스키마 검증(SELECT 전용)
-- ────────────────────────────────────────────────────────────────────────
-- (3-1) line_id 컬럼 존재 + nullable
-- select table_name, column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public'
--    and table_name in ('exam_annual_targets','exam_monthly_results')
--    and column_name='line_id'
--  order by table_name;
--
-- (3-2) line_id FK(대상 exam_lines · on delete set null)
-- select tc.table_name, kcu.column_name, ccu.table_name as ref_table, rc.delete_rule
--   from information_schema.table_constraints tc
--   join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
--   join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
--   join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
--  where tc.constraint_type='FOREIGN KEY'
--    and tc.table_name in ('exam_annual_targets','exam_monthly_results')
--    and kcu.column_name='line_id';
--
-- (3-3) index 목록(기존 unique 유지 + 신규 ix_..._line 확인)
-- select tablename, indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename in ('exam_annual_targets','exam_monthly_results')
--  order by tablename, indexname;


-- ────────────────────────────────────────────────────────────────────────
-- (4) 백필 "가능성" 진단(SELECT 전용) — 결정적 경로가 없음을 수치로 확인. 데이터 변경 없음.
--     아래는 exam_annual_targets 기준. 월간실적은 테이블명을 exam_monthly_results 로 바꿔 실행.
-- ────────────────────────────────────────────────────────────────────────
-- (4-1) 현재 line_id 보유/미보유(추가 직후: 전량 NULL 기대)
-- select count(*) filter (where line_id is null) as line_null,
--        count(*) filter (where line_id is not null) as line_set,
--        count(*) as total
--   from public.exam_annual_targets where deleted_at is null;
--
-- (4-2) [모호성 증명] 각 목표의 group_id 에 대해 exam_rules 에 존재하는 "서로 다른 라인 수".
--        cnt=1 → 해당 그룹의 규칙이 단일 라인(잠재적 유일 후보이나 규칙 부재 그룹과 구분 필요),
--        cnt>1 → 그룹이 여러 라인에 걸침(자동 배정 불가 · 사람 결정 필요),
--        cnt=0 → 매칭 규칙 없음(후보 없음).
--        ⇒ cnt>1 또는 0 이 하나라도 있으면 "그룹→라인"은 결정적이지 않음(자동 백필 금지 근거).
-- with tg as (
--   select t.id, t.group_id from public.exam_annual_targets t where t.deleted_at is null
-- )
-- select
--   count(*) filter (where lc.cnt = 1)                    as line_unique_by_rules,
--   count(*) filter (where lc.cnt > 1)                    as line_ambiguous_multi,
--   count(*) filter (where lc.cnt = 0 or lc.cnt is null)  as line_no_rule_candidate
--   from tg
--   left join lateral (
--     select count(distinct r.line_id) as cnt
--       from public.exam_rules r
--      where r.deleted_at is null
--        and r.group_id = tg.group_id
--        and r.line_id is not null
--   ) lc on true;
--
-- (4-3) group_id 자체가 NULL 인 목표(역추적 출발점조차 없음 → 라인 후보 없음)
-- select count(*) as group_id_null from public.exam_annual_targets where deleted_at is null and group_id is null;


-- ────────────────────────────────────────────────────────────────────────
-- (5) orphan / 불일치 진단(SELECT 전용)
-- ────────────────────────────────────────────────────────────────────────
-- (5-1) orphan: line_id 가 존재하지 않는 라인을 가리킴(FK 로 발생 불가하나 확인용)
-- select t.id, t.line_id
--   from public.exam_annual_targets t
--   left join public.exam_lines l on l.id = t.line_id
--  where t.line_id is not null and l.id is null;
-- select t.id, t.line_id
--   from public.exam_monthly_results t
--   left join public.exam_lines l on l.id = t.line_id
--  where t.line_id is not null and l.id is null;
--
-- (5-2) 불일치: line_id 가 soft-delete 된 라인을 가리킴(운영 정합성 점검)
-- select t.id, t.line_id, l.name
--   from public.exam_annual_targets t
--   join public.exam_lines l on l.id = t.line_id
--  where t.deleted_at is null and l.deleted_at is not null;


-- ============================================================================
-- (6) [선택 · 수동 · 업무 결정] 라인 배정 — 자동 백필 아님.
--     ⚠ 결정적 관계가 없으므로 "자동" 매핑 블록을 제공하지 않는다.
--     ⚠ 특정 라인을 특정 목표 집합에 배정하려면, 운영자가 "명시적 line id + 명시적 대상 필터"로만 실행한다.
--        (텍스트 이름 추정 매핑 금지 · 모호한 행 일괄 배정 금지)
--     ⚠ 예시는 실행 전 반드시 대상 SELECT 로 건수/범위를 확인하고, line id 를 (0-3) 에서 확정할 것.
--     ⚠ 기존 group_id/part_id/part_name/process_id/count/텍스트 identity 는 건드리지 않는다.
-- ============================================================================
-- -- (예) 특정 연도+특정 그룹의 목표에 특정 라인 배정 — <LINE_UUID>, <YEAR>, <GROUP_UUID> 를 실제 값으로 교체.
-- -- 실행 전 대상 확인:
-- --   select id, year, product_group, group_name, level_id, line_id
-- --     from public.exam_annual_targets
-- --    where deleted_at is null and line_id is null and year = <YEAR> and group_id = '<GROUP_UUID>';
-- -- begin;
-- -- update public.exam_annual_targets
-- --    set line_id = '<LINE_UUID>'
-- --  where deleted_at is null
-- --    and line_id is null                         -- 이미 배정된 값은 덮어쓰지 않음
-- --    and year = <YEAR>
-- --    and group_id = '<GROUP_UUID>';
-- -- commit;
-- -- (월간실적도 동일 패턴으로 exam_monthly_results 에 대해 개별 실행)


-- (schema cache 갱신 · 선택): notify pgrst, 'reload schema';


-- ============================================================================
-- 롤백(필요 시) — 신규 line_id 컬럼(+동반 FK) + 신규 일반 index 만 제거. 기존 컬럼/index 무변경.
-- ============================================================================
--   drop index if exists public.ix_annual_targets_line;
--   drop index if exists public.ix_monthly_results_line;
--   alter table public.exam_annual_targets  drop column if exists line_id;  -- FK 는 컬럼과 함께 제거됨
--   alter table public.exam_monthly_results drop column if exists line_id;
--   -- ⚠ group_id/process_id/part_id 등 기존 컬럼은 절대 drop 하지 않는다.
