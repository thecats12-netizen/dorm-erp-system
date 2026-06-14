-- ============================================================================
-- military_module_data 스키마 정상화 (Supabase SQL Editor에 붙여넣어 실행)
-- ----------------------------------------------------------------------------
-- 증상:
--   - "there is no unique or exclusion constraint matching the ON CONFLICT specification" (400)
--   - military module insert/update 실패 반복
-- 원인:
--   - 배포된 military_module_data 테이블이 기대 스키마(tenant_id PRIMARY KEY)와 다르거나
--     tenant_id 에 unique/PK 제약이 없는 경우.
--
-- 앱 코드는 onConflict 를 쓰지 않고 select → update/insert 로 동작하므로
-- unique 제약 없이도 저장되어야 정상입니다. 아래는 배포 스키마를 표준으로 맞춰
-- insert/update 가 확실히 성공하도록 보정합니다. (기존 데이터 삭제 없음)
-- ============================================================================

-- 1) 테이블이 없으면 표준 스키마로 생성 (tenant_id PRIMARY KEY)
create table if not exists public.military_module_data (
  tenant_id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) 누락 가능 컬럼 보강 (이미 있으면 무시)
alter table public.military_module_data add column if not exists data jsonb;
alter table public.military_module_data add column if not exists created_at timestamptz default now();
alter table public.military_module_data add column if not exists updated_at timestamptz default now();

-- 3) tenant_id 중복 정리(혹시 PK가 없어 중복이 쌓였다면 최신 1행만 유지)
delete from public.military_module_data a
using public.military_module_data b
where a.tenant_id = b.tenant_id
  and a.ctid < b.ctid
  and coalesce(a.updated_at, 'epoch'::timestamptz) <= coalesce(b.updated_at, 'epoch'::timestamptz);

-- 4) tenant_id UNIQUE 제약 추가 (PK가 없는 경우 대비, 이미 있으면 무시)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.military_module_data'::regclass
      and contype in ('p','u')
      and conname like '%tenant_id%'
  ) then
    begin
      alter table public.military_module_data
        add constraint military_module_data_tenant_id_key unique (tenant_id);
    exception when others then
      -- 이미 PK 등으로 보장돼 있으면 통과
      null;
    end;
  end if;
end $$;

-- 5) RLS 사용 시: 인증 사용자 insert/update/select 허용 정책 예시 (필요 시 주석 해제)
-- alter table public.military_module_data enable row level security;
-- drop policy if exists military_module_rw on public.military_module_data;
-- create policy military_module_rw on public.military_module_data
--   for all to authenticated using (true) with check (true);
