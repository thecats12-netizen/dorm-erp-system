-- ============================================================================
-- military_module_data Realtime 활성화 — 군대관리 데이터 기기 간 실시간 동기화
-- (Supabase SQL Editor 에 붙여넣어 실행. 데이터/구조 변경 없음. 멱등)
-- ----------------------------------------------------------------------------
-- 앱은 supabase_realtime 퍼블리케이션의 postgres_changes 를 구독합니다.
-- military_module_data 가 퍼블리케이션에 없으면 다른 기기의 변경이 실시간 전파되지 않습니다.
-- 아래로 테이블을 퍼블리케이션에 추가합니다(이미 있으면 무시).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'military_module_data'
  ) then
    alter publication supabase_realtime add table public.military_module_data;
  end if;
end $$;

-- UPDATE/DELETE 시 이전 행(old) 정보가 필요하면 REPLICA IDENTITY FULL 권장(블롭 1행 구조라 선택).
alter table public.military_module_data replica identity full;

-- 확인:
-- select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='military_module_data';
