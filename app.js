'use strict';

// ── Audio ──────────────────────────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playBeep(freq = 880, duration = 0.12) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
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

// ── State ──────────────────────────────────────────────────────────────────
const PHASES = { PREP: 'prep', WORK: 'work', REST: 'rest', BREAK: 'break', DONE: 'done' };

let config = {};
let state  = {};
let ticker = null;

function buildConfig() {
  const exercises = [...document.querySelectorAll('.exercise-input')]
    .map(i => i.value.trim() || 'Exercise');
  if (exercises.length === 0) exercises.push('Exercise');

  return {
    prepTime:   parseInt(document.getElementById('cfg-prep').value,  10) || 0,
    workTime:   parseInt(document.getElementById('cfg-work').value,  10) || 20,
    restTime:   parseInt(document.getElementById('cfg-rest').value,  10) || 10,
    breakTime:  parseInt(document.getElementById('cfg-break').value, 10) || 60,
    rounds:     parseInt(document.getElementById('cfg-rounds').value, 10) || 8,
    exercises,
  };
}

function initialState(cfg) {
  return {
    phase:      cfg.prepTime > 0 ? PHASES.PREP : PHASES.WORK,
    timeLeft:   cfg.prepTime > 0 ? cfg.prepTime : cfg.workTime,
    round:      1,
    exerciseIdx: 0,
    paused:     false,
  };
}

// ── Phase transitions ──────────────────────────────────────────────────────
function nextPhase() {
  const cfg = config;
  const s   = state;
  const lastExercise = s.exerciseIdx === cfg.exercises.length - 1;
  const lastRound    = s.round === cfg.rounds;

  if (s.phase === PHASES.PREP) {
    s.phase    = PHASES.WORK;
    s.timeLeft = cfg.workTime;
    announce('Work!');
    return;
  }

  if (s.phase === PHASES.WORK) {
    if (lastExercise) {
      if (lastRound) {
        s.phase    = PHASES.DONE;
        s.timeLeft = 0;
        announce('Session complete! Great job!');
        return;
      }
      if (cfg.breakTime > 0) {
        s.phase    = PHASES.BREAK;
        s.timeLeft = cfg.breakTime;
        announce('Round break!');
        return;
      }
      // no break — start next round
      s.round++;
      s.exerciseIdx = 0;
      s.phase    = PHASES.WORK;
      s.timeLeft = cfg.workTime;
      announce('Work!');
      return;
    }
    // more exercises in this round
    if (cfg.restTime > 0) {
      s.phase    = PHASES.REST;
      s.timeLeft = cfg.restTime;
      announce('Rest!');
      return;
    }
    s.exerciseIdx++;
    s.phase    = PHASES.WORK;
    s.timeLeft = cfg.workTime;
    announce('Work!');
    return;
  }

  if (s.phase === PHASES.REST) {
    s.exerciseIdx++;
    s.phase    = PHASES.WORK;
    s.timeLeft = cfg.workTime;
    announce('Work!');
    return;
  }

  if (s.phase === PHASES.BREAK) {
    s.round++;
    s.exerciseIdx = 0;
    s.phase    = PHASES.WORK;
    s.timeLeft = cfg.workTime;
    announce('Work!');
    return;
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────
function tick() {
  if (state.paused || state.phase === PHASES.DONE) return;

  // 3-second countdown beeps
  if (state.timeLeft <= 3 && state.timeLeft > 0) playBeep(660, 0.1);

  state.timeLeft--;

  if (state.timeLeft <= 0 && state.phase !== PHASES.DONE) {
    nextPhase();
  }

  renderTimer();
}

// ── Render ─────────────────────────────────────────────────────────────────
const phaseLabels = {
  [PHASES.PREP]:  'Get Ready',
  [PHASES.WORK]:  'Work!',
  [PHASES.REST]:  'Rest',
  [PHASES.BREAK]: 'Round Break',
  [PHASES.DONE]:  'Done!',
};

function renderTimer() {
  const s   = state;
  const cfg = config;

  document.getElementById('phase-label').textContent = phaseLabels[s.phase] ?? s.phase;
  document.getElementById('countdown').textContent   = s.timeLeft;
  document.getElementById('exercise-name').textContent =
    s.phase === PHASES.DONE ? '' : cfg.exercises[s.exerciseIdx] ?? '';
  document.getElementById('cur-round').textContent    = s.round;
  document.getElementById('tot-rounds').textContent   = cfg.rounds;
  document.getElementById('cur-exercise').textContent = s.exerciseIdx + 1;
  document.getElementById('tot-exercises').textContent = cfg.exercises.length;
  document.getElementById('btn-pause').textContent    = s.paused ? 'Resume' : 'Pause';

  // colour class on body
  document.body.className = `phase-${s.phase}`;
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
  else announce('Work!');
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
  const list = document.getElementById('exercise-list');
  const row  = document.createElement('div');
  row.className = 'exercise-row';

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'exercise-input';
  input.placeholder = `Exercise ${list.children.length + 1}`;
  input.value       = name;

  const btn = document.createElement('button');
  btn.className   = 'btn-remove';
  btn.textContent = '×';
  btn.addEventListener('click', () => row.remove());

  row.append(input, btn);
  list.appendChild(row);
}

// ── View switching ─────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('view-config').classList.toggle('active', name === 'config');
  document.getElementById('view-timer').classList.toggle('active',  name === 'timer');
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  addExerciseRow('Exercise 1');

  document.getElementById('btn-add-exercise').addEventListener('click', () => addExerciseRow());
  document.getElementById('btn-start').addEventListener('click', startSession);
  document.getElementById('btn-pause').addEventListener('click', pauseSession);
  document.getElementById('btn-reset').addEventListener('click', resetSession);
});
