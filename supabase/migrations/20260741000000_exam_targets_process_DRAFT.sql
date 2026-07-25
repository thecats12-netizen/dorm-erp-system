-- ============================================================================
-- [초안 · 자동 적용 금지] 연간목표(exam_annual_targets) / 월간실적(exam_monthly_results)
--   "제품/파트 → 그룹(group_id)" 축 additive 전환 준비 (ADD ONLY · 무파괴)
--
--   ⚠ 이 스크립트는 기존 목표 데이터/통계/집계를 절대 변경하지 않는다.
--      - 기존 행 UPDATE/DELETE 없음((5) group_id 백필은 "수동 · 선택" 블록으로 분리)
--      - 기존 unique index(텍스트 키/휴면 FK 키) 삭제·교체 없음
--      - part_id / part_name / process_id 컬럼·값 무변경(process_id 는 이미 존재 → ALTER 안 함)
--      - 신규 nullable 컬럼(group_id) + 일반 조회 index 만 추가(add ... if not exists → 멱등)
--   ⚠ Supabase SQL Editor 에서 (1)→(2) 실행. (3)(4) 진단(SELECT)로 확인. (5) 백필은 "선택·수동".
--   ⚠ RLS: 두 테이블은 이미 시험 마스터 RLS 대상(20260712/20260716). 컬럼 추가는 RLS 무영향.
--
--   [실측 스키마 근거]
--    · exam_annual_targets / exam_monthly_results 둘 다 존재하는 컬럼(20260712000000 + 20260712050000):
--        tenant_id text, deleted_at timestamptz, level_id uuid,
--        year int, group_name text, product_group text, part_name text,
--        part_id uuid(FK exam_parts), process_id uuid(FK exam_processes)   ← process_id "이미 존재"
--    · 운영 unique index(앱이 실제 사용 · 유지):
--        ux_annual_targets_key  (tenant_id, year, group_name, product_group, part_name, level_id)
--        ux_monthly_results_key (tenant_id, year, group_name, product_group, part_name, level_id)
--      (둘 다 where deleted_at is null and year is not null)
--    · updated_at 자동 트리거 없음(insert default now() 뿐) → 백필 시 updated_at 은 건드리지 않는다
--      (구조 컬럼 채움일 뿐 "업무 수정"이 아님을 audit 상 유지).
--
--   [핵심 결정]
--    · group_id(nullable FK → exam_groups) 만 추가한다. part_id → exam_parts.group_id 로 결정적 백필 가능.
--    · process_id 는 이미 존재하지만 앱 identity/집계가 텍스트(part_name)라서, process 를 identity 로
--      넣으면 통계가 달라진다 → 이번엔 "일반 index" 만 두고, 부분 unique index 는 업무 규칙 확정 전까지
--      "주석 처리"한다(잘못된 무결성 규칙 조기 고정 방지 · (2-B) 참조).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────
-- (1) group_id(nullable FK) 신규 추가 — 두 테이블. process_id 는 이미 존재하므로 ALTER 하지 않음.
-- ────────────────────────────────────────────────────────────────────────
begin;

alter table public.exam_annual_targets
  add column if not exists group_id uuid references public.exam_groups(id) on delete set null;

alter table public.exam_monthly_results
  add column if not exists group_id uuid references public.exam_groups(id) on delete set null;

commit;


-- ────────────────────────────────────────────────────────────────────────
-- (2-A) 일반 조회 index — group_id / process_id (멱등 · partial where deleted_at is null)
--        기존 unique index 는 손대지 않는다.
-- ────────────────────────────────────────────────────────────────────────
begin;

create index if not exists ix_annual_targets_group  on public.exam_annual_targets  (tenant_id, group_id)   where deleted_at is null;
create index if not exists ix_annual_targets_proc   on public.exam_annual_targets  (tenant_id, process_id) where deleted_at is null;
create index if not exists ix_monthly_results_group on public.exam_monthly_results (tenant_id, group_id)   where deleted_at is null;
create index if not exists ix_monthly_results_proc  on public.exam_monthly_results (tenant_id, process_id) where deleted_at is null;

commit;

-- ────────────────────────────────────────────────────────────────────────
-- (2-B) [보류 · 주석] process 기반 부분 unique index — 업무 규칙 미확정으로 지금은 생성하지 않는다.
--   보류 사유:
--     · 신규 목표 identity 후보: (tenant_id, year, process_id, level_id) 또는 라인 구분 시 +line_id.
--       └ process 는 그룹/제품군을 함의하므로 상위 텍스트는 불필요하나, "라인별 목표"를 둘지,
--         "연도+공정+레벨당 목표 1행"이 맞는지 등 업무 규칙이 확정되지 않았다.
--     · 부분 unique index 를 지금 만들면 위 규칙을 DB 레벨에서 조기 고정 → 향후 UI/정책 제약.
--     · 무결성 이득보다 "잘못된 업무 규칙 고정" 리스크가 크다 → 규칙 확정 후 별도 DRAFT 로 추가.
--   확정 시 추가 예시(그때 실행):
--     -- create unique index if not exists ux_annual_targets_process_key
--     --   on public.exam_annual_targets (tenant_id, year, process_id, level_id)
--     --   where deleted_at is null and year is not null and process_id is not null;
--     -- create unique index if not exists ux_monthly_results_process_key
--     --   on public.exam_monthly_results (tenant_id, year, process_id, level_id)
--     --   where deleted_at is null and year is not null and process_id is not null;


-- (schema cache 갱신이 필요하면 · 선택): notify pgrst, 'reload schema';


-- ============================================================================
-- (3) 스키마 검증(SELECT 전용) — 컬럼/FK/index 생성 결과 확인
-- ============================================================================
-- (3-1) 테이블 존재
-- select to_regclass('public.exam_annual_targets')  as annual_exists,
--        to_regclass('public.exam_monthly_results') as monthly_exists;
--
-- (3-2) group_id / process_id 컬럼 존재 + nullable 여부
-- select table_name, column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema='public'
--    and table_name in ('exam_annual_targets','exam_monthly_results')
--    and column_name in ('group_id','process_id','part_id','part_name','year','level_id','tenant_id','deleted_at')
--  order by table_name, column_name;
--
-- (3-3) group_id FK 존재(대상 exam_groups · on delete set null)
-- select tc.table_name, tc.constraint_name, kcu.column_name,
--        ccu.table_name as ref_table, rc.delete_rule
--   from information_schema.table_constraints tc
--   join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
--   join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
--   join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
--  where tc.constraint_type='FOREIGN KEY'
--    and tc.table_name in ('exam_annual_targets','exam_monthly_results')
--    and kcu.column_name='group_id';
--
-- (3-4) index 목록(기존 unique 유지 + 신규 일반 index 확인)
-- select tablename, indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename in ('exam_annual_targets','exam_monthly_results')
--  order by tablename, indexname;


-- ============================================================================
-- (4) 진단(SELECT 전용) — 전환 가능성/영향. 데이터 변경 없음.
--     아래는 exam_annual_targets 기준. 월간실적은 테이블명을 exam_monthly_results 로 바꿔 동일 실행.
-- ============================================================================
-- (4-6) 전체 행 수
-- select count(*) as total_rows from public.exam_annual_targets where deleted_at is null;
--
-- (4-7) part_id 보유 행 수
-- select count(*) as has_part_id from public.exam_annual_targets where deleted_at is null and part_id is not null;
--
-- (4-8) group_id NULL 행 수
-- select count(*) as group_id_null from public.exam_annual_targets where deleted_at is null and group_id is null;
--
-- (4-9) part_id 로 group_id 백필 "가능" 행 수(part 존재 + part.group_id 존재 + 아직 group_id null)
-- select count(*) as group_backfillable
--   from public.exam_annual_targets t
--   join public.exam_parts p on p.id = t.part_id
--  where t.deleted_at is null and t.group_id is null and p.group_id is not null;
--
-- (4-10) part_id 가 없어서 백필 "불가" 행 수
-- select count(*) as no_part_id
--   from public.exam_annual_targets
--  where deleted_at is null and group_id is null and part_id is null;
--
-- (4-11) orphan: part_id 는 있으나 exam_parts 없음 또는 part.group_id 가 NULL(백필 불가 목록)
-- select t.id, t.year, t.group_name, t.product_group, t.part_name, t.part_id
--   from public.exam_annual_targets t
--   left join public.exam_parts p on p.id = t.part_id
--  where t.deleted_at is null and t.group_id is null and t.part_id is not null
--    and (p.id is null or p.group_id is null);
--
-- (4-12) process_id 가 이미 채워진 기존 행 수(앱은 미기록 → 보통 0)
-- select count(*) as has_process_id from public.exam_annual_targets where deleted_at is null and process_id is not null;
--
-- (4-13) part 별 process 개수(해당 part 가 속한 그룹의 활성 공정 수)
-- select t.part_id, max(t.part_name) as part_name, p.group_id,
--        (select count(*) from public.exam_processes pr where pr.group_id = p.group_id and coalesce(pr.is_active,true)) as process_cnt
--   from public.exam_annual_targets t
--   join public.exam_parts p on p.id = t.part_id
--  where t.deleted_at is null and t.part_id is not null
--  group by t.part_id, p.group_id;
--
-- (4-14) process 후보 0 / 1 / 2+ 건수(자동 process 백필 가능성 판정 — 1 만 유일 매핑)
-- with tp as (
--   select t.id, p.group_id
--     from public.exam_annual_targets t
--     left join public.exam_parts p on p.id = t.part_id
--    where t.deleted_at is null
-- )
-- select
--   count(*) filter (where pc.cnt = 1)                    as process_unique_mappable,
--   count(*) filter (where pc.cnt > 1)                    as process_ambiguous_need_decision,
--   count(*) filter (where pc.cnt = 0 or pc.cnt is null)  as process_no_candidate
--   from tp
--   left join lateral (
--     select count(*) as cnt from public.exam_processes pr
--      where pr.group_id = tp.group_id and coalesce(pr.is_active,true)
--   ) pc on true;
--
-- (4-15) 운영 unique key 중복 여부(0 행이어야 정상 · 기존 무결성 확인)
-- select tenant_id, year, group_name, product_group, part_name, level_id, count(*)
--   from public.exam_annual_targets
--  where deleted_at is null and year is not null
--  group by 1,2,3,4,5,6 having count(*) > 1;
--
-- (4-16) [백필 후 실행] group_id 불일치 여부(0 행이어야 정상 — 백필이 part.group_id 와 일치하는지)
-- select t.id, t.group_id, p.group_id as part_group_id
--   from public.exam_annual_targets t
--   join public.exam_parts p on p.id = t.part_id
--  where t.deleted_at is null and t.group_id is not null and p.group_id is not null
--    and t.group_id <> p.group_id;


-- ============================================================================
-- (5) [선택 · 수동 실행] group_id 백필 — 결정적 관계(part_id → exam_parts.group_id)만 사용.
--     ⚠ 기본 미실행. 운영 확인 후 필요 시에만 아래 주석을 해제해 실행.
--     ⚠ 규칙: group_id 가 NULL 인 행만 / part_id NULL 이면 미변경 / part.group_id NULL 이면 미변경 /
--            기존 group_id 있으면 덮어쓰지 않음 / updated_at 미변경(프로젝트에 auto-touch 트리거 없음) /
--            part_id·part_name·process_id·count 절대 미변경 / 자동 삭제·보정 없음.
--     ⚠ 연간목표와 월간실적은 각각 독립 실행 가능(둘 다 실행할 필요 없음).
-- ============================================================================

-- (5-A) 연간목표 group_id 백필 ----------------------------------------------
-- -- 실행 전 대상 건수:
-- --   select count(*) from public.exam_annual_targets t join public.exam_parts p on p.id=t.part_id
-- --    where t.deleted_at is null and t.group_id is null and p.group_id is not null;
-- begin;
-- update public.exam_annual_targets t
--    set group_id = p.group_id
--   from public.exam_parts p
--  where t.part_id = p.id
--    and t.group_id is null
--    and p.group_id is not null
--    and t.deleted_at is null;
-- commit;
-- -- 실행 후 남은 group_id NULL 건수(감소 확인):
-- --   select count(*) from public.exam_annual_targets where deleted_at is null and group_id is null;

-- (5-B) 월간실적 group_id 백필 ----------------------------------------------
-- -- 실행 전 대상 건수:
-- --   select count(*) from public.exam_monthly_results t join public.exam_parts p on p.id=t.part_id
-- --    where t.deleted_at is null and t.group_id is null and p.group_id is not null;
-- begin;
-- update public.exam_monthly_results t
--    set group_id = p.group_id
--   from public.exam_parts p
--  where t.part_id = p.id
--    and t.group_id is null
--    and p.group_id is not null
--    and t.deleted_at is null;
-- commit;
-- -- 실행 후 남은 group_id NULL 건수(감소 확인):
-- --   select count(*) from public.exam_monthly_results where deleted_at is null and group_id is null;


-- ============================================================================
-- 롤백(필요 시) — 신규 group_id 컬럼 + 신규 일반 index 만 제거. process_id/기존 index 는 유지.
-- ============================================================================
--   drop index if exists public.ix_annual_targets_group;
--   drop index if exists public.ix_annual_targets_proc;
--   drop index if exists public.ix_monthly_results_group;
--   drop index if exists public.ix_monthly_results_proc;
--   alter table public.exam_annual_targets  drop column if exists group_id;  -- FK 는 컬럼과 함께 제거됨
--   alter table public.exam_monthly_results drop column if exists group_id;
--   -- ⚠ process_id 컬럼은 기존 스키마이므로 절대 drop 하지 않는다.
