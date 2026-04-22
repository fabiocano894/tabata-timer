'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config profiles
  db: {
    listConfigs:  ()                         => ipcRenderer.invoke('config:list'),
    loadConfig:   (id)                       => ipcRenderer.invoke('config:load', id),
    saveConfig:   (name, config)             => ipcRenderer.invoke('config:save', { name, config }),
    deleteConfig: (id)                       => ipcRenderer.invoke('config:delete', id),
    startSession: (data)                     => ipcRenderer.invoke('session:start', data),
    endSession:   (sessionId, completed)     => ipcRenderer.invoke('session:end', { sessionId, completed }),
    getHistory:   (limit)                    => ipcRenderer.invoke('session:history', limit),
  },
});
