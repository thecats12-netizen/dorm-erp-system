-- ============================================================================
-- 자동 라이선스 관리 — employee_license_plan(직원별 라이선스 진행계획) 신규 테이블 + exam_rules 보강
--
-- [원칙] 기존 시험관리 테이블/컬럼/데이터/RLS/함수/트리거는 절대 수정하지 않는다.
--   · 신규 테이블 public.employee_license_plan 1개만 생성한다.
--   · exam_rules 에는 없는 컬럼(required_months) 1개만 add column if not exists 로 추가한다.
--   · 재실행 안전(idempotent): create ... if not exists / add column if not exists / drop policy if exists.
--
-- [멀티테넌트/표준] tenant_id text default 'default', 사용자 참조 uuid, soft delete(deleted_at)+is_active,
--   RLS 는 기존 exam_* 표준과 동일(JWT 클레임 auth.jwt()->>'role'/'tenant_id').
--
-- ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행. 롤백/검증 파일 동봉.
--   선행: 20260712000000_create_exam_management.sql, 20260714040000_exam_rules_columns.sql
-- ============================================================================

begin;

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- 1) 인증 기준관리(exam_rules) — 취득 기한(개월) 컬럼 추가. 관리자가 화면에서 수정 가능한 값.
--    기존 컬럼(min_tenure_months=최소 재직기간, valid_months=유효기간)과 별개의 "취득해야 하는 기한(개월)".
-- ─────────────────────────────────────────────────────────────
alter table public.exam_rules
  add column if not exists required_months int;   -- 취득 기한(개월): 입사일/선행취득일 기준 +N개월 = 목표취득일

comment on column public.exam_rules.required_months is '취득 기한(개월). 목표취득일 = 기준일(입사일 또는 선행 인증 취득일) + required_months 개월. 하드코딩 금지, 관리자 수정 가능.';

-- required_months 음수 방지(재실행 안전 — 제약이 없을 때만 추가).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'exam_rules_required_months_nonneg') then
    alter table public.exam_rules
      add constraint exam_rules_required_months_nonneg check (required_months is null or required_months >= 0);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2) employee_license_plan — 직원별 라이선스 단계 진행계획(신규)
--    한 직원의 각 라이선스 단계(Single→M1→…→PM→DM)마다 1행. 순서/상태/목표취득일을 관리한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.employee_license_plan (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default 'default',
  organization_id  text,                                                        -- 기존 exam_* 표준(선택)
  employee_id      uuid not null references public.exam_personnel(id) on delete cascade,
  license_level    text not null,                                               -- 라이선스 단계 코드(Single/M1/M2/M3/M4/PM/DM 등, exam_levels 기준)
  rule_id          uuid references public.exam_rules(id) on delete set null,    -- 이 단계 생성/기한 계산에 사용한 인증 규칙
  status           text not null default 'waiting'
                     check (status in ('waiting','active','completed','expired','cancel')),
  join_date        date,                                                        -- 입사일(계산 기준, 첫 단계)
  base_date        date,                                                        -- 이 단계 기준일(첫=입사일, 후속=직전 취득일). 미확정이면 null → waiting 유지
  target_date      date,                                                        -- 목표취득일(기준일 + required_months 개월)
  completed_date   date,                                                        -- 실제 취득 완료일
  required_months  int check (required_months is null or required_months >= 0), -- 이 단계 취득 기한(개월) — 음수 금지
  previous_license text,                                                        -- 직전 단계 코드(선행)
  next_license     text,                                                        -- 다음 단계 코드
  -- 표준 감사/소프트삭제 컬럼(다른 exam_* 테이블과 동일 패턴 — RLS/이력 일관성용)
  is_active        boolean not null default true,
  deleted_at       timestamptz,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.employee_license_plan is '직원별 라이선스 단계 진행계획(자동 라이선스 관리). 한 직원의 각 단계마다 1행. 기존 시험관리 기능과 독립적으로 추가된 확장 테이블.';

-- 이미 테이블이 생성된 환경(구버전 적용분)에도 base_date 컬럼과 음수 제약이 반영되도록 idempotent 보강.
alter table public.employee_license_plan add column if not exists base_date date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employee_license_plan_required_months_nonneg') then
    alter table public.employee_license_plan
      add constraint employee_license_plan_required_months_nonneg check (required_months is null or required_months >= 0);
  end if;
end $$;

-- 한 직원 + 동일 단계는 1건(soft delete 미삭제 기준)
create unique index if not exists ux_emp_license_plan_emp_level
  on public.employee_license_plan (tenant_id, employee_id, license_level) where deleted_at is null;

-- 조회 성능
create index if not exists ix_emp_license_plan_tenant   on public.employee_license_plan (tenant_id);
create index if not exists ix_emp_license_plan_employee on public.employee_license_plan (employee_id);
create index if not exists ix_emp_license_plan_status   on public.employee_license_plan (tenant_id, status);
create index if not exists ix_emp_license_plan_target   on public.employee_license_plan (tenant_id, target_date);

-- updated_at 자동 갱신(기존 exam_* 는 앱에서 갱신하지만, 매일 배치/직접수정 대비 트리거 1개 추가 — 신규 테이블 한정).
create or replace function public.set_emp_license_plan_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_emp_license_plan_updated_at on public.employee_license_plan;
create trigger trg_emp_license_plan_updated_at
  before update on public.employee_license_plan
  for each row execute function public.set_emp_license_plan_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3) RLS — 기존 exam_* 표준과 동일(admin FOR ALL / viewer FOR SELECT, JWT 클레임 + tenant 격리).
--    그 외 역할(하자접수/기숙사 담당 등)은 정책 없음 → 접근 자동 거부.
-- ─────────────────────────────────────────────────────────────
alter table public.employee_license_plan enable row level security;

drop policy if exists exam_admin_all on public.employee_license_plan;
create policy exam_admin_all on public.employee_license_plan
  for all
  using  (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id)
  with check (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id);

drop policy if exists exam_viewer_select on public.employee_license_plan;
create policy exam_viewer_select on public.employee_license_plan
  for select
  using (auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id);

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- 완료. 재실행 안전. 기존 데이터/기능 무변경(신규 테이블 + 컬럼 1개만 추가).
-- ============================================================================
