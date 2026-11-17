// Super-Admin-only document administration: full cancellation (reversal) of posted
// sales / purchase invoices and returns, plus correction of opening stock.
// "Edit" = cancel + re-enter (cleanest accounting trail: nothing is overwritten,
// every correction is a visible reversing journal + audit log).
import { erpDb, generateErpId } from './db';
import { AccountingEngine } from './accounting';
import { AuthorizationService } from './authorization';
import { InventoryTransaction } from '../types/erp';

export type CancellableDoc = 'sales_invoice' | 'purchase_invoice' | 'sales_return' | 'purchase_return';
export interface AdminOptions { userId?: string; userName?: string; reason?: string; }
export interface AdminResult { success: boolean; error?: string; reversedJournals?: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;

export class DocumentAdminService {
  private static fail(error: string): AdminResult { return { success: false, error }; }

  /** Journals that belong to a document (not yet reversed, not reversals). */
  private static journalsOf(ids: string[]) {
    const db = erpDb.getSnapshot();
    return db.journalEntries.filter(j =>
      !!j.sourceDocumentId && ids.includes(j.sourceDocumentId) && j.sourceDocumentType !== 'journal_reversal');
  }

  /** Inventory transactions of the document, ignoring earlier cancellation entries. */
  private static txsOf(docNumbers: string[]): InventoryTransaction[] {
    const db = erpDb.getSnapshot();
    return db.inventoryTransactions.filter(t =>
      docNumbers.includes(t.documentNumber) && t.documentType !== 'document_cancellation');
  }

  /** Pre-check: receipts can be removed only if their batch still holds the quantity. */
  private static checkInventory(txs: InventoryTransaction[]): string | undefined {
    const db = erpDb.getSnapshot();
    const need = new Map<string, number>();
    for (const t of txs) {
      if (t.quantityIn > 0) {
        const key = `${t.itemId}|${t.warehouseId}|${t.batchNumber}`;
        need.set(key, (need.get(key) || 0) + t.quantityIn);
      }
    }
    for (const [key, qty] of need) {
      const [itemId, warehouseId, batchNumber] = key.split('|');
      const b = db.batches.find(x => x.itemId === itemId && x.warehouseId === warehouseId && x.batchNumber === batchNumber);
      const have = b ? b.quantity : 0;
      if (have + 1e-9 < qty) {
        const item = db.items.find(i => i.id === itemId);
        return `لا يمكن الإلغاء: الكمية المستلمة من الصنف (${item?.nameAr || itemId}) تم صرف جزء منها (المتاح ${have} من ${qty}). ألغِ المستندات اللاحقة أولاً`;
      }
    }
    return undefined;
  }

  private static cancel(kind: CancellableDoc, docId: string, opts: AdminOptions): AdminResult {
    const guard = AuthorizationService.requireSuperAdmin(opts);
    if (!guard.allowed) return this.fail(guard.error || 'غير مصرح');
    const reason = (opts.reason || '').trim();
    if (!reason) return this.fail('سبب الإلغاء مطلوب');

    const db = erpDb.getSnapshot();
    type Doc = { id: string; status: string; journalEntryId?: string };
    let doc: (Doc & Record<string, any>) | undefined;
    let number = '';
    if (kind === 'sales_invoice') { doc = db.salesInvoices.find(d => d.id === docId) as any; number = doc?.invoiceNumber; }
    if (kind === 'purchase_invoice') { doc = db.purchaseInvoices.find(d => d.id === docId) as any; number = doc?.invoiceNumber; }
    if (kind === 'sales_return') { doc = db.salesReturns.find(d => d.id === docId) as any; number = doc?.returnNumber; }
    if (kind === 'purchase_return') { doc = db.purchaseReturns.find(d => d.id === docId) as any; number = doc?.returnNumber; }
    if (!doc) return this.fail('المستند غير موجود');
    if (doc.status === 'cancelled') return this.fail('المستند ملغي مسبقًا');

    // ---- unsupported side effects → refuse before touching anything ----
    if (kind === 'sales_return') {
      if ((doc.withholdingReversedAmountEGP || 0) > 0 ||
          db.withholdingAdjustments.some(w => w.salesReturnId === doc!.id)) {
        return this.fail('مرتجع المبيعات مرتبط بتسوية ضريبة خصم وإضافة — يلزم تسويتها يدويًا قبل الإلغاء');
      }
    }
    if (kind === 'sales_invoice') {
      if (db.salesReturns.some(r => r.invoiceId === doc!.id && r.status !== 'cancelled')) {
        return this.fail('على الفاتورة مرتجعات مبيعات — ألغِ المرتجعات أولاً');
      }
      if (db.exportShipments?.some(s => s.salesInvoiceId === doc!.id)) {
        return this.fail('الفاتورة مرتبطة بشحنة تصدير — فك الارتباط أولاً');
      }
    }
    if (kind === 'purchase_invoice') {
      if (db.purchaseReturns.some(r => r.purchaseInvoiceId === doc!.id && r.status !== 'cancelled')) {
        return this.fail('على الفاتورة مرتجعات مشتريات — ألغِ المرتجعات أولاً');
      }
    }

    const journals = this.journalsOf([doc.id]).filter(j => !j.isReversed);
    const txs = this.txsOf([number]);
    const invErr = this.checkInventory(txs);
    if (invErr) return this.fail(invErr);

    // ---- 1) GL: reverse every journal of the document ----
    let reversed = 0;
    for (const j of journals) {
      const res = AccountingEngine.reverseJournal(j.id, `إلغاء ${number}: ${reason}`, guard.userId, guard.userName);
      if (!res.success) {
        return { success: false, reversedJournals: reversed, error: `فشل عكس القيد ${j.entryNumber}: ${res.error}` };
      }
      reversed++;
    }

    // ---- 2) stock + balances + status in one atomic mutation ----
    const today = new Date().toISOString().slice(0, 10);
    erpDb.mutate(draft => {
      for (const t of txs) {
        if (t.quantityOut > 0) {
          // restore consumed stock into its batch at the issued cost (value-preserving)
          let b = draft.batches.find(x => x.itemId === t.itemId && x.warehouseId === t.warehouseId && x.batchNumber === t.batchNumber);
          if (b) {
            const q = b.quantity + t.quantityOut;
            b.unitCost = q > 0 ? (b.quantity * b.unitCost + t.quantityOut * t.unitCost) / q : t.unitCost;
            b.quantity = q;
          } else {
            draft.batches.push({
              id: generateErpId('bat'), batchNumber: t.batchNumber || `CXL-${number}`,
              itemId: t.itemId, warehouseId: t.warehouseId, productionDate: t.date, expiryDate: '',
              quantity: t.quantityOut, unitCost: t.unitCost,
            });
          }
        } else if (t.quantityIn > 0) {
          const b = draft.batches.find(x => x.itemId === t.itemId && x.warehouseId === t.warehouseId && x.batchNumber === t.batchNumber);
          if (b) b.quantity = Math.max(0, b.quantity - t.quantityIn);
        }
        const balanceAfter = draft.batches
          .filter(x => x.itemId === t.itemId && x.warehouseId === t.warehouseId)
          .reduce((s, x) => s + x.quantity, 0);
        draft.inventoryTransactions.push({
          id: generateErpId('itx'), date: today, documentType: 'document_cancellation',
          documentNumber: number, movementType: 'inventory_adjustment', itemId: t.itemId,
          warehouseId: t.warehouseId, batchNumber: t.batchNumber,
          quantityIn: t.quantityOut, quantityOut: t.quantityIn, balanceAfter,
          unitCost: t.unitCost, totalCost: t.totalCost, notes: `عكس حركة ${number} - إلغاء مستند`,
        });
      }

      // party balances (the same single movement the document made)
      if (kind === 'sales_invoice' && doc!.paymentMethod === 'credit') {
        const c = draft.customers.find(x => x.id === doc!.customerId);
        if (c) c.currentBalance = r2((c.currentBalance || 0) - doc!.totalAmount);
      }
      if (kind === 'purchase_invoice' && doc!.paymentMethod === 'credit') {
        const s = draft.suppliers.find(x => x.id === doc!.supplierId);
        if (s) s.currentBalance = r2((s.currentBalance || 0) - doc!.totalAmountEGP);
      }
      if (kind === 'sales_return') {
        const c = draft.customers.find(x => x.id === doc!.customerId);
        if (c) c.currentBalance = r2((c.currentBalance || 0) + doc!.totalAmount);
      }
      if (kind === 'purchase_return') {
        const s = draft.suppliers.find(x => x.id === doc!.supplierId);
        if (s) s.currentBalance = r2((s.currentBalance || 0) + doc!.totalAmount + (doc!.totalVat || 0));
      }

      // cash documents: drop the linked treasury receipt, rep-custody sale lines
      const jIds = new Set(journals.map(j => j.id));
      draft.treasuryTransactions = draft.treasuryTransactions.filter(t => !(t.journalEntryId && jIds.has(t.journalEntryId)));
      if (kind === 'sales_invoice') {
        draft.custodyMovements = draft.custodyMovements.filter(m => m.referenceDoc !== number);
      }

      const target: any =
        kind === 'sales_invoice' ? draft.salesInvoices.find(d => d.id === docId) :
        kind === 'purchase_invoice' ? draft.purchaseInvoices.find(d => d.id === docId) :
        kind === 'sales_return' ? draft.salesReturns.find(d => d.id === docId) :
        draft.purchaseReturns.find(d => d.id === docId);
      if (target) {
        target.status = 'cancelled';
        target.cancelledAt = new Date().toISOString();
        target.cancelledBy = guard.userName;
        target.cancelReason = reason;
      }

      draft.auditLogs.push({
        id: generateErpId('aud'), timestamp: new Date().toISOString(),
        userId: guard.userId, userName: guard.userName || 'Super Admin',
        module: 'إدارة المستندات', action: 'cancel', recordId: docId,
        description: `إلغاء ${number} (${kind}) — السبب: ${reason}`,
      });
    });
    return { success: true, reversedJournals: reversed };
  }

  public static cancelSalesInvoice(id: string, o: AdminOptions) { return this.cancel('sales_invoice', id, o); }
  public static cancelPurchaseInvoice(id: string, o: AdminOptions) { return this.cancel('purchase_invoice', id, o); }
  public static cancelSalesReturn(id: string, o: AdminOptions) { return this.cancel('sales_return', id, o); }
  public static cancelPurchaseReturn(id: string, o: AdminOptions) { return this.cancel('purchase_return', id, o); }

  /**
   * Correct an opening-balance batch (quantity and/or unit cost). The value difference
   * is posted against opening equity (acc-3103) so GL == stock value stays true.
   */
  public static correctOpeningBatch(params: {
    batchId: string; newQuantity: number; newUnitCost: number;
    inventoryAccountId: string; reason: string; date?: string;
  } & AdminOptions): AdminResult {
    const guard = AuthorizationService.requireSuperAdmin(params);
    if (!guard.allowed) return this.fail(guard.error || 'غير مصرح');
    if (!params.reason?.trim()) return this.fail('سبب التعديل مطلوب');
    if (!(params.newQuantity >= 0) || !(params.newUnitCost >= 0)) return this.fail('كمية أو تكلفة غير صحيحة');
    const db = erpDb.getSnapshot();
    const b = db.batches.find(x => x.id === params.batchId);
    if (!b) return this.fail('التشغيلة غير موجودة');
    if (!db.accounts.some(a => a.id === params.inventoryAccountId)) return this.fail('حساب المخزون غير موجود');
    if (!db.accounts.some(a => a.id === 'acc-3103')) return this.fail('حساب أرصدة أول المدة (3103) غير موجود');
    const oldVal = r2(b.quantity * b.unitCost);
    const newVal = r2(params.newQuantity * params.newUnitCost);
    const delta = r2(newVal - oldVal);
    const date = params.date || new Date().toISOString().slice(0, 10);
    const ref = `OB-FIX-${b.batchNumber}`;

    if (delta !== 0) {
      const amt = Math.abs(delta);
      const inv = { accountId: params.inventoryAccountId };
      const eq = { accountId: 'acc-3103' };
      const mk = (a: { accountId: string }, d: number, c: number) => ({
        accountId: a.accountId, debit: d, credit: c, debitBase: d, creditBase: c,
        currency: 'EGP', exchangeRate: 1, description: `تصحيح رصيد أول المدة - ${ref}`,
      }) as any;
      const jv = AccountingEngine.postJournal({
        date, reference: ref, description: `تصحيح رصيد أول المدة (${params.reason})`,
        sourceDocumentType: 'opening_correction', sourceDocumentId: b.id,
        lines: delta > 0 ? [mk(inv, amt, 0), mk(eq, 0, amt)] : [mk(eq, amt, 0), mk(inv, 0, amt)],
      } as any, guard.userId, guard.userName);
      if (!jv.success) return this.fail(jv.error || 'فشل ترحيل قيد التصحيح');
    }
    erpDb.mutate(draft => {
      const t = draft.batches.find(x => x.id === params.batchId)!;
      const dq = params.newQuantity - t.quantity;
      t.quantity = params.newQuantity;
      t.unitCost = params.newUnitCost;
      const balanceAfter = draft.batches.filter(x => x.itemId === t.itemId && x.warehouseId === t.warehouseId)
        .reduce((s, x) => s + x.quantity, 0);
      draft.inventoryTransactions.push({
        id: generateErpId('itx'), date, documentType: 'document_cancellation', documentNumber: ref,
        movementType: 'inventory_adjustment', itemId: t.itemId, warehouseId: t.warehouseId,
        batchNumber: t.batchNumber, quantityIn: dq > 0 ? dq : 0, quantityOut: dq < 0 ? -dq : 0,
        balanceAfter, unitCost: params.newUnitCost, totalCost: delta,
        notes: `تصحيح رصيد أول المدة: ${params.reason}`,
      });
      draft.auditLogs.push({
        id: generateErpId('aud'), timestamp: new Date().toISOString(), userId: guard.userId,
        userName: guard.userName || 'Super Admin', module: 'إدارة المستندات', action: 'update',
        recordId: params.batchId, description: `تصحيح تشغيلة ${t.batchNumber}: ${oldVal} → ${newVal} (${params.reason})`,
      });
    });
    return { success: true };
  }
}
