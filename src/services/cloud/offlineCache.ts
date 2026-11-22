// Offline continuation cache for the cloud/PWA build only (the desktop
// build never uses this — it is always local-storage-first, see
// electron/.env.desktop). Without this file, opening (or reloading) the
// cloud app with NO network at all shows a blank "connecting..." screen
// forever, because db.ts starts every cloud session from an empty database
// and waits for the server. This file lets a device that has successfully
// synced at least once keep reading AND writing (e.g. a cashier completing
// a sale) while genuinely offline, by keeping a local mirror of:
//   - the last-known database contents (db.ts reads this at boot instead of
//     starting empty), and
//   - the sync engine's position (CloudSync.exportPosition()/primeFromCache()
//     in syncEngine.ts) — so reconnecting only pushes/pulls what actually
//     changed, never wipes anything.
//
// This is a best-effort local mirror, not a source of truth: the server
// remains authoritative the moment a connection exists again.

const KEY = 'erp_offline_cache_v1';

export interface OfflineCache {
  db: Record<string, any>;
  versions: [string, number][];
  shadow: [string, string][];
  cursor: number;
  savedAt: number;
}

export function readOfflineCache(): OfflineCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.db || typeof parsed.db !== 'object') return null;
    return parsed as OfflineCache;
  } catch {
    return null;
  }
}

export function writeOfflineCache(cache: OfflineCache) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Best-effort only (quota exceeded, private browsing, ...) — the app
    // keeps working purely in memory; it just loses the offline-resume
    // safety net for this device until a write succeeds again.
  }
}

/** Call on explicit sign-out so a signed-out, offline device shows nothing. */
export function clearOfflineCache() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
