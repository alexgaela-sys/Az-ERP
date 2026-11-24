-- 003_platform_addons.sql
-- ---------------------------------------------------------------------------
-- YZ-ERP — platform add-ons layered on top of the ERP schema itself
-- (001_erp_store.sql): a hardening fix, the software-licensing tables, and
-- automatic daily backups of the cloud data. These are product-platform
-- concerns (how the YZ-ERP *app* is sold/run), not ERP business data, which
-- is why they live in their own file instead of inside 001.
--
-- Idempotent: safe to run more than once. Run it in: Supabase Dashboard ->
-- SQL Editor, AFTER 001_erp_store.sql has been applied.
--
-- Requires the pg_cron extension (created below) — on Supabase this needs
-- no special plan/add-on, it's available on every project.
-- ---------------------------------------------------------------------------

begin;

-- 1) Search-path hardening for a trigger function from 001 (defence in depth
--    against search_path hijacking; functional behavior is unchanged).
alter function public.erp_members_block_client_writes() set search_path = public, pg_temp;

-- 2) Software activation/licensing for the YZ-ERP app itself (desktop + cloud
--    builds alike) — separate from the ERP's own business data (erp_* tables).
--    Only the license-check Edge Function (service role) ever reads or writes
--    these tables; RLS is enabled with zero policies so neither the anon key
--    nor any signed-in ERP user can read or alter licenses directly.
create table if not exists public.app_licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  customer_name text not null,
  max_devices integer not null check (max_devices > 0),
  expires_at timestamptz not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.app_licenses(id) on delete cascade,
  device_id text not null,
  device_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, device_id)
);

create index if not exists app_license_devices_license_id_idx
  on public.app_license_devices(license_id);

alter table public.app_licenses enable row level security;
alter table public.app_license_devices enable row level security;
-- No policies created: table is reachable only via the service-role key
-- inside the license-check Edge Function.

-- 3) pg_cron, needed for the automatic daily backup job below.
create extension if not exists pg_cron with schema extensions;

-- 4) Automatic daily snapshots of the ERP's cloud data (erp_records), so a
--    bad import/edit or any unforeseen data corruption has a recent,
--    restorable point to go back to — on top of whatever Supabase's own
--    infrastructure backups already provide. RLS enabled with zero policies
--    (same pattern as app_licenses): reachable only via the service-role
--    key, i.e. the cron job below and, if ever needed, a manual SQL restore
--    by the owner.
create table if not exists public.app_backups (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  record_count integer not null,
  records jsonb not null
);

create index if not exists app_backups_taken_at_idx on public.app_backups(taken_at desc);

alter table public.app_backups enable row level security;
-- No policies: reachable only via the service-role key (the cron job, or a
-- manual SQL restore run by the owner). Never exposed to the app itself.

create or replace function public.take_erp_backup() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_backups (record_count, records)
  select count(*), coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from public.erp_records r;

  -- Keep a rolling ~35 days of daily snapshots.
  delete from public.app_backups
  where taken_at < now() - interval '35 days';
end;
$$;

-- cron.schedule() is not idempotent by name — unschedule first so re-running
-- this file never errors or double-schedules the job.
do $$
begin
  perform cron.unschedule('erp-daily-backup');
exception when others then
  null; -- job didn't exist yet — fine on a fresh project
end $$;

select cron.schedule(
  'erp-daily-backup',
  '30 1 * * *', -- 01:30 UTC ≈ 03:30 Cairo time (low activity)
  $$select public.take_erp_backup();$$
);

commit;

-- Take one snapshot right now, so there's already a restore point today
-- rather than waiting for the first scheduled run (outside the transaction —
-- same reasoning as 001_erp_store.sql's own post-commit steps).
select public.take_erp_backup();
