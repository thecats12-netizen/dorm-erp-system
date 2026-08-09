-- ============================================================================
-- 인증 기준정보 계층 역전 준비 — exam_categories.group_id (신규 · additive · 비파괴)
--   목표 계층: 그룹 → 제품군 → 공정 → 장비.
--   현행 DB: exam_groups.category_id (여러 그룹 → 한 제품군, 제품군이 부모).
--   전환   : exam_categories.group_id (여러 제품군 → 한 그룹, 그룹이 부모).
--
--   ⚠ 이 마이그레이션은 컬럼/인덱스만 "추가"한다(데이터 변경 없음).
--   ⚠ 기존 exam_groups.category_id 는 삭제하지 않는다(하위 호환·롤백 대비).
--   ⚠ backfill 은 카디널리티 반전으로 일반적으로 모호함 → 별도 SQL(docs/category-group-backfill.sql)
--     에서 "충돌 검출 후 명확한 경우만" 수동 실행. 이 파일에서는 자동 backfill 하지 않는다.
--   ⚠ 신규 UI(그룹→제품군) 전환은 backfill 검증 이후에 진행(미backfill 시 제품군 드롭다운 공백).
-- ============================================================================
begin;

alter table public.exam_categories
  add column if not exists group_id uuid references public.exam_groups(id) on delete set null;

create index if not exists ix_exam_categories_group
  on public.exam_categories (tenant_id, group_id) where deleted_at is null;

commit;

-- 확인:
--   select id, name, group_id from public.exam_categories where deleted_at is null order by tenant_id, name;
