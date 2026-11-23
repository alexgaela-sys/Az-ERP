// Exposes one narrow, explicit bridge to the renderer: local backup-file
// I/O, used only by services/autoBackup.ts in the desktop build (the data
// itself still lives in normal browser storage — localStorage/IndexedDB —
// which Electron's renderer already provides like any Chromium page).
// contextIsolation stays on; nothing else privileged is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBackup', {
  save: (filename, content) => ipcRenderer.invoke('backup:save', { filename, content }),
  list: () => ipcRenderer.invoke('backup:list'),
  openFolder: () => ipcRenderer.invoke('backup:openFolder'),
});
