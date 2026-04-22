'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path    = require('path');
const Database = require('better-sqlite3');

// ── Database ───────────────────────────────────────────────────────────────
let db;

function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'tabata.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS configs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      mode        TEXT    NOT NULL DEFAULT 'standard',
      prep_time   INTEGER NOT NULL DEFAULT 10,
      work_time   INTEGER NOT NULL DEFAULT 20,
      rest_time   INTEGER NOT NULL DEFAULT 10,
      break_time  INTEGER NOT NULL DEFAULT 60,
      rounds      INTEGER NOT NULL DEFAULT 8,
      exercises   TEXT    NOT NULL DEFAULT '[]',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      config_id    INTEGER REFERENCES configs(id) ON DELETE SET NULL,
      config_name  TEXT,
      mode         TEXT    NOT NULL,
      total_time   INTEGER NOT NULL,
      completed    INTEGER NOT NULL DEFAULT 0,
      started_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at  TEXT
    );
  `);
}

// ── IPC: Config CRUD ───────────────────────────────────────────────────────
ipcMain.handle('config:list', () =>
  db.prepare('SELECT id, name, mode, updated_at FROM configs ORDER BY updated_at DESC').all()
);

ipcMain.handle('config:load', (_e, id) => {
  const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(id);
  if (!row) return null;
  row.exercises = JSON.parse(row.exercises);
  return row;
});

ipcMain.handle('config:save', (_e, { name, config }) => {
  const exercises = JSON.stringify(config.exercises);
  const existing  = db.prepare('SELECT id FROM configs WHERE name = ?').get(name);
  if (existing) {
    db.prepare(`
      UPDATE configs
         SET mode=?, prep_time=?, work_time=?, rest_time=?, break_time=?, rounds=?, exercises=?,
             updated_at=datetime('now','localtime')
       WHERE id=?
    `).run(config.mode, config.prepTime, config.workTime, config.restTime,
           config.breakTime, config.rounds, exercises, existing.id);
    return { id: existing.id };
  }
  const result = db.prepare(`
    INSERT INTO configs (name, mode, prep_time, work_time, rest_time, break_time, rounds, exercises)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, config.mode, config.prepTime, config.workTime,
         config.restTime, config.breakTime, config.rounds, exercises);
  return { id: result.lastInsertRowid };
});

ipcMain.handle('config:delete', (_e, id) => {
  db.prepare('DELETE FROM configs WHERE id = ?').run(id);
  return { success: true };
});

// ── IPC: Session history ───────────────────────────────────────────────────
ipcMain.handle('session:start', (_e, { configId, configName, mode, totalTime }) => {
  const result = db.prepare(`
    INSERT INTO sessions (config_id, config_name, mode, total_time) VALUES (?, ?, ?, ?)
  `).run(configId || null, configName, mode, totalTime);
  return { sessionId: result.lastInsertRowid };
});

ipcMain.handle('session:end', (_e, { sessionId, completed }) => {
  db.prepare(`
    UPDATE sessions
       SET completed=?, finished_at=datetime('now','localtime')
     WHERE id=?
  `).run(completed ? 1 : 0, sessionId);
  return { success: true };
});

ipcMain.handle('session:history', (_e, limit = 30) =>
  db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit)
);

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

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initDB();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
