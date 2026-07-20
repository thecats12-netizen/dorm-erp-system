-- ============================================================================
-- [초안 · 자동 적용 금지] 시험관리 기준정보 코드 중복 정책 개선
--   전역 unique(code) 대신 "부모 범위" 복합 unique 로 전환(요구사항 5).
--
--   제품군  exam_categories : unique(tenant_id, code)
--   그룹    exam_groups      : unique(tenant_id, category_id, code)
--   제품/파트 exam_parts     : unique(tenant_id, group_id, code)
--   공정    exam_processes   : unique(tenant_id, part_id, code)
--   장비    exam_equipment   : unique(tenant_id, process_id, code)
--
--   ⚠ 이 파일은 검토용 초안입니다. Supabase SQL Editor 에서 직접 실행해야 하며,
--     실행 전 반드시 아래 (0) 사전 점검으로 기존 중복을 해소해야 합니다.
--     (부분 unique index 생성 시 기존 중복 데이터가 있으면 생성이 실패합니다.)
--   ⚠ 현재 프론트 검사는 부모 범위 기준으로 이미 개선되어 있으나, DB 제약은 아직 없습니다.
--     본 마이그레이션 적용 전까지 DB 레벨 중복 방지는 걸려 있지 않습니다.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- (0) 사전 점검 — 적용 전에 먼저 실행해 중복이 0건인지 확인하세요(수정 없이 SELECT 만).
--     결과가 있으면 해당 code 를 정리(재코딩/삭제)한 뒤 (1) 을 실행합니다.
-- ────────────────────────────────────────────────────────────────────────
-- select tenant_id, code, count(*) from public.exam_categories
--   where deleted_at is null and code is not null and code <> ''
--   group by tenant_id, code having count(*) > 1;
-- select tenant_id, category_id, code, count(*) from public.exam_groups
--   where deleted_at is null and code is not null and code <> ''
--   group by tenant_id, category_id, code having count(*) > 1;
-- select tenant_id, group_id, code, count(*) from public.exam_parts
--   where deleted_at is null and code is not null and code <> ''
--   group by tenant_id, group_id, code having count(*) > 1;
-- select tenant_id, part_id, code, count(*) from public.exam_processes
--   where deleted_at is null and code is not null and code <> ''
--   group by tenant_id, part_id, code having count(*) > 1;
-- select tenant_id, process_id, code, count(*) from public.exam_equipment
--   where deleted_at is null and code is not null and code <> ''
--   group by tenant_id, process_id, code having count(*) > 1;

-- ────────────────────────────────────────────────────────────────────────
-- (1) 복합 unique 부분 인덱스 생성 — 미삭제 + code 존재 행에만 적용.
--     재실행 안전(if not exists). group_id/part_id/process_id 가 null 인 레거시 행은
--     coalesce 로 빈 범위(''::uuid 대체 불가 → text 캐스팅)로 묶어 동일 범위 취급.
-- ────────────────────────────────────────────────────────────────────────
begin;

create unique index if not exists ux_exam_categories_code
  on public.exam_categories (tenant_id, upper(code))
  where deleted_at is null and code is not null and code <> '';

create unique index if not exists ux_exam_groups_code
  on public.exam_groups (tenant_id, coalesce(category_id::text, ''), upper(code))
  where deleted_at is null and code is not null and code <> '';

create unique index if not exists ux_exam_parts_code
  on public.exam_parts (tenant_id, coalesce(group_id::text, ''), upper(code))
  where deleted_at is null and code is not null and code <> '';

create unique index if not exists ux_exam_processes_code
  on public.exam_processes (tenant_id, coalesce(part_id::text, ''), upper(code))
  where deleted_at is null and code is not null and code <> '';

create unique index if not exists ux_exam_equipment_code
  on public.exam_equipment (tenant_id, coalesce(process_id::text, ''), upper(code))
  where deleted_at is null and code is not null and code <> '';

commit;

-- ────────────────────────────────────────────────────────────────────────
-- 롤백(필요 시):
--   drop index if exists public.ux_exam_categories_code;
--   drop index if exists public.ux_exam_groups_code;
--   drop index if exists public.ux_exam_parts_code;
--   drop index if exists public.ux_exam_processes_code;
--   drop index if exists public.ux_exam_equipment_code;
-- ────────────────────────────────────────────────────────────────────────
