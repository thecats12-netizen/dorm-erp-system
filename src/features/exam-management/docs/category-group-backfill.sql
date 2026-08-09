-- ============================================================================
-- 제품군→그룹 역전 backfill (수동 · 운영자 검토 필수 · 테스트 tenant 먼저)
--   목적: 신규 exam_categories.group_id 를 기존 exam_groups.category_id 관계에서 안전 매핑.
--   ⚠ 카디널리티 반전: 기존은 "여러 그룹 → 한 제품군". 한 제품군을 여러 그룹이 참조했다면
--     "그 제품군의 그룹"은 유일하지 않음 → 자동 추정 금지(충돌). 아래 [1] 로 먼저 충돌을 확인.
--   ⚠ 20260752000000 (group_id 컬럼) 선행 적용 필요. 파괴 없음(UPDATE 는 group_id IS NULL 행만).
--   파라미터: :tenant  (예: 'default' 또는 대상 tenant)
-- ============================================================================

-- [1] 충돌 검출(읽기 전용) — 한 제품군을 참조하는 그룹이 2개 이상 = 자동 매핑 불가(운영자 결정 필요)
select c.id as category_id, c.name as category_name,
       count(g.id) as linked_group_count,
       string_agg(g.name, ', ' order by g.name) as linked_groups
  from public.exam_categories c
  join public.exam_groups g
    on g.category_id = c.id and g.deleted_at is null and g.tenant_id = c.tenant_id
 where c.deleted_at is null and c.tenant_id = :tenant
 group by c.id, c.name
having count(g.id) > 1
 order by linked_group_count desc, category_name;
-- → 행이 나오면 그 제품군들은 backfill 하지 말고 운영자가 어느 그룹 소속인지 결정해야 함(별도 보고).

-- [2] 명확한 경우만 backfill(멱등) — "정확히 1개 그룹만" 참조하는 제품군에 한해 group_id 설정.
--     group_id 가 이미 있는 행은 건드리지 않음(IS NULL 조건). 다른 tenant 영향 없음.
update public.exam_categories c
   set group_id = sub.only_group
  from (
    select g.category_id as cat, min(g.id) as only_group
      from public.exam_groups g
     where g.deleted_at is null and g.tenant_id = :tenant and g.category_id is not null
     group by g.category_id
    having count(*) = 1
  ) sub
 where c.id = sub.cat
   and c.tenant_id = :tenant
   and c.deleted_at is null
   and c.group_id is null;   -- 기존 값 덮어쓰기 금지

-- [3] 결과 확인(읽기 전용)
select
  (select count(*) from public.exam_categories where tenant_id = :tenant and deleted_at is null) as total_categories,
  (select count(*) from public.exam_categories where tenant_id = :tenant and deleted_at is null and group_id is not null) as mapped_categories,
  (select count(*) from public.exam_categories where tenant_id = :tenant and deleted_at is null and group_id is null) as unmapped_categories;

-- [4] 미매핑(충돌/미참조) 제품군 목록 — 운영자가 UI(제품군 등록/수정 그룹 드롭다운)로 수동 지정
select c.id, c.name
  from public.exam_categories c
 where c.tenant_id = :tenant and c.deleted_at is null and c.group_id is null
 order by c.name;
