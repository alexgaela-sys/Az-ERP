// Super-Admin-only "cancel document" button (full reversal: GL + stock + balances).
import React from 'react';
import { AuthService } from '../services/auth';
import { DocumentAdminService } from '../services/documentAdmin';

type Kind = 'sales_invoice' | 'purchase_invoice' | 'sales_return' | 'purchase_return';

export function isSuperAdminSession(): boolean {
  return AuthService.getCurrentSession()?.user.role === 'Super Admin';
}

export const CancelDocButton: React.FC<{ kind: Kind; id: string; number: string; status: string }> = ({ kind, id, number, status }) => {
  if (!isSuperAdminSession() || status === 'cancelled') return null;
  const run = () => {
    const reason = window.prompt(`سبب إلغاء ${number}؟ (سيتم عكس القيود والمخزون والأرصدة)`);
    if (!reason || !reason.trim()) return;
    if (!window.confirm(`تأكيد إلغاء ${number}؟ لا يمكن التراجع (تعيد إدخاله بعد التصحيح).`)) return;
    const o = { reason: reason.trim() };
    const res =
      kind === 'sales_invoice' ? DocumentAdminService.cancelSalesInvoice(id, o) :
      kind === 'purchase_invoice' ? DocumentAdminService.cancelPurchaseInvoice(id, o) :
      kind === 'sales_return' ? DocumentAdminService.cancelSalesReturn(id, o) :
      DocumentAdminService.cancelPurchaseReturn(id, o);
    window.alert(res.success ? `تم إلغاء ${number} بنجاح` : res.error || 'فشل الإلغاء');
  };
  return (
    <button onClick={run} className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold border border-rose-200">
      إلغاء
    </button>
  );
};
