-- ============================================================================
-- 인증 레벨 seed — "지정 tenant 1곳"에만 적용(운영 안전판) · SELECT/INSERT/UPDATE 모두 tenant 한정
--   · 20260747000001(전 tenant seed)의 대체. 이 파일은 supabase/migrations 가 아니라 docs 에 있으므로
--     `supabase db push` 로 자동 실행되지 않는다(수동 실행 전용).
--   · 다른 tenant 의 exam_levels 는 절대 SELECT-enumerate/INSERT/UPDATE 하지 않는다.
--   · 선행: 20260747000000(tier/parent_level_id/requires_approval/auto_promote 컬럼) 적용 필요.
--   psql:      \set target_tenant 'exam-test'  후 실행
--   Dashboard: 아래 :'target_tenant' 를 모두 '실제 테스트 tenant' 로 치환(예: 'exam-test')
--   ⚠ default/prod/production/main/운영 tenant 에는 실행 금지(하단 guard 가 차단).
-- ============================================================================
\set target_tenant 'exam-test'

-- ── [guard 1] 운영/기본 tenant 차단(빈값·default·prod 등 → 0으로 나눠 강제 에러) ──────
select case when :'target_tenant' in ('', 'default', 'prod', 'production', 'main', '운영')
            then 1/0 else 0 end as guard_block_production_tenant;

-- ── [context] 전체 tenant 수 vs 대상 tenant 현황(실행 전 운영자 확인용) ────────────────
select
  (select count(distinct tenant_id) from public.exam_levels)                                              as tenants_with_levels_total,
  :'target_tenant'                                                                                        as target_tenant,
  (select count(*) from public.exam_levels    where tenant_id = :'target_tenant' and deleted_at is null)  as target_levels_before,
  (select count(*) from public.exam_personnel where tenant_id = :'target_tenant')                         as target_personnel_rows,
  (select count(*) from public.exam_processes where tenant_id = :'target_tenant')                         as target_process_rows;
-- ⚠ target_personnel/process 가 0 이고 실제 사용 tenant 가 아니라면, 정말 이 tenant 가 맞는지 재확인.

-- ── [1] 레벨 INSERT (대상 tenant 한정 · 멱등 · 기존 name/code/tier 덮어쓰지 않음) ───────────
with ins as (
  insert into public.exam_levels (tenant_id, code, name, tier, rank_order, auto_promote, requires_approval, is_active)
  select :'target_tenant', v.code, v.name, v.tier, v.rank_order, v.auto_promote, v.requires_approval, true
    from (values
      ('SINGLE',    'Single',    'PM',        10, true,  false),
      ('M1',        'M1',        'PM',        20, false, true),
      ('M2',        'M2',        'PM',        30, false, true),
      ('M3',        'M3',        'PM',        40, false, true),
      ('M4',        'M4',        'PM',        50, false, true),
      ('DM',        'DM',        'DM',        60, false, true),
      ('SENIOR_DM', 'Senior DM', 'SENIOR_DM', 70, false, true),
      ('MAESTRO',   'Maestro',   'MAESTRO',   80, false, true)
    ) as v(code, name, tier, rank_order, auto_promote, requires_approval)
   where not exists (
     select 1 from public.exam_levels e
      where e.tenant_id = :'target_tenant' and upper(e.code) = upper(v.code) and e.deleted_at is null
   )
  returning 1
)
select count(*) as inserted_levels from ins;   -- 실행 결과 row count

-- ── [2] 선행 계층(parent_level_id) 연결 — 대상 tenant · parent_level_id IS NULL 인 행만 ──────
with upd as (
  update public.exam_levels c
     set parent_level_id = p.id
    from public.exam_levels p
   where c.tenant_id = :'target_tenant' and p.tenant_id = :'target_tenant'
     and c.deleted_at is null and p.deleted_at is null and c.parent_level_id is null
     and (
       (upper(c.code)='M1'        and upper(p.code)='SINGLE')    or
       (upper(c.code)='M2'        and upper(p.code)='M1')        or
       (upper(c.code)='M3'        and upper(p.code)='M2')        or
       (upper(c.code)='M4'        and upper(p.code)='M3')        or
       (upper(c.code)='DM'        and upper(p.code)='M4')        or
       (upper(c.code)='SENIOR_DM' and upper(p.code)='DM')        or
       (upper(c.code)='MAESTRO'   and upper(p.code)='SENIOR_DM')
     )
  returning 1
)
select count(*) as linked_parents from upd;     -- 실행 결과 row count

-- ── [after] 대상 tenant 레벨 현황 + 비대상 tenant 영향 0 확인 ─────────────────────────────
select tenant_id, count(*) as level_count
  from public.exam_levels
 where tenant_id = :'target_tenant' and deleted_at is null
 group by tenant_id;
-- 비대상 tenant 레벨 수(실행 전후 동일해야 함 = 다른 tenant 영향 0):
select count(*) as non_target_level_rows_unchanged
  from public.exam_levels where tenant_id <> :'target_tenant';
