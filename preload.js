'use strict';

// Preload runs in a privileged context — it bridges Node (main process)
// and the renderer safely via contextBridge. The renderer never gets
// direct Node access; it only sees the methods exposed here.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: ()       => ipcRenderer.invoke('load-config'),
});
