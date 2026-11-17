// معادلات التصنيع القياسية لمنتجات سناك دب (من شيت الإنتاج + بيانات المحاسب).
// الأساس: 1000 قطعة. الشيبس جاهز من المورد بالكيلو؛ كل نكهة لها وزن حصتها، والهالك بمتوسط تقرير الإنتاج.
import { erpDb } from './db';
import { ManufacturingEngine } from './manufacturing';

const BASE = 1000;
const SAUCE = { sweet: 'item-raw-flavor-sweet-chili', spicy: 'item-raw-flavor-spicy-grilled', bbq: 'item-raw-flavor-honey-bbq', burger: 'item-raw-flavor-smokey-burger', mustard: 'item-raw-flavor-honey-mustard' };

/**
 * عدد البورشنات (القطع الفردية) التي تخرج من 1 كجم شيبس = 1000 ÷ وزن الحصة بالجرام.
 * مُتحقَّق منها من فواتير الخليجية مقابل "الكمية" في تقرير الإنتاج: ليمون 1071 كجم = 14,280 قطعة (75 جم)،
 * جمبري 963 كجم = 12,840 (75 جم)، فراخ 563.75 كجم = 10,250 (55 جم للحصة؛ الديو = حصتين)، ناتشوز 65 جم.
 */
export const CHIP_YIELD: Record<string, number> = {
  'item-raw-chip-chicken': 1000 / 55, 'item-raw-chip-beef-bbq': 1000 / 55, 'item-raw-chip-krinkle': 1000 / 60,
  'item-raw-chip-fire-lemon': 1000 / 75, 'item-raw-chip-fire-shrimp': 1000 / 75,
  'item-raw-chip-nacho-salt': 1000 / 65, 'item-raw-chip-nacho-cheese': 1000 / 65, 'item-raw-chip-nacho-paprika': 1000 / 65, 'item-raw-chip-dibi-shells': 1000 / 55,
};

/** متوسط نسبة الهالك % من تقرير "سحب الخامات" (هالك ÷ سحب لكل خامة، يوليو-أكتوبر 2026). */
export const CHIP_WASTE: Record<string, number> = {
  'item-raw-chip-chicken': 0.5, 'item-raw-chip-beef-bbq': 0.5, 'item-raw-chip-krinkle': 1.0,
  'item-raw-chip-fire-lemon': 1.4, 'item-raw-chip-fire-shrimp': 6.1,
  'item-raw-chip-nacho-salt': 0.5, 'item-raw-chip-nacho-cheese': 0.9, 'item-raw-chip-nacho-paprika': 0.5, 'item-raw-chip-dibi-shells': 0.3,
};
const SAUCE_WASTE = 5.8; // متوسط (سويت 10.1، برجر 4.6، باربكيو 2.8)

interface Formula { chip: string; sauces: string[]; duo: boolean }
export const STANDARD_FORMULAS: Record<string, Formula> = {
  'item-fp-d1': { chip: 'item-raw-chip-beef-bbq', sauces: [SAUCE.burger, SAUCE.bbq], duo: true },
  'item-fp-d2': { chip: 'item-raw-chip-beef-bbq', sauces: [SAUCE.burger, SAUCE.mustard], duo: true },
  'item-fp-d3': { chip: 'item-raw-chip-chicken', sauces: [SAUCE.sweet, SAUCE.spicy], duo: true },
  'item-fp-d4': { chip: 'item-raw-chip-chicken', sauces: [SAUCE.sweet, SAUCE.bbq], duo: true },
  'item-fp-d5': { chip: 'item-raw-chip-dibi-shells', sauces: [SAUCE.sweet, SAUCE.bbq], duo: true },
  'item-fp-s1': { chip: 'item-raw-chip-fire-lemon', sauces: [SAUCE.sweet], duo: false },
  'item-fp-s2': { chip: 'item-raw-chip-fire-shrimp', sauces: [SAUCE.spicy], duo: false },
  'item-fp-s3': { chip: 'item-raw-chip-nacho-salt', sauces: [SAUCE.bbq], duo: false },
  'item-fp-s4': { chip: 'item-raw-chip-nacho-paprika', sauces: [SAUCE.sweet], duo: false },
  'item-fp-s5': { chip: 'item-raw-chip-nacho-cheese', sauces: [SAUCE.burger], duo: false },
  'item-fp-s6': { chip: 'item-raw-chip-krinkle', sauces: [SAUCE.mustard], duo: false },
};

export function formulaLines(f: Formula) {
  const portions = f.duo ? 2 : 1;
  const L = (materialItemId: string, quantityRequired: number, unitId: string, wastePercentage = 0) => ({ materialItemId, quantityRequired: Number(quantityRequired.toFixed(4)), unitId, ...(wastePercentage ? { wastePercentage } : {}) });
  return [
    L(f.chip, (portions * BASE) / CHIP_YIELD[f.chip], 'unit-kg', CHIP_WASTE[f.chip]),
    // رول الفيلم: تكلفة الرول على القطعة في شيت التكاليف 1.10 للسنجل و1.57 للديو (سعر الرول 176) => 6.25 / 8.92 رول لكل 1000 قطعة
    L('item-pkg-film', f.duo ? 8.92 : 6.25, 'unit-roll'),
    ...f.sauces.map(id => L(id, BASE, 'unit-piece', SAUCE_WASTE)),
    L(f.duo ? 'item-pkg-box-duo' : 'item-pkg-box-single', BASE, 'unit-piece', f.duo ? 6.8 : 1.1),
    ...(f.duo
      ? [L('item-pkg-tray', BASE, 'unit-piece', 2.7), L('item-pkg-sauce-tray', BASE, 'unit-piece', 7.2), L('item-pkg-liner', BASE, 'unit-piece')]
      : [L('item-pkg-sauce-tray', BASE, 'unit-piece', 1.6)]),
    L('item-pkg-glue', 0.75, 'unit-kg'),   // غراء: 10 كجم لكل ~13,345 قطعة في شيت التكاليف = 0.75 جم/قطعة
    L('item-pkg-sticker', (f.duo ? 2 : 1) * BASE, 'unit-piece'),
    L('item-pkg-napkin', (f.duo ? 2 : 1) * BASE, 'unit-piece', 0.1),
    L(f.duo ? 'item-pkg-kraft-duo' : 'item-pkg-kraft-single', BASE / (f.duo ? 8 : 15), 'unit-piece', f.duo ? 2.0 : 0.8),
  ];
}

/** ينشئ معادلة لكل منتج تام (نسخة جديدة وتوقف القديمة). يتخطى المنتج لو معادلته الفعالة قياسية بالفعل. */
export function installStandardBoms(actor: { userId?: string; userName?: string; isTest?: boolean }, date = '2026-11-01'): { success: boolean; created: number; error?: string } {
  let created = 0;
  for (const [fpId, f] of Object.entries(STANDARD_FORMULAS)) {
    const db = erpDb.getSnapshot();
    if (!db.items.find(i => i.id === fpId)) continue;
    const existing = db.boms.find(b => b.finishedItemId === fpId && b.active && (b.notes || '').startsWith('معادلة قياسية'));
    if (existing) continue;
    const r = ManufacturingEngine.createBomVersion({
      finishedItemId: fpId, baseQuantity: BASE, unitId: 'unit-piece', effectiveDate: date,
      notes: 'معادلة قياسية — من شيت الإنتاج (شيبس بالكيلو بوزن الحصة، هالك بمتوسط التقرير)', lines: formulaLines(f), ...actor,
    });
    if (!r.success) return { success: false, created, error: `${fpId}: ${r.error}` };
    created++;
  }
  return { success: true, created };
}
