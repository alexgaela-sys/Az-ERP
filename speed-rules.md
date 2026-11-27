# Speed rules for YZ-ERP

Read this before writing or changing any screen. These apply to every new feature.

1. Lists: never render all rows. Any list that can grow (invoices, customers, journal entries, audit log, stock transactions, batches) must be paginated (50 per page) or virtualized.
2. Lookups: never call `.find()` or `.filter()` over a whole array inside a `.map()` or loop. Build a `Map` once (by id, or by itemId + warehouseId) and read from it. Stock balance, value and batches must come from one index per DB snapshot.
3. Derived data: filters, totals and group-bys go in `useMemo` with exact dependencies. Do not filter the same array several times in one render.
4. Re-renders: a database change must not re-render screens that do not use the changed data. Use `React.memo` for list rows.
5. Loading: every screen that waits for data or code must show a skeleton, never a blank page or a lone text line.
6. Bundle: each module screen is loaded with `React.lazy`. Do not import heavy libraries at the top of App.tsx or main.tsx.
7. Cache: hashed files under `/assets/` are served cache-first by the service worker. `index.html` and API calls are network-first. Never cache Supabase requests.
8. Storage: do not put big data in localStorage. Use IndexedDB. Never save images as full-size data URLs: resize and compress first (max 256 px for logos).
9. Database: any new column used in a filter, join or sort in the cloud store gets an index in `supabase/cloud-store`, in the same change.
10. Before saying done: test with the seed set (5,000 invoices, 2,000 items, 20,000 batches), record the times in `docs/perf-baseline.md`, and do not accept a change that makes a screen slower than before.

Do not change any accounting, inventory costing or tax calculation while doing speed work. Results must be identical before and after.
