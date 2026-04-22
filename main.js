'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:           520,
    height:          860,
    minWidth:        400,
    minHeight:       600,
    backgroundColor: '#111111',
    title:           'Tabata Timer',
    autoHideMenuBar: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile('index.html');
}

// ── IPC: Save config ───────────────────────────────────────────────────────
ipcMain.handle('save-config', async (_event, config) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title:       'Save Tabata Config',
    defaultPath: 'tabata-config.json',
    filters:     [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false };
  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Load config ───────────────────────────────────────────────────────
ipcMain.handle('load-config', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title:      'Open Tabata Config',
    filters:    [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { success: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    return { success: true, config: JSON.parse(content), filePath: filePaths[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
