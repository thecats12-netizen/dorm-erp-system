-- PM 인증관리(pm_certifications): 승인 워크플로 + 시험 응시 연동 컬럼 추가.
-- 목적: 시험 응시관리에서 필기합격+실기합격+인증취득 건을 승인대기로 자동 생성하고, 승인 시 인증번호/만료일/PM Level 갱신을 처리.
-- 정책: 기존 컬럼/데이터/RLS 미변경. 신규 컬럼 추가(add column if not exists) + 자동생성용 FK/취득일 NOT NULL 완화(데이터 삭제 아님).
--       설계는 기존 dm_certifications(연명부 denormalized: employee_no/name + approval_status)와 동일하게 맞춘다.
-- 적용: Supabase SQL Editor 에서 1회 수동 실행. (자동 실행하지 않음)

-- 1) 워크플로/연동 컬럼(재실행 안전).
alter table public.pm_certifications add column if not exists employee_no text;           -- 사원번호(연명부 표기)
alter table public.pm_certifications add column if not exists name text;                  -- 성명
alter table public.pm_certifications add column if not exists pm_level text;              -- PM Level(Single/M1~M4/Master 등)
alter table public.pm_certifications add column if not exists approval_status text;       -- 승인상태(대기/승인/반려)
alter table public.pm_certifications add column if not exists approved_by uuid;           -- 승인자
alter table public.pm_certifications add column if not exists approved_at timestamptz;    -- 승인시각
alter table public.pm_certifications add column if not exists source_application_id uuid; -- 원본 시험응시(exam_applications.id) — 자동생성 중복 방지 키

-- 2) 자동생성/연명부 기반 등록을 위한 NOT NULL 완화(원본 데이터 손상 없음).
alter table public.pm_certifications alter column personnel_id drop not null;
alter table public.pm_certifications alter column level_id drop not null;
alter table public.pm_certifications alter column acquired_date drop not null;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';
