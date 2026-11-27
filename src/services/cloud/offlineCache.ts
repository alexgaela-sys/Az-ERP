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
//
// Fix 6 (speed-fix list): this used to be a single JSON string in
// localStorage, rewritten in full (including every row's `shadow` copy)
// after every edit. Browsers cap localStorage at a few MB, so on a company
// with enough history the write silently stopped updating. Storage is now
// IndexedDB (much higher practical limit, and writes don't block the main
// thread). The read/write/clear API keeps the same three function names and
// purpose; they are necessarily async now (IndexedDB has no synchronous
// API) — every caller already runs inside an async flow (CloudGate's
// connect(), cloudRuntime's debounced persist), so this changes nothing
// about *when* they are called, only that callers now await them.

const DB_NAME = 'yz_erp_offline';
const STORE = 'kv';
const CACHE_KEY = 'cache';
const LEGACY_LOCALSTORAGE_KEY = 'erp_offline_cache_v1'; // pre-Fix-6 location, migrated once

export interface OfflineCache {
  db: Record<string, any>;
  versions: [string, number][];
  shadow: [string, string][];
  cursor: number;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Reads the legacy single-JSON-string localStorage value (pre-Fix-6), if
 * any, and removes it — used only once, by readOfflineCache()'s migration. */
function takeLegacyLocalStorageCache(): OfflineCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.db || typeof parsed.db !== 'object') return null;
    return parsed as OfflineCache;
  } catch {
    return null;
  }
}

export async function readOfflineCache(): Promise<OfflineCache | null> {
  const db = await openDb();
  if (!db) return null;
  const existing = await idbGet<OfflineCache>(db, CACHE_KEY);
  if (existing && typeof existing === 'object' && existing.db) return existing;
  // First run after upgrading: migrate a pre-Fix-6 localStorage cache into
  // IndexedDB once, so a device that was already offline-capable doesn't
  // lose its resume position.
  const legacy = takeLegacyLocalStorageCache();
  if (legacy) {
    await idbPut(db, CACHE_KEY, legacy);
    return legacy;
  }
  return null;
}

type WriteFailureListener = () => void;
const writeFailureListeners = new Set<WriteFailureListener>();

/** SyncBadge subscribes to this to show a visible warning instead of the
 * previous silent failure — see Fix 6 (speed-fix list). */
export function subscribeOfflineCacheWriteFailure(listener: WriteFailureListener): () => void {
  writeFailureListeners.add(listener);
  return () => writeFailureListeners.delete(listener);
}

export async function writeOfflineCache(cache: OfflineCache): Promise<void> {
  const db = await openDb();
  const ok = db ? await idbPut(db, CACHE_KEY, cache) : false;
  if (!ok) {
    // Best-effort only (quota exceeded, private browsing, IndexedDB
    // unavailable, ...) — the app keeps working purely in memory; it just
    // loses the offline-resume safety net for this device until a write
    // succeeds again. Unlike before Fix 6, this is now surfaced visibly.
    writeFailureListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
  }
}

/** Call on explicit sign-out so a signed-out, offline device shows nothing. */
export async function clearOfflineCache(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
  } catch {
    // ignore
  }
  const db = await openDb();
  if (db) await idbDelete(db, CACHE_KEY);
}
