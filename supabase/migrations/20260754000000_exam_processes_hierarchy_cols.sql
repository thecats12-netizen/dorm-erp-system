-- ============================================================================
-- 공정 계층 정합화 — exam_processes.group_id / category_id (신규 · additive · 비파괴)
--   목적: 그룹→제품군→공정 계층을 DB 까지 정상 저장(프런트/Excel 은 이미 두 컬럼을 저장하려 함).
--   현황: 두 컬럼은 20260731(정규)·20260740(DRAFT)에도 정의돼 있으나 운영 DB 미적용 → PGRST204.
--         이 파일은 두 컬럼만 콕 집어 idempotent 하게 추가(20260731 적용 여부와 무관하게 안전).
--   ⚠ additive only. 기존 컬럼/데이터/part_id/legacy 관계·기존 migration 변경 없음. FK on delete set null.
--   ⚠ backfill 은 legacy part(part.group_id/category_id)로 유일 결정되는 경우만(멱등 · null 만 채움).
--     part 가 없거나 part 에 group/category 가 없는 공정은 null 유지 → 하단 진단 SELECT 로 운영자 확인.
--   ⚠ DB 미적용 상태로 작성만 함. 사용자 승인 후 SQL Editor 에서 실행.
-- ============================================================================
begin;

-- (1) 컬럼 추가(idempotent) — 이미 있으면 무시.
alter table public.exam_processes
  add column if not exists group_id    uuid references public.exam_groups(id)     on delete set null,
  add column if not exists category_id uuid references public.exam_categories(id) on delete set null;

-- (2) 인덱스(미삭제 행 · tenant 스코프).
create index if not exists ix_exam_processes_tenant_group    on public.exam_processes (tenant_id, group_id)    where deleted_at is null;
create index if not exists ix_exam_processes_tenant_category on public.exam_processes (tenant_id, category_id) where deleted_at is null;

-- (3) backfill — legacy part 관계에서 유일 결정 가능한 경우만(멱등 · 기존 값 보존 · null 만 채움).
--     각 공정은 part_id 0/1개 → part 0/1개 → group/category 0/1개(모호 아님). fuzzy 이름 추정 없음.
update public.exam_processes p
   set group_id = pt.group_id, updated_at = now()
  from public.exam_parts pt
 where p.part_id = pt.id and p.deleted_at is null and p.group_id is null and pt.group_id is not null;

update public.exam_processes p
   set category_id = pt.category_id, updated_at = now()
  from public.exam_parts pt
 where p.part_id = pt.id and p.deleted_at is null and p.category_id is null and pt.category_id is not null;

commit;

-- (4) 미매핑 진단(운영자 확인용 · 읽기 전용) — part 없음/부모 없음으로 group/category 를 결정 못한 공정.
--   select id, code, name, part_id, group_id, category_id
--     from public.exam_processes
--    where deleted_at is null and (group_id is null or category_id is null)
--    order by name;
--   → 이 공정들은 인증 기준관리 화면에서 그룹/제품군을 지정하거나, 통합 Excel 로 그룹·제품군을 채워 등록하세요.
