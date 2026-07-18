-- ============================================================================
-- [검증 · 비파괴] 20260726000000_employee_license_plan.sql 적용 확인
-- ============================================================================

-- 1) 테이블/컬럼 존재 확인
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='employee_license_plan'
order by ordinal_position;

-- 2) exam_rules.required_months 컬럼 추가 확인(기존 컬럼은 그대로여야 함)
select column_name from information_schema.columns
where table_schema='public' and table_name='exam_rules'
  and column_name in ('required_months','min_tenure_months','valid_months','prerequisite_level_id')
order by column_name;

-- 3) status CHECK 제약 확인
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.employee_license_plan'::regclass and contype='c';

-- 4) 유니크/인덱스 확인
select indexname from pg_indexes
where schemaname='public' and tablename='employee_license_plan' order by indexname;

-- 5) RLS 활성/정책 확인(admin FOR ALL / viewer FOR SELECT)
select relrowsecurity from pg_class where oid='public.employee_license_plan'::regclass;
select policyname, cmd, permissive from pg_policies
where schemaname='public' and tablename='employee_license_plan' order by policyname;

-- 6) 트리거 확인
select tgname from pg_trigger
where tgrelid='public.employee_license_plan'::regclass and not tgisinternal;

-- 7) 기존 데이터 무변경 참고(신규 테이블은 0행이 정상)
select count(*) as plan_rows from public.employee_license_plan;
