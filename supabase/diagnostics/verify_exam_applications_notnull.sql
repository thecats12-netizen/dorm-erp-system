-- ============================================================================
-- exam_applications 응시 등록 400(23502) 진단/검증 (읽기 전용)
--   적용 전: personnel_id/session_id 가 NOT NULL 이면 사원번호 기반 등록이 400.
--   적용 후: 둘 다 nullable(YES) 이어야 정상.
-- ============================================================================

-- [1] 문제 컬럼의 NOT NULL 여부
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'exam_applications'
  and column_name in ('personnel_id', 'session_id')
order by column_name;
--  → is_nullable = 'NO'  : 20260729 미적용(=현재 버그 상태, 등록 시 400).
--  → is_nullable = 'YES' : 수정 적용됨.

-- [2] 앱이 실제 전송하는 컬럼이 모두 존재하는지(누락 컬럼 400 배제용)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'exam_applications'
  and column_name in ('employee_no','name','group_name','product','process','pm_level','status',
                      'tenant_id','created_by','updated_by','created_at','updated_at')
order by column_name;
--  → 12개 모두 조회돼야 함(하나라도 빠지면 그 컬럼이 400 원인).

-- [3] (참고) 최근 응시행의 personnel_id/session_id 채움 상태
select count(*) as total,
       count(personnel_id) as with_personnel,
       count(session_id)   as with_session
from public.exam_applications
where deleted_at is null;
--  → 사원번호 기반 신규행은 with_personnel/with_session 이 0 에 가까움(정상).
