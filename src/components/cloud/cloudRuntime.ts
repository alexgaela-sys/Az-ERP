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
import { readOfflineCache, writeOfflineCache } from '../../services/cloud/offlineCache';

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

  // Resume incrementally (never a destructive full reload) if this device
  // has a cached sync position — see services/cloud/offlineCache.ts and
  // CloudSync.primeFromCache()/connect() in services/cloud/syncEngine.ts.
  const cached = readOfflineCache();
  if (cached) sync.primeFromCache({ versions: cached.versions, shadow: cached.shadow, cursor: cached.cursor });

  // Keep that cache up to date: after every local edit and every server
  // round-trip, mirror the live database + sync position to localStorage,
  // debounced so a burst of edits (e.g. posting an invoice) writes once.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const pos = sync.exportPosition();
      writeOfflineCache({
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
