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

// ── Helpers ────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── State ──────────────────────────────────────────────────────────────────
const PHASES = { PREP: 'prep', WORK: 'work', REST: 'rest', BREAK: 'break', DONE: 'done' };

let config           = {};
let state            = {};
let ticker           = null;
let currentSessionId = null;
let activeConfigId   = null;   // DB id of the loaded profile (null = ad hoc)

// ── Config / form ──────────────────────────────────────────────────────────
function buildConfig() {
  const exercises = [...document.querySelectorAll('.exercise-input')]
    .map(i => i.value.trim() || 'Exercise');
  if (exercises.length === 0) exercises.push('Exercise');

  const mode = document.getElementById('cfg-mode').value;
  const base = {
    mode,
    prepTime:  parseInt(document.getElementById('cfg-prep').value,   10) || 0,
    workTime:  parseInt(document.getElementById('cfg-work').value,   10) || 20,
    restTime:  parseInt(document.getElementById('cfg-rest').value,   10) || 10,
    breakTime: parseInt(document.getElementById('cfg-break').value,  10) || 60,
    rounds:    parseInt(document.getElementById('cfg-rounds').value, 10) || 8,
    exercises,
  };

  if (mode === 'pyramid') {
    const n      = exercises.length;
    const levels = [];
    const rev    = [...exercises].reverse();
    for (let i = 0; i < n; i++) levels.push(exercises.slice(0, i + 1));
    for (let i = 0; i < n; i++) levels.push(rev.slice(0, n - i));
    base.pyramidLevels = levels;
  }

  return base;
}

function fillForm(row) {
  document.getElementById('cfg-prep').value   = row.prep_time  ?? row.prepTime  ?? 10;
  document.getElementById('cfg-work').value   = row.work_time  ?? row.workTime  ?? 20;
  document.getElementById('cfg-rest').value   = row.rest_time  ?? row.restTime  ?? 10;
  document.getElementById('cfg-break').value  = row.break_time ?? row.breakTime ?? 60;
  document.getElementById('cfg-rounds').value = row.rounds     ?? 8;

  const mode = row.mode ?? 'standard';
  setMode(mode);

  const list      = document.getElementById('exercise-list');
  list.innerHTML  = '';
  const exercises = row.exercises?.length ? row.exercises : ['Exercise 1'];
  exercises.forEach(name => addExerciseRow(name));
  updateTotalDisplay();
}

// ── Profiles ───────────────────────────────────────────────────────────────
function setProfileStatus(msg, type = '') {
  const el = document.getElementById('profile-status');
  el.textContent = msg;
  el.className   = type ? `status-${type}` : '';
}

async function refreshProfileList(selectId = null) {
  if (!window.electronAPI?.db) return;
  const configs = await window.electronAPI.db.listConfigs();
  const sel     = document.getElementById('profile-select');
  sel.innerHTML = '<option value="">— no profile —</option>';
  configs.forEach(c => {
    const opt   = document.createElement('option');
    opt.value   = c.id;
    opt.text    = c.name;
    sel.appendChild(opt);
  });
  if (selectId) sel.value = selectId;
}

async function loadSelectedProfile() {
  const id = parseInt(document.getElementById('profile-select').value);
  if (!id) { setProfileStatus('Select a profile first.', 'warn'); return; }
  const row = await window.electronAPI.db.loadConfig(id);
  if (!row) { setProfileStatus('Profile not found.', 'err'); return; }
  fillForm(row);
  activeConfigId = id;
  document.getElementById('profile-name').value = row.name;
  setProfileStatus(`Loaded: ${row.name}`, 'ok');
}

async function saveCurrentProfile() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) { setProfileStatus('Enter a profile name.', 'warn'); return; }
  const result = await window.electronAPI.db.saveConfig(name, buildConfig());
  activeConfigId = result.id;
  await refreshProfileList(result.id);
  setProfileStatus(`Saved: ${name}`, 'ok');
}

async function deleteSelectedProfile() {
  const id   = parseInt(document.getElementById('profile-select').value);
  const name = document.getElementById('profile-select').selectedOptions[0]?.text;
  if (!id) { setProfileStatus('Select a profile to delete.', 'warn'); return; }
  await window.electronAPI.db.deleteConfig(id);
  if (activeConfigId === id) {
    activeConfigId = null;
    document.getElementById('profile-name').value = '';
  }
  await refreshProfileList();
  setProfileStatus(`Deleted: ${name}`, 'ok');
}

// ── Session tracking ───────────────────────────────────────────────────────
async function logSessionStart() {
  if (!window.electronAPI?.db) return;
  const cfg   = config;
  const sel   = document.getElementById('profile-select');
  const name  = activeConfigId
    ? (sel.selectedOptions[0]?.text ?? 'Ad hoc')
    : 'Ad hoc';
  const result = await window.electronAPI.db.startSession({
    configId:   activeConfigId,
    configName: name,
    mode:       cfg.mode,
    totalTime:  calculateTotalTime(cfg),
  });
  currentSessionId = result.sessionId;
}

async function logSessionEnd(completed) {
  if (!window.electronAPI?.db || !currentSessionId) return;
  await window.electronAPI.db.endSession(currentSessionId, completed);
  currentSessionId = null;
}

// ── History ────────────────────────────────────────────────────────────────
async function loadHistory() {
  if (!window.electronAPI?.db) return;
  const sessions = await window.electronAPI.db.getHistory(50);
  const el       = document.getElementById('history-list');

  if (!sessions.length) {
    el.innerHTML = '<p class="empty-msg">No sessions yet.</p>';
    return;
  }

  el.innerHTML = sessions.map(s => {
    const dur      = s.finished_at ? formatDuration(
      Math.round((new Date(s.finished_at) - new Date(s.started_at)) / 1000)
    ) : '—';
    const badge    = s.mode === 'pyramid' ? '▲▼' : '↻';
    const statusCls = s.completed ? 'hist-done' : 'hist-stopped';
    const statusTxt = s.completed ? '✓ Done' : '✗ Stopped';

    return `
      <div class="hist-card">
        <div class="hist-top">
          <span class="hist-name">${s.config_name ?? 'Ad hoc'}</span>
          <span class="hist-badge">${badge} ${s.mode}</span>
        </div>
        <div class="hist-bottom">
          <span class="hist-date">${formatDateTime(s.started_at)}</span>
          <span class="hist-dur">⏱ ${dur}</span>
          <span class="${statusCls}">${statusTxt}</span>
        </div>
      </div>`;
  }).join('');
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

function updateTotalDisplay() {
  const cfg   = buildConfig();
  const total = calculateTotalTime(cfg);
  document.querySelector('#session-total span').textContent = formatDuration(total);
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
        s.phase = PHASES.DONE; s.timeLeft = 0;
        announce('Session complete! Great job!');
        logSessionEnd(true);
        return;
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
        s.phase = PHASES.DONE; s.timeLeft = 0;
        announce('Session complete! Great job!');
        logSessionEnd(true);
        return;
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

  if (cfg.mode === 'pyramid') renderTimerPyramid(s, cfg);
  else                        renderTimerStandard(s, cfg);
}

function renderTimerStandard(s, cfg) {
  document.getElementById('exercise-name').textContent    = s.phase === PHASES.DONE ? '' : cfg.exercises[s.exerciseIdx] ?? '';
  document.getElementById('lbl-round').textContent        = 'Round';
  document.getElementById('cur-round').textContent        = s.round;
  document.getElementById('tot-rounds').textContent       = cfg.rounds;
  document.getElementById('cur-exercise').textContent     = s.exerciseIdx + 1;
  document.getElementById('tot-exercises').textContent    = cfg.exercises.length;
  document.getElementById('level-exercises').innerHTML    = '';
}

function renderTimerPyramid(s, cfg) {
  const levels = cfg.pyramidLevels;
  const lvIdx  = Math.min(s.levelIdx, levels.length - 1);
  const level  = levels[lvIdx];

  document.getElementById('exercise-name').textContent    = s.phase === PHASES.DONE ? '' : level[s.exerciseIdx] ?? '';
  document.getElementById('lbl-round').textContent        = 'Level';
  document.getElementById('cur-round').textContent        = lvIdx + 1;
  document.getElementById('tot-rounds').textContent       = levels.length;
  document.getElementById('cur-exercise').textContent     = s.exerciseIdx + 1;
  document.getElementById('tot-exercises').textContent    = level.length;

  const el = document.getElementById('level-exercises');
  if (s.phase === PHASES.DONE) { el.innerHTML = ''; return; }

  if (s.phase === PHASES.BREAK) {
    const next = levels[lvIdx + 1];
    el.innerHTML = next
      ? `<span class="ex-next-label">Next: </span>` + next.map(ex => `<span class="ex-chip">${ex}</span>`).join('<span class="ex-sep">→</span>')
      : '';
    return;
  }

  el.innerHTML = level.map((ex, i) =>
    `<span class="ex-chip ${i === s.exerciseIdx && s.phase === PHASES.WORK ? 'ex-active' : ''}">${ex}</span>`
  ).join('<span class="ex-sep">→</span>');
}

// ── Session control ────────────────────────────────────────────────────────
function initialState(cfg) {
  const startPhase = cfg.prepTime > 0 ? PHASES.PREP : PHASES.WORK;
  const startTime  = cfg.prepTime > 0 ? cfg.prepTime : cfg.workTime;
  if (cfg.mode === 'pyramid') {
    return { phase: startPhase, timeLeft: startTime, levelIdx: 0, exerciseIdx: 0, paused: false };
  }
  return { phase: startPhase, timeLeft: startTime, round: 1, exerciseIdx: 0, paused: false };
}

async function startSession() {
  config = buildConfig();
  state  = initialState(config);
  await logSessionStart();
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

async function resetSession() {
  clearInterval(ticker);
  window.speechSynthesis?.cancel();
  await logSessionEnd(false);
  document.body.className = '';
  showView('config');
}

// ── Exercise list builder ──────────────────────────────────────────────────
function addExerciseRow(name = '') {
  const list = document.getElementById('exercise-list');
  const row  = document.createElement('div');
  row.className = 'exercise-row';

  const input       = document.createElement('input');
  input.type        = 'text';
  input.className   = 'exercise-input';
  input.placeholder = `Exercise ${list.children.length + 1}`;
  input.value       = name;

  const btn         = document.createElement('button');
  btn.className     = 'btn-remove';
  btn.textContent   = '×';
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
  ['config', 'timer', 'history'].forEach(v =>
    document.getElementById(`view-${v}`).classList.toggle('active', v === name)
  );
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  addExerciseRow('Exercise 1');
  updateTotalDisplay();

  await refreshProfileList();

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => { setMode(btn.dataset.mode); updateTotalDisplay(); })
  );

  // Config inputs → recalculate total
  document.getElementById('view-config').addEventListener('input', updateTotalDisplay);

  // Exercise add button
  document.getElementById('btn-add-exercise').addEventListener('click', () => {
    addExerciseRow(); updateTotalDisplay();
  });

  // Profile buttons
  document.getElementById('btn-load-profile').addEventListener('click',   loadSelectedProfile);
  document.getElementById('btn-save-profile').addEventListener('click',   saveCurrentProfile);
  document.getElementById('btn-delete-profile').addEventListener('click', deleteSelectedProfile);

  // Timer buttons
  document.getElementById('btn-start').addEventListener('click', startSession);
  document.getElementById('btn-pause').addEventListener('click', pauseSession);
  document.getElementById('btn-reset').addEventListener('click', resetSession);

  // History buttons
  document.getElementById('btn-show-history').addEventListener('click', async () => {
    await loadHistory();
    showView('history');
  });
  document.getElementById('btn-hide-history').addEventListener('click', () => showView('config'));
});
