# Audio Cues Enhancement — Design Spec

**Date:** 2026-07-02
**Status:** Approved (defaults locked in via delegated `/loop` autonomy — see "Locked-in decisions")
**Branch:** `feat/audio-cues`

## Goal

Make the workout timer's audio guidance complete and useful without looking at the screen: spoken cues for rest and rotation (already coded but disabled by default), a spoken start countdown, a spoken last-5-second countdown, and a new mid-interval "halfway" chime.

## Current state (baseline)

In `app.js`:
- `say(text)` speaks via `speechSynthesis`, **gated by `config.voice`** (default **false** in `catalog.js` `DEFAULT`). It calls `speechSynthesis.cancel()` before each utterance, so a new cue interrupts the previous one.
- Transition tones exist: `sWork`, `sRest`, `sRotate`, `sDone`; `sTick` (1568 Hz) is gated by `config.ticks` (default **true**).
- `enterPhase(p, firstWorkOfBlock)` plays the transition tone + `say(...)`: work → exercise name (solo, first of block) else `"Work"`; rest → rotation ⇒ `"Rotate. Switch stations."` else `"Rest"`.
- `loop()` fires `sTick()` when `secLeft <= 3` (last **3** seconds of work/rest/prep), de-duplicated per second via `beepSec`.
- `start()` says `"Get ready"` at the beginning of a prep phase.
- Settings "Sound & feel" section has `data-tog` toggles: `voice`, `ticks`, `haptics`, `keepAwake`, driven by a generic handler that reads/writes `draft[t.dataset.tog]`.

So: **Rest voice and Rotation voice already exist** but are silent because `voice` defaults off. Start already beeps (last 3 s of prep). Halfway does not exist. Countdown is 3 s of beeps only.

## Locked-in decisions (from brainstorm answers + recommended defaults)

1. **Voice on by default** — flip `DEFAULT.voice` to `true`. This activates the existing Rest/Rotation cues plus the new spoken cues. Users can still mute Voice in Settings. *Note:* returning users whose saved config already persisted `voice:false` keep their setting (migrate preserves an explicit value); only fresh installs get voice on.
2. **Halfway cue = a distinct chime (tone), not a spoken word** — matches the original "sound or audio" phrasing, is language-neutral, and reads cleanly on short rests. Fires at the midpoint of **work and rest** intervals. Gated by a **new `halfChime` toggle, default on**.
3. **Last-5-sec countdown = spoken "5,4,3,2,1"** on work and rest intervals (the beep window also extends 3 → 5 s so beeps and numbers align; beeps remain under the existing `ticks` toggle).
4. **Start countdown = spoken "3, 2, 1, GO"** — the prep phase's final 3 s are spoken, and the first work interval says `"Go"`.

## Behavior specification

### Per-second cues (during `loop`)
Driven by a new **pure** function `secondCue(phase, secLeft)` (in `engine.js`), called once per integer-second boundary. Given a phase `{type, dur}` and integer `secLeft` (seconds remaining), it returns `{ speak: string|null, beep: boolean, chime: boolean }`:

- **Prep phase:** if `1 ≤ secLeft ≤ min(3, dur-1)` → `speak = String(secLeft)`, `beep = true`.
- **Work / rest phase:**
  - Countdown: if `1 ≤ secLeft ≤ min(5, dur-1)` → `speak = String(secLeft)`, `beep = true`.
  - Halfway: if `dur ≥ 12` **and** `secLeft === Math.round(dur/2)` → `chime = true`.
- Otherwise all-false.

The `dur ≥ 12` guard guarantees the halfway second (`≥ 6`) never collides with the countdown window (`≤ 5`), and the `min(…, dur-1)` ceiling keeps the numeric countdown from stepping on the phase-entry transition word on short intervals.

`app.js` maps the result: `beep && config.ticks → sTick()`; `speak → say(speak)`; `chime && config.halfChime → sHalf()`. `sTick`/`say` keep their own internal gates; the caller gates the chime.

### Transition cues (during `enterPhase`)
Unchanged except: the **first** work interval (`type==="work" && block===0 && iv===0`) says **`"Go"`** (still plays `sWork`), instead of the usual `"Work"`/exercise name. All later work/rest/rotation cues are unchanged. `"Get ready"` at prep start is unchanged.

Resulting start sequence with voice on: `"Get ready"` … (spoken/beeped `"3" "2" "1"`) … `"Go"`.

### New sound
`sHalf()` — a short rising two-note sine chime, distinct from the single-note `sTick`, e.g. `tone(880,0,.12,.28,"sine"); tone(1174,.10,.14,.28,"sine");`.

## Architecture

Follows the existing **pure-engine / DOM-app** split:
- **`engine.js`** gains `secondCue(phase, secLeft)` — pure, DOM-free, unit-tested. It owns all cue-timing rules (countdown windows, halfway midpoint + guards).
- **`app.js`** owns playback: adds `sHalf`, replaces the inline `sTick`-at-≤3 logic in `loop()` with a `secondCue(...)` call (renaming `beepSec` → `cueSec` for the per-second de-dup), adds the first-work `"Go"` branch in `enterPhase`, and adds the `halfChime` settings toggle wiring.
- **`catalog.js`** flips `DEFAULT.voice → true` and adds `DEFAULT.halfChime: true`.
- Config-default plumbing: add `voice`, `ticks`, `halfChime` to `engine.js`'s internal `DEFAULTS` and to the `setDefaults({...})` call in `app.js`, so migrated legacy configs receive sensible defaults (existing explicit `voice` values are preserved by `migrate`).

## Settings change

Add one row to the "Sound & feel" section in `index.html`:
```html
<div class="tog"><span>Halfway chime<small>Chimes at the midpoint of each interval</small></span><div class="sw-toggle" data-tog="halfChime"></div></div>
```
No JS change needed — the generic `.sw-toggle[data-tog]` handler and `fillSettings` already read/write `draft.halfChime` by attribute.

## Edge cases

- **Short intervals:** the `min(…, dur-1)` ceiling means a 3 s rest counts only `"2","1"` (entry word keeps the first second); a 1 s interval gets no countdown/chime. No halfway on intervals `< 12 s` (e.g. Tabata 20/10 rests) — avoids chatter and countdown collisions.
- **No double-fire:** countdown and halfway can never both trigger at the same second (guard proof above). Per-second de-dup via `cueSec` prevents repeats within a second.
- **Speech reliability:** `speechSynthesis` has some latency; `say()` cancels the prior utterance each second, so rapid numbers won't queue up. Short number words ("five".."one") fit comfortably within one second. Accepted limitation of the Web Speech API; beeps provide a reliable parallel cue when `ticks` is on.
- **Audio unlock:** unchanged — `ensureAudio()` on Start resumes the `AudioContext`; tones no-op until then. Speech does not require the unlock.

## Testing

`tests/engine.test.mjs` gains unit tests for `secondCue`:
- Prep window: `secondCue({type:"prep",dur:5}, 3)` speaks `"3"`+beep; `secLeft 4` and `5` are silent.
- Work countdown: `dur:60` → `secLeft 5..1` speak the number + beep; `secLeft 6` silent.
- Halfway: `dur:60` → `secLeft 30` chimes; `dur:12` → `secLeft 6` chimes; `dur:11` and `dur:10` → **no** chime anywhere (guard boundary).
- No-collision: for `dur:12`, the `secLeft 6` result has `chime:true, speak:null`, and `secLeft 5` has `speak:"5", chime:false`.
- Degenerate: `dur:1` → all-false at every `secLeft`.

The DOM playback wiring (default-on voice, `"Go"`, chime toggle) is verified by the controller's headless runtime driver (drives a workout to completion) plus code review, since no browser is available.

## Out of scope

- No new voice-selection/rate/pitch UI, no per-cue volume, no spoken exercise names beyond the existing solo callout, no configurable countdown length, no haptic changes. Halfway stays a chime (not spoken) unless the user later requests otherwise.
