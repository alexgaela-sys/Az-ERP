-- Issue a new YZ-ERP software license key, or renew/change an existing one.
-- Run this directly on the project's SQL editor (or via the Supabase MCP
-- `execute_sql` tool) — licenses are issued manually by the owner, never by
-- the app itself. See src/services/license.ts and
-- supabase/functions/license-check/index.ts for how a license is checked.
--
-- One license key = one customer. It allows up to `max_devices` separate
-- installations (desktop or cloud alike — counted together) until
-- `expires_at`. A customer outgrowing their device count, or renewing past
-- the expiry date, gets the SAME key updated in place (see the "renew"
-- block below) — devices already registered keep working with no changes
-- needed on their side.

-- ============================================================
-- 1) Issue a brand-new license
-- ============================================================
-- Replace the three values, then run. gen_random_uuid() keeps the key
-- unguessable; format it however you like for readability when you hand it
-- to the customer.
insert into public.app_licenses (license_key, customer_name, max_devices, expires_at)
values (
  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),  -- e.g. 'A1B2C3D4E5F6A7B8' — reformat with dashes if you like
  'اسم العميل هنا',
  5,                               -- max_devices
  now() + interval '365 days'      -- expires_at
)
returning license_key, customer_name, max_devices, expires_at;

-- ============================================================
-- 2) Renew / change an existing license (same key keeps working everywhere)
-- ============================================================
-- update public.app_licenses
-- set expires_at = now() + interval '365 days',
--     max_devices = 5,
--     active = true,
--     updated_at = now()
-- where license_key = 'THE-EXISTING-KEY';

-- ============================================================
-- 3) Revoke a license immediately (blocks all its devices on their next check)
-- ============================================================
-- update public.app_licenses set active = false, updated_at = now()
-- where license_key = 'THE-KEY-TO-REVOKE';

-- ============================================================
-- 4) Free up a device slot (e.g. a customer replaced a computer)
-- ============================================================
-- delete from public.app_license_devices
-- where license_id = (select id from public.app_licenses where license_key = 'THE-KEY')
--   and device_label ilike '%old device hint%';

-- ============================================================
-- 5) Check current status for a key
-- ============================================================
-- select l.license_key, l.customer_name, l.max_devices, l.expires_at, l.active,
--        count(d.id) as devices_used
-- from public.app_licenses l
-- left join public.app_license_devices d on d.license_id = l.id
-- where l.license_key = 'THE-KEY'
-- group by l.id;
