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

const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard } = require('electron');
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
    width: 1320,
    height: 912,
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

  // Right-click context menu — Copy / Select All / Inspect / Copy All Logs.
  // Fires on every right-click in any renderer window.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];

    if (params.editFlags?.canCut && params.isEditable) {
      items.push({ label: 'Cut', role: 'cut' });
    }
    if (params.selectionText && params.selectionText.trim().length > 0) {
      items.push({ label: 'Copy', role: 'copy' });
    }
    if (params.editFlags?.canPaste && params.isEditable) {
      items.push({ label: 'Paste', role: 'paste' });
    }
    if (items.length > 0) items.push({ type: 'separator' });

    items.push({ label: 'Select all', role: 'selectAll' });

    // Convenience: copy *everything* in the closest .log-body element.
    // Useful for "grab the whole run log to share with someone."
    items.push({
      label: 'Copy all log output',
      click: async () => {
        try {
          const text = await mainWindow.webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector('.log-body');
              return el ? el.innerText : '';
            })();
          `);
          if (text) clipboard.writeText(text);
        } catch (_) { /* fail silently — non-critical convenience */ }
      },
    });

    items.push({ type: 'separator' });
    items.push({ label: 'Reload', role: 'reload' });
    items.push({
      label: 'Toggle developer tools',
      click: () => mainWindow.webContents.toggleDevTools(),
    });

    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  // If the user clicks the window's X while a run is active, prompt
  // before tearing down. Once they confirm, before-quit takes over and
  // does the cleanup.
  mainWindow.on('close', (event) => {
    if (!activeRun || cleanupInProgress) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Stop run and quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Active run',
      message: 'A Workbench run is still active.',
      detail: 'Closing now will stop the simulator and any associated processes.',
    });
    if (choice === 0) {
      cleanupInProgress = true;
      stopActiveRun({ reason: 'window close' }).then(() => {
        // remove this listener so the second close goes through
        mainWindow?.removeAllListeners('close');
        mainWindow?.close();
        app.quit();
      });
    }
  });

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

// read a project file by path
ipcMain.handle('project:read', (_evt, projectPath) => {
  if (!projectPath) return null;
  const file = path.join(projectPath, 'workbench.project.yaml');
  const proj = readProjectFile(file);
  if (!proj) return { error: `No workbench.project.yaml at ${projectPath}` };
  return {
    path: projectPath,
    file,
    name: proj.top.name || path.basename(projectPath),
    adapter: proj.top.adapter || '(unknown)',
    adapter_config: proj.adapterConfig,
  };
});

// ── subprocess management ──────────────────────────────────────────
// One Workbench run can be active at a time. The renderer subscribes to
// streaming events; main.js owns the child process and sends stdout/stderr
// chunks back to whichever window is current.
//
// Adapter scripts may print a single "[workbench-meta] container_name=..."
// line to stdout. When we see it we remember the name so we can `docker
// stop` it directly on shutdown — this is the belt-and-suspenders that
// protects against the script's own trap not finishing if Electron exits
// abruptly.
let activeRun = null;
// shape: { proc, mode, projectPath, startedAt, containerName, stoppingPromise }

function emit(event, payload) {
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, payload);
  }
}

// Synchronous best-effort: check whether `docker` is reachable. We don't
// want to hang shutdown waiting for a missing daemon.
function dockerAvailable() {
  try {
    require('node:child_process').execFileSync('docker', ['version', '--format', '{{.Client.Version}}'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 1500,
    });
    return true;
  } catch (_) { return false; }
}

// Force-stop a named docker container. Async, never throws. Used as the
// belt-and-suspenders cleanup path. Caller should await but is fine if
// the call rejects — we always log and move on.
function dockerStopContainer(name, timeoutSec = 5) {
  return new Promise((resolve) => {
    if (!name) return resolve({ ok: false, reason: 'no name' });
    const p = spawn('docker', ['stop', '-t', String(timeoutSec), name], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    p.on('close', (code) => resolve({ ok: code === 0, code, stderr }));
    p.on('error', (e) => resolve({ ok: false, reason: e.message }));
    setTimeout(() => {
      try { p.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, reason: 'docker stop timed out' });
    }, (timeoutSec + 3) * 1000);
  });
}

// Parse a buffered chunk for our meta-info line. Side-effect: updates
// activeRun.containerName when found.
const META_RE = /\[workbench-meta\]\s+container_name=([\w.-]+)/;
function scanForMeta(chunkText) {
  if (!activeRun) return;
  if (activeRun.containerName) return;        // already captured
  const m = chunkText.match(META_RE);
  if (m) {
    activeRun.containerName = m[1];
    emit('run:event', {
      type: 'meta',
      key: 'container_name',
      value: m[1],
    });
  }
}

ipcMain.handle('run:status', () => {
  if (!activeRun) return { running: false };
  return {
    running: true,
    mode: activeRun.mode,
    projectPath: activeRun.projectPath,
    startedAt: activeRun.startedAt,
    pid: activeRun.proc.pid,
    containerName: activeRun.containerName || null,
  };
});

ipcMain.handle('run:start', (_evt, { projectPath, mode }) => {
  if (activeRun) {
    return { error: 'A run is already active. Stop it first.' };
  }
  if (!projectPath || !mode) {
    return { error: 'projectPath and mode are required' };
  }
  if (!fs.existsSync(WORKBENCH_BIN)) {
    return { error: `workbench CLI not found at ${WORKBENCH_BIN}` };
  }

  // Spawn the workbench CLI from the project directory. The CLI walks
  // up to find workbench.project.yaml, so cwd matters.
  let proc;
  try {
    proc = spawn(WORKBENCH_BIN, ['run', '--mode', mode], {
      cwd: projectPath,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  } catch (e) {
    return { error: `failed to spawn: ${e.message}` };
  }

  activeRun = {
    proc,
    mode,
    projectPath,
    startedAt: new Date().toISOString(),
    containerName: null,
    stoppingPromise: null,
  };

  emit('run:event', { type: 'started', mode, projectPath, pid: proc.pid });

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    scanForMeta(text);
    emit('run:event', { type: 'stdout', text });
  });
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    scanForMeta(text);
    emit('run:event', { type: 'stderr', text });
  });
  proc.on('error', (err) => {
    emit('run:event', { type: 'error', message: err.message });
  });
  proc.on('close', (code, signal) => {
    const startedAt = activeRun ? new Date(activeRun.startedAt).getTime() : Date.now();
    emit('run:event', {
      type: 'closed',
      code,
      signal,
      ranFor: Date.now() - startedAt,
    });
    activeRun = null;
  });

  return { ok: true, pid: proc.pid };
});

// stopActiveRun: idempotent, async, best-effort. Returns a promise that
// resolves once we believe the run is fully gone (subprocess closed AND
// docker container stopped, if any). Subsequent calls return the same
// promise.
function stopActiveRun({ reason = 'stop' } = {}) {
  if (!activeRun) return Promise.resolve({ ok: true, reason: 'no active run' });
  if (activeRun.stoppingPromise) return activeRun.stoppingPromise;

  const run = activeRun;            // capture — activeRun may go null mid-flight
  const containerName = run.containerName;

  emit('run:event', {
    type: 'stdout',
    text: `[workbench] stopping (${reason})…\n`,
  });

  // Send SIGINT to the bash chain. ros2/launch installs handlers that
  // shut down nodes in order; SIGTERM tends to orphan Gazebo / Zenoh.
  try { run.proc.kill('SIGINT'); } catch (_) {}

  // In parallel, ask docker to stop the container directly. This protects
  // against the bash trap not getting to run if Electron exits hard.
  const dockerStop = (containerName && dockerAvailable())
    ? dockerStopContainer(containerName, 5)
    : Promise.resolve({ ok: true, reason: 'no container or docker unavailable' });

  // Wait for the subprocess `close` event (or timeout).
  const procClose = new Promise((resolve) => {
    if (run.proc.exitCode !== null || run.proc.signalCode !== null) {
      return resolve({ ok: true, reason: 'already exited' });
    }
    let done = false;
    const onClose = () => { if (!done) { done = true; resolve({ ok: true }); } };
    run.proc.once('close', onClose);
    setTimeout(() => {
      if (!done) {
        done = true;
        try { run.proc.kill('SIGKILL'); } catch (_) {}
        resolve({ ok: false, reason: 'subprocess shutdown timed out' });
      }
    }, 8000);
  });

  run.stoppingPromise = Promise.all([dockerStop, procClose]).then(([d, p]) => {
    return { ok: p.ok && d.ok, proc: p, docker: d, containerName };
  });

  return run.stoppingPromise;
}

ipcMain.handle('run:stop', async () => {
  const res = await stopActiveRun({ reason: 'user' });
  return res;
});

// ── orphan-container sweep on startup ──────────────────────────────
// If a previous Workbench session crashed or was killed, leftover
// containers may still be running. Clean them on app boot so the user
// doesn't have to think about it.
function sweepOrphans() {
  if (!dockerAvailable()) return;
  try {
    const out = require('node:child_process').execFileSync(
      'docker',
      ['ps', '--filter', 'name=workbench-aic-', '--format', '{{.Names}}'],
      { timeout: 3000 }
    ).toString('utf8').trim();
    if (!out) return;
    const names = out.split('\n').filter(Boolean);
    if (names.length === 0) return;
    console.log('[workbench] sweeping orphan containers:', names);
    for (const n of names) {
      // fire-and-forget; we logged the intent already
      spawn('docker', ['stop', '-t', '3', n], { stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.warn('[workbench] orphan sweep failed:', e.message);
  }
}

// ── shutdown lifecycle ──────────────────────────────────────────────
// Need a flag so we don't intercept the second quit() we issue ourselves.
let cleanupInProgress = false;

app.on('before-quit', (event) => {
  if (!activeRun || cleanupInProgress) return;
  event.preventDefault();
  cleanupInProgress = true;
  emit('run:event', {
    type: 'stdout',
    text: '[workbench] app exiting — stopping active run…\n',
  });
  stopActiveRun({ reason: 'app quit' }).then((res) => {
    console.log('[workbench] cleanup result:', res?.ok ? 'ok' : 'partial', res);
    app.quit();
  });
});

// ── deck editor (Behavior Deck) ────────────────────────────────────
//
// Workbench's Everyman authoring surface: the user composes a sequence of
// named, parameterized cards. We persist the deck as YAML in the project
// and *generate* a working policy.py the AIC runtime loads. The generated
// file is inspectable per Rule 3 (Emit, don't hide).

const ADAPTERS_DIR = path.join(REPO_ROOT, 'adapters');

function loadCardLibrary(adapterName) {
  const file = path.join(ADAPTERS_DIR, adapterName, 'cards.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('failed to parse cards.json:', e);
    return null;
  }
}

ipcMain.handle('cards:list', (_evt, adapterName) => {
  const lib = loadCardLibrary(adapterName || 'intrinsic-aic');
  if (!lib) return { error: `No card library for adapter "${adapterName}"` };
  // Strip emit templates from the response — renderer doesn't need them
  // and they're verbose.
  return {
    version: lib.version,
    globals: lib.globals,
    cards: lib.cards.map((c) => ({
      id: c.id, name: c.name, summary: c.summary,
      description: c.description, params: c.params,
    })),
  };
});

// Persist the user's deck as YAML in the project directory.
// Format matches what humans expect to read; not a full YAML library —
// we control the schema, so we hand-format.
function deckToYaml(deck) {
  const lines = [];
  lines.push('# Workbench behavior deck.');
  lines.push('# This file is the source of truth for the policy — edit either');
  lines.push('# here or via the Workbench deck editor. After editing, re-generate');
  lines.push('# the policy via the editor or `workbench deck generate`.');
  lines.push('');
  lines.push(`adapter: ${deck.adapter || 'intrinsic-aic'}`);
  lines.push('globals:');
  for (const [k, v] of Object.entries(deck.globals || {})) {
    lines.push(`  ${k}: ${v}`);
  }
  lines.push('sequence:');
  for (const step of (deck.sequence || [])) {
    lines.push(`  - card: ${step.card}`);
    if (step.params && Object.keys(step.params).length) {
      lines.push('    params:');
      for (const [k, v] of Object.entries(step.params)) {
        const printed = (typeof v === 'string') ? `"${v}"` : v;
        lines.push(`      ${k}: ${printed}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

// Tiny YAML reader for the deck schema we wrote — same caveat as the
// project-file reader; we control the format.
function readDeckYaml(text) {
  const out = { adapter: null, globals: {}, sequence: [] };
  const lines = text.split('\n');
  let mode = null;        // null | 'globals' | 'sequence'
  let curStep = null;
  let inStepParams = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^adapter:/.test(line)) {
      out.adapter = line.split(':')[1].trim().replace(/^"(.*)"$/, '$1');
      mode = null; continue;
    }
    if (/^globals:\s*$/.test(line)) { mode = 'globals'; continue; }
    if (/^sequence:\s*$/.test(line)) { mode = 'sequence'; continue; }
    if (mode === 'globals') {
      const m = line.match(/^\s+([A-Za-z_][\w]*):\s*(.+)$/);
      if (m) out.globals[m[1]] = parseScalar(m[2]);
    } else if (mode === 'sequence') {
      const stepMatch = line.match(/^\s+- card:\s*(.+)$/);
      if (stepMatch) {
        if (curStep) out.sequence.push(curStep);
        curStep = { card: stepMatch[1].trim().replace(/^"(.*)"$/, '$1'), params: {} };
        inStepParams = false;
        continue;
      }
      if (/^\s+params:\s*$/.test(line)) { inStepParams = true; continue; }
      if (inStepParams) {
        const p = line.match(/^\s+([A-Za-z_][\w]*):\s*(.+)$/);
        if (p && curStep) curStep.params[p[1]] = parseScalar(p[2]);
      }
    }
  }
  if (curStep) out.sequence.push(curStep);
  return out;
}

function parseScalar(s) {
  s = s.trim();
  if (/^".*"$/.test(s)) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

ipcMain.handle('deck:read', (_evt, projectPath) => {
  const file = path.join(projectPath, 'deck.yaml');
  if (!fs.existsSync(file)) return { exists: false, deck: null };
  try {
    const text = fs.readFileSync(file, 'utf8');
    return { exists: true, deck: readDeckYaml(text) };
  } catch (e) {
    return { exists: true, error: e.message };
  }
});

ipcMain.handle('deck:save', (_evt, { projectPath, deck }) => {
  if (!projectPath || !deck) return { error: 'projectPath and deck required' };
  const file = path.join(projectPath, 'deck.yaml');
  try {
    fs.writeFileSync(file, deckToYaml(deck), 'utf8');
    return { ok: true, file };
  } catch (e) {
    return { error: e.message };
  }
});

// Code generator. Reads the project's deck + the adapter's card library,
// emits a policy.py that derives from aic_model.policy.Policy.
function generatePolicyPy(deck, lib) {
  const tickHz = (deck.globals && deck.globals.tick_hz) || 20;
  const maxForceN = (deck.globals && deck.globals.max_force_n) || 18;

  const cardsById = {};
  for (const c of lib.cards) cardsById[c.id] = c;

  const interpolate = (template, params) =>
    template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key === 'tick_hz') return tickHz;
      if (key === 'max_force_n') return maxForceN;
      if (params && key in params) {
        const v = params[key];
        return (typeof v === 'string') ? `'${v}'` : String(v);
      }
      return '0';   // unresolved param — defensive default
    });

  const body = [];
  body.push('# This file is generated by PSF Workbench from deck.yaml.');
  body.push('# Edit deck.yaml (or the Workbench deck editor) and re-generate.');
  body.push('# Hand edits to this file will be overwritten on next generation.');
  body.push('# Generated: ' + new Date().toISOString());
  body.push('');
  body.push('from aic_model.policy import Policy');
  body.push('from aic_control_interfaces.msg import MotionUpdate');
  body.push('from aic_task_interfaces.msg import Task');
  body.push('from geometry_msgs.msg import Point, Pose, Quaternion');
  body.push('from rclpy.duration import Duration');
  body.push('');
  body.push('');
  body.push('class ReflexPolicy(Policy):');
  body.push('    """Generated from a Workbench Behavior Deck."""');
  body.push('');
  body.push('    def __init__(self, parent_node):');
  body.push('        super().__init__(parent_node)');
  body.push('        self.get_logger().info("ReflexPolicy (deck-generated) ready")');
  body.push('');
  body.push('    def insert_cable(self, task: Task, get_observation, move_robot, send_feedback) -> bool:');
  body.push('        send_feedback(f"[deck] insert_cable started for task {task.id}")');

  if (!deck.sequence || deck.sequence.length === 0) {
    body.push('        send_feedback("[deck] empty deck — no behaviors to run")');
    body.push('        return True');
  } else {
    deck.sequence.forEach((step, idx) => {
      const card = cardsById[step.card];
      if (!card) {
        body.push(`        send_feedback("[deck] step ${idx + 1}: unknown card '${step.card}' — skipped")`);
        return;
      }
      body.push('');
      body.push(`        # ── step ${idx + 1}: ${card.name} ──`);
      const merged = { ...defaultParamsFor(card), ...(step.params || {}) };
      for (const line of card.emit) {
        body.push('        ' + interpolate(line, merged));
      }
    });
    body.push('');
    body.push('        send_feedback("[deck] sequence complete")');
    body.push('        return True');
  }

  body.push('');
  return body.join('\n');
}

function defaultParamsFor(card) {
  const out = {};
  for (const p of (card.params || [])) {
    out[p.id] = p.default;
  }
  return out;
}

ipcMain.handle('deck:generate', (_evt, { projectPath, deck, adapterName }) => {
  if (!projectPath || !deck) return { error: 'projectPath and deck required' };
  const lib = loadCardLibrary(adapterName || deck.adapter || 'intrinsic-aic');
  if (!lib) return { error: `No card library for adapter` };

  const code = generatePolicyPy(deck, lib);

  // We write to <project>/reflex_policy/policy.py if that directory
  // exists (the AIC submission's package layout); otherwise the project
  // root with a clear name. Also write to <project>/generated/policy.py
  // for inspectability per Rule 3.
  const targets = [];
  const generatedDir = path.join(projectPath, 'generated');
  try {
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(path.join(generatedDir, 'policy.py'), code, 'utf8');
    targets.push(path.join(generatedDir, 'policy.py'));
  } catch (e) {
    return { error: 'failed to write generated/policy.py: ' + e.message };
  }

  const reflexDir = path.join(projectPath, 'reflex_policy');
  if (fs.existsSync(reflexDir)) {
    try {
      fs.writeFileSync(path.join(reflexDir, 'policy.py'), code, 'utf8');
      targets.push(path.join(reflexDir, 'policy.py'));
    } catch (e) {
      // non-fatal — the canonical write succeeded
    }
  }

  return { ok: true, targets, byteCount: code.length };
});

// ── policy file editor (in-window code view) ──────────────────────
//
// The Code tab in the operator view edits reflex_policy/policy.py
// directly. We track mtime so we can detect concurrent external edits
// and warn before overwriting them.

function policyFilePath(projectPath) {
  return path.join(projectPath, 'reflex_policy', 'policy.py');
}

ipcMain.handle('policy:read', (_evt, projectPath) => {
  if (!projectPath) return { error: 'projectPath required' };
  const file = policyFilePath(projectPath);
  if (!fs.existsSync(file)) {
    return {
      exists: false,
      file,
      hint: 'Compose a deck and click "Save & Generate" first, or write your own policy.py here.',
    };
  }
  try {
    const stat = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    const isGenerated = text.startsWith('# This file is generated by PSF Workbench');
    return {
      exists: true,
      file,
      text,
      mtimeMs: stat.mtimeMs,
      isGenerated,
    };
  } catch (e) {
    return { error: e.message, file };
  }
});

// Write the policy file. If `expectedMtimeMs` is provided, we check it
// matches the file's current mtime — if not, the file changed under us
// (regenerated, edited externally) and we refuse to overwrite without
// a force flag.
ipcMain.handle('policy:write', (_evt, { projectPath, text, expectedMtimeMs, force }) => {
  if (!projectPath || typeof text !== 'string') {
    return { error: 'projectPath and text required' };
  }
  const file = policyFilePath(projectPath);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    if (fs.existsSync(file) && !force && expectedMtimeMs != null) {
      const cur = fs.statSync(file).mtimeMs;
      if (Math.abs(cur - expectedMtimeMs) > 1.0) {
        return {
          conflict: true,
          file,
          currentMtimeMs: cur,
          message: 'File changed on disk since you loaded it. Reload or force-save.',
        };
      }
    }

    fs.writeFileSync(file, text, 'utf8');
    const stat = fs.statSync(file);
    return { ok: true, file, mtimeMs: stat.mtimeMs };
  } catch (e) {
    return { error: e.message, file };
  }
});

// "Open in editor" — tries common editors in order. Always falls back to
// xdg-open which lets the OS pick.
ipcMain.handle('project:open-in-editor', (_evt, projectPath) => {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { error: 'project path missing' };
  }
  const tries = ['code', 'subl', 'gedit'];
  for (const cmd of tries) {
    try {
      spawn(cmd, [projectPath], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, opened: cmd };
    } catch (_) { /* keep trying */ }
  }
  try {
    spawn('xdg-open', [projectPath], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, opened: 'xdg-open' };
  } catch (e) {
    return { error: 'no editor found' };
  }
});

// ── lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  sweepOrphans();          // clean up any leftover containers from prior runs
  createMainWindow();
});

app.on('window-all-closed', () => {
  // before-quit will preventDefault and run cleanup if a run is active.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
