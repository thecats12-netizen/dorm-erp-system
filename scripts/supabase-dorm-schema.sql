-- ============================================================
-- Supabase schema for dorm core data
-- dorms, occupants, dorm_contracts, new_hires
-- ============================================================

create table if not exists public.dorms (
  id text primary key,
  tenant_id text not null default 'default',
  site text not null,
  gender text not null,
  building_name text not null,
  address text,
  dong text,
  room_ho text,
  pyeong text,
  capacity int,
  manager_user_id uuid,
  contract_start timestamptz,
  contract_end timestamptz,
  contract_amount text,
  lease_status text,
  shared_entry text,
  unit_entry text,
  prepayment_deposit numeric,
  real_estate_name text,
  balance_date text,
  notes text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.occupants (
  id text primary key,
  tenant_id text not null default 'default',
  dorm_id text not null,
  site text not null,
  employee_name text,
  gender text,
  department text,
  phone text,
  move_in_date timestamptz,
  move_out_due_date timestamptz,
  status text,
  is_new_hire_assignment boolean not null default false,
  notes text,
  expected_move_in_date timestamptz,
  expected_move_out_date timestamptz,
  actual_move_out_date timestamptz,
  source_new_hire_id text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dorm_contracts (
  id text primary key,
  tenant_id text not null default 'default',
  site text not null,
  address text,
  building_name text,
  dong text,
  room_ho text,
  pyeong text,
  landlord_name text,
  landlord_phone text,
  real_estate_name text,
  real_estate_phone text,
  shared_entry text,
  unit_entry text,
  contract_start timestamptz,
  contract_end timestamptz,
  contract_status text,
  contract_amount text,
  prepayment_deposit text,
  deposit text,
  monthly_rent_or_maintenance text,
  contract_type text,
  gender text,
  notes text,
  registered_by text,
  modified_by text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.new_hires (
  id text primary key,
  tenant_id text not null default 'default',
  site text not null,
  gender text,
  name text,
  phone text,
  department text,
  dorm_id text,
  address text,
  building_name text,
  dong text,
  room_ho text,
  pyeong text,
  shared_entry text,
  unit_entry text,
  expected_move_in_date timestamptz,
  move_in_date timestamptz,
  expected_move_out_date timestamptz,
  move_out_date timestamptz,
  actual_move_out_date timestamptz,
  cheonan_move_date timestamptz,
  residence_status text,
  move_in_type text,
  extension_reason text,
  notes text,
  manager_user_id uuid,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Triggers to update updated_at
create or replace function public.update_timestamp()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_dorms_updated_at on public.dorms;
create trigger update_dorms_updated_at
  before update on public.dorms
  for each row execute function public.update_timestamp();

drop trigger if exists update_occupants_updated_at on public.occupants;
create trigger update_occupants_updated_at
  before update on public.occupants
  for each row execute function public.update_timestamp();

drop trigger if exists update_dorm_contracts_updated_at on public.dorm_contracts;
create trigger update_dorm_contracts_updated_at
  before update on public.dorm_contracts
  for each row execute function public.update_timestamp();

drop trigger if exists update_new_hires_updated_at on public.new_hires;
create trigger update_new_hires_updated_at
  before update on public.new_hires
  for each row execute function public.update_timestamp();

-- Enable RLS on tables
alter table public.dorms enable row level security;
alter table public.occupants enable row level security;
alter table public.dorm_contracts enable row level security;
alter table public.new_hires enable row level security;

-- Admin full access
create policy "dorms_admin_all" on public.dorms for all using (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
) with check (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "occupants_admin_all" on public.occupants for all using (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
) with check (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "dorm_contracts_admin_all" on public.dorm_contracts for all using (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
) with check (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "new_hires_admin_all" on public.new_hires for all using (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
) with check (
  auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id
);

-- Viewer select-only
create policy "dorms_viewer_select" on public.dorms for select using (
  auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "occupants_viewer_select" on public.occupants for select using (
  auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "dorm_contracts_viewer_select" on public.dorm_contracts for select using (
  auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id
);

create policy "new_hires_viewer_select" on public.new_hires for select using (
  auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id
);

-- Dorm manager select/update own dorm rows
create policy "dorms_dorm_manager_select" on public.dorms for select using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and id = auth.jwt() ->> 'dorm_id'
);

create policy "dorms_dorm_manager_update" on public.dorms for update using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and id = auth.jwt() ->> 'dorm_id'
) with check (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and id = auth.jwt() ->> 'dorm_id'
);

create policy "occupants_dorm_manager_select" on public.occupants for select using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

create policy "occupants_dorm_manager_update" on public.occupants for update using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
) with check (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

create policy "new_hires_dorm_manager_select" on public.new_hires for select using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

create policy "new_hires_dorm_manager_update" on public.new_hires for update using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
) with check (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

-- Dorm manager contract visibility by tenant and site
create policy "dorm_contracts_dorm_manager_select" on public.dorm_contracts for select using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and site = auth.jwt() ->> 'site_access'
);

create policy "dorm_contracts_dorm_manager_update" on public.dorm_contracts for update using (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and site = auth.jwt() ->> 'site_access'
) with check (
  auth.jwt() ->> 'role' = 'dorm_manager'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and site = auth.jwt() ->> 'site_access'
);

-- Maintenance reporter select-only own dorm records
create policy "dorms_reporter_select" on public.dorms for select using (
  auth.jwt() ->> 'role' = 'maintenance_reporter'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and id = auth.jwt() ->> 'dorm_id'
);

create policy "occupants_reporter_select" on public.occupants for select using (
  auth.jwt() ->> 'role' = 'maintenance_reporter'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

create policy "new_hires_reporter_select" on public.new_hires for select using (
  auth.jwt() ->> 'role' = 'maintenance_reporter'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and dorm_id = auth.jwt() ->> 'dorm_id'
);

create policy "dorm_contracts_reporter_select" on public.dorm_contracts for select using (
  auth.jwt() ->> 'role' = 'maintenance_reporter'
  and auth.jwt() ->> 'tenant_id' = tenant_id
  and site = auth.jwt() ->> 'site_access'
);
