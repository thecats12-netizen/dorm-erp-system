-- ============================================================================
-- 인증 기준관리 확장 필드 (제품군/그룹/제품·파트/공정/장비/레벨/규칙)
--
-- [원칙] 전부 add column if not exists / add constraint(가드) — 기존 컬럼·데이터·FK·RLS 미변경.
--   · 재실행 안전(멱등). 신규 컬럼은 모두 nullable(또는 default) → 기존 CRUD/Excel 무영향.
--   · 이 migration 적용 후에야 examMasterConfigs 에 확장 필드를 노출한다(미적용 상태에서 노출하면 400).
--   · tenant_id/RLS/soft delete 구조는 기존 exam_* 표준 그대로 사용(추가 정책 없음).
--
-- ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--    롤백: 20260731000000_exam_master_fields_expansion_rollback.sql
--    선행: 20260712000000, 20260712010000, 20260714020000(exam_parts.group_id), 20260714040000
-- ============================================================================

begin;

-- 1) 제품군(exam_categories): 설명/적용기간/비고
alter table public.exam_categories
  add column if not exists description   text,
  add column if not exists effective_from date,
  add column if not exists effective_to   date,
  add column if not exists notes          text;

-- 2) 그룹(exam_groups): 설명/담당 관리자/비고
alter table public.exam_groups
  add column if not exists description  text,
  add column if not exists manager_name text,
  add column if not exists notes        text;

-- 3) 제품/파트(exam_parts): 그룹 연결(20260714020000 에서 group_id 추가)·제품타입/모델·설명/비고
--    group_id 는 이미 20260714020000 에 있으므로 여기서는 없을 때만 보강.
alter table public.exam_parts
  add column if not exists group_id     uuid references public.exam_groups(id) on delete set null,
  add column if not exists product_type text,
  add column if not exists description  text,
  add column if not exists notes        text;

-- 4) 공정(exam_processes): 상위 종속(제품군/그룹)·공정유형·시험/장비 기본정책·설명
alter table public.exam_processes
  add column if not exists category_id uuid references public.exam_categories(id) on delete set null,
  add column if not exists group_id    uuid references public.exam_groups(id) on delete set null,
  add column if not exists process_type text,
  add column if not exists require_written   boolean,
  add column if not exists require_practical  boolean,
  add column if not exists uses_equipment     boolean,
  add column if not exists default_equipment_count int,
  add column if not exists description  text;

-- 5) 장비(exam_equipment): 유형/제조사/모델/장비군/대표·개별인증·실기대상/설명·비고
alter table public.exam_equipment
  add column if not exists equipment_type          text,
  add column if not exists maker                   text,
  add column if not exists model                   text,
  add column if not exists equipment_group         text,
  add column if not exists is_representative        boolean,
  add column if not exists individual_cert_required boolean,
  add column if not exists practical_target         boolean,
  add column if not exists description              text,
  add column if not exists notes                    text;

-- 6) 인증 레벨(exam_levels): 선행/다음 레벨·기본 기한/유효/재시험·필기실기 기본·자동생성·설명
alter table public.exam_levels
  add column if not exists prerequisite_level_id uuid references public.exam_levels(id) on delete set null,
  add column if not exists next_level_id         uuid references public.exam_levels(id) on delete set null,
  add column if not exists default_required_months int,
  add column if not exists default_valid_months    int,
  add column if not exists default_retest_months   int,
  add column if not exists require_written   boolean,
  add column if not exists require_practical  boolean,
  add column if not exists auto_create_next   boolean,
  add column if not exists description        text;

-- 7) 인증 규칙(exam_rules): 필기/실기 점수·장비 인증방식·평가자·갱신·PM/DM 조건 등
alter table public.exam_rules
  -- 필기
  add column if not exists written_pass_score int,
  add column if not exists written_max_score  int,
  add column if not exists written_valid_months int,
  add column if not exists written_retest_months int,
  add column if not exists written_max_attempts int,
  add column if not exists written_exemptable  boolean,
  -- 실기
  add column if not exists practical_pass_score int,
  add column if not exists equipment_test_required boolean,
  add column if not exists equipment_cert_method  text,      -- one/all/representative/equipment_group/individual
  add column if not exists evaluator_count       int,
  add column if not exists practical_max_attempts int,
  add column if not exists evidence_required     boolean,
  -- 기간/자동화
  add column if not exists renewal_period_months int,
  add column if not exists renewal_rewritten     boolean,
  add column if not exists renewal_repractical    boolean,
  add column if not exists auto_create_cert       boolean,
  add column if not exists auto_activate_next     boolean,
  add column if not exists priority               int,
  add column if not exists effective_to           date,
  -- PM/DM
  add column if not exists pm_target   boolean,
  add column if not exists dm_target   boolean,
  add column if not exists min_process_count   int,
  add column if not exists min_equipment_count int,
  add column if not exists dual_condition  text,
  add column if not exists multi_condition text,
  add column if not exists master_condition text;

-- 장비 인증 방식 허용값 제약(가드 — 없을 때만 추가). null 허용.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'exam_rules_equipment_cert_method_chk') then
    alter table public.exam_rules
      add constraint exam_rules_equipment_cert_method_chk
      check (equipment_cert_method is null
             or equipment_cert_method in ('one','all','representative','equipment_group','individual'));
  end if;
end $$;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';

commit;
