-- ============================================================================
-- 인증 기준관리 cascade 컬럼 존재 확인 (읽기 전용)
--   목적: 심화 cascade 구현 전, 어떤 상위 FK 컬럼이 실제 운영 DB 에 있는지 확인.
--   결과에 따라 코드가 "확실한 컬럼만" 필터에 사용한다(없는 컬럼은 자동 우회).
-- ============================================================================
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'exam_parts'      and column_name in ('category_id','group_id')) or
    (table_name = 'exam_processes'  and column_name in ('part_id','category_id','group_id')) or
    (table_name = 'exam_equipment'  and column_name in ('process_id')) or
    (table_name = 'exam_groups'     and column_name in ('category_id'))
  )
order by table_name, column_name;
--  기대(원본 스키마 · 확실): exam_groups.category_id, exam_parts.category_id,
--                            exam_processes.part_id, exam_equipment.process_id
--  선택(후속 migration · 있으면 cascade 더 정밀):
--    exam_parts.group_id            ← 20260714020000
--    exam_processes.category_id/group_id ← 20260731000000
--  → 위 '선택' 컬럼이 결과에 없으면, 코드는 해당 필터를 자동 우회한다(무회귀). 강제 사용/임의 적용 없음.
