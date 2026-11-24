// license-check — activates/validates a YZ-ERP software license key for one
// device. Public (callable with the project's anon key; no ERP sign-in
// required, since this must work before anyone has logged in, on both the
// desktop and cloud builds). Uses the service-role key internally to read
// and write the license tables, which carry no public RLS policies.
//
// Request body (JSON): { licenseKey: string, deviceId: string, deviceLabel?: string }
//
// Response:
//   ok:true  -> { ok:true, customerName, expiresAt, maxDevices, devicesUsed }
//   ok:false -> { ok:false, reason: 'bad_request'|'invalid'|'inactive'|'expired'|'device_limit'|'server_error', ...summary? }
//
// Rules:
//  - Unknown license key -> invalid. Key the owner turned off -> inactive.
//  - Past expires_at -> expired (summary still included so the app can show
//    the expiry date and device count even while refusing to run).
//  - Device already registered for this license -> refreshes last_seen_at, ok.
//  - New device under max_devices -> registers it, ok.
//  - New device at max_devices already -> device_limit.
//
// Deploy to a new customer's project with:
//   supabase functions deploy license-check --project-ref <ref> --no-verify-jwt=false
// (verify_jwt stays TRUE — it is still callable with the project's own
// publishable/anon key, which is itself a valid JWT.)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ ok: false, reason: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return reply({ ok: false, reason: 'bad_request' }, 400); }

  const licenseKey = String(body?.licenseKey ?? '').trim();
  const deviceId = String(body?.deviceId ?? '').trim();
  const deviceLabel = body?.deviceLabel ? String(body.deviceLabel).slice(0, 200) : null;
  if (!licenseKey || !deviceId) return reply({ ok: false, reason: 'bad_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: license, error: licErr } = await admin
    .from('app_licenses')
    .select('id, customer_name, max_devices, expires_at, active')
    .eq('license_key', licenseKey)
    .maybeSingle();

  if (licErr) return reply({ ok: false, reason: 'server_error' }, 500);
  if (!license) return reply({ ok: false, reason: 'invalid' }, 404);
  if (!license.active) return reply({ ok: false, reason: 'inactive' }, 403);

  const { data: devices, error: devErr } = await admin
    .from('app_license_devices')
    .select('id, device_id')
    .eq('license_id', license.id);
  if (devErr) return reply({ ok: false, reason: 'server_error' }, 500);

  const devicesUsed = devices?.length ?? 0;
  const existing = (devices ?? []).find((d: { device_id: string }) => d.device_id === deviceId);
  const expired = new Date(license.expires_at).getTime() < Date.now();

  const summary = {
    customerName: license.customer_name,
    expiresAt: license.expires_at,
    maxDevices: license.max_devices,
    devicesUsed,
  };

  if (expired) return reply({ ok: false, reason: 'expired', ...summary });

  if (existing) {
    await admin.from('app_license_devices')
      .update({ last_seen_at: new Date().toISOString(), ...(deviceLabel ? { device_label: deviceLabel } : {}) })
      .eq('id', existing.id);
    return reply({ ok: true, ...summary });
  }

  if (devicesUsed >= license.max_devices) {
    return reply({ ok: false, reason: 'device_limit', ...summary });
  }

  const { error: insErr } = await admin.from('app_license_devices').insert({
    license_id: license.id, device_id: deviceId, device_label: deviceLabel,
  });
  if (insErr) return reply({ ok: false, reason: 'server_error' }, 500);

  return reply({ ok: true, ...summary, devicesUsed: devicesUsed + 1 });
});
