-- ============================================================================
-- 기준정보 scoped unique — 부모 스코프 내에서만 코드 중복 차단 (신규 · additive)
--   현재 exam_categories/groups/processes/equipment 에는 전역 unique 가 없음(프런트 검사만).
--   프런트 [요구사항 5·계층 역전] 스코프와 DB 를 일치시킨다:
--     · 그룹      : (tenant_id, upper(code))                          — tenant 전역(독립)
--     · 제품군    : (tenant_id, group_id, upper(code))                — 같은 그룹 내
--     · 공정      : (tenant_id, group_id, category_id, upper(code))   — 같은 그룹+제품군 내
--     · 장비      : (tenant_id, process_id, upper(code))              — 같은 공정 내
--   다른 부모 스코프면 같은 코드 허용(예: 1그룹/CVD, 2그룹/CVD).
--   ⚠ additive only. 기존 index/데이터/컬럼 변경·삭제 없음. 코드 없는 행/미매핑(부모 null)은 인덱스 제외.
--   ⚠ 기존 데이터에 스코프 중복이 있으면 인덱스 생성이 실패한다 → DO 가드가 사전 진단 후 중단(자동 삭제/병합 금지).
--   ⚠ DB 미적용 상태로 작성만 함. 사용자 승인 후 SQL Editor 에서 실행.
-- ============================================================================
begin;

-- ── 사전 중복 진단(스코프 위반 시 중단 · 데이터 무변경) ─────────────────────────
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.exam_groups
     where deleted_at is null and coalesce(code,'') <> ''
     group by tenant_id, upper(code) having count(*) > 1) d;
  if n > 0 then raise exception '그룹 코드 중복(tenant 내) % 그룹 — 운영자 정리 후 재실행', n; end if;

  select count(*) into n from (
    select 1 from public.exam_categories
     where deleted_at is null and coalesce(code,'') <> '' and group_id is not null
     group by tenant_id, group_id, upper(code) having count(*) > 1) d;
  if n > 0 then raise exception '제품군 코드 중복(그룹 스코프) % 그룹 — 운영자 정리 후 재실행', n; end if;

  select count(*) into n from (
    select 1 from public.exam_processes
     where deleted_at is null and coalesce(code,'') <> '' and group_id is not null and category_id is not null
     group by tenant_id, group_id, category_id, upper(code) having count(*) > 1) d;
  if n > 0 then raise exception '공정 코드 중복(그룹+제품군 스코프) % 그룹 — 운영자 정리 후 재실행', n; end if;

  select count(*) into n from (
    select 1 from public.exam_equipment
     where deleted_at is null and coalesce(code,'') <> '' and process_id is not null
     group by tenant_id, process_id, upper(code) having count(*) > 1) d;
  if n > 0 then raise exception '장비 코드 중복(공정 스코프) % 그룹 — 운영자 정리 후 재실행', n; end if;
end $$;

-- ── scoped 부분 unique index(코드 존재 + 부모 존재 + 미삭제) ─────────────────────
create unique index if not exists ux_exam_groups_scoped_code
  on public.exam_groups (tenant_id, upper(code))
  where deleted_at is null and coalesce(code,'') <> '';

create unique index if not exists ux_exam_categories_scoped_code
  on public.exam_categories (tenant_id, group_id, upper(code))
  where deleted_at is null and coalesce(code,'') <> '' and group_id is not null;

create unique index if not exists ux_exam_processes_scoped_code
  on public.exam_processes (tenant_id, group_id, category_id, upper(code))
  where deleted_at is null and coalesce(code,'') <> '' and group_id is not null and category_id is not null;

create unique index if not exists ux_exam_equipment_scoped_code
  on public.exam_equipment (tenant_id, process_id, upper(code))
  where deleted_at is null and coalesce(code,'') <> '' and process_id is not null;

commit;

-- 진단(중단 시 참고 · 어떤 행이 중복인지):
--   select tenant_id, group_id, upper(code), count(*) from public.exam_categories
--    where deleted_at is null and coalesce(code,'')<>'' and group_id is not null
--    group by 1,2,3 having count(*)>1;
