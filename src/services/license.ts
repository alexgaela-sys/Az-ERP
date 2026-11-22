// Software activation/licensing for the YZ-ERP app itself — separate from
// the ERP's own business data and from Supabase sign-in. Applies identically
// to BOTH builds (desktop/Electron and cloud/PWA): both read the same public
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see services/cloud/
// supabaseHttpStore.ts's readSupabaseConfigFromEnv — the desktop build keeps
// these two values even though it turns VITE_ERP_STORAGE off, see
// .env.desktop), and both call the same public `license-check` Edge Function.
//
// The owner issues one license key per customer (manually, via Supabase SQL —
// see supabase/scripts/issue-license.sql), stamped with an expiry date and a
// maximum number of devices. Each installation generates and keeps its own
// random device id (not a hardware fingerprint — simple and stable, and the
// owner controls how many of them a given key may claim).
//
// Online, every check is authoritative. Offline, a device that activated
// successfully before keeps working for a grace period (so a short outage
// never blocks a cashier mid-sale — the same philosophy as cloud/offlineCache.ts),
// then must reach the server again to keep running.

const STATE_KEY = 'yz_erp_license_v1';
const DEVICE_ID_KEY = 'yz_erp_device_id';
const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days offline tolerance between successful checks

export type LicenseFailureReason =
  | 'bad_request'
  | 'invalid'
  | 'inactive'
  | 'expired'
  | 'device_limit'
  | 'server_error'
  | 'network_error';

export interface LicenseSummary {
  customerName: string;
  expiresAt: string; // ISO
  maxDevices: number;
  devicesUsed: number;
}

export interface LicenseState {
  licenseKey: string;
  summary: LicenseSummary | null;
  /** Result of the most recent check, whatever it was. */
  lastReason: LicenseFailureReason | null;
  lastOk: boolean;
  /** epoch ms of the most recent check attempt (ok or not) */
  lastCheckedAt: number | null;
  /** epoch ms of the most recent check that succeeded */
  lastOkAt: number | null;
}

function readJson<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort only
  }
}

/** A random id generated once per installation and kept forever (not a hardware fingerprint). */
export function getDeviceId(): string {
  let id = '';
  try {
    id = (typeof localStorage !== 'undefined' && localStorage.getItem(DEVICE_ID_KEY)) || '';
  } catch {
    id = '';
  }
  if (id) return id;
  try {
    id = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() || '';
  } catch {
    id = '';
  }
  if (!id) id = `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* best-effort only */ }
  return id;
}

export function readLicenseState(): LicenseState | null {
  return readJson<LicenseState>(STATE_KEY);
}

function writeLicenseState(state: LicenseState) {
  writeJson(STATE_KEY, state);
}

export function clearLicenseState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
}

function deviceLabel(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isElectron = /Electron/i.test(ua);
    return `${isElectron ? 'Desktop' : 'Web'} · ${ua.slice(0, 120)}`;
  } catch {
    return 'unknown device';
  }
}

interface CheckResult {
  ok: boolean;
  reason: LicenseFailureReason | null;
  summary: LicenseSummary | null;
}

/** Calls the server. Never throws — network/parse failures come back as { ok:false, reason:'network_error' }. */
async function callLicenseCheck(licenseKey: string, cfg: { url: string; anonKey: string }): Promise<CheckResult> {
  try {
    const res = await fetch(`${cfg.url}/functions/v1/license-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.anonKey}`,
        apikey: cfg.anonKey,
      },
      body: JSON.stringify({ licenseKey, deviceId: getDeviceId(), deviceLabel: deviceLabel() }),
    });
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return { ok: false, reason: 'network_error', summary: null };
    const summary: LicenseSummary | null =
      typeof data.customerName === 'string' && typeof data.expiresAt === 'string'
        ? {
            customerName: data.customerName,
            expiresAt: data.expiresAt,
            maxDevices: Number(data.maxDevices) || 0,
            devicesUsed: Number(data.devicesUsed) || 0,
          }
        : null;
    if (data.ok === true) return { ok: true, reason: null, summary };
    return { ok: false, reason: (data.reason as LicenseFailureReason) || 'server_error', summary };
  } catch {
    return { ok: false, reason: 'network_error', summary: null };
  }
}

/**
 * Activates (or re-validates) a license key against the server and persists
 * the result. Call this when the person types in a key, and periodically
 * while the app is running.
 */
export async function checkLicenseOnline(
  licenseKey: string,
  cfg: { url: string; anonKey: string },
): Promise<CheckResult> {
  const result = await callLicenseCheck(licenseKey, cfg);
  const now = Date.now();
  const prev = readLicenseState();
  const next: LicenseState = {
    licenseKey,
    summary: result.summary ?? prev?.summary ?? null,
    lastReason: result.reason,
    lastOk: result.ok,
    lastCheckedAt: now,
    lastOkAt: result.ok ? now : prev?.lastOkAt ?? null,
  };
  writeLicenseState(next);
  return result;
}

/** True when a cached activation is still trustworthy without reaching the server right now. */
export function isValidOffline(state: LicenseState | null): boolean {
  if (!state || !state.lastOk || !state.summary || !state.lastOkAt) return false;
  const now = Date.now();
  if (new Date(state.summary.expiresAt).getTime() <= now) return false;
  if (now - state.lastOkAt > GRACE_MS) return false;
  return true;
}

export const LICENSE_GRACE_MS = GRACE_MS;
