-- ============================================================================
-- 시험관리 시험 응시관리(인증시험 응시데이터) — exam_applications 에 컬럼 추가(신규 컬럼만).
-- 기존 데이터/컬럼·타 테이블 미변경. 재실행 안전(add column if not exists).
-- ============================================================================

begin;

alter table public.exam_applications add column if not exists seq_no int;                 -- 연번
alter table public.exam_applications add column if not exists employee_no text;            -- 사원번호(연명부와 동일 표기)
alter table public.exam_applications add column if not exists name text;                   -- 성명
alter table public.exam_applications add column if not exists group_name text;             -- 그룹
alter table public.exam_applications add column if not exists product text;                -- 제품
alter table public.exam_applications add column if not exists process text;                -- 공정
alter table public.exam_applications add column if not exists category_code text;          -- 구분코드(중복 식별/재업로드 매칭 키)
alter table public.exam_applications add column if not exists category text;               -- 구분
alter table public.exam_applications add column if not exists level_id uuid references public.exam_levels(id) on delete set null;       -- 인증단계(기준정보)
alter table public.exam_applications add column if not exists equipment_id uuid references public.exam_equipment(id) on delete set null; -- 인증 설비(기준정보)
alter table public.exam_applications add column if not exists written_exam_date date;       -- 필기 진행일
alter table public.exam_applications add column if not exists written_pass_date date;       -- 필기 합격일
alter table public.exam_applications add column if not exists practical_acquire_date date;  -- 실기 취득일
alter table public.exam_applications add column if not exists practical_pass_date date;     -- 실기 합격일
alter table public.exam_applications add column if not exists cert_acquired_date date;      -- 인증 취득일
alter table public.exam_applications add column if not exists cert_status text;             -- 인증취득여부(취득/미취득) — 자동계산 또는 수동확정
alter table public.exam_applications add column if not exists cert_status_manual boolean;   -- 수동 확정 여부(true 면 자동계산이 덮어쓰지 않음)
alter table public.exam_applications add column if not exists timing_status text;           -- 조기/정상/지연취득
alter table public.exam_applications add column if not exists pm_level text;                -- PM Level
alter table public.exam_applications add column if not exists dm_process text;              -- D.M 공정

-- 중복 방지: 동일 사원번호 + 동일 구분코드(미삭제) — 구분코드 기준 재업로드 매칭.
create unique index if not exists ux_exam_applications_emp_catcode
  on public.exam_applications (tenant_id, employee_no, category_code)
  where deleted_at is null and category_code is not null and employee_no is not null;

create index if not exists ix_exam_applications_catcode on public.exam_applications (tenant_id, category_code);
create index if not exists ix_exam_applications_status  on public.exam_applications (tenant_id, status);

commit;
