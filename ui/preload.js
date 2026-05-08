// PSF Workbench — Electron preload script.
//
// The renderer process is sandboxed (contextIsolation:true, nodeIntegration:false).
// This file is the only place where renderer-side JS gets a controlled
// view of Node/OS APIs, exposed via contextBridge under window.workbench.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbench', {
  // metadata about the running app (for diagnostics + UI footers)
  info: () => ipcRenderer.invoke('app:info'),

  // project chooser
  listProjects: () => ipcRenderer.invoke('projects:list'),
  browseForProject: () => ipcRenderer.invoke('projects:browse'),

  // operator view — read project + control runs
  readProject: (projectPath) => ipcRenderer.invoke('project:read', projectPath),
  saveAdapterConfig: (projectPath, updates) =>
    ipcRenderer.invoke('project:adapter-config-save', { projectPath, updates }),
  runStatus: () => ipcRenderer.invoke('run:status'),
  runStart: (projectPath, mode) =>
    ipcRenderer.invoke('run:start', { projectPath, mode }),
  runStop: () => ipcRenderer.invoke('run:stop'),

  // subscribe to run events (started / stdout / stderr / closed / error)
  // returns an unsubscribe function
  onRunEvent: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },

  // navigation helper — keeps renderer code out of the address bar
  navigate: (page) => { window.location.href = page; },

  // hand off a project to the operator view via sessionStorage
  // (URL-based handoff would also work, but this avoids URL parsing)
  setActiveProject: (project) => {
    try { sessionStorage.setItem('workbench:activeProject', JSON.stringify(project)); }
    catch (_) {}
  },
  getActiveProject: () => {
    try {
      const v = sessionStorage.getItem('workbench:activeProject');
      return v ? JSON.parse(v) : null;
    } catch (_) { return null; }
  },

  // deck editor — Workbench's Everyman authoring surface
  cardsList: (adapterName) => ipcRenderer.invoke('cards:list', adapterName),
  deckRead: (projectPath) => ipcRenderer.invoke('deck:read', projectPath),
  deckSave: (projectPath, deck) =>
    ipcRenderer.invoke('deck:save', { projectPath, deck }),
  deckGenerate: (projectPath, deck, adapterName) =>
    ipcRenderer.invoke('deck:generate', { projectPath, deck, adapterName }),

  // policy file (Code view in the operator pane)
  policyRead: (projectPath) => ipcRenderer.invoke('policy:read', projectPath),
  policyWrite: (projectPath, text, opts = {}) =>
    ipcRenderer.invoke('policy:write', {
      projectPath, text,
      expectedMtimeMs: opts.expectedMtimeMs,
      force: !!opts.force,
    }),

  openInEditor: (projectPath) =>
    ipcRenderer.invoke('project:open-in-editor', projectPath),
});
