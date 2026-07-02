-- ============================================================================
-- 입주전 점검 테이블 (Supabase SQL Editor 에서 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 운영관리 > 입주전 점검 메뉴용. 기숙사 계약 후 신입사원 입주 전 방 상태를 사진으로
-- 기록/증빙한다. 사진은 photos jsonb 에 [{category, description, dataUrl(base64)}] 로 저장
-- (기존 청소/하자 사진 저장 방식과 동일 — 별도 Storage 없이 동작).
-- service_role_key 는 사용하지 않는다(클라이언트 anon key + 아래 RLS). tenant_id 로 분리.
-- ============================================================================

create table if not exists public.pre_move_in_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  dorm_id uuid,
  contract_id uuid,
  occupant_id uuid,
  inspection_date date,
  region text default '',
  gender text default '',
  building_name text default '',
  dong text default '',
  room text default '',
  address text default '',
  contract_start_date date,
  contract_end_date date,
  landlord_name text default '',
  expected_move_in_name text default '',
  expected_move_in_phone text default '',
  expected_move_in_dept text default '',
  expected_move_in_date date,
  inspector_name text default '',
  inspection_status text default '점검대기',
  cleaning_status text default '양호',
  facility_status text default '양호',
  supply_status text default '양호',
  has_defect boolean default false,
  defect_description text default '',
  action_required text default '',
  memo text default '',
  photos jsonb default '[]'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_deleted boolean default false,
  deleted_at timestamptz,
  deleted_by text,
  is_permanent_deleted boolean default false,
  permanent_deleted_at timestamptz,
  permanent_deleted_by text
);

-- 조회 성능 인덱스
create index if not exists idx_pmi_tenant on public.pre_move_in_inspections (tenant_id);
create index if not exists idx_pmi_dorm on public.pre_move_in_inspections (dorm_id);
create index if not exists idx_pmi_inspection_date on public.pre_move_in_inspections (inspection_date desc);

-- ----------------------------------------------------------------------------
-- Realtime 활성화: 다른 기기의 등록/수정/삭제가 새로고침 없이 반영되려면 필수.
-- (Dashboard: Database → Replication → supabase_realtime 에 이 테이블 추가와 동일)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pre_move_in_inspections'
  ) then
    alter publication supabase_realtime add table public.pre_move_in_inspections;
  end if;
end $$;

-- DELETE 이벤트에서 old row 의 id/tenant_id 를 받으려면 REPLICA IDENTITY FULL 권장
-- (소프트 삭제는 UPDATE 라 불필요하나, 하드 DELETE 대비).
alter table public.pre_move_in_inspections replica identity full;

-- ----------------------------------------------------------------------------
-- RLS: 로그인(authenticated) 사용자에게 CRUD 허용. 다른 운영 테이블과 동일 정책 수준.
-- (프로젝트가 tenant 필터 없이 조회하므로 tenant 단위 세분화는 앱 레벨에서 처리)
-- ----------------------------------------------------------------------------
alter table public.pre_move_in_inspections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pre_move_in_inspections'
      and policyname = 'pmi_authenticated_all'
  ) then
    create policy pmi_authenticated_all
      on public.pre_move_in_inspections
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (선택) Supabase Storage 버킷 — 사진을 base64 대신 파일로 저장하고 싶을 때만 사용.
-- 현재 앱은 photos jsonb(base64)로 동작하므로 필수 아님.
-- ----------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public)
--   values ('inspection-photos', 'inspection-photos', false)
--   on conflict (id) do nothing;
--
-- create policy "inspection-photos authenticated rw"
--   on storage.objects for all to authenticated
--   using (bucket_id = 'inspection-photos')
--   with check (bucket_id = 'inspection-photos');
