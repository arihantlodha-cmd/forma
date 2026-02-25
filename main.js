const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path   = require('path');
const { spawn, execSync } = require('child_process');
const http   = require('http');
const fs     = require('fs');

let mainWindow  = null;
let flaskProc   = null;
const FLASK_PORT = 5001; // separate from any existing dev server

/* ─── FLASK MANAGEMENT ───────────────────────────────────────────────────── */

function findPython() {
  const candidates = [
    path.join(__dirname, 'venv', 'bin', 'python'),
    path.join(__dirname, 'venv', 'bin', 'python3'),
    path.join(process.resourcesPath || __dirname, 'venv', 'bin', 'python'),
    'python3', 'python',
  ];
  for (const p of candidates) {
    try { execSync(`"${p}" --version`, { stdio: 'ignore' }); return p; } catch { /**/ }
  }
  return 'python3';
}

function startFlask() {
  const python = findPython();
  const env    = { ...process.env, PORT: String(FLASK_PORT), FLASK_DEBUG: 'false' };
  const script = path.join(__dirname, 'app.py');

  flaskProc = spawn(python, [script], { env, cwd: __dirname });

  flaskProc.stdout.on('data', d => console.log('[flask]', d.toString().trim()));
  flaskProc.stderr.on('data', d => console.error('[flask]', d.toString().trim()));
  flaskProc.on('exit', code => { if (code !== 0 && mainWindow) console.error('[flask] exited', code); });
}

function waitForFlask(retries = 30, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(`http://127.0.0.1:${FLASK_PORT}/ping`, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve());
      }).on('error', () => {
        if (n <= 0) reject(new Error('Flask did not start in time'));
        else setTimeout(() => attempt(n - 1), delay);
      });
    };
    attempt(retries);
  });
}

function stopFlask() {
  if (flaskProc) { flaskProc.kill('SIGTERM'); flaskProc = null; }
}

/* ─── WINDOW ─────────────────────────────────────────────────────────────── */

function createWindow() {
  const preload = path.join(__dirname, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 680,
    frame: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    titleBarOverlay: false,
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show splash then load app
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'loading.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  waitForFlask().then(() => {
    const isFirstRun = !fs.existsSync(path.join(__dirname, 'forma.db'));
    const page = isFirstRun ? 'onboarding.html' : 'index.html';
    mainWindow.loadFile(path.join(__dirname, 'renderer', page));
  }).catch(err => {
    console.error(err);
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ─── IPC HANDLERS ───────────────────────────────────────────────────────── */

ipcMain.handle('get-flask-port', () => FLASK_PORT);

ipcMain.handle('show-open-dialog', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result;
});

ipcMain.handle('show-save-dialog', async (_, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, opts);
  return result;
});

ipcMain.handle('write-file', async (_, { filePath, data }) => {
  fs.writeFileSync(filePath, data);
  return { ok: true };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('navigate', (_, page) => {
  mainWindow.loadFile(path.join(__dirname, 'renderer', page));
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());

/* ─── MENU ───────────────────────────────────────────────────────────────── */

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' }
    ]}] : []),
    { label: 'File', submenu: [
      { label: 'New Analysis', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-analysis') },
      { label: 'Open Image…',  accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('open-image') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' },
      { type: 'separator' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ]},
    { label: 'Forma', submenu: [
      { label: 'Settings',       accelerator: 'CmdOrCtrl+,',     click: () => mainWindow?.webContents.send('open-settings') },
      { label: 'History',        accelerator: 'CmdOrCtrl+H',     click: () => mainWindow?.webContents.send('toggle-history') },
      { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => mainWindow?.webContents.send('show-shortcuts') },
      { type: 'separator' },
      { label: 'Restart Onboarding', click: () => mainWindow?.loadFile(path.join(__dirname, 'renderer', 'onboarding.html')) },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ─── APP LIFECYCLE ──────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  startFlask();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});

app.on('window-all-closed', () => {
  stopFlask();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopFlask);
