-- ============================================================================
-- [초안 · 자동 적용 금지] 인증 기준 계층에서 제품/파트 단계 제거 지원
--   목표 계층: 라인 → 제품군 → 그룹 → 공정 → 장비 (제품/파트 단계 없음)
--   공정을 그룹에 직접 연결(exam_processes.group_id)해 신규 공정을 제품/파트 없이 등록 가능하게 한다.
--
--   ⚠ 검토용 초안입니다. Supabase SQL Editor 에서 (0)진단 → (1)변경 → (2)backfill 순으로 실행하세요.
--   ⚠ 기존 exam_parts 테이블/데이터/FK, exam_processes.part_id, exam_rules.part_id 는 유지(삭제/변경 금지).
--   ⚠ 프론트는 이 초안 미적용 시에도 안전: 인증규칙은 공정→그룹을 exam_parts(part.group_id) 역추적으로
--      "표시/필터"만 하므로 group_id 컬럼 없이도 동작. 이 초안은 "신규 공정을 그룹에 직접 저장"할 때 필요.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- (0) [진단 · SELECT 전용]
-- ────────────────────────────────────────────────────────────────────────
-- 공정의 상위 그룹 역추적 가능 여부(part 를 통한 연결).
-- select
--   count(*)                                                   as total_processes,
--   count(*) filter (where part_id is not null)                as with_part,
--   count(*) filter (where part_id is null)                    as without_part
-- from public.exam_processes where deleted_at is null;
--
-- part → group 매핑 누락(부모 그룹 없는 파트에 달린 공정) 점검.
-- select p.id as process_id, p.name, p.part_id, pt.group_id
--   from public.exam_processes p
--   left join public.exam_parts pt on pt.id = p.part_id
--  where p.deleted_at is null and (pt.id is null or pt.group_id is null);

-- ────────────────────────────────────────────────────────────────────────
-- (1) [변경] exam_processes 에 group_id(nullable FK) 추가 + 인덱스
--     nullable → 기존 공정(part 기반)은 group_id null 이어도 무방(프론트가 part 로 역추적).
-- ────────────────────────────────────────────────────────────────────────
begin;
alter table public.exam_processes add column if not exists group_id uuid references public.exam_groups(id) on delete set null;
create index if not exists ix_exam_processes_group on public.exam_processes (tenant_id, group_id) where deleted_at is null;
commit;

-- ────────────────────────────────────────────────────────────────────────
-- (2) [backfill] 기존 공정의 group_id 를 part.group_id 로 채움(멱등 · 기존 값 유지).
--     기존 데이터를 삭제/재매핑하지 않고, group_id 가 비어 있을 때만 part 기준으로 채운다.
-- ────────────────────────────────────────────────────────────────────────
-- update public.exam_processes p
--    set group_id = pt.group_id, updated_at = now()
--   from public.exam_parts pt
--  where p.part_id = pt.id
--    and p.group_id is null
--    and pt.group_id is not null
--    and p.deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────
-- (참고) exam_rules.part_id / exam_rules.line_id
--   · exam_rules.part_id: 신규 규칙은 저장하지 않음(프론트에서 제외). 기존 값은 그대로 보존(변경 없음).
--   · exam_rules.line_id: 20260739000000_exam_lines_DRAFT.sql 에서 추가(nullable · 공통=null).
--   두 컬럼 모두 nullable 이므로 제품/파트 제거로 인한 NOT NULL 저장 실패는 없습니다.
-- ────────────────────────────────────────────────────────────────────────

-- ── 롤백(필요 시) ──────────────────────────────────────────────────────────
--   drop index if exists public.ix_exam_processes_group;
--   alter table public.exam_processes drop column if exists group_id;
