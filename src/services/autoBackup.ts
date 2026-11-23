// Automatic local backups for the desktop (On-Premise/local-storage) build
// only. Its data lives solely in this computer's browser-style localStorage
// (see db.ts's STORAGE_KEY) — a single file with no redundancy — so a silent
// daily copy to a plain, human-readable JSON file is real protection against
// a corrupted profile, a bad import, or an accidental uninstall. The cloud
// build's data already lives durably in Supabase and is snapshotted
// server-side instead (see supabase/scripts/backup-cron.sql).
//
// Writing the file itself happens in Electron's main process (electron/
// main.js's backup:save, bridged by preload.js as window.electronBackup) —
// this module only decides WHEN (once per calendar day) and WHAT (the
// current database snapshot). It no-ops completely outside Electron
// (window.electronBackup absent, e.g. a browser dev build) and in the cloud
// build, so it's safe to start unconditionally.

import { erpDb, CLOUD_STORAGE_MODE } from './db';

const LAST_RUN_KEY = 'yz_erp_last_auto_backup_date';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check hourly; actually backs up at most once/day
const FIRST_RUN_DELAY_MS = 8000; // let the app finish loading first

declare global {
  interface Window {
    electronBackup?: {
      save: (filename: string, content: string) => Promise<{ ok: boolean; path?: string; folder?: string; error?: string }>;
      list: () => Promise<{ ok: boolean; folder?: string; files?: string[]; error?: string }>;
      openFolder: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

async function runOnce(): Promise<void> {
  if (CLOUD_STORAGE_MODE) return;
  if (typeof window === 'undefined' || !window.electronBackup) return;

  let last = '';
  try { last = localStorage.getItem(LAST_RUN_KEY) || ''; } catch { /* ignore */ }
  if (last === todayStr()) return;

  try {
    const snapshot = erpDb.getSnapshot();
    const content = JSON.stringify(snapshot, null, 2);
    const filename = `yz_erp_backup_${todayStr()}.json`;
    const res = await window.electronBackup.save(filename, content);
    if (res.ok) {
      try { localStorage.setItem(LAST_RUN_KEY, todayStr()); } catch { /* ignore */ }
    }
  } catch {
    // Best-effort only — a failed backup never blocks or breaks the app.
  }
}

let started = false;

/** Call once, anywhere early (e.g. main.tsx). Safe to call in every build. */
export function startAutoBackup(): void {
  if (started) return;
  started = true;
  setTimeout(runOnce, FIRST_RUN_DELAY_MS);
  setInterval(runOnce, CHECK_INTERVAL_MS);
}
