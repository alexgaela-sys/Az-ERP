// No privileged API is exposed to the renderer: the app only needs normal
// browser storage (localStorage/IndexedDB), which Electron's renderer
// already provides like any Chromium page. Kept as an empty, explicit
// preload (contextIsolation stays on) so adding a native bridge later
// (e.g. direct local file export/import) has an obvious place to go.
