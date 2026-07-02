# Audio Cues Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spoken start/finish countdowns and a mid-interval halfway chime, and turn the existing (but disabled) rest/rotation voice cues on by default.

**Architecture:** Keep the pure-engine / DOM-app split. A new pure `secondCue(phase, secLeft)` in `engine.js` decides which per-second cue fires (spoken number / beep / halfway chime); `app.js` maps that decision to audio playback. Config defaults flip in `catalog.js` (+ `engine.js` DEFAULTS so migrated configs inherit them).

**Tech Stack:** Vanilla ES modules, Web Audio + Web Speech APIs, Node ≥18 `node --test`. No dependencies.

## Global Constraints

- **Relative asset paths only** (`./engine.js`, …) — GitHub Pages.
- **ES modules**; `engine.js` stays **DOM-free** (no `document`/`window`/audio) so it is Node-testable.
- **Voice default ON**, **Halfway chime default ON** — but `migrate` must preserve a returning user's explicit `voice` value.
- Halfway is a **chime tone**, not a spoken word. Countdown windows: **work/rest = last 5 s**, **prep = last 3 s**. Halfway fires only when interval `dur ≥ 12 s`.
- Reuse the existing `.sw-toggle[data-tog]` settings mechanism — no new settings handler code.

---

### Task 1: Pure `secondCue` timing function + tests (TDD)

Add the DOM-free per-second cue decision to `engine.js`, test-first.

**Files:**
- Modify: `engine.js`
- Modify: `tests/engine.test.mjs`

**Interfaces:**
- Produces: `secondCue(phase, secLeft) -> { speak: string|null, beep: boolean, chime: boolean }` where `phase` is `{ type: "prep"|"work"|"rest"|…, dur: number }` and `secLeft` is an integer count of whole seconds remaining.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine.test.mjs`:

```js
import { secondCue } from "../engine.js";

test("secondCue: prep speaks only the last 3 seconds, with beep", () => {
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 3), { speak: "3", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 1), { speak: "1", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 4), { speak: null, beep: false, chime: false });
  assert.deepEqual(secondCue({ type: "prep", dur: 5 }, 5), { speak: null, beep: false, chime: false });
});

test("secondCue: work/rest speak the last 5 seconds, with beep", () => {
  assert.deepEqual(secondCue({ type: "work", dur: 60 }, 5), { speak: "5", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "rest", dur: 60 }, 1), { speak: "1", beep: true, chime: false });
  assert.deepEqual(secondCue({ type: "work", dur: 60 }, 6), { speak: null, beep: false, chime: false });
});

test("secondCue: chimes at the halfway second only when dur >= 12", () => {
  assert.equal(secondCue({ type: "work", dur: 60 }, 30).chime, true);
  assert.equal(secondCue({ type: "work", dur: 12 }, 6).chime, true);
  assert.equal(secondCue({ type: "work", dur: 11 }, 6).chime, false); // guard boundary
  assert.equal(secondCue({ type: "rest", dur: 10 }, 5).chime, false);  // short rest: no chime
});

test("secondCue: never speaks and chimes in the same second", () => {
  assert.deepEqual(secondCue({ type: "work", dur: 12 }, 6), { speak: null, beep: false, chime: true });
  assert.deepEqual(secondCue({ type: "work", dur: 12 }, 5), { speak: "5", beep: true, chime: false });
});

test("secondCue: a 1s interval is silent at every second", () => {
  for (let s = 0; s <= 1; s++) {
    assert.deepEqual(secondCue({ type: "work", dur: 1 }, s), { speak: null, beep: false, chime: false });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `The requested module '../engine.js' does not provide an export named 'secondCue'`.

- [ ] **Step 3: Implement `secondCue` in `engine.js`**

Append to `engine.js`:

```js
// Per-second audio-cue decision (pure). Returns which cue(s) fire at `secLeft`
// whole seconds remaining in `phase`. app.js maps this to sound/speech.
export function secondCue(phase, secLeft) {
  const out = { speak: null, beep: false, chime: false };
  if (!phase || secLeft < 1) return out;
  const type = phase.type, dur = phase.dur || 0;
  if (type === "prep") {
    if (secLeft <= Math.min(3, dur - 1)) { out.speak = String(secLeft); out.beep = true; }
    return out;
  }
  if (type === "work" || type === "rest") {
    if (secLeft <= Math.min(5, dur - 1)) { out.speak = String(secLeft); out.beep = true; }
    if (dur >= 12 && secLeft === Math.round(dur / 2)) out.chime = true;
    return out;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test`
Expected: PASS — all existing tests (13) plus the 5 new `secondCue` tests green, output pristine.

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/engine.test.mjs
git commit -m "feat: pure secondCue timing function for per-second audio cues"
```

---

### Task 2: Wire audio playback, config defaults, and the Halfway-chime toggle

Connect `secondCue` to real audio in `app.js`, add the `sHalf` chime and the first-work `"Go"`, flip the config defaults, and add the settings toggle row.

**Files:**
- Modify: `catalog.js` (`DEFAULT.voice`, `DEFAULT.halfChime`)
- Modify: `engine.js` (internal `DEFAULTS` gains `voice`/`ticks`/`halfChime`)
- Modify: `app.js` (import `secondCue`; `setDefaults` call; `sHalf`; `loop` cue dispatch + `beepSec`→`cueSec` rename; `enterPhase` `"Go"`)
- Modify: `index.html` (add the `halfChime` toggle row; fix stale "3 seconds" copy)

**Interfaces:**
- Consumes: `secondCue(phase, secLeft)` (Task 1).

- [ ] **Step 1: Flip catalog defaults**

In `catalog.js`, inside the `DEFAULT` object, change `voice:false` to `voice:true` and add `halfChime:true`. Find the line containing `voice:false` (it sits alongside `ticks:true, haptics:false, keepAwake:true`). Replace:

```js
    theme:"Volt", voice:false, ticks:true, haptics:false, keepAwake:true, volume:0.8,
```
with:
```js
    theme:"Volt", voice:true, ticks:true, haptics:false, keepAwake:true, volume:0.8, halfChime:true,
```
(If the exact spacing differs, keep the surrounding keys; only change `voice` to `true` and add `halfChime:true`.)

- [ ] **Step 2: Add the booleans to engine `DEFAULTS` so migrated configs inherit them**

In `engine.js`, find the module-level defaults line:

```js
let DEFAULTS = { people: 2, prep: 5, theme: "Volt", volume: 0.8, targetMin: 0 };
```
Replace with:
```js
let DEFAULTS = { people: 2, prep: 5, theme: "Volt", volume: 0.8, targetMin: 0, voice: true, ticks: true, halfChime: true };
```
`migrate` does `{ ...DEFAULTS, ...input }`, so a legacy config that already persisted `voice:false` keeps it, while configs missing these keys get the new defaults.

- [ ] **Step 3: Pass the new defaults through `setDefaults` and import `secondCue`**

In `app.js`, add `secondCue` to the `engine.js` import list. The current import is:

```js
import {
  blockLenOf, blocksFor, buildPhases, enc, dec, migrate, sanitize,
  clampPeople, occupants, setDefaults,
} from "./engine.js";
```
Change it to also import `secondCue`:
```js
import {
  blockLenOf, blocksFor, buildPhases, enc, dec, migrate, sanitize,
  clampPeople, occupants, setDefaults, secondCue,
} from "./engine.js";
```
(Preserve whatever the current exact import list is — just add `secondCue`. Do not re-add `offsetFor`/`YT` which were removed earlier.)

Then update the `setDefaults({...})` call near the top. Current:
```js
setDefaults({ people: DEFAULT.people, prep: DEFAULT.prep, theme: DEFAULT.theme, volume: DEFAULT.volume, targetMin: DEFAULT.targetMin });
```
Replace with:
```js
setDefaults({ people: DEFAULT.people, prep: DEFAULT.prep, theme: DEFAULT.theme, volume: DEFAULT.volume, targetMin: DEFAULT.targetMin, voice: DEFAULT.voice, ticks: DEFAULT.ticks, halfChime: DEFAULT.halfChime });
```

- [ ] **Step 4: Add the `sHalf` chime sound**

In `app.js`, immediately after the `sTick` definition (`const sTick=()=>{ if(config.ticks) tone(1568,0,.05,.16,"sine"); };`), add:

```js
const sHalf=()=>{ tone(880,0,.12,.28,"sine"); tone(1174,.10,.14,.28,"sine"); };
```

- [ ] **Step 5: Rename `beepSec` → `cueSec` and dispatch `secondCue` in `loop()`**

In `app.js`:

(a) In the state declaration line, rename `beepSec` to `cueSec`:
```js
let idx=0, remaining=0, running=false, finished=false, last=0, cueSec=null, rafId=null;
```

(b) Replace the per-second beep line in `loop()`:
```js
  if((p.type==="work"||p.type==="rest"||p.type==="prep")&&secLeft<=3&&secLeft>=1&&secLeft!==beepSec){ beepSec=secLeft; sTick(); }
```
with the cue dispatch:
```js
  if(secLeft>=1&&secLeft!==cueSec){
    cueSec=secLeft;
    const cue=secondCue(p, secLeft);
    if(cue.beep) sTick();
    if(cue.speak) say(cue.speak);
    if(cue.chime && config.halfChime) sHalf();
  }
```
(`sTick` self-gates on `config.ticks`; `say` self-gates on `config.voice`; the chime is gated here on `config.halfChime`.)

(c) In the `while(remaining<=0)` block, change `beepSec=null;` to `cueSec=null;`.

(d) In `start()`, change `beepSec=null;` to `cueSec=null;`.

(e) In `reset()`, change `beepSec=null;` to `cueSec=null;`.

- [ ] **Step 6: Say `"Go"` on the first work interval in `enterPhase`**

In `app.js`, replace the `work` branch of `enterPhase`:
```js
  if(p.type==="work"){ sWork(); buzz([50,40,80]);
    if(config.people===1&&firstWorkOfBlock){ const st=occupants(p.block,1,N)[0].station; say(config.stations[st].ex); }
    else say("Work"); }
```
with a first-work `"Go"`:
```js
  if(p.type==="work"){ sWork(); buzz([50,40,80]);
    if(p.block===0&&p.iv===0){ say("Go"); }
    else if(config.people===1&&firstWorkOfBlock){ const st=occupants(p.block,1,N)[0].station; say(config.stations[st].ex); }
    else say("Work"); }
```

- [ ] **Step 7: Add the Halfway-chime settings toggle + fix stale copy**

In `index.html`, in the "Sound & feel" `.togs` block, find the "Countdown beeps" row (`data-tog="ticks"`). Update its help copy from "3 seconds" to "5 seconds" and add a new halfChime row immediately after it. Replace:
```html
        <div class="tog"><span>Countdown beeps<small>Ticks in the last 3 seconds</small></span><div class="sw-toggle" data-tog="ticks"></div></div>
```
with:
```html
        <div class="tog"><span>Countdown beeps<small>Ticks in the last 5 seconds</small></span><div class="sw-toggle" data-tog="ticks"></div></div>
        <div class="tog"><span>Halfway chime<small>Chimes at the midpoint of each interval</small></span><div class="sw-toggle" data-tog="halfChime"></div></div>
```
No JS change is needed: the generic `.sw-toggle[data-tog]` click handler and `fillSettings` already read/write `draft.halfChime` by attribute.

- [ ] **Step 8: Verify**

Run: `node --test`
Expected: PASS — 18 tests (13 prior + 5 `secondCue`), pristine.

Run: `node --check app.js`
Expected: no output (syntax OK).

Static self-review: grep `app.js` for `beepSec` → **zero** matches (fully renamed to `cueSec`); confirm `secondCue` is imported and called in `loop`; confirm `sHalf` defined; confirm `enterPhase` has the `p.block===0&&p.iv===0` `"Go"` branch; confirm `index.html` has one `data-tog="halfChime"` row. The controller will run its headless workout driver (voice-on config) to confirm a full run still completes with no crash and the new cue dispatch executes.

- [ ] **Step 9: Commit**

```bash
git add catalog.js engine.js app.js index.html
git commit -m "feat: default-on voice, spoken start/finish countdowns, halfway chime"
```

---

## Self-Review

- **Spec coverage:** Voice-on default (T2 S1–S3), rest/rotation voice (activated by the default flip, no code change — noted), spoken start "3,2,1,GO" (T2 S5 prep countdown + S6 `"Go"`), spoken last-5-sec countdown (T1 window + T2 S5 dispatch), halfway chime work+rest with `dur≥12` guard (T1 + T2 S4/S5), `halfChime` toggle (T2 S7), migrate-preserves-voice (T2 S2). All covered.
- **Placeholder scan:** No TBD/placeholder steps; every code step carries literal code and exact locations.
- **Type consistency:** `secondCue(phase, secLeft) -> {speak,beep,chime}` used identically in T1 (definition/tests) and T2 (dispatch). `cueSec` replaces `beepSec` consistently across all five sites. `config.halfChime` / `DEFAULT.halfChime` / `data-tog="halfChime"` names match.
