-- ============================================================================
-- audit_logs(변경이력) 스키마 보정 + RLS (Supabase SQL Editor 에 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 증상: 운영 모듈 저장 시 audit_logs POST 500 반복.
-- 원인: id PK/unique 부재로 upsert(on_conflict=id) 실패, 또는 컬럼 누락.
-- 조치: id uuid PK 보장 + 앱이 기록하는 컬럼 + 요청 스키마 컬럼을 모두 보강하고
--       admin 만 insert/select 가능한 RLS 를 적용. (앱은 plain insert 사용)
-- ============================================================================

-- 1) 테이블 생성(없으면)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  -- 앱(현재 코드)이 기록하는 컬럼
  target_type text,
  target_id text,
  action_type text,
  changed_by text,
  changed_at timestamptz,
  before_value text,
  after_value text,
  memo text,
  changes jsonb default '[]'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- 요청 스키마(호환용 추가 컬럼, nullable)
  action text,
  module text,
  target_name text,
  user_id uuid,
  user_name text,
  details jsonb default '{}'::jsonb
);

-- 2) 기존 배포에 누락된 컬럼 보강(멱등)
alter table public.audit_logs add column if not exists tenant_id text;
alter table public.audit_logs add column if not exists target_type text;
alter table public.audit_logs add column if not exists target_id text;
alter table public.audit_logs add column if not exists action_type text;
alter table public.audit_logs add column if not exists changed_by text;
alter table public.audit_logs add column if not exists changed_at timestamptz;
alter table public.audit_logs add column if not exists before_value text;
alter table public.audit_logs add column if not exists after_value text;
alter table public.audit_logs add column if not exists memo text;
alter table public.audit_logs add column if not exists changes jsonb default '[]'::jsonb;
alter table public.audit_logs add column if not exists created_by text;
alter table public.audit_logs add column if not exists updated_by text;
alter table public.audit_logs add column if not exists created_at timestamptz default now();
alter table public.audit_logs add column if not exists updated_at timestamptz default now();
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists module text;
alter table public.audit_logs add column if not exists target_name text;
alter table public.audit_logs add column if not exists user_id uuid;
alter table public.audit_logs add column if not exists user_name text;
alter table public.audit_logs add column if not exists details jsonb default '{}'::jsonb;

-- 3) id 를 PK 로 보장(이미 PK 면 무시). id 가 null 인 기존 행은 채운 뒤 PK 설정.
do $$
begin
  update public.audit_logs set id = gen_random_uuid() where id is null;
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'audit_logs' and c.contype = 'p'
  ) then
    alter table public.audit_logs add primary key (id);
  end if;
exception when others then
  raise notice 'audit_logs PK 설정 생략: %', sqlerrm;
end $$;

-- 4) RLS: admin 만 insert/select. is_admin() SECURITY DEFINER 가 있으면 사용.
alter table public.audit_logs enable row level security;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_admin') then
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_admin_select') then
      create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.is_admin());
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_admin_insert') then
      create policy audit_logs_admin_insert on public.audit_logs for insert to authenticated with check (public.is_admin());
    end if;
  else
    -- is_admin() 미배포 환경 폴백: 로그인 사용자 허용(앱에서 admin 만 호출).
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_auth_select') then
      create policy audit_logs_auth_select on public.audit_logs for select to authenticated using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_auth_insert') then
      create policy audit_logs_auth_insert on public.audit_logs for insert to authenticated with check (true);
    end if;
  end if;
end $$;

-- 확인:
-- select column_name from information_schema.columns where table_schema='public' and table_name='audit_logs';
-- select polname, cmd from pg_policies where tablename='audit_logs';
