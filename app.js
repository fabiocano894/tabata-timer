'use strict';

// ── Audio ──────────────────────────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playBeep(freq = 880, duration = 0.12) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function announce(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  window.speechSynthesis.speak(u);
}

// ── File persistence ───────────────────────────────────────────────────────
// Electron path  → uses native dialog via IPC (window.electronAPI)
// Browser path   → uses File System Access API as fallback

let fileHandle = null; // used only in browser path
const FILE_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

function setFileStatus(msg, type = '') {
  const el = document.getElementById('file-status');
  el.textContent = msg;
  el.className   = type;
}

function fillForm(cfg) {
  document.getElementById('cfg-prep').value   = cfg.prepTime  ?? 10;
  document.getElementById('cfg-work').value   = cfg.workTime  ?? 20;
  document.getElementById('cfg-rest').value   = cfg.restTime  ?? 10;
  document.getElementById('cfg-break').value  = cfg.breakTime ?? 60;
  document.getElementById('cfg-rounds').value = cfg.rounds    ?? 8;

  if (cfg.mode) setMode(cfg.mode);

  const list = document.getElementById('exercise-list');
  list.innerHTML = '';
  const exercises = cfg.exercises?.length ? cfg.exercises : ['Exercise 1'];
  exercises.forEach(name => addExerciseRow(name));
}

function basename(filePath) {
  return filePath.split(/[\\/]/).pop();
}

async function loadConfig() {
  // ── Electron ──
  if (window.electronAPI) {
    const result = await window.electronAPI.loadConfig();
    if (!result.success) return;
    fillForm(result.config);
    updateTotalDisplay();
    setFileStatus(`Loaded: ${basename(result.filePath)}`, 'ok');
    return;
  }
  // ── Browser fallback ──
  if (!window.showOpenFilePicker) {
    setFileStatus('File System API not supported in this browser.', 'err'); return;
  }
  try {
    [fileHandle] = await window.showOpenFilePicker({ types: FILE_TYPES });
    const file   = await fileHandle.getFile();
    const cfg    = JSON.parse(await file.text());
    fillForm(cfg);
    updateTotalDisplay();
    setFileStatus(`Loaded: ${file.name}`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') setFileStatus('Failed to load file.', 'err');
  }
}

async function saveConfig() {
  // ── Electron ──
  if (window.electronAPI) {
    const result = await window.electronAPI.saveConfig(buildConfig());
    if (!result.success) return;
    setFileStatus(`Saved: ${basename(result.filePath)}`, 'ok');
    return;
  }
  // ── Browser fallback ──
  if (!window.showSaveFilePicker) {
    setFileStatus('File System API not supported in this browser.', 'err'); return;
  }
  try {
    if (!fileHandle) {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'tabata-config.json', types: FILE_TYPES,
      });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(buildConfig(), null, 2));
    await writable.close();
    setFileStatus(`Saved: ${fileHandle.name}`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') setFileStatus('Failed to save file.', 'err');
  }
}

// ── State ──────────────────────────────────────────────────────────────────
const PHASES = { PREP: 'prep', WORK: 'work', REST: 'rest', BREAK: 'break', DONE: 'done' };

let config = {};
let state  = {};
let ticker = null;

function buildConfig() {
  const exercises = [...document.querySelectorAll('.exercise-input')]
    .map(i => i.value.trim() || 'Exercise');
  if (exercises.length === 0) exercises.push('Exercise');

  const mode = document.getElementById('cfg-mode').value;

  const base = {
    mode,
    prepTime:   parseInt(document.getElementById('cfg-prep').value,   10) || 0,
    workTime:   parseInt(document.getElementById('cfg-work').value,   10) || 20,
    restTime:   parseInt(document.getElementById('cfg-rest').value,   10) || 10,
    breakTime:  parseInt(document.getElementById('cfg-break').value,  10) || 60,
    rounds:     parseInt(document.getElementById('cfg-rounds').value, 10) || 8,
    exercises,
  };

  if (mode === 'pyramid') {
    const n      = exercises.length;
    const levels   = [];
    const reversed = [...exercises].reverse();
    for (let i = 0; i < n; i++) levels.push(exercises.slice(0, i + 1));       // up:   [A]→[A,B]→…→[A…N]
    for (let i = 0; i < n; i++) levels.push(reversed.slice(0, n - i));        // down: [N…A]→[N…B]→…→[N]
    base.pyramidLevels = levels;
  }

  return base;
}

function initialState(cfg) {
  const startPhase = cfg.prepTime > 0 ? PHASES.PREP : PHASES.WORK;
  const startTime  = cfg.prepTime > 0 ? cfg.prepTime : cfg.workTime;

  if (cfg.mode === 'pyramid') {
    return { phase: startPhase, timeLeft: startTime, levelIdx: 0, exerciseIdx: 0, paused: false };
  }
  return { phase: startPhase, timeLeft: startTime, round: 1, exerciseIdx: 0, paused: false };
}

// ── Phase transitions — Standard ───────────────────────────────────────────
function nextPhase() {
  if (config.mode === 'pyramid') { nextPhasePyramid(); return; }

  const cfg = config;
  const s   = state;
  const lastExercise = s.exerciseIdx === cfg.exercises.length - 1;
  const lastRound    = s.round === cfg.rounds;

  if (s.phase === PHASES.PREP) {
    s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.WORK) {
    if (lastExercise) {
      if (lastRound) {
        s.phase = PHASES.DONE; s.timeLeft = 0; announce('Session complete! Great job!'); return;
      }
      if (cfg.breakTime > 0) {
        s.phase = PHASES.BREAK; s.timeLeft = cfg.breakTime; announce('Round break!'); return;
      }
      s.round++; s.exerciseIdx = 0;
      s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
    }
    if (cfg.restTime > 0) {
      s.phase = PHASES.REST; s.timeLeft = cfg.restTime; announce('Rest!'); return;
    }
    s.exerciseIdx++; s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.REST) {
    s.exerciseIdx++; s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.BREAK) {
    s.round++; s.exerciseIdx = 0;
    s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }
}

// ── Phase transitions — Pyramid ────────────────────────────────────────────
function nextPhasePyramid() {
  const cfg    = config;
  const s      = state;
  const levels = cfg.pyramidLevels;
  const level  = levels[s.levelIdx];
  const lastEx = s.exerciseIdx === level.length - 1;
  const lastLv = s.levelIdx === levels.length - 1;

  if (s.phase === PHASES.PREP) {
    s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.WORK) {
    if (lastEx) {
      if (lastLv) {
        s.phase = PHASES.DONE; s.timeLeft = 0; announce('Session complete! Great job!'); return;
      }
      if (cfg.breakTime > 0) {
        s.phase = PHASES.BREAK; s.timeLeft = cfg.breakTime; announce('Rest!'); return;
      }
      s.levelIdx++; s.exerciseIdx = 0;
      s.phase = PHASES.WORK; s.timeLeft = cfg.workTime;
      announce(`Level ${s.levelIdx + 1}. Work!`); return;
    }
    if (cfg.restTime > 0) {
      s.phase = PHASES.REST; s.timeLeft = cfg.restTime; announce('Rest!'); return;
    }
    s.exerciseIdx++; s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.REST) {
    s.exerciseIdx++; s.phase = PHASES.WORK; s.timeLeft = cfg.workTime; announce('Work!'); return;
  }

  if (s.phase === PHASES.BREAK) {
    s.levelIdx++; s.exerciseIdx = 0;
    s.phase = PHASES.WORK; s.timeLeft = cfg.workTime;
    announce(`Level ${s.levelIdx + 1}. Work!`); return;
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────
function tick() {
  if (state.paused || state.phase === PHASES.DONE) return;

  if (state.timeLeft <= 3 && state.timeLeft > 0) playBeep(660, 0.1);

  state.timeLeft--;

  if (state.timeLeft <= 0 && state.phase !== PHASES.DONE) nextPhase();

  renderTimer();
}

// ── Render ─────────────────────────────────────────────────────────────────
const phaseLabels = {
  [PHASES.PREP]:  'Get Ready',
  [PHASES.WORK]:  'Work!',
  [PHASES.REST]:  'Rest',
  [PHASES.BREAK]: 'Break',
  [PHASES.DONE]:  'Done!',
};

function renderTimer() {
  const s   = state;
  const cfg = config;

  document.getElementById('phase-label').textContent = phaseLabels[s.phase] ?? s.phase;
  document.getElementById('countdown').textContent   = s.timeLeft;
  document.getElementById('btn-pause').textContent   = s.paused ? 'Resume' : 'Pause';
  document.body.className = `phase-${s.phase}`;

  if (cfg.mode === 'pyramid') {
    renderTimerPyramid(s, cfg);
  } else {
    renderTimerStandard(s, cfg);
  }
}

function renderTimerStandard(s, cfg) {
  document.getElementById('exercise-name').textContent =
    s.phase === PHASES.DONE ? '' : cfg.exercises[s.exerciseIdx] ?? '';
  document.getElementById('lbl-round').textContent     = 'Round';
  document.getElementById('cur-round').textContent     = s.round;
  document.getElementById('tot-rounds').textContent    = cfg.rounds;
  document.getElementById('cur-exercise').textContent  = s.exerciseIdx + 1;
  document.getElementById('tot-exercises').textContent = cfg.exercises.length;
  document.getElementById('level-exercises').innerHTML = '';
}

function renderTimerPyramid(s, cfg) {
  const levels = cfg.pyramidLevels;
  const lvIdx  = Math.min(s.levelIdx, levels.length - 1);
  const level  = levels[lvIdx];

  document.getElementById('exercise-name').textContent =
    s.phase === PHASES.DONE ? '' : level[s.exerciseIdx] ?? '';
  document.getElementById('lbl-round').textContent     = 'Level';
  document.getElementById('cur-round').textContent     = lvIdx + 1;
  document.getElementById('tot-rounds').textContent    = levels.length;
  document.getElementById('cur-exercise').textContent  = s.exerciseIdx + 1;
  document.getElementById('tot-exercises').textContent = level.length;

  const el = document.getElementById('level-exercises');

  if (s.phase === PHASES.DONE) {
    el.innerHTML = '';
    return;
  }

  // During break, preview the next level's exercises
  if (s.phase === PHASES.BREAK) {
    const next = levels[lvIdx + 1];
    if (next) {
      el.innerHTML = `<span class="ex-next-label">Next level: </span>` +
        next.map(ex => `<span class="ex-chip">${ex}</span>`).join('<span class="ex-sep">→</span>');
    }
    return;
  }

  // During work/rest/prep: show current level chips, active one highlighted
  el.innerHTML = level.map((ex, i) =>
    `<span class="ex-chip ${i === s.exerciseIdx && s.phase === PHASES.WORK ? 'ex-active' : ''}">${ex}</span>`
  ).join('<span class="ex-sep">→</span>');
}

// ── Session control ────────────────────────────────────────────────────────
function startSession() {
  config = buildConfig();
  state  = initialState(config);

  showView('timer');
  renderTimer();

  clearInterval(ticker);
  ticker = setInterval(tick, 1000);

  if (state.phase === PHASES.PREP) announce('Get ready!');
  else announce(config.mode === 'pyramid' ? 'Level 1. Work!' : 'Work!');
}

function pauseSession() {
  if (state.phase === PHASES.DONE) return;
  state.paused = !state.paused;
  if (!state.paused) announce(state.phase === PHASES.WORK ? 'Work!' : 'Rest!');
  renderTimer();
}

function resetSession() {
  clearInterval(ticker);
  window.speechSynthesis?.cancel();
  document.body.className = '';
  showView('config');
}

// ── Exercise list builder ──────────────────────────────────────────────────
function addExerciseRow(name = '') {
  const list  = document.getElementById('exercise-list');
  const row   = document.createElement('div');
  row.className = 'exercise-row';

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'exercise-input';
  input.placeholder = `Exercise ${list.children.length + 1}`;
  input.value       = name;

  const btn = document.createElement('button');
  btn.className   = 'btn-remove';
  btn.textContent = '×';
  btn.addEventListener('click', () => { row.remove(); updateTotalDisplay(); });

  row.append(input, btn);
  list.appendChild(row);
}

// ── Mode toggle ────────────────────────────────────────────────────────────
const MODE_HINTS = {
  standard: 'Cycle through all exercises each round.',
  pyramid:  'Build up A → A,B → A,B,C → … then back down.',
};

function setMode(mode) {
  document.getElementById('cfg-mode').value = mode;
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
  document.getElementById('cfg-rounds-section').style.display =
    mode === 'pyramid' ? 'none' : '';
  document.getElementById('mode-hint').textContent = MODE_HINTS[mode] ?? '';
}

// ── View switching ─────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('view-config').classList.toggle('active', name === 'config');
  document.getElementById('view-timer').classList.toggle('active',  name === 'timer');
}

// ── Total time calculation ─────────────────────────────────────────────────
function calculateTotalTime(cfg) {
  let total = cfg.prepTime;

  if (cfg.mode === 'pyramid') {
    cfg.pyramidLevels.forEach((level, i) => {
      total += level.length * cfg.workTime;
      total += (level.length - 1) * cfg.restTime;
      if (i < cfg.pyramidLevels.length - 1) total += cfg.breakTime;
    });
  } else {
    const n = cfg.exercises.length;
    total += cfg.rounds * (n * cfg.workTime + (n - 1) * cfg.restTime);
    total += (cfg.rounds - 1) * cfg.breakTime;
  }

  return total;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function updateTotalDisplay() {
  const cfg   = buildConfig();
  const total = calculateTotalTime(cfg);
  document.querySelector('#session-total span').textContent = formatDuration(total);
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  addExerciseRow('Exercise 1');

  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => { setMode(btn.dataset.mode); updateTotalDisplay(); })
  );

  // Recalculate total whenever any config input changes
  document.getElementById('view-config').addEventListener('input', updateTotalDisplay);

  // Also recalculate when exercises are added or removed
  const origAdd = addExerciseRow;
  document.getElementById('btn-add-exercise').addEventListener('click', () => {
    addExerciseRow();
    updateTotalDisplay();
  });

  document.getElementById('btn-load-config').addEventListener('click', loadConfig);
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('btn-start').addEventListener('click', startSession);
  document.getElementById('btn-pause').addEventListener('click', pauseSession);
  document.getElementById('btn-reset').addEventListener('click', resetSession);

  updateTotalDisplay();
});
