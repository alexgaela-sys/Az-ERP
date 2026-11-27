// Shared UI primitives & design-system helpers for YZ ERP.
// Presentation-only: no business logic, no engine calls.

import React from 'react';
import { Inbox } from 'lucide-react';

/* ============================================================
   Formatting helpers (Arabic-first, EGP/USD)
   ============================================================ */

export function formatEGP(value: number | undefined | null, opts?: { signed?: boolean }): string {
  const v = Number(value || 0);
  const sign = v < 0 ? '-' : opts?.signed && v > 0 ? '+' : '';
  return `${sign}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`;
}

export function formatUSD(value: number | undefined | null): string {
  const v = Number(value || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function formatNum(value: number | undefined | null): string {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/* ============================================================
   Page header
   ============================================================ */

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, icon: Icon, accent = 'bg-brand-50 text-brand-600', actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
    <div className="flex items-center gap-3">
      {Icon && (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div>
        <h2 className="page-title">{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

/* ============================================================
   Section card
   ============================================================ */

export const SectionCard: React.FC<{
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Shows money: hidden from people without the "prices" permission. */
  money?: boolean;
}> = ({ title, hint, icon: Icon, headerAction, children, className = '', money }) => (
  <div className={`card ${className}`} {...(money ? { 'data-price': true } : {})}>
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-cream-200">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="w-5 h-5 text-brand-600 shrink-0" />}
        <div className="min-w-0">
          <h3 className="text-sm font-black text-ink-900 truncate">{title}</h3>
          {hint && <p className="text-[11px] text-cream-600 font-medium">{hint}</p>}
        </div>
      </div>
      {headerAction && <div className="shrink-0">{headerAction}</div>}
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </div>
);

/* ============================================================
   Status badge — canonical color system for the whole app
   ============================================================ */

export type StatusTone =
  | 'success' | 'warning' | 'error' | 'pending'
  | 'draft' | 'brand' | 'purple' | 'cream';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  pending: 'badge-pending',
  draft: 'badge-draft',
  brand: 'badge-brand',
  purple: 'badge-purple',
  cream: 'badge-cream',
};

export const StatusBadge: React.FC<{ label: string; tone: StatusTone }> = ({ label, tone }) => (
  <span className={TONE_CLASS[tone]}>{label}</span>
);

/* ============================================================
   Empty state
   ============================================================ */

export const EmptyState: React.FC<{
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}> = ({ title, hint, icon: Icon = Inbox }) => (
  <div className="py-10 text-center">
    <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-3">
      <Icon className="w-6 h-6 text-cream-400" />
    </div>
    <p className="text-sm font-bold text-cream-800">{title}</p>
    {hint && <p className="text-xs text-cream-500 mt-1">{hint}</p>}
  </div>
);

/* ============================================================
   Pager — pairs with src/components/usePagination.ts (speed-fix list,
   Fix 1). Presentation only: shows "صفحة X من Y (إجمالي Z)" plus
   prev/next buttons. Hidden entirely when there is only one page.
   ============================================================ */

export const Pager: React.FC<{
  page: number;
  pageCount: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  itemLabel?: string; // e.g. 'فاتورة' — shown as "(إجمالي N فاتورة)"
}> = ({ page, pageCount, totalCount, onPageChange, itemLabel }) => {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-cream-200 flex-wrap">
      <p className="text-xs font-bold text-cream-600">
        صفحة {page} من {pageCount} (إجمالي {totalCount.toLocaleString('en-US')}{itemLabel ? ` ${itemLabel}` : ''})
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cream-100 text-cream-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cream-200 transition-colors"
        >
          السابق
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cream-100 text-cream-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cream-200 transition-colors"
        >
          التالي
        </button>
      </div>
    </div>
  );
};

/* ============================================================
   Skeleton — speed-fix list, Fix 5. A lightweight loading placeholder (gray
   animated blocks shaped like a table) so the user sees structure instead of
   a blank page or a lone line of text. Used as the Suspense fallback for
   lazy-loaded module screens (Fix 4) and from CloudGate's 'connecting'
   phase. Arabic RTL, no new dependencies — plain CSS animation.
   ============================================================ */

export const Skeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="space-y-4" dir="rtl" aria-busy="true" aria-label="جاري التحميل">
    <div className="h-8 w-48 rounded-lg bg-cream-200 animate-pulse" />
    <div className="bg-white rounded-2xl border border-cream-200 overflow-hidden">
      <div className="h-10 bg-cream-100 animate-pulse" />
      <div className="divide-y divide-cream-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-11 flex items-center gap-4 px-4">
            <div className="h-3.5 flex-[2] rounded bg-cream-200 animate-pulse" />
            <div className="h-3.5 flex-[3] rounded bg-cream-200 animate-pulse" />
            <div className="h-3.5 flex-1 rounded bg-cream-200 animate-pulse" />
            <div className="h-3.5 flex-1 rounded bg-cream-200 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  </div>
);
