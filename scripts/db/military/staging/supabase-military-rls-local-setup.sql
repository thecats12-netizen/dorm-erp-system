-- ============================================================================
-- 군대관리 v2 RLS 검증 — LOCAL / STAGING 전용 셋업 (⚠ PRODUCTION 실행 절대 금지)
-- 목적: Production 구조(military_module_data + 기존 broad 정책 2개)를 로컬에 재현해
--       "기존 → 신규" 정책 교체를 안전하게 검증하기 위한 최소 스키마 + 가짜 데이터.
-- 실행 위치: 로컬 `supabase start` DB 또는 별도 staging 프로젝트의 SQL Editor.
-- 개인정보 금지: 실제 이름/전화/생년월일/군번/계좌/이메일 절대 사용 금지(전부 dummy).
-- ============================================================================

-- ── profiles: 기존 프로젝트에 이미 있으면 이 블록은 건너뛰어도 됨(테스트 최소 구조) ──
create table if not exists public.profiles (
  id uuid primary key,
  role text,
  is_active boolean default true
);

-- ── military_module_data: Production 확인 구조와 동일(id text PK · tenant_id UNIQUE 없음) ──
create table if not exists public.military_module_data (
  id text primary key default gen_random_uuid()::text,
  tenant_id text not null,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by uuid
);
alter table public.military_module_data enable row level security;

-- ── 기존 Production broad 정책 재현(교체 대상) ──
drop policy if exists military_module_data_admin_all on public.military_module_data;
drop policy if exists military_module_data_select    on public.military_module_data;
create policy military_module_data_admin_all on public.military_module_data
  for all to authenticated using (tenant_id = 'default') with check (tenant_id = 'default');
create policy military_module_data_select on public.military_module_data
  for select to authenticated using (tenant_id = 'default');

-- ── 가짜 데이터 1행(tenant_id='default') · 명백한 dummy 값만 ──
insert into public.military_module_data (tenant_id, data)
select 'default', jsonb_build_object(
  'militaryPersonnel', jsonb_build_array(
    jsonb_build_object('id','dummy-p1','name','더미대상A','unit','1테스트부서','rank','더미','phone','010-0000-0001','birthDate','1990-01-01','status','재직'),
    jsonb_build_object('id','dummy-p2','name','더미대상B','unit','2테스트부서','rank','더미','phone','010-0000-0002','birthDate','1991-02-02','status','재직')),
  'militaryTrainingRecords', jsonb_build_array(
    jsonb_build_object('id','dummy-t1','personnelId','dummy-p1','subject','더미훈련','trainingDate','2026-08-10','status','예정')),
  'militaryNotices', jsonb_build_array(
    jsonb_build_object('id','dummy-n1','personnelIds', jsonb_build_array('dummy-p1'),'title','더미통보','sentStatus','미발송')),
  'militaryReports', jsonb_build_array(),
  'militarySettings', '{}'::jsonb)
where not exists (select 1 from public.military_module_data where tenant_id = 'default');

-- ── 테스트 계정 profiles seed 안내(auth.users.id 와 동일 UUID 로 채워 넣으세요) ──
-- Local Studio → Authentication → Users 에서 6개 계정 생성 후, 그 UUID 로 아래를 채움:
--   insert into public.profiles(id, role, is_active) values
--     ('<admin_active_uid>',    'admin',                true),
--     ('<viewer_active_uid>',   'viewer',               true),
--     ('<dorm_active_uid>',     'dorm_manager',         true),
--     ('<maint_active_uid>',    'maintenance_reporter', true),
--     ('<admin_inactive_uid>',  'admin',                false),
--     ('<viewer_inactive_uid>', 'viewer',               false)
--   on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
