-- ============================================================================
-- ROLLBACK — exam_processes.group_id / category_id (20260754000000)
--   신규 인덱스 제거 + 컬럼 제거. 기존 part_id/legacy 관계·다른 데이터 영향 없음.
--   ⚠ 컬럼 제거 시 backfill/입력된 group_id·category_id 값은 삭제됨(part_id 로 재backfill 가능).
--   ⚠ 20260731 등 다른 migration 도 동일 컬럼을 정의하므로, 그쪽이 적용된 환경에서는 롤백을 신중히 판단.
-- ============================================================================
begin;
drop index if exists public.ix_exam_processes_tenant_group;
drop index if exists public.ix_exam_processes_tenant_category;
alter table public.exam_processes drop column if exists group_id;
alter table public.exam_processes drop column if exists category_id;
commit;
