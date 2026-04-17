# Tabata Timer — Agent Context

## What this app is
A single-page local web app for Tabata-style interval training. No server, no build step — open `index.html` directly in a browser.

## Tech stack
- Pure HTML / CSS / JavaScript (ES2020, no frameworks, no dependencies)
- Web Speech API (`speechSynthesis`) for voice announcements
- Web Audio API (`AudioContext`) for beep tones

## File map
| File | Role |
|------|------|
| `index.html` | Two-view layout: config form + timer display |
| `style.css` | Dark theme, color-coded phases, mobile-first |
| `app.js` | All logic: state machine, tick loop, audio, DOM updates |

## Timer state machine (`app.js`)

Phases: `prep → work → rest → work → rest → … → break → work → … → done`

```
PREP  (optional) — counts down before the first exercise
WORK             — active exercise window
REST  (optional) — short rest between exercises within a round
BREAK (optional) — longer rest between full rounds
DONE             — session complete
```

Key objects:
- `config` — built from the form at session start (see `buildConfig()`)
- `state`  — `{ phase, timeLeft, round, exerciseIdx, paused }`
- `tick()` — called every 1 000 ms via `setInterval`; decrements `timeLeft`, calls `nextPhase()` when it hits 0
- `nextPhase()` — pure transition logic; calls `announce()` on every phase change

## Configurable parameters and defaults
| Field | Default | Description |
|-------|---------|-------------|
| Rounds | 8 | Number of full circuits |
| Get Ready (prep) | 10 s | Countdown before session starts |
| Work | 20 s | Active exercise duration |
| Rest | 10 s | Rest between exercises |
| Round Break | 60 s | Rest between rounds |
| Exercises | ["Exercise 1"] | Named list; length drives exerciseIdx cycling |

## Audio
- `announce(text)` — cancels any in-flight speech, speaks the text
- `playBeep(freq, duration)` — generates a tone via `AudioContext`; called at 3-second countdown
- `AudioContext` is created lazily on first use (browser autoplay policy requires user gesture first)

## How to run
Just open `index.html` in any modern browser. No install, no server.

## Common tasks for future agents
- **Add a new phase**: extend the `PHASES` constant, add a case in `nextPhase()`, add a CSS class in `style.css`, and add a label entry in `phaseLabels`.
- **Change default values**: edit the `value` attributes in `index.html` (config form inputs).
- **Add exercise sets/reps display**: extend `config.exercises` to store objects `{ name, sets, reps }` and update `renderTimer()`.
- **Persist config**: add `localStorage` read/write around `buildConfig()` and `DOMContentLoaded`.
