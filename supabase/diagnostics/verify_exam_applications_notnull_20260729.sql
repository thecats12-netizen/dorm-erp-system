-- ============================================================================
-- 20260729 적용 여부 확인 (읽기 전용 · 최소)
--   exam_applications.personnel_id / session_id 의 NOT NULL 제거 여부만 판정한다.
-- ============================================================================
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'exam_applications'
  and column_name in ('personnel_id', 'session_id')
order by column_name;

-- [결과 해석]
--   personnel_id = YES  &  session_id = YES   → "정상"(20260729 적용 완료)
--   둘 다 NO                                   → "미적용"(기존 20260729 먼저 적용 필요)
--   하나만 YES                                 → "부분 적용"(20260729 재실행 — 멱등이라 안전)
--   행이 0건/테이블 없음                        → "추가 확인 필요"(exam_applications 자체 미생성 → 선행 마이그레이션 확인)
