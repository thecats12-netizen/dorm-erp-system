-- ============================================================================
-- 시험관리 기준정보 보강 — "그룹", "장비 목록" 전용 신규 테이블만 추가.
-- 기존 exam_* 테이블/컬럼/RLS는 수정하지 않는다(신규 2개 테이블 + RLS만 추가). 재실행 안전(idempotent).
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- 그룹(제품군 하위 기준정보)
create table if not exists public.exam_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  category_id uuid references public.exam_categories(id) on delete set null,
  code text,
  name text not null,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 장비 목록
create table if not exists public.exam_equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  process_id uuid references public.exam_processes(id) on delete set null,
  code text,
  name text not null,
  spec text,
  location text,
  sort_order int,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_exam_groups_tenant on public.exam_groups (tenant_id);
create index if not exists ix_exam_equipment_tenant on public.exam_equipment (tenant_id);

-- RLS (기존 표준과 동일: admin=ALL, viewer=SELECT, 그 외 거부, tenant 격리)
do $do$
declare t text;
begin
  foreach t in array array['exam_groups','exam_equipment'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id) with check (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_admin_all', t, 'role', 'admin', 'tenant_id', 'role', 'admin', 'tenant_id'
    );
    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format(
      'create policy %I on public.%I for select using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_viewer_select', t, 'role', 'viewer', 'tenant_id'
    );
  end loop;
end
$do$;

commit;
