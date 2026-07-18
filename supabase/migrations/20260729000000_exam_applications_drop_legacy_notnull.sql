-- ============================================================================
-- 시험 응시관리 "승인하여 응시 등록" 400 오류 수정
--
-- [증상]
--   응시 후보 자동계산 → "승인하여 응시 등록" 클릭 시 Supabase REST 400.
--   콘솔: [examMasterService] upsertExamRow 실패.
--
-- [근본 원인 — NOT NULL 위반(23502)]
--   exam_applications 는 원래 정규화 설계(20260712000000)로 만들어져
--     personnel_id uuid NOT NULL, session_id uuid NOT NULL
--   두 컬럼이 필수였다. 이후 시험 응시관리는 사원번호(employee_no) 기반의
--   평면 시트 구조로 재설계(20260712030000: employee_no/name/group_name/product/
--   process/pm_level 등 컬럼 추가)되어, Excel 가져오기·수동 등록·후보 승인 모두
--   personnel_id/session_id 를 사용하지 않는다.
--   그래서 INSERT 시 두 NOT NULL 컬럼이 비어 23502(null value violates
--   not-null constraint) → HTTP 400 이 발생한다.
--
--   ※ 같은 재설계를 겪은 pm_certifications 는 20260714030000 에서 이미
--     personnel_id/level_id/acquired_date 의 NOT NULL 을 제거했다. exam_applications
--     만 누락되어 응시 등록이 전면 실패했다. 본 마이그레이션이 그 누락을 보완한다.
--
-- [수정 — 최소 범위]
--   personnel_id / session_id 의 NOT NULL 만 제거한다.
--   · 컬럼/FK/인덱스는 그대로 둔다(과거 정규화 데이터 호환 유지, nullable FK 는 정상).
--   · 다른 테이블·컬럼·RLS·중복 인덱스는 건드리지 않는다.
--   · 재실행 안전(if exists · drop not null 은 멱등).
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    선행: 20260712000000_create_exam_management.sql, 20260712030000_exam_applications_columns.sql
--    롤백: 20260729000000_exam_applications_drop_legacy_notnull_rollback.sql
-- ============================================================================

begin;

alter table public.exam_applications alter column personnel_id drop not null;
alter table public.exam_applications alter column session_id  drop not null;

commit;
