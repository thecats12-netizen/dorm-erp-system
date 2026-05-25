-- Supabase schema for storing per-tenant military module state
-- Run this in your Supabase SQL editor or migration pipeline.

create table if not exists public.military_module_data (
  tenant_id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_military_module_data_tenant_id on public.military_module_data (tenant_id);
