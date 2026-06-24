-- ============================================================================
-- 운영 설정(app_settings) 테이블 — 운영시뮬레이션(월 예상 운영비/공실 손실) 등
-- 관리자 설정을 테넌트 단위로 저장하고 모든 기기에서 Realtime 으로 공유. (멱등)
-- ----------------------------------------------------------------------------
-- 구조: tenant_id 당 1행, data jsonb 에 { simCostSettings: {...} } 형태로 저장.
-- ============================================================================

create table if not exists public.app_settings (
  tenant_id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- 로그인 사용자는 조회 가능, 관리자만 수정 가능(앱에서도 admin 만 저장 호출).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_settings' and policyname='app_settings_select') then
    create policy app_settings_select on public.app_settings for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_settings' and policyname='app_settings_admin_write') then
    -- is_admin() SECURITY DEFINER 가 있으면 사용, 없으면 authenticated 전체 허용으로 폴백.
    if exists (select 1 from pg_proc where proname='is_admin') then
      create policy app_settings_admin_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
    else
      create policy app_settings_admin_write on public.app_settings for all to authenticated using (true) with check (true);
    end if;
  end if;
end $$;

-- Realtime publication 등록 + old 행 전파
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
  execute 'alter table public.app_settings replica identity full';
end $$;

-- 확인:
-- select * from public.app_settings;
