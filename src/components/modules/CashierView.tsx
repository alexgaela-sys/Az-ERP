// Cashier (POS) screen — fast retail checkout for walk-in customers.
// Reuses the exact same accounting/inventory posting path as the regular
// Sales module (WorkflowService.createSalesInvoice): no parallel ledger logic.
import React, { useState } from 'react';
import { Banknote, Search, Trash2, X, Undo2 } from 'lucide-react';
import { erpDb, generateErpId } from '../../services/db';
import { WorkflowService } from '../../services/workflows';
import { PaymentMethod } from '../../types/erp';
import { priceFor, warehouseForChannel } from '../../services/pricing';
import { AuthService } from '../../services/auth';

interface CartLine {
  itemId: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  /** Line discount as a percentage (0-100), same semantics as the regular
   *  Sales module's SalesInvoiceLine.discount. */
  discountPct: number;
}

/** Every POS sale needs a customer card. A single shared "walk-in" cash
 *  customer is created once (lazily) and reused for every POS sale — same
 *  pattern as CloudGate's lazy owner-account bootstrap. */
function ensureCashCustomer(): string {
  const db = erpDb.getSnapshot();
  const existing = db.customers.find(c => c.code === 'CASH-POS');
  if (existing) return existing.id;
  const id = generateErpId('cust');
  erpDb.mutate(draft => {
    draft.customers.push({
      id,
      code: 'CASH-POS',
      name: 'عميل نقدي (كاشير)',
      customerType: 'retail',
      channel: 'retail',
      address: '',
      phone: '',
      currency: 'EGP',
      creditLimit: 0,
      currentBalance: 0,
      openingBalance: 0,
      active: true,
    });
  });
  return id;
}

function printReceipt(opts: {
  invoiceNumber: string;
  date: string;
  companyName: string;
  lines: Array<{ nameAr: string; quantity: number; unitPrice: number; vatRate: number }>;
  subtotal: number;
  vat: number;
  total: number;
  /** Total amount shaved off by line discounts (pre-VAT), shown as "وفرت". */
  savedAmount?: number;
  cashReceived?: number;
  change?: number;
}) {
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) return;
  const rows = opts.lines
    .map(
      l => `<tr>
        <td>${l.nameAr}</td>
        <td style="text-align:center">${l.quantity}</td>
        <td style="text-align:left">${(l.unitPrice * (1 + l.vatRate)).toFixed(2)}</td>
        <td style="text-align:left">${(l.quantity * l.unitPrice * (1 + l.vatRate)).toFixed(2)}</td>
      </tr>`
    )
    .join('');
  win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
    <title>إيصال ${opts.invoiceNumber}</title>
    <style>
      /* 80mm receipt-printer roll width, not A4. */
      @page { size: 80mm auto; margin: 0; }
      body { font-family: 'Tahoma', sans-serif; width: 72mm; margin: 0 auto; padding: 4mm; font-size: 12px; }
      h2 { text-align: center; margin: 4px 0; }
      .meta { text-align: center; font-size: 11px; color: #444; margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 3px 2px; font-size: 11px; }
      th { border-bottom: 1px solid #000; text-align: right; }
      .totals { margin-top: 8px; border-top: 1px dashed #000; padding-top: 6px; }
      .totals div { display: flex; justify-content: space-between; }
      .grand { font-weight: bold; font-size: 14px; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; }
    </style></head>
    <body>
      <h2>${opts.companyName || 'إيصال بيع'}</h2>
      <div class="meta">فاتورة ${opts.invoiceNumber} — ${opts.date}</div>
      <table>
        <thead><tr><th>الصنف</th><th>ك</th><th>سعر</th><th>إجمالي</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><span>الإجمالي قبل الضريبة</span><span>${opts.subtotal.toFixed(2)}</span></div>
        <div><span>ض.ق.م</span><span>${opts.vat.toFixed(2)}</span></div>
        <div class="grand"><span>الإجمالي</span><span>${opts.total.toFixed(2)} ج.م</span></div>
        ${opts.cashReceived != null ? `<div><span>المدفوع نقدًا</span><span>${opts.cashReceived.toFixed(2)}</span></div>
        <div><span>الباقي</span><span>${(opts.change ?? 0).toFixed(2)}</span></div>` : ''}
      </div>
      ${opts.savedAmount && opts.savedAmount > 0.001
        ? `<div style="margin-top:6px; text-align:center; font-weight:bold; border:1px dashed #000; padding:4px; border-radius:4px;">
             لقد وفرت ${opts.savedAmount.toFixed(2)} ج.م في هذه الفاتورة 🎉
           </div>`
        : ''}
      <script>window.onload = () => { window.print(); };</script>
    </body></html>`);
  win.document.close();
}

export const CashierView: React.FC = () => {
  const db = erpDb.getSnapshot();
  const finishedProducts = db.items.filter(i => i.itemType === 'finished_product' && i.active);

  const [search, setSearch] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [formError, setFormError] = useState('');
  const [lastReceipt, setLastReceipt] = useState<string>('');
  const [mode, setMode] = useState<'sale' | 'return'>('sale');
  const [invoiceDiscountPct, setInvoiceDiscountPct] = useState('');

  // There's no separate "invoice-level discount" accounting field — applying
  // one here just sets the same % on every line, reusing the exact posting
  // path already proven for per-line discounts instead of a second, riskier
  // code path that would touch VAT/GL computation.
  const applyInvoiceDiscount = () => {
    const pct = Math.max(0, Math.min(100, Number(invoiceDiscountPct) || 0));
    setCart(prev => prev.map(l => ({ ...l, discountPct: pct })));
  };

  const addItem = (itemId: string) => {
    const itm = finishedProducts.find(i => i.id === itemId);
    if (!itm) return;
    setCart(prev => {
      const idx = prev.findIndex(l => l.itemId === itemId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, { itemId, quantity: 1, unitPrice: priceFor(itm, 'retail'), vatRate: itm.vatRate, discountPct: 0 }];
    });
  };

  const scanBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const itm = finishedProducts.find(i => i.barcode === trimmed || i.code === trimmed);
    if (!itm) {
      setScanError(`لا يوجد صنف بالباركود "${trimmed}"`);
      return;
    }
    setScanError('');
    addItem(itm.id);
  };

  const onScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      scanBarcode(scanInput);
      setScanInput('');
    }
  };

  const updateQty = (itemId: string, qty: number) => {
    setCart(prev => prev.map(l => (l.itemId === itemId ? { ...l, quantity: Math.max(0.001, qty) } : l)));
  };

  const updateDiscount = (itemId: string, pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct || 0));
    setCart(prev => prev.map(l => (l.itemId === itemId ? { ...l, discountPct: clamped } : l)));
  };

  const removeLine = (itemId: string) => setCart(prev => prev.filter(l => l.itemId !== itemId));
  const clearCart = () => setCart([]);

  // Net-of-discount amount for a line (discount is a percentage, same
  // semantics as the regular Sales module's SalesInvoiceLine.discount).
  const lineNet = (l: CartLine) => l.quantity * l.unitPrice * (1 - (l.discountPct || 0) / 100);

  const subtotal = cart.reduce((s, l) => s + lineNet(l), 0);
  const vat = cart.reduce((s, l) => s + lineNet(l) * l.vatRate, 0);
  const savedAmount = cart.reduce((s, l) => s + l.quantity * l.unitPrice * ((l.discountPct || 0) / 100), 0);
  const total = subtotal + vat;
  const cashReceivedNum = Number(cashReceived) || 0;
  const change = paymentMethod === 'cash' ? cashReceivedNum - total : 0;

  const filteredProducts = finishedProducts.filter(i => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      i.nameAr.toLowerCase().includes(q) ||
      i.nameEn.toLowerCase().includes(q) ||
      i.code.toLowerCase().includes(q) ||
      (i.barcode || '').toLowerCase().includes(q)
    );
  });

  const checkout = () => {
    setFormError('');
    if (cart.length === 0) {
      setFormError('السلة فارغة');
      return;
    }
    if (paymentMethod === 'cash' && cashReceivedNum < total) {
      setFormError('المبلغ المدفوع أقل من إجمالي الفاتورة');
      return;
    }

    const customerId = ensureCashCustomer();
    const session = AuthService.getCurrentSession();
    const warehouseId = warehouseForChannel('retail');

    const res = WorkflowService.createSalesInvoice({
      customerId,
      channel: 'retail',
      warehouseId,
      paymentMethod,
      currency: 'EGP',
      exchangeRate: db.company.currentUsdExchangeRate,
      date: new Date().toISOString().split('T')[0],
      notes: 'فاتورة كاشير (POS)',
      lines: cart.map(l => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        discount: l.discountPct || 0,
      })),
      userId: session?.user.id,
      userName: session?.user.name,
    });

    if (!res.success || !res.invoice) {
      setFormError(res.error || 'حدث خطأ أثناء ترحيل الفاتورة');
      return;
    }

    printReceipt({
      invoiceNumber: res.invoice.invoiceNumber,
      date: res.invoice.date,
      companyName: db.company.nameAr,
      lines: cart.map(l => ({
        nameAr: finishedProducts.find(i => i.id === l.itemId)?.nameAr || l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice * (1 - (l.discountPct || 0) / 100),
        vatRate: l.vatRate,
      })),
      subtotal,
      vat,
      total,
      savedAmount,
      cashReceived: paymentMethod === 'cash' ? cashReceivedNum : undefined,
      change: paymentMethod === 'cash' ? change : undefined,
    });

    setLastReceipt(res.invoice.invoiceNumber);
    setCart([]);
    setCashReceived('');
  };

  if (mode === 'return') {
    return <ReturnPanel onBack={() => setMode('sale')} />;
  }

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-4" dir="rtl">
      {/* Product grid */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-brand-600" />
            <h2 className="font-black text-lg">شاشة الكاشير</h2>
          </div>
          <button
            onClick={() => setMode('return')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200"
          >
            <Undo2 className="w-3.5 h-3.5" /> مرتجع
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cream-700" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الكود…"
              className="w-full pr-9 pl-3 py-2 rounded-xl border border-cream-300 text-sm"
            />
          </div>
          <input
            type="text"
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={onScanKeyDown}
            placeholder="امسح الباركود…"
            dir="ltr"
            className="w-48 py-2 px-3 rounded-xl border border-cream-300 text-sm"
          />
        </div>
        {scanError && <p className="text-xs text-red-700 font-bold">{scanError}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 overflow-auto pr-1" style={{ maxHeight: '70vh' }}>
          {filteredProducts.map(p => (
            <button
              key={p.id}
              onClick={() => addItem(p.id)}
              className="text-right p-3 rounded-xl border border-cream-300 bg-white hover:border-brand-400 hover:shadow-md transition-all"
            >
              <div className="font-bold text-sm leading-5 truncate">{p.nameAr}</div>
              <div className="text-[11px] text-cream-700 font-mono mt-1" dir="ltr">
                {p.barcode || p.code}
              </div>
              <div className="text-brand-700 font-black text-sm mt-1">{priceFor(p, 'retail').toFixed(2)} ج.م</div>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <p className="col-span-full text-center text-sm text-cream-700 py-6">لا توجد أصناف مطابقة</p>
          )}
        </div>
      </div>

      {/* Cart / checkout panel */}
      <div className="w-full lg:w-96 flex-shrink-0 bg-white rounded-2xl border border-cream-300 shadow-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">السلة ({cart.length})</h3>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-xs text-red-700 font-bold flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> إفراغ السلة
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto divide-y divide-cream-100" style={{ maxHeight: '38vh' }}>
          {cart.map(l => {
            const itm = finishedProducts.find(i => i.id === l.itemId);
            return (
              <div key={l.itemId} className="py-2 flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{itm?.nameAr || l.itemId}</div>
                  <div className="text-[11px] text-cream-700 font-mono">
                    {l.unitPrice.toFixed(2)} ج.م × {l.quantity}
                    {l.discountPct > 0 && <span className="text-emerald-700 font-bold"> (خصم {l.discountPct}%)</span>}
                  </div>
                </div>
                <input
                  type="number"
                  min="0.001"
                  step="1"
                  value={l.quantity}
                  onChange={e => updateQty(l.itemId, Number(e.target.value))}
                  title="الكمية"
                  className="w-16 p-1 rounded-lg border border-cream-300 text-xs text-center"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={l.discountPct || 0}
                    onChange={e => updateDiscount(l.itemId, Number(e.target.value))}
                    title="نسبة الخصم %"
                    className="w-14 p-1 rounded-lg border border-cream-300 text-xs text-center"
                  />
                  <span className="text-[10px] text-cream-600 font-bold">%</span>
                </div>
                <button onClick={() => removeLine(l.itemId)} className="text-cream-600 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          {cart.length === 0 && <p className="text-center text-xs text-cream-700 py-6">السلة فارغة — اضغط صنف أو امسح باركود</p>}
        </div>

        {cart.length > 0 && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              value={invoiceDiscountPct}
              onChange={e => setInvoiceDiscountPct(e.target.value)}
              placeholder="خصم عام على الفاتورة %"
              className="flex-1 p-2 rounded-xl border border-cream-300 text-xs"
            />
            <button
              onClick={applyInvoiceDiscount}
              className="px-3 py-2 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-xs font-bold"
            >
              تطبيق على الكل
            </button>
          </div>
        )}

        <div className="border-t border-cream-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>الإجمالي قبل الضريبة</span><span className="font-mono">{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>ض.ق.م</span><span className="font-mono">{vat.toFixed(2)}</span></div>
          <div className="flex justify-between font-black text-base"><span>الإجمالي</span><span className="font-mono">{total.toFixed(2)} ج.م</span></div>
        </div>

        <div className="flex gap-2">
          {(['cash', 'bank_transfer'] as PaymentMethod[]).map(pm => (
            <button
              key={pm}
              onClick={() => setPaymentMethod(pm)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                paymentMethod === pm ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-cream-300 text-cream-800'
              }`}
            >
              {pm === 'cash' ? 'نقدًا' : 'بطاقة / تحويل'}
            </button>
          ))}
        </div>

        {paymentMethod === 'cash' && (
          <div className="space-y-1">
            <label className="block text-xs font-bold text-cream-800">المبلغ المستلم</label>
            <input
              type="number"
              value={cashReceived}
              onChange={e => setCashReceived(e.target.value)}
              className="w-full p-2 rounded-xl border border-cream-300 text-sm font-mono"
              placeholder="0.00"
            />
            {cashReceivedNum > 0 && (
              <div className="text-xs font-bold text-emerald-700">الباقي: {Math.max(0, change).toFixed(2)} ج.م</div>
            )}
          </div>
        )}

        {formError && <p className="text-xs text-red-700 font-bold">{formError}</p>}
        {lastReceipt && !formError && (
          <p className="text-xs text-emerald-700 font-bold">تم ترحيل الفاتورة {lastReceipt} وطباعة الإيصال.</p>
        )}

        <button
          onClick={checkout}
          className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-black text-sm"
        >
          إتمام البيع وطباعة الإيصال
        </button>
      </div>
    </div>
  );
};

/** Looks up a posted sales invoice by number and posts a partial/full return
 *  against it through WorkflowService.postSalesReturn — the exact same
 *  inspection/inventory/GL reversal logic as the regular Returns workflow. */
const ReturnPanel: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const db = erpDb.getSnapshot();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState('');
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const invoice = invoiceId ? db.salesInvoices.find(i => i.id === invoiceId) : null;
  const lines = invoice ? db.salesInvoiceLines.filter(l => l.invoiceId === invoice.id) : [];

  const searchInvoice = () => {
    setSuccessMsg('');
    setFormError('');
    const found = db.salesInvoices.find(i => i.invoiceNumber === invoiceNumber.trim() && i.status === 'posted');
    if (!found) {
      setSearchError(`لا توجد فاتورة مرحّلة برقم "${invoiceNumber.trim()}"`);
      setInvoiceId(null);
      return;
    }
    setSearchError('');
    setInvoiceId(found.id);
    setQtyByLine({});
  };

  const submitReturn = () => {
    if (!invoice) return;
    setFormError('');
    const selected = lines
      .filter(l => (qtyByLine[l.id] || 0) > 0)
      .map(l => ({ itemId: l.itemId, quantity: qtyByLine[l.id], unitPrice: l.unitPrice, vatRate: l.vatRate }));
    if (selected.length === 0) {
      setFormError('حدد كمية صنف واحد على الأقل للإرجاع');
      return;
    }
    if (!reason.trim()) {
      setFormError('سبب المرتجع مطلوب');
      return;
    }
    const session = AuthService.getCurrentSession();
    const res = WorkflowService.postSalesReturn({
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      warehouseId: invoice.warehouseId,
      date: new Date().toISOString().split('T')[0],
      reason: reason.trim(),
      lines: selected,
      userId: session?.user.id,
      userName: session?.user.name,
    });
    if (!res.success || !res.salesReturn) {
      setFormError(res.error || 'حدث خطأ أثناء ترحيل المرتجع');
      return;
    }
    setSuccessMsg(`تم ترحيل المرتجع رقم ${res.salesReturn.returnNumber} بنجاح.`);
    setQtyByLine({});
    setReason('');
  };

  return (
    <div className="h-full p-4 max-w-2xl mx-auto" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Undo2 className="w-5 h-5 text-rose-600" />
          <h2 className="font-black text-lg">مرتجع من فاتورة كاشير</h2>
        </div>
        <button onClick={onBack} className="text-xs font-bold text-cream-700 flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> رجوع للبيع
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-cream-300 shadow-lg p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={invoiceNumber}
            onChange={e => setInvoiceNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchInvoice()}
            placeholder="رقم الفاتورة"
            dir="ltr"
            className="flex-1 p-2 rounded-xl border border-cream-300 text-sm"
          />
          <button onClick={searchInvoice} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs">
            بحث
          </button>
        </div>
        {searchError && <p className="text-xs text-red-700 font-bold">{searchError}</p>}

        {invoice && (
          <>
            <div className="divide-y divide-cream-100 border-y border-cream-200">
              {lines.map(l => {
                const itm = db.items.find(i => i.id === l.itemId);
                return (
                  <div key={l.id} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">{itm?.nameAr || l.itemId}</div>
                      <div className="text-[11px] text-cream-700 font-mono">
                        بيع: {l.quantity} × {l.unitPrice.toFixed(2)} ج.م
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={l.quantity}
                      step="1"
                      value={qtyByLine[l.id] || 0}
                      onChange={e =>
                        setQtyByLine(prev => ({ ...prev, [l.id]: Math.max(0, Math.min(l.quantity, Number(e.target.value))) }))
                      }
                      className="w-20 p-1.5 rounded-lg border border-cream-300 text-xs text-center"
                    />
                  </div>
                );
              })}
            </div>

            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="سبب المرتجع *"
              className="w-full p-2 rounded-xl border border-cream-300 text-sm"
            />

            {formError && <p className="text-xs text-red-700 font-bold">{formError}</p>}
            {successMsg && <p className="text-xs text-emerald-700 font-bold">{successMsg}</p>}

            <button
              onClick={submitReturn}
              className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm"
            >
              تنفيذ المرتجع
            </button>
          </>
        )}
      </div>
    </div>
  );
};
