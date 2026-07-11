-- ============================================================================
-- 시험관리(Exam Management) 전용 스키마 — 신규 테이블만 생성.
-- 기존 테이블/컬럼/데이터/RLS/함수/트리거는 절대 수정하지 않는다(모두 신규 public.exam_* 만 추가).
-- 멀티테넌트 기준: tenant_id text default 'default' (기존 표준), 사용자 참조: uuid (기존 표준).
-- RLS: 기존 표준과 동일하게 JWT 클레임(auth.jwt() ->> 'role' / 'tenant_id') 기반 → profiles 재조회(재귀) 없음.
-- 재실행 안전(idempotent): create ... if not exists / drop policy if exists.
-- ============================================================================

begin;

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- 1) 기준정보(코드성) 테이블
-- ─────────────────────────────────────────────────────────────

-- 직원 기본정보
create table if not exists public.exam_personnel (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  employee_no text not null,                 -- 사번
  name text not null,
  department text,
  part_id uuid,
  process_id uuid,
  level_id uuid,
  hire_date date,
  phone text,
  email text,
  status text,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 시험 카테고리(대분류)
create table if not exists public.exam_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  code text,
  name text not null,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 파트
create table if not exists public.exam_parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  category_id uuid references public.exam_categories(id) on delete set null,
  code text,
  name text not null,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 공정
create table if not exists public.exam_processes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  part_id uuid references public.exam_parts(id) on delete set null,
  code text,
  name text not null,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 인증 레벨
create table if not exists public.exam_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  code text,
  name text not null,
  rank_order int,                            -- 레벨 순위(정렬/상하위 비교용)
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 2) 시험 운영 테이블
-- ─────────────────────────────────────────────────────────────

-- 시험 회차
create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  session_code text,
  session_name text not null,
  category_id uuid references public.exam_categories(id) on delete set null,
  level_id uuid references public.exam_levels(id) on delete set null,
  exam_date date,
  location text,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 응시 신청
create table if not exists public.exam_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  session_id uuid not null references public.exam_sessions(id) on delete cascade,
  status text,                               -- 신청/승인/취소 등
  applied_at timestamptz,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 시험 결과
create table if not exists public.exam_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  application_id uuid references public.exam_applications(id) on delete cascade,
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  session_id uuid references public.exam_sessions(id) on delete set null,
  level_id uuid references public.exam_levels(id) on delete set null,
  score numeric,
  passed boolean,
  result_date date,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PM 인증 이력
create table if not exists public.pm_certifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  level_id uuid not null references public.exam_levels(id) on delete restrict,
  part_id uuid references public.exam_parts(id) on delete set null,
  process_id uuid references public.exam_processes(id) on delete set null,
  cert_no text,
  acquired_date date not null,
  expiry_date date,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D.M 인증 이력
create table if not exists public.dm_certifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  personnel_id uuid not null references public.exam_personnel(id) on delete cascade,
  level_id uuid not null references public.exam_levels(id) on delete restrict,
  part_id uuid references public.exam_parts(id) on delete set null,
  process_id uuid references public.exam_processes(id) on delete set null,
  cert_no text,
  acquired_date date not null,
  expiry_date date,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 3) 목표/실적/기준 테이블
-- ─────────────────────────────────────────────────────────────

-- 연간 목표
create table if not exists public.exam_annual_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  target_year int not null,
  part_id uuid references public.exam_parts(id) on delete set null,
  process_id uuid references public.exam_processes(id) on delete set null,
  level_id uuid references public.exam_levels(id) on delete set null,
  target_count int,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 월간 실적
create table if not exists public.exam_monthly_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  result_year int not null,
  result_month int not null,
  part_id uuid references public.exam_parts(id) on delete set null,
  process_id uuid references public.exam_processes(id) on delete set null,
  level_id uuid references public.exam_levels(id) on delete set null,
  achieved_count int,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 취득/달성 기준
create table if not exists public.exam_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  rule_type text,                            -- 취득기준 / 달성기준 등
  part_id uuid references public.exam_parts(id) on delete set null,
  process_id uuid references public.exam_processes(id) on delete set null,
  level_id uuid references public.exam_levels(id) on delete set null,
  criteria jsonb,
  effective_date date,
  notes text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 4) Excel 가져오기 / 감사
-- ─────────────────────────────────────────────────────────────

-- 가져오기 작업
create table if not exists public.exam_import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  file_name text,
  target_table text,
  status text,                               -- pending/processing/done/failed
  total_rows int,
  success_rows int,
  error_rows int,
  started_at timestamptz,
  finished_at timestamptz,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 가져오기 오류 상세
create table if not exists public.exam_import_errors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  job_id uuid not null references public.exam_import_jobs(id) on delete cascade,
  row_no int,
  column_name text,
  message text,
  raw_data jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 시험관리 전용 감사 로그
create table if not exists public.exam_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  target_type text,
  target_id text,
  action_type text,                          -- create/update/delete/import 등
  changed_by uuid,
  before_value jsonb,
  after_value jsonb,
  memo text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 중복 방지(부분 유니크 인덱스 — soft delete(deleted_at) 미삭제 행 기준)
-- ============================================================================
-- 사번 중복 방지(테넌트 내)
create unique index if not exists ux_exam_personnel_empno
  on public.exam_personnel (tenant_id, employee_no) where deleted_at is null;
-- 동일 직원 + 동일 시험회차 중복 응시 방지
create unique index if not exists ux_exam_applications_person_session
  on public.exam_applications (tenant_id, personnel_id, session_id) where deleted_at is null;
-- 동일 직원 + 동일 인증레벨 + 동일 취득일 중복 방지 (PM/DM)
create unique index if not exists ux_pm_cert_person_level_date
  on public.pm_certifications (tenant_id, personnel_id, level_id, acquired_date) where deleted_at is null;
create unique index if not exists ux_dm_cert_person_level_date
  on public.dm_certifications (tenant_id, personnel_id, level_id, acquired_date) where deleted_at is null;
-- 동일 연도 + 파트 + 공정 + 레벨 목표 중복 방지
create unique index if not exists ux_exam_annual_targets_key
  on public.exam_annual_targets (tenant_id, target_year, part_id, process_id, level_id) where deleted_at is null;

-- ============================================================================
-- 조회 성능 인덱스
-- ============================================================================
create index if not exists ix_exam_personnel_tenant     on public.exam_personnel (tenant_id);
create index if not exists ix_exam_categories_tenant     on public.exam_categories (tenant_id);
create index if not exists ix_exam_parts_tenant          on public.exam_parts (tenant_id);
create index if not exists ix_exam_processes_tenant      on public.exam_processes (tenant_id);
create index if not exists ix_exam_levels_tenant         on public.exam_levels (tenant_id);
create index if not exists ix_exam_sessions_tenant       on public.exam_sessions (tenant_id);
create index if not exists ix_exam_sessions_date         on public.exam_sessions (tenant_id, exam_date);
create index if not exists ix_exam_applications_tenant   on public.exam_applications (tenant_id);
create index if not exists ix_exam_applications_person   on public.exam_applications (personnel_id);
create index if not exists ix_exam_applications_session  on public.exam_applications (session_id);
create index if not exists ix_exam_results_tenant        on public.exam_results (tenant_id);
create index if not exists ix_exam_results_person        on public.exam_results (personnel_id);
create index if not exists ix_pm_cert_tenant             on public.pm_certifications (tenant_id);
create index if not exists ix_pm_cert_person             on public.pm_certifications (personnel_id);
create index if not exists ix_dm_cert_tenant             on public.dm_certifications (tenant_id);
create index if not exists ix_dm_cert_person             on public.dm_certifications (personnel_id);
create index if not exists ix_exam_annual_targets_tenant on public.exam_annual_targets (tenant_id, target_year);
create index if not exists ix_exam_monthly_results_key   on public.exam_monthly_results (tenant_id, result_year, result_month);
create index if not exists ix_exam_rules_tenant          on public.exam_rules (tenant_id);
create index if not exists ix_exam_import_jobs_tenant    on public.exam_import_jobs (tenant_id);
create index if not exists ix_exam_import_errors_job     on public.exam_import_errors (job_id);
create index if not exists ix_exam_audit_logs_tenant     on public.exam_audit_logs (tenant_id);

-- ============================================================================
-- RLS — 기존 표준(JWT 클레임)과 동일. tenant_id 격리 + 역할 제어.
--   admin  : FOR ALL (CRUD)
--   viewer : FOR SELECT (조회)
--   그 외(maintenance_reporter=하자접수 전용, dorm_manager 등): 정책 없음 → 접근 자동 거부
--   → 하자접수 전용 계정은 시험관리 테이블 조회/등록/수정/삭제 불가(프론트 숨김 + DB 차단 이중).
-- ============================================================================
do $do$
declare
  t text;
  tables text[] := array[
    'exam_personnel','exam_categories','exam_parts','exam_processes','exam_levels',
    'exam_sessions','exam_applications','exam_results','pm_certifications','dm_certifications',
    'exam_annual_targets','exam_monthly_results','exam_rules','exam_import_jobs',
    'exam_import_errors','exam_audit_logs'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id) with check (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_admin_all', t, 'role', 'admin', 'tenant_id', 'role', 'admin', 'tenant_id'
    );

    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format(
      'create policy %I on public.%I for select using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_viewer_select', t, 'role', 'viewer', 'tenant_id'
    );
  end loop;
end
$do$;

commit;

-- ============================================================================
-- 확인 쿼리(선택)
-- ============================================================================
-- (A) 생성된 시험관리 테이블
-- select table_name from information_schema.tables
--  where table_schema='public' and table_name like 'exam\_%' escape '\'
--     or table_name in ('pm_certifications','dm_certifications') order by table_name;
--
-- (B) RLS 활성화/정책 확인
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and (tablename like 'exam\_%' escape '\'
--     or tablename in ('pm_certifications','dm_certifications')) order by tablename, cmd;
