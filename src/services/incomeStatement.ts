// Income statement in the company's own layout (columns: الحساب | تحليلي | جزئي | كلي + % of net sales).
// Pure function over the DB snapshot so it can be unit-run with bun and reused for print / Excel export.
import type { ERPDatabaseSchema } from './db';

export type IsRowKind = 'title' | 'header' | 'item' | 'sub' | 'group' | 'band' | 'final' | 'note';
export interface IsRow { kind: IsRowKind; label: string; d?: number; e?: number; f?: number; pct?: number; tone?: 'navy' | 'red' | 'blue' }

const FAMILY_PROVISION = 'acc-6112';
const SALES_ACCOUNTS = ['acc-4101', 'acc-4102', 'acc-4103'];
const OTHER_INCOME = ['acc-4104', 'acc-4105'];
const WAGES = ['acc-5110', 'acc-5111']; // production labour: workers + production/quality staff
// Expense grouping (by account) - same three groups as the monthly sheet.
const GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: 'م . بيعية وتسـويقية :-', ids: ['acc-6118', 'acc-6106', 'acc-6105', 'acc-6115', 'acc-6104'] },
  { title: 'م . تشغيلـــية :-', ids: ['acc-6122', 'acc-6103', 'acc-6116', 'acc-6102', 'acc-6107', 'acc-6108', 'acc-6110', 'acc-6114'] },
  { title: 'م . عمومية وإداريـة :-', ids: ['acc-6119', 'acc-6120', 'acc-6121', 'acc-6101', 'acc-6109', 'acc-6111', 'acc-6113', 'acc-6117', 'acc-7101'] },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];

export function incomeStatementTitle(allPeriods: boolean, from: string, to: string, company: string) {
  let period: string;
  if (allPeriods) period = 'عن كامل الحركات المرحلة';
  else if (from.slice(0, 7) === to.slice(0, 7)) period = `شهر ${MONTHS_AR[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  else period = `عن الفترة من ${from} إلى ${to}`;
  return `قائمة الدخــــــــــــــل\n${period}\nشركــــــة ${company}`;
}

export function buildIncomeStatement(db: ERPDatabaseSchema, opts: { allPeriods: boolean; from: string; to: string }): { rows: IsRow[]; netSales: number; profitBefore: number; netProfit: number; provision: number } {
  const inP = (d: string) => opts.allPeriods || (d >= opts.from && d <= opts.to);
  const accById = new Map(db.accounts.map(a => [a.id, a]));
  // account -> total (debit - credit) and per-description analysis
  const tot = new Map<string, { dr: number; cr: number; lines: Map<string, number> }>();
  let tuition = 0;
  for (const je of db.journalEntries) {
    if (!je.isPosted || !inP(je.date)) continue;
    for (const l of je.lines) {
      let t = tot.get(l.accountId); if (!t) { t = { dr: 0, cr: 0, lines: new Map() }; tot.set(l.accountId, t); }
      t.dr += l.debit; t.cr += l.credit;
      const desc = (l.description || je.description || '').replace(/\s+/g, ' ').trim();
      t.lines.set(desc, (t.lines.get(desc) || 0) + (l.debit - l.credit));
      if (l.accountId === 'acc-2108' && (je.reference || '').startsWith('FAM-')) tuition += l.credit - l.debit;
    }
  }
  const dr = (id: string) => { const t = tot.get(id); return t ? t.dr - t.cr : 0; }; // debit-nature balance
  const cr = (id: string) => -dr(id);
  const name = (id: string) => accById.get(id)?.nameAr || id;

  const rows: IsRow[] = [];
  const gross = SALES_ACCOUNTS.reduce((s, id) => s + (tot.get(id)?.cr || 0), 0);
  const returns = SALES_ACCOUNTS.reduce((s, id) => s + (tot.get(id)?.dr || 0), 0);
  const otherInc = OTHER_INCOME.reduce((s, id) => s + cr(id), 0);
  const netSales = r2(gross - returns + otherInc);
  const pct = (v: number) => (netSales ? v / netSales : 0);

  rows.push({ kind: 'header', label: 'الحســــــــــــــــــــــــــــاب' });
  rows.push({ kind: 'item', label: 'اجمــــــــــــالى المبيعات', e: r2(gross), tone: 'navy' });
  for (const id of SALES_ACCOUNTS) { const v = r2(tot.get(id)?.cr || 0); if (v) rows.push({ kind: 'sub', label: name(id), d: v }); }
  rows.push({ kind: 'item', label: 'مرتجع المبيعات', e: r2(-returns) || 0, tone: 'red' });
  if (otherInc) rows.push({ kind: 'item', label: 'إيرادات أخرى (هالك / فروق عملة)', e: r2(otherInc), tone: 'navy' });
  rows.push({ kind: 'band', label: 'صــــــــــــــــــافى المبيعات', f: netSales });

  const cogsIds = db.accounts.filter(a => !a.isHeader && a.category === 'COGS').map(a => a.id);
  const cogsOther = cogsIds.filter(id => !WAGES.includes(id) && r2(dr(id)) !== 0);
  const cogsTotal = r2(cogsIds.reduce((s, id) => s + dr(id), 0));
  rows.push({ kind: 'item', label: 'يطــــــــــــــــــــــــــرح', tone: 'red' });
  for (const id of WAGES) { const w = r2(dr(id)); if (w) rows.push({ kind: 'item', label: name(id), e: w, tone: 'navy' }); }
  // Production payroll is loaded onto product cost (Dr 5105 -> finished goods -> COGS when sold); show what was loaded in the period for reference.
  const loaded = r2(WAGES.reduce((s, id) => s + (tot.get(id)?.dr || 0), 0));
  const loadedNet = r2(WAGES.reduce((s, id) => s + dr(id), 0));
  if (loaded && Math.abs(loaded - loadedNet) > 0.5) rows.push({ kind: 'sub', label: `أجور الإنتاج المُحمَّلة على تكلفة المنتج (من الرواتب: ${loaded.toLocaleString('en-US')}) - مدرجة ضمن تكلفة البضاعة والمخزون التام`, d: loaded });
  for (const id of cogsOther) rows.push({ kind: 'sub', label: name(id), d: r2(dr(id)) });
  rows.push({ kind: 'group', label: ' تكلفة البضاعه المباعه', f: cogsTotal, pct: pct(cogsTotal) });
  const grossProfit = r2(netSales - cogsTotal);
  rows.push({ kind: 'band', label: 'مجمــــــــــــــــل الربح', f: grossProfit, pct: pct(grossProfit) });

  rows.push({ kind: 'item', label: 'يطـــــــــــــــــــــــــــرح', tone: 'red' });
  let expTotal = 0;
  const used = new Set<string>([FAMILY_PROVISION]);
  const expenseGroups = GROUPS.map(g => ({ ...g, ids: [...g.ids] }));
  // any other expense account with a balance goes to the general group so the total always ties to the books
  const known = new Set(expenseGroups.flatMap(g => g.ids));
  for (const a of db.accounts) if (!a.isHeader && (a.category === 'Operating Expenses' || a.category === 'Other Expenses') && !known.has(a.id) && a.id !== FAMILY_PROVISION) expenseGroups[2].ids.push(a.id);
  for (const g of expenseGroups) {
    const ids = g.ids.filter(id => r2(dr(id)) !== 0);
    const gt = r2(ids.reduce((s, id) => s + dr(id), 0));
    expTotal += gt;
    rows.push({ kind: 'group', label: g.title, f: gt, pct: pct(gt), tone: 'red' });
    for (const id of ids) {
      used.add(id);
      rows.push({ kind: 'item', label: name(id), e: r2(dr(id)) });
      const t = tot.get(id)!;
      if (id === 'acc-6115') continue; // marketing samples: hundreds of per-item stock lines - the sample statement has its own sheet
      const merged = new Map<string, number>();
      for (const [desc, v] of t.lines.entries()) {
        const clean = desc.replace(new RegExp(`\\s*\\(${name(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`), '').trim() || name(id);
        merged.set(clean, (merged.get(clean) || 0) + v);
      }
      for (const [desc, v] of [...merged.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) if (r2(v) !== 0) rows.push({ kind: 'sub', label: desc, d: r2(v) });
    }
  }
  expTotal = r2(expTotal);
  rows.push({ kind: 'band', label: 'اجمـــــــــــــــــــــــالى المصروفات', f: expTotal, pct: pct(expTotal) });
  const profitBefore = r2(grossProfit - expTotal);
  rows.push({ kind: 'band', label: 'الربح قبل خصم المخصص', f: profitBefore, pct: pct(profitBefore), tone: 'blue' });
  const provision = r2(dr(FAMILY_PROVISION));
  rows.push({ kind: 'item', label: 'مخصص الدعم الداخلى 10 %', f: provision, tone: 'blue' });
  if (r2(tuition)) rows.push({ kind: 'sub', label: 'منه: مخصص الرسوم الدراسيه', d: r2(tuition) });
  const netProfit = r2(profitBefore - provision);
  rows.push({ kind: 'final', label: 'صافى الربح', f: netProfit, pct: pct(netProfit) });
  return { rows, netSales, profitBefore, netProfit, provision };
}
