// Electron main process for the YZ ERP desktop (On-Premise) build.
// Loads the already-built local-mode web app (dist/index.html) in a normal
// desktop window. No network server, no cloud mode — all data lives in this
// computer's app storage (same local-storage engine the browser build uses,
// since Electron's renderer is still a Chromium browser).
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'YZ ERP',
    backgroundColor: '#fdfaf4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open any target="_blank" link (e.g. barcode label / receipt print
  // windows, which the app opens via window.open) in Electron's own
  // BrowserWindow instead of silently failing.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://') || url === 'about:blank') {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// Minimal RTL-friendly menu (the app itself is Arabic/RTL; the native
// window chrome/menu stays simple rather than translating every item).
function buildMenu() {
  const template = [
    {
      label: 'ملف',
      submenu: [{ role: 'quit', label: 'خروج' }],
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'reload', label: 'تحديث' },
        { role: 'toggleDevTools', label: 'أدوات المطور' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'الحجم الافتراضي' },
        { role: 'zoomIn', label: 'تكبير' },
        { role: 'zoomOut', label: 'تصغير' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Automatic local backups (desktop build only — the renderer's data lives
// solely in this computer's localStorage, so this is its only real
// protection against a corrupted profile, a bad import, or an accidental
// uninstall). The renderer (src/services/autoBackup.ts) decides WHEN to
// back up (once per day); these handlers only know HOW to write/list files,
// kept in a plain folder under this app's own per-user data directory —
// never inside the install folder, which may not be writable.
const BACKUPS_DIR = () => path.join(app.getPath('userData'), 'backups');
const MAX_BACKUPS = 60; // ~2 months of daily snapshots before the oldest is pruned
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'backup-config.json');

// Second backup destination: a folder the person picks themselves — in
// practice, their local Google Drive / OneDrive / Dropbox desktop sync
// folder. We never talk to any cloud API or store any account credentials;
// we just also drop the exact same backup file into that plain folder on
// disk, and whichever sync client is already watching it (if any) uploads
// it on its own, same as any other file the person saves there.
function readBackupConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { driveFolder: typeof parsed.driveFolder === 'string' ? parsed.driveFolder : null };
  } catch {
    return { driveFolder: null };
  }
}

function writeBackupConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

ipcMain.handle('backup:save', async (_event, { filename, content }) => {
  try {
    const dir = BACKUPS_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'backup.json';
    fs.writeFileSync(path.join(dir, safeName), String(content), 'utf-8');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    while (files.length > MAX_BACKUPS) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(dir, oldest)); } catch { /* best-effort */ }
    }

    // Best-effort copy into the configured Drive/OneDrive/Dropbox folder, if
    // any — never fails the primary (local) backup if this one has trouble
    // (folder unplugged, sync client uninstalled, permissions, ...).
    let driveResult = null;
    const { driveFolder } = readBackupConfig();
    if (driveFolder) {
      try {
        fs.mkdirSync(driveFolder, { recursive: true });
        fs.writeFileSync(path.join(driveFolder, safeName), String(content), 'utf-8');
        driveResult = { ok: true, folder: driveFolder };
      } catch (e) {
        driveResult = { ok: false, folder: driveFolder, error: String((e && e.message) || e) };
      }
    }

    return { ok: true, path: path.join(dir, safeName), folder: dir, drive: driveResult };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('backup:pickDriveFolder', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'اختر مجلد Google Drive (أو OneDrive / Dropbox) على جهازك',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
    const folder = res.filePaths[0];
    writeBackupConfig({ driveFolder: folder });
    return { ok: true, folder };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('backup:getDriveFolder', async () => {
  return { ok: true, folder: readBackupConfig().driveFolder };
});

ipcMain.handle('backup:clearDriveFolder', async () => {
  writeBackupConfig({ driveFolder: null });
  return { ok: true };
});

ipcMain.handle('backup:list', async () => {
  try {
    const dir = BACKUPS_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
    return { ok: true, folder: dir, files };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('backup:openFolder', async () => {
  try {
    const dir = BACKUPS_DIR();
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // Auto-update: electron-builder publishes releases to this repo's GitHub
  // Releases (see electron-builder.yml); electron-updater checks there,
  // downloads a newer installer in the background, and installs it on quit.
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Offline / no releases yet — never block the app on this.
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
