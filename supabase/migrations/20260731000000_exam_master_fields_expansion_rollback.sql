-- ============================================================================
-- 롤백: 20260731 확장 필드.
--   ⚠ 컬럼 DROP 은 그 컬럼에 입력된 데이터를 영구 삭제한다. 적용 후 값을 입력했다면
--      되돌리지 말거나, 먼저 백업하라. 기본 롤백은 "제약조건만" 제거한다(데이터 보존).
--   컬럼까지 완전히 되돌리려면 아래 주석(DROP COLUMN) 블록을 검토 후 수동 실행.
-- ============================================================================

begin;

-- 1) 안전한 기본 롤백: 장비 인증방식 CHECK 제약만 제거(데이터 보존).
alter table public.exam_rules drop constraint if exists exam_rules_equipment_cert_method_chk;

-- 2) (선택·위험) 컬럼까지 완전 제거 — 데이터 삭제됨. 필요 시에만 주석 해제.
-- alter table public.exam_categories drop column if exists description, drop column if exists effective_from, drop column if exists effective_to, drop column if exists notes;
-- alter table public.exam_groups     drop column if exists description, drop column if exists manager_name, drop column if exists notes;
-- alter table public.exam_parts      drop column if exists product_type, drop column if exists description, drop column if exists notes;   -- group_id 는 20260714020000 소유 → 여기서 제거 금지
-- alter table public.exam_processes  drop column if exists category_id, drop column if exists group_id, drop column if exists process_type, drop column if exists require_written, drop column if exists require_practical, drop column if exists uses_equipment, drop column if exists default_equipment_count, drop column if exists description;
-- alter table public.exam_equipment  drop column if exists equipment_type, drop column if exists maker, drop column if exists model, drop column if exists equipment_group, drop column if exists is_representative, drop column if exists individual_cert_required, drop column if exists practical_target, drop column if exists description, drop column if exists notes;
-- alter table public.exam_levels     drop column if exists prerequisite_level_id, drop column if exists next_level_id, drop column if exists default_required_months, drop column if exists default_valid_months, drop column if exists default_retest_months, drop column if exists require_written, drop column if exists require_practical, drop column if exists auto_create_next, drop column if exists description;
-- alter table public.exam_rules      drop column if exists written_pass_score, drop column if exists written_max_score, drop column if exists written_valid_months, drop column if exists written_retest_months, drop column if exists written_max_attempts, drop column if exists written_exemptable, drop column if exists practical_pass_score, drop column if exists equipment_test_required, drop column if exists equipment_cert_method, drop column if exists evaluator_count, drop column if exists practical_max_attempts, drop column if exists evidence_required, drop column if exists renewal_period_months, drop column if exists renewal_rewritten, drop column if exists renewal_repractical, drop column if exists auto_create_cert, drop column if exists auto_activate_next, drop column if exists priority, drop column if exists effective_to, drop column if exists pm_target, drop column if exists dm_target, drop column if exists min_process_count, drop column if exists min_equipment_count, drop column if exists dual_condition, drop column if exists multi_condition, drop column if exists master_condition;

notify pgrst, 'reload schema';

commit;
