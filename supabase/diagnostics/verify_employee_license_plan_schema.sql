-- ============================================================================
-- employee_license_plan 운영 스키마 확인 (읽기 전용)
--   목적: 라이선스 계획 기능이 실제 운영 DB 에서 동작 가능한지 검증.
--   선행 migration: 20260726000000_employee_license_plan.sql
-- ============================================================================

-- [1] 테이블 존재
select to_regclass('public.employee_license_plan') as table_exists;
--  → null 이면 미적용(20260726 필요). 그 경우 화면 코드만으로 '동작'으로 판정하지 않는다.

-- [2] 컬럼/타입/nullable
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'employee_license_plan'
order by ordinal_position;
--  기대 컬럼: id, tenant_id, organization_id, employee_id, license_level, rule_id,
--             status, join_date, base_date, target_date, completed_date, required_months,
--             previous_license, next_license, is_active, deleted_at, created_by/at, updated_by/at

-- [3] status CHECK 값
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con
join pg_class c on c.oid = con.conrelid and c.relname = 'employee_license_plan'
where con.contype = 'c';
--  기대: status in ('waiting','active','completed','expired','cancel')

-- [4] PK / FK / UNIQUE
select con.conname, con.contype, pg_get_constraintdef(con.oid) as def
from pg_constraint con
join pg_class c on c.oid = con.conrelid and c.relname = 'employee_license_plan'
where con.contype in ('p','f','u')
order by con.contype;
--  FK: employee_id → exam_personnel(id), rule_id → exam_rules(id). UNIQUE 중복방지 인덱스 존재 여부 확인.

-- [5] 중복 방지용 인덱스(부분 유니크 포함)
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'employee_license_plan';

-- [6] RLS 활성화 + 정책 목록
select relname, relrowsecurity from pg_class where relname = 'employee_license_plan';
select polname, cmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy where polrelid = 'public.employee_license_plan'::regclass;
--  → RLS true + admin/tenant 정책이 있어야 함. tenant 컬럼은 tenant_id(text).
