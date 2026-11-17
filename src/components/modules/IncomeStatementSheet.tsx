import React from 'react';
import type { IsRow } from '../../services/incomeStatement';

const NAVY = '#2E75B6';       // header / band fill (same blue as the monthly sheet)
const PEACH = '#F8CBAD';      // "profit before provision" band
const BLUE = '#0070C0';       // final net-profit fill
const TONE: Record<string, string> = { navy: '#002060', red: '#FF0000', blue: '#0070C0' };

const fmt = (n?: number) => (n === undefined ? '' : (n === 0 ? 0 : n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtPct = (n?: number) => (n === undefined ? '' : `${(n * 100).toFixed(1)}%`);

interface Style { fill?: string; color: string; bold: boolean; size: number; border: string }
function styleOf(r: IsRow): Style {
  switch (r.kind) {
    case 'header': return { fill: NAVY, color: '#fff', bold: true, size: 14, border: '2px solid #000' };
    case 'band': return r.tone === 'blue'
      ? { fill: PEACH, color: '#1F3864', bold: true, size: 14, border: '2px solid #000' }
      : { fill: NAVY, color: '#fff', bold: true, size: 14, border: '2px solid #000' };
    case 'final': return { fill: BLUE, color: '#fff', bold: true, size: 14, border: '2px solid #000' };
    case 'group': return { color: r.tone ? TONE[r.tone] : '#FF0000', bold: true, size: 12, border: '1px solid #bbb' };
    case 'sub': return { color: '#0070C0', bold: true, size: 11, border: '1px dotted #bbb' };
    default: return { color: r.tone ? TONE[r.tone] : '#000', bold: true, size: 12, border: '1px dotted #bbb' };
  }
}

/** One table, four columns (الحساب | تحليلى | جزئى | كلى) + % of net sales - used for screen, print and Excel. */
export function incomeStatementHtml(title: string, rows: IsRow[], opts: { forExcel?: boolean } = {}): string {
  const cell = (st: Style, v: string, extra = '') =>
    `<td style="border:${st.border};${st.fill ? `background:${st.fill};` : ''}color:${st.color};font-weight:${st.bold ? 700 : 400};font-size:${st.size}px;text-align:center;padding:3px 6px;${extra}">${v}</td>`;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
  const head = `<tr><td colspan="5" style="background:${NAVY};color:#fff;font-weight:700;font-size:20px;text-align:center;padding:14px;border:2px solid #000;font-family:'Times New Roman',serif;line-height:1.7">${esc(title)}</td></tr>`;
  const body = rows.map(r => {
    const st = styleOf(r);
    if (r.kind === 'header') {
      return `<tr>${cell(st, esc(r.label), 'width:38%')}${cell(st, 'تحليـــــلى')}${cell(st, 'جـــــزئى')}${cell(st, 'كلــــــى')}${cell(st, '%')}</tr>`;
    }
    const empty = { ...st, fill: st.fill };
    return `<tr>${cell(st, esc(r.label), `text-align:${r.kind === 'sub' ? 'right' : 'center'};${r.kind === 'sub' ? 'padding-right:22px;' : ''}`)}${cell(empty, fmt(r.d))}${cell(empty, fmt(r.e))}${cell(empty, fmt(r.f))}${cell(empty, fmtPct(r.pct))}</tr>`;
  }).join('');
  return `<table dir="rtl" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif" ${opts.forExcel ? 'border="1"' : ''}>${head}${body}</table>`;
}

export function exportIncomeStatementExcel(title: string, rows: IsRow[], filename: string) {
  const html = `<html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>قائمة الدخل</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${incomeStatementHtml(title, rows, { forExcel: true })}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const IncomeStatementSheet: React.FC<{ title: string; rows: IsRow[] }> = ({ title, rows }) => (
  <div className="print-area bg-white rounded-2xl border border-slate-200 shadow-xs p-3 sm:p-6 max-w-4xl mx-auto overflow-x-auto"
       dangerouslySetInnerHTML={{ __html: incomeStatementHtml(title, rows) }} />
);
