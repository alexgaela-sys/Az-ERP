// Read-only view of the running copy's software license (see
// services/license.ts and components/license/LicenseGate.tsx), plus a way to
// switch to a different license key. The license itself is unrelated to any
// ERP user/role — it gates the whole app before sign-in — so this panel only
// ever shows status; it never grants or restricts ERP permissions.
import React from 'react';
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react';
import { readLicenseState, LICENSE_GRACE_MS } from '../../../services/license';
import { resetLicenseAndReload } from '../../license/LicenseGate';
import { SectionCard } from '../../ui';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

export const LicenseSection: React.FC = () => {
  const state = readLicenseState();
  const graceDays = Math.round(LICENSE_GRACE_MS / (24 * 60 * 60 * 1000));

  return (
    <SectionCard
      title="ترخيص البرنامج"
      hint="تفعيل هذه النسخة من البرنامج — منفصل تمامًا عن حسابات المستخدمين داخل النظام"
      icon={KeyRound}
    >
      {!state?.summary ? (
        <p className="text-xs font-bold text-cream-600">لا توجد بيانات ترخيص بعد.</p>
      ) : (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl ${
              state.lastOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {state.lastOk ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
            <span>{state.lastOk ? 'الترخيص فعال' : 'يوجد مشكلة في الترخيص'}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-cream-50 border border-cream-200 rounded-xl p-3">
              <p className="text-cream-600 font-bold">العميل</p>
              <p className="font-black text-ink-900">{state.summary.customerName}</p>
            </div>
            <div className="bg-cream-50 border border-cream-200 rounded-xl p-3">
              <p className="text-cream-600 font-bold">تاريخ الانتهاء</p>
              <p className="font-black text-ink-900">{formatDate(state.summary.expiresAt)}</p>
            </div>
            <div className="bg-cream-50 border border-cream-200 rounded-xl p-3">
              <p className="text-cream-600 font-bold">الأجهزة المستخدمة</p>
              <p className="font-black text-ink-900">
                {state.summary.devicesUsed} / {state.summary.maxDevices}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-cream-600 font-medium">
            يعمل البرنامج بدون إنترنت لمدة تصل إلى {graceDays} يومًا منذ آخر تحقق ناجح، ثم يحتاج اتصال لإعادة التحقق.
          </p>
        </div>
      )}
      <button
        className="mt-4 w-full sm:w-auto px-4 py-2 rounded-xl border border-cream-300 text-xs font-bold hover:bg-cream-100 cursor-pointer"
        onClick={() => {
          if (confirm('سيتم إعادة تشغيل البرنامج لإدخال كود ترخيص آخر. هل تريد المتابعة؟')) resetLicenseAndReload();
        }}
      >
        إدخال كود ترخيص آخر
      </button>
    </SectionCard>
  );
};
