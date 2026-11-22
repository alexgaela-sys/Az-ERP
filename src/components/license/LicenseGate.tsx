// Start-up gate for the software license itself — runs BEFORE everything
// else (wraps both the cloud build's CloudGate and the desktop build's plain
// App in main.tsx), since it has nothing to do with Supabase sign-in or
// which ERP user is logged in. See services/license.ts for the activation
// rules (grace period, device limit, expiry).
//
//   no key saved yet  -> ask for the license key (first run on this device)
//   checking          -> brief spinner on first activation only
//   blocked           -> a clear reason, with a way to try again or change the key
//   ok (cached or verified) -> renders the app; a silent background check
//                              keeps running every hour to catch revocation

import React, { useEffect, useRef, useState } from 'react';
import { readSupabaseConfigFromEnv } from '../../services/cloud/supabaseHttpStore';
import {
  checkLicenseOnline,
  clearLicenseState,
  isValidOffline,
  LicenseFailureReason,
  LicenseState,
  readLicenseState,
} from '../../services/license';

const RECHECK_MS = 60 * 60 * 1000; // re-validate with the server once an hour while open

const card = 'w-full max-w-md bg-white rounded-2xl border border-cream-300 shadow-lg p-6 space-y-4 text-right';
const input =
  'w-full rounded-lg border border-cream-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400';
const primary =
  'w-full py-2.5 rounded-lg bg-brand-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const secondary = 'w-full py-2.5 rounded-lg border border-cream-300 font-bold text-sm cursor-pointer hover:bg-cream-100';

const Shell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-h-screen bg-cream-100 flex items-center justify-center p-4 font-sans text-ink-900" dir="rtl">
    <div className={card}>
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-black">
          YZ <span className="text-brand-600">ERP</span>
        </h1>
        <p className="text-sm font-bold text-cream-800">{title}</p>
      </div>
      {children}
    </div>
  </div>
);

function reasonText(reason: LicenseFailureReason | null): string {
  switch (reason) {
    case 'invalid':
      return 'كود الترخيص غير صحيح. تأكد من الكود وحاول مرة أخرى.';
    case 'inactive':
      return 'تم إيقاف هذا الترخيص. برجاء التواصل مع الجهة المسؤولة.';
    case 'expired':
      return 'انتهت صلاحية الترخيص. برجاء تجديده للاستمرار في استخدام البرنامج.';
    case 'device_limit':
      return 'تم الوصول للحد الأقصى من الأجهزة المسموح بها لهذا الترخيص.';
    case 'bad_request':
      return 'كود الترخيص فارغ أو غير صالح.';
    case 'network_error':
      return 'تعذر الاتصال بخادم الترخيص. تأكد من اتصال الإنترنت وحاول مرة أخرى.';
    default:
      return 'تعذر التحقق من الترخيص.';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

const KeyEntryForm: React.FC<{ onActivated: () => void; prefill?: string; notice?: string }> = ({
  onActivated,
  prefill,
  notice,
}) => {
  const [key, setKey] = useState(prefill || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = readSupabaseConfigFromEnv();

  const activate = async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setError('اكتب كود الترخيص أولاً.');
      return;
    }
    if (!cfg) {
      setError('إعدادات الاتصال بالخادم غير مكتملة في هذه النسخة.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await checkLicenseOnline(trimmed, cfg);
    setBusy(false);
    if (result.ok) {
      onActivated();
    } else {
      setError(reasonText(result.reason));
    }
  };

  return (
    <div className="space-y-3">
      {notice && (
        <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          {notice}
        </div>
      )}
      <p className="text-xs font-bold text-cream-700">برجاء إدخال كود تفعيل البرنامج الخاص بشركتكم:</p>
      <input
        className={input}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        value={key}
        onChange={e => setKey(e.target.value)}
        dir="ltr"
        onKeyDown={e => e.key === 'Enter' && activate()}
        autoFocus
      />
      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      <button className={primary} onClick={activate} disabled={busy}>
        {busy ? 'جاري التحقق...' : 'تفعيل'}
      </button>
    </div>
  );
};

const BlockedScreen: React.FC<{ state: LicenseState; onRetry: () => void; busy: boolean }> = ({
  state,
  onRetry,
  busy,
}) => {
  const [changing, setChanging] = useState(false);
  if (changing) {
    return (
      <Shell title="تفعيل البرنامج">
        <KeyEntryForm prefill={state.licenseKey} onActivated={() => window.location.reload()} />
      </Shell>
    );
  }
  return (
    <Shell title="تعذر استخدام البرنامج">
      <div className="space-y-3">
        <p className="text-sm font-bold text-red-600">{reasonText(state.lastReason)}</p>
        {state.summary && (
          <div className="text-xs font-bold text-cream-700 bg-cream-100 rounded-lg p-2.5 space-y-1">
            <p>العميل: {state.summary.customerName}</p>
            <p>تاريخ الانتهاء: {formatDate(state.summary.expiresAt)}</p>
            <p>
              الأجهزة: {state.summary.devicesUsed} / {state.summary.maxDevices}
            </p>
          </div>
        )}
        <button className={primary} onClick={onRetry} disabled={busy}>
          {busy ? 'جاري المحاولة...' : 'إعادة المحاولة'}
        </button>
        <button className={secondary} onClick={() => setChanging(true)}>
          إدخال كود ترخيص آخر
        </button>
      </div>
    </Shell>
  );
};

export const LicenseGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<LicenseState | null>(() => readLicenseState());
  const [checking, setChecking] = useState(false);
  // A device that's already validly activated (within its offline grace window)
  // renders the app immediately on every launch, with no loading flash — the
  // server re-check below still happens, just silently in the background.
  const [allowed, setAllowed] = useState<boolean>(() => isValidOffline(readLicenseState()));
  const [bootDone, setBootDone] = useState<boolean>(() => isValidOffline(readLicenseState()));
  const recheckTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runCheck = async (key: string) => {
    const cfg = readSupabaseConfigFromEnv();
    if (!cfg) return;
    setChecking(true);
    const result = await checkLicenseOnline(key, cfg);
    setChecking(false);
    const fresh = readLicenseState();
    setState(fresh);
    if (result.ok) {
      setAllowed(true);
    } else if (result.reason === 'network_error') {
      // Could not reach the server this time — fall back to the offline grace
      // window rather than blocking on a transient connectivity blip.
      setAllowed(isValidOffline(fresh));
    } else {
      setAllowed(false);
    }
  };

  useEffect(() => {
    const existing = readLicenseState();
    if (existing?.licenseKey) {
      // Runs whether or not the device is already in the "allowed" state —
      // either verifies quietly in the background, or (first launch since
      // install, or the grace window lapsed) blocks on it.
      runCheck(existing.licenseKey).finally(() => setBootDone(true));
    } else {
      setBootDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allowed) return;
    recheckTimer.current = setInterval(() => {
      const existing = readLicenseState();
      if (existing?.licenseKey) runCheck(existing.licenseKey);
    }, RECHECK_MS);
    return () => {
      if (recheckTimer.current) clearInterval(recheckTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!bootDone) {
    return <Shell title="جاري التحقق من الترخيص...">{null}</Shell>;
  }

  if (!state || !state.licenseKey) {
    return (
      <Shell title="تفعيل البرنامج">
        <KeyEntryForm onActivated={() => window.location.reload()} />
      </Shell>
    );
  }

  if (!allowed) {
    return (
      <BlockedScreen
        state={state}
        busy={checking}
        onRetry={() => runCheck(state.licenseKey)}
      />
    );
  }

  return <>{children}</>;
};

/** Used by the Settings "License" panel to let the person change keys from inside the app. */
export function resetLicenseAndReload() {
  clearLicenseState();
  window.location.reload();
}
