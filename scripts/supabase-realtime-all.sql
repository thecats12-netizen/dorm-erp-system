-- ============================================================================
-- 전체 메뉴 Supabase Realtime 활성화 (Supabase SQL Editor 에 붙여넣어 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 앱은 supabase_realtime 퍼블리케이션의 postgres_changes 를 구독합니다.
-- 아래 테이블을 퍼블리케이션에 추가하고, UPDATE/DELETE 의 old 행 전파를 위해
-- REPLICA IDENTITY FULL 을 설정합니다(soft delete/복구 즉시 반영).
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'dorms',
    'dorm_contracts',
    'occupants',
    'new_hires',
    'inventory_items',
    'defect_requests',
    'cleaning_reports',
    'settlement_records',
    'settlement_items',
    'profiles',
    'audit_logs',
    'military_module_data',
    'app_settings'
  ];
begin
  foreach t in array tables loop
    -- 테이블이 실제 존재할 때만 처리
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      -- 퍼블리케이션에 없으면 추가
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      -- old 행(삭제/이전값) 전파를 위해 REPLICA IDENTITY FULL
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;

-- 확인:
-- select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename;
