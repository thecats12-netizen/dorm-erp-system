-- =====================================================================
-- Supabase Realtime 활성화 스크립트 (실시간 다중 사용자 동기화용)
-- ---------------------------------------------------------------------
-- 목적:
--   App.tsx 의 Realtime 구독(7개 테이블)이 실제로 이벤트를 수신하려면
--   해당 테이블이 supabase_realtime publication 에 등록되어 있어야 합니다.
--   저장소 스키마(supabase-dorm-schema.sql / supabase-operational-schema.sql)
--   에는 publication 등록 구문이 없으므로 이 스크립트로 보완합니다.
--
-- 적용 방법:
--   Supabase Dashboard > SQL Editor 에 붙여넣고 1회 실행 (idempotent).
--   또는 supabase db push 시 마이그레이션으로 포함.
--
-- 주의:
--   - 저장/로드 로직, 인증, 기존 RLS 정책은 변경하지 않습니다.
--   - REPLICA IDENTITY FULL: UPDATE/DELETE 이벤트의 old row 에 tenant_id 등
--     전체 컬럼을 포함시켜, 클라이언트의 tenant_id 필터/삭제 처리가
--     정확히 동작하도록 합니다. (소프트 삭제는 UPDATE 이므로 new row 로도
--     동작하지만, 영구삭제(DELETE) 시 old row 의 tenant_id 가 필요합니다.)
-- =====================================================================

-- 1) Realtime publication 에 7개 테이블 등록 (이미 있으면 건너뜀)
do $$
declare
  t text;
  tables text[] := array[
    'dorms',
    'occupants',
    'new_hires',
    'dorm_contracts',
    'cleaning_reports',
    'defect_requests',
    'inventory_items'
  ];
begin
  -- publication 이 없으면 생성 (Supabase 기본 프로젝트에는 보통 존재)
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;

-- 2) UPDATE/DELETE 이벤트에 old row 전체 포함 (tenant_id 필터 정확도)
alter table public.dorms             replica identity full;
alter table public.occupants         replica identity full;
alter table public.new_hires         replica identity full;
alter table public.dorm_contracts    replica identity full;
alter table public.cleaning_reports  replica identity full;
alter table public.defect_requests   replica identity full;
alter table public.inventory_items   replica identity full;

-- 3) 적용 확인 — 7개 테이블이 모두 나오면 publication 등록 완료
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'dorms','occupants','new_hires','dorm_contracts',
    'cleaning_reports','defect_requests','inventory_items'
  )
order by tablename;

-- 4) REPLICA IDENTITY 확인 — relreplident 가 모두 'f'(full) 이어야 함
select c.relname as table_name, c.relreplident as replica_identity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'dorms','occupants','new_hires','dorm_contracts',
    'cleaning_reports','defect_requests','inventory_items'
  )
order by c.relname;

-- 5) RLS 진단 — Realtime 은 RLS SELECT 정책을 따릅니다.
--    relrowsecurity=true 인 테이블은 authenticated 가 읽을 수 있는 SELECT 정책이 있어야
--    해당 행의 Realtime 이벤트를 수신합니다. (정책을 변경하지 말고 존재 여부만 확인)
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'dorms','occupants','new_hires','dorm_contracts',
    'cleaning_reports','defect_requests','inventory_items'
  )
order by c.relname;

-- 6) RLS 가 켜진 테이블의 SELECT 정책 목록 (수신 가능 역할 확인용)
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'dorms','occupants','new_hires','dorm_contracts',
    'cleaning_reports','defect_requests','inventory_items'
  )
order by tablename, cmd;
