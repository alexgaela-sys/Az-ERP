// Branches (multi-branch, opt-in): add, rename, reassign warehouse, disable.
//
// IMPORTANT backward-compatibility rule: a company with zero or one branch
// sees no change anywhere else in the app. The branch selector in the
// Cashier screen only appears once a SECOND active branch exists here.
import React, { useState } from 'react';
import { Network, Plus, Power, Save } from 'lucide-react';
import { erpDb } from '../../../services/db';
import { CompanySettingsService } from '../../../services/companySettings';
import { Branch } from '../../../types/erp';
import { SectionCard } from '../../ui';

const EMPTY_FORM = { nameAr: '', nameEn: '', warehouseId: '' };

export const BranchesSection: React.FC = () => {
  const db = erpDb.getSnapshot();
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const input = 'w-full p-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-slate-300';
  const activeWarehouses = db.warehouses.filter(w => w.active);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, warehouseId: activeWarehouses[0]?.id || '' });
    setShowForm(true);
  };

  const openEdit = (b: Branch) => {
    setEditing(b);
    setForm({ nameAr: b.nameAr, nameEn: b.nameEn || '', warehouseId: b.warehouseId });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.warehouseId) {
      setMessage({ tone: 'error', text: 'اختر مستودعًا لهذا الفرع' });
      return;
    }
    const payload = { nameAr: form.nameAr, nameEn: form.nameEn, warehouseId: form.warehouseId };
    const res = editing
      ? CompanySettingsService.updateBranch(editing.id, payload)
      : CompanySettingsService.createBranch(payload);
    if (!res.success) {
      setMessage({ tone: 'error', text: res.error || 'تعذر حفظ الفرع' });
      return;
    }
    setShowForm(false);
    setEditing(null);
    setMessage({ tone: 'ok', text: 'تم حفظ الفرع. سيظهر محدد الفرع في شاشة الكاشير تلقائيًا الآن.' });
  };

  const handleToggle = (b: Branch) => {
    const res = CompanySettingsService.updateBranch(b.id, { active: !b.active });
    setMessage(res.success
      ? { tone: 'ok', text: b.active ? 'تم تعطيل الفرع.' : 'تم تنشيط الفرع.' }
      : { tone: 'error', text: res.error || 'تعذر تغيير حالة الفرع' });
  };

  return (
    <SectionCard
      title="الفروع"
      hint="إضافة فروع إضافية (كل فرع بمستودع بيع خاص به) — لا تظهر أي واجهة فروع إلا بعد إضافة فرع ثانٍ"
      icon={Network}
      headerAction={
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> إضافة فرع
        </button>
      }
    >
      {message && (
        <div className={`mb-4 p-3 rounded-xl text-xs font-bold border ${message.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {message.text}
        </div>
      )}

      {db.branches.length === 0 ? (
        <div className="p-5 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-600 leading-relaxed">
          لا يوجد أي فرع مُضاف — النظام يعمل حاليًا بفرع واحد ضمني (المستودع الافتراضي) تمامًا كما كان دائمًا،
          ولا يظهر أي محدد فروع في شاشة الكاشير. أضف فرعًا هنا فقط إذا كانت المنشأة تدير أكثر من نقطة بيع فعليًا.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs min-w-[640px]">
            <thead className="bg-slate-100 text-slate-700 font-bold">
              <tr>
                <th className="p-3">الكود</th>
                <th className="p-3">اسم الفرع</th>
                <th className="p-3">المستودع المرتبط</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.branches.map(b => {
                const wh = db.warehouses.find(w => w.id === b.warehouseId);
                return (
                  <tr key={b.id} className={b.active ? 'hover:bg-slate-50' : 'bg-slate-50/60 text-slate-400'}>
                    <td className="p-3 font-mono font-black text-slate-900">{b.code}</td>
                    <td className="p-3 font-bold text-slate-800">{b.nameAr}</td>
                    <td className="p-3">{wh ? `${wh.nameAr} (${wh.code})` : '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${b.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                        {b.active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(b)} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer">تعديل</button>
                        <button onClick={() => handleToggle(b)} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${b.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                          <Power className="w-3 h-3" /> {b.active ? 'تعطيل' : 'تنشيط'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
        إضافة فرع واحد فقط (أو عدم إضافة أي فرع) لا تغيّر شيئًا في البيع — كل المبيعات تستمر على المستودع الافتراضي.
        بمجرد إضافة فرع ثانٍ نشط، يظهر محدد الفرع تلقائيًا أعلى شاشة الكاشير ليختار الكاشير الفرع الذي يبيع منه.
      </p>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 text-right space-y-3">
            <h3 className="font-black text-sm text-slate-900 pb-2 border-b border-slate-200">
              {editing ? `تعديل الفرع ${editing.code}` : 'إضافة فرع جديد'}
            </h3>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الفرع *</label>
              <input className={input} value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">اسم الفرع (إنجليزي)</label>
              <input className={input} dir="ltr" value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">المستودع المرتبط (مخزون البيع لهذا الفرع) *</label>
              <select className={input} value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))}>
                <option value="">— اختر مستودعًا —</option>
                {activeWarehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.nameAr} ({w.code})</option>
                ))}
              </select>
              {activeWarehouses.length === 0 && (
                <p className="text-[10px] text-amber-700 mt-1">لا يوجد مستودع نشط — أضف مستودعًا جديدًا من تبويب «المستودعات» أولًا (يفضّل مستودع من نوع «منتج تام محلي»).</p>
              )}
              <p className="text-[10px] text-slate-500 mt-1">أنشئ مستودعًا جديدًا مخصصًا لهذا الفرع من تبويب «المستودعات» إذا أردت فصل مخزونه عن باقي الفروع.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer">إلغاء</button>
              <button onClick={handleSave} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer">
                <Save className="w-3.5 h-3.5" /> حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
};
