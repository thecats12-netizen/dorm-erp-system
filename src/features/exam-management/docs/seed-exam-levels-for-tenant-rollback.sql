-- ============================================================================
-- ROLLBACK — 지정 tenant 레벨 seed 되돌리기 (수동 · 신중)
--   · 자동 파괴 실행 없음. 먼저 "탐지"만 실행하고, 운영자 확인 후 soft delete 를 수동 실행.
--   · 기존 레벨/참조 중인 레벨 삭제 금지. 하드 delete 금지(soft delete=deleted_at 만).
--   · exam_levels 에는 seed 태깅 컬럼이 없으므로, "대상 tenant + seed 코드 + 미참조" 를 식별 기준으로 한다.
--   psql: \set target_tenant 'exam-test'  / Dashboard: :'target_tenant' 를 치환.
-- ============================================================================
\set target_tenant 'exam-test'

-- [guard] 운영/기본 tenant 차단
select case when :'target_tenant' in ('', 'default', 'prod', 'production', 'main', '운영')
            then 1/0 else 0 end as guard_block_production_tenant;

-- ── [탐지] 대상 tenant 의 seed 코드 레벨 + 참조 여부 ─────────────────────────────────────
-- is_referenced = true 인 행은 절대 삭제 금지(다른 데이터가 사용 중).
with cand as (
  select l.id, upper(l.code) as code
    from public.exam_levels l
   where l.tenant_id = :'target_tenant'
     and upper(l.code) in ('SINGLE','M1','M2','M3','M4','DM','SENIOR_DM','MAESTRO')
     and l.deleted_at is null
),
refd as (  -- 어떤 형태로든 참조되는 level id(하나라도 참조되면 삭제 대상 제외)
  select c.id from cand c
   where exists (select 1 from public.exam_levels               x where x.parent_level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.pm_certifications         x where x.level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.exam_rules                x where x.level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.exam_equipment_stage_rules x where x.level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.exam_equipment_certifications x where x.level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.exam_applications         x where x.level_id = c.id and x.deleted_at is null)
      or exists (select 1 from public.exam_certification_history x where x.level_id = c.id or x.previous_level_id = c.id)
)
select c.id, c.code, (c.id in (select id from refd)) as is_referenced
  from cand c order by c.code;

-- ── [수동 soft delete] 위 결과에서 is_referenced=false 인 행만 되돌리기 ─────────────────────
-- ⚠ 자동 실행 금지. 위 탐지 결과를 확인한 뒤 아래 주석을 해제하여 수동 실행하세요.
-- ⚠ 하드 delete 금지. 아래는 soft delete(deleted_at) 이며, 참조 중이거나 seed 코드가 아닌 행은 건드리지 않습니다.
--
-- update public.exam_levels
--    set deleted_at = now()
--  where tenant_id = :'target_tenant'
--    and upper(code) in ('SINGLE','M1','M2','M3','M4','DM','SENIOR_DM','MAESTRO')
--    and deleted_at is null
--    and id not in (
--      -- 참조 중인 id (위 refd 와 동일 조건). 참조되면 삭제 제외.
--      select l.id from public.exam_levels l where l.tenant_id = :'target_tenant' and (
--         exists (select 1 from public.exam_levels x               where x.parent_level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.pm_certifications x          where x.level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.exam_rules x                where x.level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.exam_equipment_stage_rules x where x.level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.exam_equipment_certifications x where x.level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.exam_applications x          where x.level_id=l.id and x.deleted_at is null)
--      or exists (select 1 from public.exam_certification_history x where x.level_id=l.id or x.previous_level_id=l.id)
--      ));
--
-- 참고: 다른 tenant 의 레벨은 이 SQL 의 어떤 절에도 포함되지 않습니다(모두 tenant_id = :'target_tenant').
