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

  // navigation helper — keeps renderer code out of the address bar
  navigate: (page) => { window.location.href = page; },
});
