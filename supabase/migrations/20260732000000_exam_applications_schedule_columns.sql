-- ============================================================================
-- 시험 응시관리 · 시험 일정 배정용 컬럼 추가 (exam_applications)
--
-- [배경]
--   exam_applications 에는 예정 시험일/회차/종류/장소/감독자 전용 컬럼이 없다.
--   기존 날짜 컬럼(written_exam_date=필기 진행일, practical_acquire_date=실기 취득일,
--   cert_acquired_date=인증 취득일)은 "결과/취득" 의미라 "예정 일정"과 분리해야 한다.
--   session_id(→exam_sessions FK)는 평면 설계에서 미사용이며, 회차를 위해 더미 FK 를
--   저장하지 않는다(요구사항). 따라서 회차는 텍스트(exam_round)로 관리한다.
--
-- [원칙] 전부 ADD COLUMN IF NOT EXISTS · nullable · 기존 데이터/컬럼/UNIQUE/RLS/status 무변경.
--   · DROP/RENAME 없음. 기존 행에 기본값 강제 없음(모두 null 시작). 재실행 안전(멱등).
--   · 신규 테이블/FK 생성 없음(proctor 는 사용자 마스터가 없어 text 로 시작).
--
-- ※ 자동 실행 금지. 승인 후 Supabase SQL Editor 에서 1회 수동 실행.
--    선행: 20260712030000_exam_applications_columns.sql (권장: 20260729 먼저 적용해 등록 정상화)
--    롤백: 20260732000000_exam_applications_schedule_columns_rollback.sql
-- ============================================================================

begin;

alter table public.exam_applications
  add column if not exists exam_date      date,   -- 예정 시험일(결과일/취득일과 분리)
  add column if not exists exam_time       time,   -- 시험 시작 시간(선택)
  add column if not exists exam_round      text,   -- 시험 회차(예: 2026-03-1차) — 회차 마스터 없어 텍스트
  add column if not exists exam_type       text,   -- 시험 종류(필기/실기/통합/기타)
  add column if not exists exam_location   text,   -- 시험 장소
  add column if not exists proctor         text,   -- 감독자(사용자 FK 없음 → text 로 시작)
  add column if not exists schedule_notes  text;   -- 일정 비고(기존 notes=일반 신청 메모와 분리)

-- 조회 최적화: 일정(월별/예정) 조회용. tenant_id+status, tenant_id+category_code, (tenant_id,employee_no,category_code) 유니크는
--  20260712030000 에 이미 존재하므로 재생성하지 않는다. exam_date 만 신규 인덱스 추가(선택 · 중복 방지 if not exists).
create index if not exists ix_exam_applications_exam_date on public.exam_applications (tenant_id, exam_date);

commit;

-- PostgREST 스키마 캐시 갱신(컬럼 추가 즉시 반영).
notify pgrst, 'reload schema';
