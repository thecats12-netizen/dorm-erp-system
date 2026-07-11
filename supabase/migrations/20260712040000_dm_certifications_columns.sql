-- ============================================================================
-- 시험관리 D.M 인증관리 — dm_certifications 에 컬럼 추가(신규 컬럼만).
-- 기존 데이터/컬럼·타 테이블(PM 인증 원본 포함) 미변경. 재실행 안전(add column if not exists).
-- ============================================================================

begin;

alter table public.dm_certifications add column if not exists employee_no text;          -- 사원번호(연명부 표기)
alter table public.dm_certifications add column if not exists name text;                 -- 성명
alter table public.dm_certifications add column if not exists dm_stage text;             -- D.M 단계(Single Job/Multi Job 1~4/Dual Multi/Master)
alter table public.dm_certifications add column if not exists dm_level text;             -- D.M Level
alter table public.dm_certifications add column if not exists process_count int;         -- 인증 공정 수
alter table public.dm_certifications add column if not exists equipment_count int;       -- 인증 장비 수
alter table public.dm_certifications add column if not exists process_combination text;  -- 공정 조합
alter table public.dm_certifications add column if not exists dual_multi boolean;        -- Dual Multi 여부
alter table public.dm_certifications add column if not exists renewal_date date;         -- 갱신일
alter table public.dm_certifications add column if not exists proof_file text;           -- 인증 증빙(파일명/경로)
alter table public.dm_certifications add column if not exists approval_status text;      -- 승인상태(대기/승인/반려)
alter table public.dm_certifications add column if not exists approved_by uuid;          -- 승인자
alter table public.dm_certifications add column if not exists approved_at timestamptz;   -- 승인시각

-- 중복 방지 보강: 동일 사원번호 + D.M 단계 + 취득일(미삭제).
create unique index if not exists ux_dm_cert_emp_stage_date
  on public.dm_certifications (tenant_id, employee_no, dm_stage, acquired_date)
  where deleted_at is null and employee_no is not null and dm_stage is not null;

create index if not exists ix_dm_cert_emp on public.dm_certifications (tenant_id, employee_no);

commit;
