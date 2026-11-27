// Company identity + contact data (settings screen, Super Admin only).
// All writes go through CompanySettingsService → validated, audited, persisted
// in the database store the app reads (browser localStorage).
import React, { useRef, useState } from 'react';
import { Building2, ImageUp, Save, Trash2 } from 'lucide-react';
import { erpDb, CLOUD_STORAGE_MODE } from '../../../services/db';
import { CompanySettingsService } from '../../../services/companySettings';
import { SectionCard } from '../../ui';

// Fix 7 (speed-fix list): the logo travels with every full snapshot and
// every offline-cache write, so it's resized + re-encoded before it's ever
// stored — not just capped by raw upload size.
const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024; // reject originals over 2MB outright
const LOGO_MAX_WIDTH = 256;
const LOGO_QUALITY = 0.8;

/** Resize `file` to at most LOGO_MAX_WIDTH wide (same aspect ratio, never
 * upscaled) and re-encode as WebP (falls back to JPEG if the browser can't
 * produce WebP), returning a data URL. */
function resizeLogoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, LOGO_MAX_WIDTH / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL('image/webp', LOGO_QUALITY);
      // Some browsers silently return a PNG data URL when WebP encoding
      // isn't supported — fall back to JPEG in that case.
      if (!dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', LOGO_QUALITY);
      }
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('invalid image')); };
    img.src = objectUrl;
  });
}

export const CompanySettingsSection: React.FC = () => {
  const company = erpDb.getSnapshot().company;
  const [form, setForm] = useState({
    nameAr: company.nameAr,
    nameEn: company.nameEn,
    taxNumber: company.taxNumber,
    commercialRegister: company.commercialRegister || '',
    address: company.address || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.website || '',
    contactName: company.contactName || '',
    contactPhone: company.contactPhone || '',
    currentUsdExchangeRate: String(company.currentUsdExchangeRate ?? ''),
    logoDataUrl: company.logoDataUrl || '',
    businessType: company.businessType || 'manufacturing',
  });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // businessType is a literal union, not a plain string — it's set directly
  // via setForm below, not through this generic string-field setter.
  const set = (key: keyof Omit<typeof form, 'businessType'>, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ tone: 'error', text: 'الملف المختار ليس صورة' });
      return;
    }
    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      setMessage({ tone: 'error', text: 'حجم الشعار أكبر من 2 ميجابايت — اختر صورة أصغر' });
      return;
    }
    // Existing saved logos (already stored as a data URL from before this
    // fix) are left exactly as they are — only a newly-chosen file goes
    // through the resize/re-encode step below.
    resizeLogoToDataUrl(file)
      .then(dataUrl => set('logoDataUrl', dataUrl))
      .catch(() => setMessage({ tone: 'error', text: 'تعذّرت معالجة ملف الشعار' }));
  };

  const handleSave = () => {
    const res = CompanySettingsService.updateCompany({
      nameAr: form.nameAr,
      nameEn: form.nameEn,
      taxNumber: form.taxNumber,
      commercialRegister: form.commercialRegister,
      address: form.address,
      phone: form.phone,
      email: form.email,
      website: form.website,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      logoDataUrl: form.logoDataUrl,
      currentUsdExchangeRate: form.currentUsdExchangeRate === '' ? undefined : Number(form.currentUsdExchangeRate),
      businessType: form.businessType,
    });
    setMessage(res.success
      ? { tone: 'ok', text: 'تم حفظ بيانات الشركة في قاعدة البيانات — تظهر فورًا في الفواتير المطبوعة.' }
      : { tone: 'error', text: res.error || 'تعذر حفظ بيانات الشركة' });
  };

  const input = 'w-full p-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-slate-300';

  return (
    <SectionCard
      title="بيانات الشركة"
      hint="الاسم القانوني، الشعار، العنوان، الهاتف، الرقم الضريبي وبيانات التواصل"
      icon={Building2}
      headerAction={
        <button onClick={handleSave} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer">
          <Save className="w-3.5 h-3.5" /> حفظ البيانات
        </button>
      }
    >
      {message && (
        <div className={`mb-4 p-3 rounded-xl text-xs font-bold border ${message.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-[11px] font-bold text-slate-500 mb-2">شعار الشركة (يظهر في الفواتير)</div>
            {form.logoDataUrl ? (
              <img src={form.logoDataUrl} alt="شعار الشركة" className="mx-auto h-20 max-w-full object-contain rounded-lg bg-white p-2 border border-slate-200" />
            ) : (
              <div className="h-20 flex items-center justify-center text-[11px] text-slate-400 border border-dashed border-slate-300 rounded-lg bg-white">لا يوجد شعار محفوظ</div>
            )}
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer">
                <ImageUp className="w-3.5 h-3.5" /> اختيار صورة
              </button>
              {form.logoDataUrl && (
                <button onClick={() => set('logoDataUrl', '')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" /> إزالة
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={handleLogo} />
            <p className="text-[10px] text-slate-400 mt-2">PNG / JPG / WEBP / SVG — حتى 300 كيلوبايت</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[11px] leading-relaxed text-slate-600">
            <b className="text-slate-800 block mb-1">أين تُحفظ البيانات؟</b>
            {CLOUD_STORAGE_MODE
              ? 'تُحفظ في قاعدة البيانات السحابية المشتركة وتظهر على كل الأجهزة، وتظهر مباشرة في الفواتير المطبوعة. يُنصح بأخذ نسخة احتياطية دورية من تبويب «البيانات».'
              : 'تُحفظ في قاعدة بيانات التطبيق نفسها (localStorage) وتُقرأ عند كل فتح، وتظهر مباشرة في الفواتير المطبوعة. لا توجد مزامنة سحابية بين الأجهزة — النسخ الاحتياطي من تبويب «البيانات».'}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الشركة العربي *</label>
              <input className={input} value={form.nameAr} onChange={e => set('nameAr', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الشركة الإنجليزي *</label>
              <input className={input} dir="ltr" value={form.nameEn} onChange={e => set('nameEn', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">الرقم الضريبي</label>
              <input className={input} dir="ltr" value={form.taxNumber} onChange={e => set('taxNumber', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">السجل التجاري</label>
              <input className={input} value={form.commercialRegister} onChange={e => set('commercialRegister', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">العنوان</label>
              <input className={input} value={form.address} onChange={e => set('address', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">الهاتف</label>
              <input className={input} dir="ltr" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
              <input className={input} dir="ltr" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">الموقع الإلكتروني</label>
              <input className={input} dir="ltr" placeholder="https://" value={form.website} onChange={e => set('website', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">سعر صرف الدولار المعتمد</label>
              <input className={input} type="number" step="0.01" value={form.currentUsdExchangeRate} onChange={e => set('currentUsdExchangeRate', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">مسؤول التواصل</label>
              <input className={input} value={form.contactName} onChange={e => set('contactName', e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">هاتف التواصل</label>
              <input className={input} dir="ltr" value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">نوع النشاط</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'manufacturing', label: 'تصنيع' },
                  { value: 'trading', label: 'تجارة (بيع وشراء فقط)' },
                  { value: 'services', label: 'خدمات' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, businessType: opt.value }))}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border cursor-pointer ${
                      form.businessType === opt.value
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 border-slate-300 text-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                "تجارة" و"خدمات" بيخفوا شاشات الإنتاج والجودة والتكاليف من القائمة الجانبية (تقدر ترجعها تاني من هنا في أي وقت).
              </p>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
};
