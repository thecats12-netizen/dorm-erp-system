-- ============================================================================
-- 실기 평가관리 스키마 진단 (읽기 전용 · SELECT only)
--   20260733(exam_results 실기 컬럼) / 20260731(exam_rules·exam_equipment 실기 요건) 적용 여부 확인.
-- ============================================================================

-- [1~2] exam_results 신규 컬럼 존재/타입/nullable
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='exam_results'
  and column_name in ('equipment_id','evaluator','evaluator_no','max_score','checklist','eval_status','result_type','score_variance','finalized_at','finalized_by')
order by column_name;
--  → 10개 모두 나오면 20260733 적용. 0/일부면 미적용/부분.

-- [3] exam_equipment FK(equipment_id) 존재
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con join pg_class c on c.oid=con.conrelid and c.relname='exam_results'
where con.contype='f' and pg_get_constraintdef(con.oid) ilike '%exam_equipment%';

-- [4] 유니크/조회 인덱스
select indexname, indexdef from pg_indexes
where schemaname='public' and tablename='exam_results'
  and indexname in ('ux_exam_results_practical_eval','ix_exam_results_eval_status');

-- [5~6] RLS 활성화 + 정책
select relname, relrowsecurity from pg_class where relname='exam_results';
select polname, cmd from pg_policy where polrelid='public.exam_results'::regclass order by cmd;

-- [7~9] 기존/실기 데이터 건수
select count(*) as total_rows,
       count(*) filter (where result_type='practical') as practical_rows
from public.exam_results where deleted_at is null;
select tenant_id, count(*) from public.exam_results where deleted_at is null group by tenant_id order by 2 desc;

-- [10] 중복 가능성(유니크 조건 위반 후보) — 적용 전 데이터 점검
select tenant_id, application_id, equipment_id, evaluator_no, count(*)
from public.exam_results
where deleted_at is null and result_type='practical' and equipment_id is not null
group by 1,2,3,4 having count(*) > 1;

-- [11~12] personnel_id 연결(실기 저장 대상 판정용) — 응시행의 personnel_id null 여부
select
  count(*) as apps_total,
  count(*) filter (where personnel_id is null) as apps_personnel_null
from public.exam_applications where deleted_at is null;
--  personnel_id null 인 응시행은 저장 시 employee_no → exam_personnel.id 확정 필요.

-- [13] 20260731 관련(exam_rules/exam_equipment) 실기 요건 컬럼 존재
select table_name, column_name
from information_schema.columns
where table_schema='public'
  and ( (table_name='exam_rules' and column_name in ('require_practical','practical_pass_score','evaluator_count','equipment_cert_method','required_equipment_count'))
     or (table_name='exam_equipment' and column_name in ('is_representative','equipment_group')) )
order by table_name, column_name;
