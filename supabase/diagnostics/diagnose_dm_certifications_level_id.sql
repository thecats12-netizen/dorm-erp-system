-- ============================================================================
-- [읽기 전용 진단] dm_certifications.level_id 연결 상태 점검
--   목적: 23502(level_id not-null) 오류의 기존 데이터 영향 범위 파악.
--   ⚠ SELECT 만 수행합니다. backfill/UPDATE/DELETE 는 포함하지 않습니다.
--   ⚠ 자동 실행되지 않습니다. Supabase SQL Editor 에서 필요 시 실행하세요.
--   사용법: 아래 :tenant 를 실제 tenant_id 로 바꾸거나, tenant 조건을 주석 처리해 전체 조회.
-- ============================================================================

-- 1) 전체 건수 / level_id null 건수 / personnel_id null 건수
select
  count(*)                                            as total_rows,
  count(*) filter (where level_id is null)            as level_id_null,
  count(*) filter (where personnel_id is null)        as personnel_id_null,
  count(*) filter (where deleted_at is not null)      as soft_deleted
from public.dm_certifications;

-- 2) level_id FK 불일치(참조 대상이 실제로 없는 행)
select d.id, d.tenant_id, d.employee_no, d.dm_stage, d.dm_level, d.level_id
from public.dm_certifications d
left join public.exam_levels l on l.id = d.level_id
where d.level_id is not null and l.id is null
order by d.created_at desc;

-- 3) tenant 불일치(인증과 레벨 마스터의 tenant_id 가 다른 행)
select d.id, d.tenant_id as cert_tenant, l.tenant_id as level_tenant, d.dm_stage, d.dm_level
from public.dm_certifications d
join public.exam_levels l on l.id = d.level_id
where d.tenant_id is distinct from l.tenant_id;

-- 4) dm_level / dm_stage 값별 건수(어떤 값이 실제로 쓰이는지)
select tenant_id, dm_stage, dm_level, count(*) as cnt,
       count(*) filter (where level_id is null) as missing_level_id
from public.dm_certifications
where deleted_at is null
group by tenant_id, dm_stage, dm_level
order by missing_level_id desc, cnt desc;

-- 5) 레벨 마스터와 "유일하게" 매칭 가능한 건수 (자동 연결 후보)
--    프론트 resolveLevelId 과 동일 규칙: 활성 레벨의 code 또는 name 이 dm_level → dm_stage 순으로 정확 일치.
with cand as (
  select d.id as cert_id, d.tenant_id, d.dm_stage, d.dm_level,
         (select count(distinct l.id)
            from public.exam_levels l
           where l.tenant_id = d.tenant_id
             and coalesce(l.is_active, true) and l.deleted_at is null
             and (lower(btrim(coalesce(l.code, ''))) = lower(btrim(coalesce(d.dm_level, '')))
               or lower(btrim(coalesce(l.name, ''))) = lower(btrim(coalesce(d.dm_level, ''))))
         ) as match_by_level,
         (select count(distinct l.id)
            from public.exam_levels l
           where l.tenant_id = d.tenant_id
             and coalesce(l.is_active, true) and l.deleted_at is null
             and (lower(btrim(coalesce(l.code, ''))) = lower(btrim(coalesce(d.dm_stage, '')))
               or lower(btrim(coalesce(l.name, ''))) = lower(btrim(coalesce(d.dm_stage, ''))))
         ) as match_by_stage
    from public.dm_certifications d
   where d.level_id is null and d.deleted_at is null
)
select
  count(*)                                                              as level_id_null_rows,
  count(*) filter (where match_by_level = 1)                            as uniquely_matchable_by_dm_level,
  count(*) filter (where match_by_level = 0 and match_by_stage = 1)     as uniquely_matchable_by_dm_stage,
  count(*) filter (where match_by_level > 1 or (match_by_level = 0 and match_by_stage > 1)) as ambiguous_multi_match,
  count(*) filter (where match_by_level = 0 and match_by_stage = 0)     as no_match
from cand;

-- 6) 모호(2건 이상 매칭) 행 목록 — 기준정보 중복 정리 대상. 자동 매칭 금지 대상이다.
with cand as (
  select d.id as cert_id, d.tenant_id, d.employee_no, d.dm_stage, d.dm_level,
         (select count(distinct l.id)
            from public.exam_levels l
           where l.tenant_id = d.tenant_id
             and coalesce(l.is_active, true) and l.deleted_at is null
             and (lower(btrim(coalesce(l.code, ''))) = lower(btrim(coalesce(d.dm_level, '')))
               or lower(btrim(coalesce(l.name, ''))) = lower(btrim(coalesce(d.dm_level, ''))))
         ) as match_by_level
    from public.dm_certifications d
   where d.level_id is null and d.deleted_at is null
)
select * from cand where match_by_level > 1 order by tenant_id, dm_level;

-- 7) 매칭 불가(0건) 행 목록 — 인증 레벨 기준정보 신규 등록이 필요한 대상.
with cand as (
  select d.id as cert_id, d.tenant_id, d.employee_no, d.dm_stage, d.dm_level,
         (select count(distinct l.id)
            from public.exam_levels l
           where l.tenant_id = d.tenant_id
             and coalesce(l.is_active, true) and l.deleted_at is null
             and (lower(btrim(coalesce(l.code, ''))) in (lower(btrim(coalesce(d.dm_level, ''))), lower(btrim(coalesce(d.dm_stage, ''))))
               or lower(btrim(coalesce(l.name, ''))) in (lower(btrim(coalesce(d.dm_level, ''))), lower(btrim(coalesce(d.dm_stage, '')))))
         ) as any_match
    from public.dm_certifications d
   where d.level_id is null and d.deleted_at is null
)
select * from cand where any_match = 0 order by tenant_id, dm_stage, dm_level;
