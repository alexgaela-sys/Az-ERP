// Shared pagination hook (speed-fix list, Fix 1). Presentation/perf helper
// only — never touches business data, only slices an already-computed and
// already-filtered array for rendering.
//
// IMPORTANT: pass the FINAL filtered/sorted array (after search, status
// filters, etc. — ideally memoized with useMemo by the caller). Totals and
// summaries must still be computed from that full array, never from
// `pageItems` — this hook only decides which rows get RENDERED.
import { useMemo, useState } from 'react';

export interface UsePaginationResult<T> {
  /** Current page, 1-based. Always within [1, pageCount]. */
  page: number;
  setPage: (p: number) => void;
  /** Total number of pages (at least 1, even for an empty list). */
  pageCount: number;
  /** The slice of `items` to render for the current page. */
  pageItems: T[];
  /** items.length, for convenience (e.g. "X نتيجة"). */
  totalCount: number;
  pageSize: number;
}

export function usePagination<T>(items: T[], pageSize: number = 50): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the filtered array itself changes (new
  // search/filter), not merely when the underlying DB grows. This is React's
  // documented "adjust state during render in response to a changed value"
  // pattern: it re-renders once with the corrected page before paint, with
  // no effect/flicker, and terminates because the next render sees
  // items === prevItems.
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    if (page !== 1) setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return { page: safePage, setPage, pageCount, pageItems, totalCount: items.length, pageSize };
}
