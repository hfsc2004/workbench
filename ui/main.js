// PSF Workbench — Electron main process.
//
// Responsibilities:
//   - Create the main window
//   - Load the renderer
//   - Expose a small IPC surface the renderer can use to:
//       * read recent / known projects
//       * read a workbench.project.yaml
//       * spawn `workbench run --mode <mode>` and stream its output
//
// The renderer is sandboxed; it cannot touch Node directly. Anything it
// needs from the OS goes through preload.js and IPC handlers here.

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── paths ──────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKBENCH_BIN = path.join(REPO_ROOT, 'workbench');
const RECENTS_FILE = path.join(
  app.getPath('userData'),
  'recent-projects.json'
);

// ── window ─────────────────────────────────────────────────────────
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,                  // show after first paint (no flash)
    backgroundColor: '#14171c',   // matches splash bg → no white flash
    title: 'PSF Workbench',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Default landing page is the splash. Splash navigates onward via
  // window.location, which Electron treats like any browser nav.
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));

  // Block unexpected external nav in case our renderer tries to follow
  // an http(s) link — keep this app local-only.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── recent-projects helpers ────────────────────────────────────────
function readRecents() {
  try {
    const raw = fs.readFileSync(RECENTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.filter(Boolean);
  } catch (_) {}
  return [];
}

function writeRecents(list) {
  try {
    fs.mkdirSync(path.dirname(RECENTS_FILE), { recursive: true });
    fs.writeFileSync(RECENTS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('failed to write recents:', e);
  }
}

function pruneStale(list) {
  // Drop entries whose workbench.project.yaml no longer exists.
  return list.filter((p) => {
    try {
      return fs.existsSync(path.join(p, 'workbench.project.yaml'));
    } catch (_) {
      return false;
    }
  });
}

// Tiny YAML reader for a small subset (top-level scalars + adapter_config block).
// Same caveat as the bash version — replaced with a real parser later.
function readProjectFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const top = {};
  const adapterConfig = {};
  let inAdapterConfig = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^adapter_config:\s*$/.test(line)) { inAdapterConfig = true; continue; }
    if (inAdapterConfig && /^[^\s]/.test(line)) inAdapterConfig = false;
    const m = line.match(/^(\s*)([A-Za-z_][\w]*):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    let val = m[3].trim().replace(/^"(.*)"$/, '$1');
    if (val === '') val = null;
    if (indent === 0) top[key] = val;
    else if (inAdapterConfig && indent > 0) adapterConfig[key] = val;
  }
  return { top, adapterConfig };
}

// ── IPC handlers ───────────────────────────────────────────────────

// list known projects (with light metadata) for the chooser
ipcMain.handle('projects:list', async () => {
  const recents = pruneStale(readRecents());
  writeRecents(recents);
  const enriched = recents.map((p) => {
    const file = path.join(p, 'workbench.project.yaml');
    const proj = readProjectFile(file);
    return {
      path: p,
      name: proj?.top?.name || path.basename(p),
      adapter: proj?.top?.adapter || '(unknown)',
    };
  });
  return enriched;
});

// pick a project directory via the system file dialog, then add to recents
ipcMain.handle('projects:browse', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Workbench project directory',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;

  const dir = res.filePaths[0];
  const file = path.join(dir, 'workbench.project.yaml');
  if (!fs.existsSync(file)) {
    return { error: `No workbench.project.yaml found in ${dir}` };
  }

  const list = readRecents().filter((p) => p !== dir);
  list.unshift(dir);
  writeRecents(list.slice(0, 20));

  const proj = readProjectFile(file);
  return {
    path: dir,
    name: proj?.top?.name || path.basename(dir),
    adapter: proj?.top?.adapter || '(unknown)',
  };
});

// expose a small "what is this" payload for diagnostics + footer info
ipcMain.handle('app:info', () => ({
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  chromeVersion: process.versions.chrome,
  platform: process.platform,
  arch: process.arch,
  homedir: os.homedir(),
  workbenchBin: WORKBENCH_BIN,
  workbenchExists: fs.existsSync(WORKBENCH_BIN),
}));

// ── lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
