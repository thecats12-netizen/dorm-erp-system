-- ============================================================================
-- 영구삭제(완전삭제) 숨김 컬럼 추가 (Supabase SQL Editor 에 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 증상: 휴지통에서 "영구삭제" 한 항목이 새로고침/재접속 후 잠깐 보였다 사라지거나
--       다시 나타남.
-- 원인: 기존 영구삭제는 로컬 state 에서만 제거 → Supabase 재조회 시 isDeleted 행이
--       그대로 돌아옴.
-- 해결: 실제 삭제 대신 is_permanent_deleted=true 로 숨김 처리(soft). 화면은
--       isDeleted=true AND is_permanent_deleted!=true 인 항목만 휴지통에 표시.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'dorms', 'occupants', 'dorm_contracts', 'new_hires',
    'inventory_items', 'cleaning_reports', 'defect_requests'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I add column if not exists is_permanent_deleted boolean default false;', t);
    execute format('alter table public.%I add column if not exists permanent_deleted_at timestamptz;', t);
    execute format('alter table public.%I add column if not exists permanent_deleted_by text;', t);
  end loop;
end $$;

-- 군대관리 인원/훈련기록은 military_module_data(jsonb 스냅샷)에 저장되므로 컬럼 추가 불필요.

-- 확인:
-- select table_name, column_name from information_schema.columns
--   where table_schema='public' and column_name like 'permanent_deleted%'
--   order by table_name, column_name;
