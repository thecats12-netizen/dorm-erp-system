-- ROLLBACK — 20260748000000_exam_equipment_stage_rules.sql
--   신규 테이블만 제거. btree_gist 확장은 공유 자원이므로 drop 하지 않는다.
drop table if exists public.exam_equipment_stage_rules;
