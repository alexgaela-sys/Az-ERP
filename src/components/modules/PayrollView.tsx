import React, { useMemo, useState } from 'react';
import { Users, Plus, Trash2, ClipboardPaste, CheckCircle2 } from 'lucide-react';
import { erpDb } from '../../services/db';
import { WorkflowService } from '../../services/workflows';
import { ManufacturingEngine } from '../../services/manufacturing';
import { AuthService } from '../../services/auth';

/** Department → expense account (each lands in its own group in the income statement). */
const DEPTS: Array<{ id: string; label: string; accountId: string; production?: boolean; match: RegExp }> = [
  { id: 'prod_workers', label: 'إنتاج - عمال', accountId: 'acc-5110', production: true, match: /^ع\s*انتاج|عامل|عمال/ },
  { id: 'prod_staff', label: 'إنتاج - كوادر وجودة', accountId: 'acc-5111', production: true, match: /م\s*انتاج|م\s*جود|جودة|مشرف/ },
  { id: 'sales', label: 'مبيعات', accountId: 'acc-6118', match: /مبيعات|مندوب|سائق/ },
  { id: 'admin', label: 'إدارة ومالية', accountId: 'acc-6119', match: /محاسب|مالي|ادار|إدار|موارد/ },
  { id: 'ceo', label: 'الإدارة العليا (CEO)', accountId: 'acc-6120', match: /ceo|مدير عام|رئيس/i },
  { id: 'prod_comm', label: 'عمولات إنتاج', accountId: 'acc-6122', match: /عمولة انتاج|عمولات انتاج/ },
];
const guessDept = (job: string) => (DEPTS.find(d => d.match.test(job.trim())) || DEPTS[3]).id;
const n = (v: string | number) => { const x = Number(String(v).replace(/,/g, '').trim()); return Number.isFinite(x) ? x : 0; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const f = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Row { name: string; dept: string; gross: number; absence: number; penalty: number; advance: number }
const blank = (): Row => ({ name: '', dept: 'prod_workers', gross: 0, absence: 0, penalty: 0, advance: 0 });

export const PayrollView: React.FC = () => {
  const db = erpDb.getSnapshot();
  const [, setTick] = useState(0);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [paste, setPaste] = useState('');
  const [absorb, setAbsorb] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reference = `PAYROLL-${month}`;
  const alreadyPosted = db.journalEntries.some(j => j.reference === reference && j.isPosted && !j.isReversed);
  const expenseOf = (r: Row) => r2(r.gross - r.absence - r.penalty);
  const byDept = useMemo(() => DEPTS.map(d => {
    const rs = rows.filter(r => r.dept === d.id);
    return { d, count: rs.length, expense: r2(rs.reduce((s, r) => s + expenseOf(r), 0)) };
  }).filter(x => x.count > 0), [rows]);
  const totalExpense = r2(rows.reduce((s, r) => s + expenseOf(r), 0));
  const totalAdv = r2(rows.reduce((s, r) => s + r.advance, 0));
  const net = r2(totalExpense - totalAdv);
  const prodTotal = r2(byDept.filter(x => x.d.production).reduce((s, x) => s + x.expense, 0));

  const upd = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const importPaste = () => {
    const parsed: Row[] = [];
    for (const line of paste.split(/\r?\n/)) {
      const c = line.split('\t');
      if (c.length < 3 || !c[0].trim()) continue;
      const gross = n(c[2]); if (!gross && !n(c[3] || 0)) continue;
      parsed.push({ name: c[0].trim(), dept: guessDept(c[1] || ''), gross, absence: n(c[3] || 0), penalty: n(c[4] || 0), advance: n(c[5] || 0) });
    }
    if (parsed.length === 0) { setMsg({ ok: false, text: 'لم يتم التعرف على أي صف. الأعمدة: الاسم | الوظيفة | المستحقات | الغياب (القيمة) | الجزاءات (القيمة) | السلف' }); return; }
    setRows(parsed); setPaste(''); setMsg({ ok: true, text: `تم استيراد ${parsed.length} موظف — راجع القسم لكل موظف قبل الترحيل` });
  };

  const post = () => {
    setMsg(null);
    if (alreadyPosted) { setMsg({ ok: false, text: `رواتب ${month} مرحّلة بالفعل (${reference})` }); return; }
    const valid = rows.filter(r => r.name.trim() && r.gross > 0);
    if (valid.length === 0) { setMsg({ ok: false, text: 'أدخل موظفًا واحدًا على الأقل بمستحقات أكبر من صفر' }); return; }
    const [y, m] = month.split('-').map(Number);
    const date = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const user = AuthService.getCurrentSession()?.user;
    const res = WorkflowService.postPayroll({
      date, reference, description: `رواتب شهر ${m}/${y}`,
      lines: valid.map(r => ({ accountId: DEPTS.find(d => d.id === r.dept)!.accountId, amount: expenseOf(r), description: r.name })),
      advancesRecovered: valid.reduce((s, r) => s + r.advance, 0), userId: user?.id, userName: user?.name,
    });
    if (!res.success) { setMsg({ ok: false, text: res.error || 'تعذر ترحيل الرواتب' }); return; }
    let extra = '';
    if (absorb && prodTotal > 0) {
      const split = DEPTS.filter(d => d.production).map(d => ({ accountId: d.accountId, amount: r2(valid.filter(r => r.dept === d.id).reduce((s, r) => s + expenseOf(r), 0)) })).filter(x => x.amount > 0);
      const dist = ManufacturingEngine.distributeProductionPayroll({
        period: month, costType: 'direct_labor', totalAmount: prodTotal, sourceDescription: `${reference} - رواتب الإنتاج`, date,
        alreadyRecognized: true, creditSplit: split, userId: user?.id, userName: user?.name,
      });
      extra = dist.success ? ` — وتم تحميل أجور الإنتاج (${f(prodTotal)}) على ${dist.distribution?.allocations.length} أمر إنتاج` : ` — تنبيه: لم تُحمَّل أجور الإنتاج على الأوامر: ${dist.error}`;
    }
    setMsg({ ok: true, text: `تم ترحيل الرواتب. صافي المستحق ${f(res.net || 0)}${extra}` });
    setTick(t => t + 1);
  };

  const history = db.journalEntries.filter(j => j.sourceDocumentType === 'payroll' && j.isPosted)
    .map(j => ({ j, total: r2(j.lines.reduce((s, l) => s + l.debit, 0)) })).sort((a, b) => b.j.date.localeCompare(a.j.date));
  const payable = db.journalEntries.filter(j => j.isPosted).reduce((s, j) => s + j.lines.filter(l => l.accountId === 'acc-2109').reduce((a, l) => a + l.credit - l.debit, 0), 0);
  const inp = 'w-full px-2 py-1 rounded border border-slate-300 text-xs font-mono text-center';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><Users className="w-5 h-5" /> رواتب الموظفين والأقسام</h2>
          <p className="text-xs text-slate-500 mt-1">يوزّع الرواتب على أقسامها (إنتاج / مبيعات / إدارة) وتظهر كل مجموعة في قائمة الدخل، وأجور الإنتاج تُحمَّل على تكلفة المنتج.</p>
        </div>
        <div className="text-xs font-bold bg-slate-100 border border-slate-200 rounded-xl px-3 py-2">رواتب مستحقة غير مسددة: <span className="font-mono">{f(payable)}</span> ج.م</div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-slate-700 flex flex-col gap-1">الشهر<input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs" /></label>
          {alreadyPosted && <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">رواتب هذا الشهر مرحّلة بالفعل</span>}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-indigo-700 flex items-center gap-1"><ClipboardPaste className="w-4 h-4 inline" /> لصق من الإكسل</summary>
          <p className="text-slate-500 my-1">انسخ من الشيت الأعمدة بالترتيب: الاسم | الوظيفة | اجمالى مستحقات | قيمة الغياب | قيمة الجزاءات | السلف — ثم الصق هنا.</p>
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={4} className="w-full border border-slate-300 rounded-lg p-2 font-mono text-[11px]" placeholder={'اسم الموظف\tع انتاج\t5998.5\t172\t145\t2000'} />
          <button onClick={importPaste} className="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold text-xs">استيراد</button>
        </details>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-700">
              <th className="p-2">الاسم</th><th className="p-2">القسم</th><th className="p-2">المستحقات</th><th className="p-2">الغياب</th><th className="p-2">الجزاءات</th><th className="p-2">السلف</th><th className="p-2">المصروف</th><th className="p-2">الصافي</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="p-1"><input className={inp} value={r.name} onChange={e => upd(i, { name: e.target.value })} /></td>
                  <td className="p-1"><select className={inp} value={r.dept} onChange={e => upd(i, { dept: e.target.value })}>{DEPTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></td>
                  {(['gross', 'absence', 'penalty', 'advance'] as const).map(k => <td key={k} className="p-1"><input className={inp} type="number" value={r[k] || ''} onChange={e => upd(i, { [k]: n(e.target.value) } as Partial<Row>)} /></td>)}
                  <td className="p-1 font-mono text-center">{f(expenseOf(r))}</td>
                  <td className="p-1 font-mono text-center">{f(expenseOf(r) - r.advance)}</td>
                  <td className="p-1"><button onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, k) => k !== i) : rs)} className="text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => setRows(rs => [...rs, blank()])} className="flex items-center gap-1 text-xs font-bold text-slate-700"><Plus className="w-4 h-4" /> إضافة موظف</button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <h3 className="text-sm font-black text-slate-800">ملخص التوزيع على الأقسام</h3>
        <table className="w-full text-xs">
          <tbody>
            {byDept.map(x => <tr key={x.d.id} className="border-b border-slate-100"><td className="p-1.5">{x.d.label} ({x.count})</td><td className="p-1.5 text-slate-500">{db.accounts.find(a => a.id === x.d.accountId)?.nameAr}</td><td className="p-1.5 font-mono text-left">{f(x.expense)}</td></tr>)}
            <tr className="font-black"><td className="p-1.5" colSpan={2}>إجمالي المصروف</td><td className="p-1.5 font-mono text-left">{f(totalExpense)}</td></tr>
            <tr><td className="p-1.5" colSpan={2}>يُخصم: سلف مستردة</td><td className="p-1.5 font-mono text-left">({f(totalAdv)})</td></tr>
            <tr className="font-black"><td className="p-1.5" colSpan={2}>صافي الرواتب المستحقة</td><td className="p-1.5 font-mono text-left">{f(net)}</td></tr>
          </tbody>
        </table>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" checked={absorb} onChange={e => setAbsorb(e.target.checked)} />
          تحميل أجور الإنتاج ({f(prodTotal)}) على أوامر إنتاج الشهر (تكلفة المنتج)
        </label>
        <button onClick={post} disabled={alreadyPosted} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs">ترحيل رواتب الشهر</button>
        {msg && <div className={`text-xs font-bold rounded-lg p-2 border ${msg.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>{msg.ok && <CheckCircle2 className="w-4 h-4 inline ml-1" />}{msg.text}</div>}
        <p className="text-[11px] text-slate-500">سداد الرواتب نفسه يتم من الخزينة/البنك على حساب "رواتب وأجور مستحقة".</p>
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-black text-slate-800 mb-2">رواتب مرحّلة</h3>
          {history.map(({ j, total }) => <div key={j.id} className="flex justify-between text-xs border-b border-slate-100 py-1"><span>{j.date} — {j.description}</span><span className="font-mono">{f(total)}</span></div>)}
        </div>
      )}
    </div>
  );
};
