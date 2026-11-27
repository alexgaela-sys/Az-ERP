// One shared set of cloud objects for the whole page: configuration, sign-in,
// the Supabase store and the sync engine attached to the ERP database.

import { erpDb } from '../../services/db';
import { CloudSync } from '../../services/cloud/syncEngine';
import {
  readSupabaseConfigFromEnv,
  SupabaseAuth,
  SupabaseConfig,
  SupabaseHttpStore,
} from '../../services/cloud/supabaseHttpStore';
import { writeOfflineCache } from '../../services/cloud/offlineCache';

export interface CloudRuntime {
  cfg: SupabaseConfig;
  auth: SupabaseAuth;
  sync: CloudSync;
  store: SupabaseHttpStore;
}

let runtime: CloudRuntime | null | undefined;

/** null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not provided at build time */
export function getCloudRuntime(): CloudRuntime | null {
  if (runtime !== undefined) return runtime;
  const cfg = readSupabaseConfigFromEnv();
  if (!cfg) {
    runtime = null;
    return runtime;
  }
  const auth = new SupabaseAuth(cfg);
  const store = new SupabaseHttpStore(cfg, auth);
  const sync = erpDb.attachCloud(store);

  // Fix 6 (speed-fix list): the offline cache now lives in IndexedDB, which
  // has no synchronous read API, so priming the sync engine's resume
  // position from it can no longer happen here (this function is called
  // synchronously, before React even renders). It instead happens in
  // hydrateOfflineCache() below, awaited from CloudGate's connect() — the
  // same async flow that already waits on the network — right before
  // rt.sync.connect() runs.

  // Keep that cache up to date: after every local edit and every server
  // round-trip, mirror the live database + sync position to IndexedDB,
  // debounced so a burst of edits (e.g. posting an invoice) writes once.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const pos = sync.exportPosition();
      void writeOfflineCache({
        db: erpDb.getSnapshot() as unknown as Record<string, any>,
        versions: pos.versions,
        shadow: pos.shadow,
        cursor: pos.cursor,
        savedAt: Date.now(),
      });
    }, 800);
  };
  erpDb.subscribe(schedulePersist);
  sync.subscribe(schedulePersist);

  runtime = { cfg, auth, sync, store };
  return runtime;
}

/** Fix 6 (speed-fix list): must be awaited once, before rt.sync.connect(),
 * from CloudGate's connect() flow. Hydrates erpDb from this device's
 * IndexedDB offline cache (if any) and primes the sync engine's resume
 * position from the SAME cache read, so the database contents and the
 * sync position never drift apart. Returns true if a cache was found and
 * applied, false otherwise (first-ever login on this device, or no usable
 * cache) — in which case erpDb stays empty and waits on the network exactly
 * as before this fix. */
export async function hydrateOfflineCache(rt: CloudRuntime): Promise<boolean> {
  const cached = await erpDb.hydrateFromOfflineCache();
  if (!cached) return false;
  rt.sync.primeFromCache({ versions: cached.versions, shadow: cached.shadow, cursor: cached.cursor });
  return true;
}
