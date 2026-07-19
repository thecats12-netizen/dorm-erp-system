-- ============================================================================
-- exam_applications 운영 스키마 확인 (읽기 전용)
--   목적: 시험 응시관리 고도화 전, 저장 가능한 컬럼과 제약을 확정.
--   선행: 20260712000000(create), 20260712030000(컬럼 추가), 20260729000000(NOT NULL 제거)
-- ============================================================================

-- [1] 테이블 존재
select to_regclass('public.exam_applications') as table_exists;

-- [2] 전체 컬럼/타입/nullable  (특히 personnel_id / session_id 의 is_nullable)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'exam_applications'
order by ordinal_position;
--  ★ personnel_id / session_id 의 is_nullable = 'YES' 여야 사원번호 기반 등록/일괄등록이 성공(20260729 적용).
--    'NO' 이면 응시 후보 일괄 등록·이 화면 저장이 23502 로 실패한다.
--  ★ 일정 관련 컬럼(exam_date/round/location/supervisor 등) 존재 여부 확인 — 없으면 일정 배정 저장 불가(마이그레이션 제안만).

-- [3] status CHECK 유무 (exam_applications.status 는 원래 자유 텍스트로 설계됨)
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con join pg_class c on c.oid = con.conrelid and c.relname = 'exam_applications'
where con.contype = 'c';

-- [4] PK / FK / UNIQUE
select con.conname, con.contype, pg_get_constraintdef(con.oid) as def
from pg_constraint con join pg_class c on c.oid = con.conrelid and c.relname = 'exam_applications'
where con.contype in ('p','f','u') order by con.contype;
--  FK: personnel_id → exam_personnel, session_id → exam_sessions, level_id → exam_levels, equipment_id → exam_equipment

-- [5] 인덱스(부분 유니크 중복방지 포함)
select indexname, indexdef from pg_indexes where schemaname='public' and tablename='exam_applications';
--  기대: ux_exam_applications_emp_catcode (tenant_id, employee_no, category_code) where deleted_at is null and category_code is not null
--        → 동일 직원·동일 단계(category_code) 중복 신청 차단(DB 레벨).

-- [6] RLS 활성화 + 정책
select relname, relrowsecurity from pg_class where relname='exam_applications';
select polname, cmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy where polrelid='public.exam_applications'::regclass;
