// Electron main process for the YZ ERP desktop (On-Premise) build.
// Loads the already-built local-mode web app (dist/index.html) in a normal
// desktop window. No network server, no cloud mode — all data lives in this
// computer's app storage (same local-storage engine the browser build uses,
// since Electron's renderer is still a Chromium browser).
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
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
