# Workout Catalog + N-Person Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file Ladder Circuit Timer into a Home→Customize→Live app with a workout catalog, generalize the engine from Solo/Duo to 1–6 color-coded people, and fix the late-workout crash and unclear completion.

**Architecture:** Split the monolithic `index.html` into `index.html` + `styles.css` + `catalog.js` (data) + `engine.js` (pure logic, ES module) + `app.js` (DOM/screens, ES module). Pure logic lives in `engine.js` so both the browser and Node's `node --test` import the same code — real unit tests with no build step. Static, GitHub-Pages hosted, relative paths only.

**Tech Stack:** Vanilla ES modules, plain CSS, HTML. Node ≥ 18 built-in test runner (`node --test`) for logic tests. No bundler, no dependencies.

## Global Constraints

- **Relative asset paths only** (`./styles.css`, `./app.js`, …) — GitHub Pages serves from a repo subpath; absolute paths 404.
- **ES modules** — `engine.js` and `catalog.js` use `export`; `app.js` uses `import`. A root `package.json` with `{"type":"module"}` makes Node treat `.js` as ESM.
- **Pure logic stays DOM-free** in `engine.js` (no `document`, `window`, audio) so it is Node-testable.
- **People are capped at station count:** `1 ≤ people ≤ min(6, stations.length)`.
- **Every station lookup wraps** with `% N`.
- Design tokens (colors) come from the existing `design-tokens.css`; per-person palette `--p1..--p6`.
- Preserve existing features: presets, share links (`#c=…`), themes, sound/voice/haptics/wake-lock, PWA manifest.

---

### Task 1: Project scaffold + test harness

Establish the module + test setup with one real, passing test before moving any app logic.

**Files:**
- Create: `package.json`
- Create: `engine.js`
- Create: `tests/engine.test.mjs`

**Interfaces:**
- Produces: `blockLenOf(config) -> number` (sum of every `[on,off]` in `config.ladder`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ladder-circuit-timer",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/engine.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { blockLenOf } from "../engine.js";

test("blockLenOf sums on+off across the ladder", () => {
  const cfg = { ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]] };
  assert.equal(blockLenOf(cfg), 300);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '../engine.js'` (or `blockLenOf is not a function`).

- [ ] **Step 4: Create `engine.js` with the minimal implementation**

```js
// engine.js — pure logic, no DOM. Imported by app.js (browser) and tests (node).
export function blockLenOf(config) {
  return config.ladder.reduce((a, p) => a + p[0] + p[1], 0);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test`
Expected: PASS — 1 test, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add package.json engine.js tests/engine.test.mjs
git commit -m "chore: scaffold ES module engine + node test harness"
```

---

### Task 2: Port pure logic into `engine.js` (behavior-preserving) with tests

Move the already-pure helpers out of `index.html` into `engine.js`, retrofitting tests. No behavior change yet — legacy `mode` still supported.

**Files:**
- Modify: `engine.js`
- Modify: `tests/engine.test.mjs`

**Interfaces:**
- Consumes: `blockLenOf` (Task 1).
- Produces:
  - `blocksFor(config) -> number`
  - `buildPhases(config) -> { phases, cum, total, N, LADN, TOTBLOCKS }`
  - `enc(config) -> string`, `dec(str) -> object|null`

- [ ] **Step 1: Write failing tests for `blocksFor` and `buildPhases`**

Append to `tests/engine.test.mjs`:

```js
import { blocksFor, buildPhases, enc, dec } from "../engine.js";

const base = {
  prep: 5,
  ladder: [[60, 30], [50, 25], [40, 20], [30, 15], [20, 10]],
  stations: [{ ex: "A" }, { ex: "B" }, { ex: "C" }, { ex: "D" }, { ex: "E" }, { ex: "F" }],
};

test("blocksFor defaults to station count when no target", () => {
  assert.equal(blocksFor({ ...base, targetMin: 0 }), 6);
});

test("blocksFor derives block count from targetMin", () => {
  // block length = 300s; 30 min => 1800/300 = 6 blocks
  assert.equal(blocksFor({ ...base, targetMin: 30 }), 6);
});

test("buildPhases produces prep + on/off per interval per block", () => {
  const r = buildPhases({ ...base, targetMin: 0 });
  assert.equal(r.N, 6);
  assert.equal(r.LADN, 5);
  assert.equal(r.TOTBLOCKS, 6);
  // 1 prep + (5 intervals * 2 phases) * 6 blocks = 1 + 60 = 61
  assert.equal(r.phases.length, 61);
  assert.equal(r.phases[0].type, "prep");
  assert.equal(r.total, 300 * 6); // prep excluded from total
});

test("enc/dec round-trips a config", () => {
  const round = dec(enc(base));
  assert.deepEqual(round.ladder, base.ladder);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `blocksFor`/`buildPhases`/`enc`/`dec` are not exported.

- [ ] **Step 3: Implement in `engine.js`**

Append to `engine.js`:

```js
export function blocksFor(config) {
  const N = config.stations.length || 1;
  const bl = blockLenOf(config) || 1;
  return (config.targetMin && config.targetMin > 0)
    ? Math.max(1, Math.round(config.targetMin * 60 / bl))
    : N;
}

export function buildPhases(config) {
  const N = config.stations.length || 1;
  const LADN = config.ladder.length || 1;
  const TOTBLOCKS = blocksFor(config);
  const phases = [{ type: "prep", dur: config.prep }];
  for (let b = 0; b < TOTBLOCKS; b++) {
    for (let i = 0; i < LADN; i++) {
      phases.push({ type: "work", dur: config.ladder[i][0], block: b, iv: i });
      phases.push({ type: "rest", dur: config.ladder[i][1], block: b, iv: i });
    }
  }
  const cum = [];
  let acc = 0;
  for (let k = 0; k < phases.length; k++) {
    cum[k] = acc;
    if (phases[k].type !== "prep") acc += phases[k].dur;
  }
  return { phases, cum, total: acc, N, LADN, TOTBLOCKS };
}

export function enc(config) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(config))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) { return ""; }
}

export function dec(s) {
  try {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch (e) { return null; }
}
```

Note: Node ≥ 18 provides global `btoa`/`atob`, so these run under `node --test`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/engine.test.mjs
git commit -m "refactor: extract phase-build and config codec into engine.js"
```

---

### Task 3: N-person placement, people cap, and config migration (TDD)

Add the new N-person math and the `mode → people` data-model change. This is the heart of the generalization.

**Files:**
- Modify: `engine.js`
- Modify: `tests/engine.test.mjs`

**Interfaces:**
- Produces:
  - `offsetFor(k, P, N) -> number` = `Math.round(k * N / P)`
  - `clampPeople(people, N) -> number` = `Math.max(1, Math.min(people || 1, Math.min(6, N)))`
  - `occupants(block, P, N) -> Array<{ person, station }>` (person `0..P-1`, `station = (block + offsetFor(k,P,N)) % N`)
  - `migrate(config) -> config` (maps legacy `mode`, fills defaults, drops `mode`)
  - `sanitize(config) -> config` (clamps `people`, trims `personNames`)

- [ ] **Step 1: Write failing tests for placement + cap**

Append to `tests/engine.test.mjs`:

```js
import { offsetFor, clampPeople, occupants, migrate, sanitize } from "../engine.js";

test("offsetFor for 2 people equals legacy floor(N/2)", () => {
  assert.equal(offsetFor(1, 2, 6), 3); // matches old OFFSET = floor(6/2)
  assert.equal(offsetFor(0, 2, 6), 0);
});

test("occupants spreads P people around N stations, wrapping", () => {
  // block 0, 3 people, 6 stations => stations 0,2,4
  assert.deepEqual(occupants(0, 3, 6).map(o => o.station), [0, 2, 4]);
  // block 5 wraps: 5,7%6=1,9%6=3
  assert.deepEqual(occupants(5, 3, 6).map(o => o.station), [5, 1, 3]);
});

test("clampPeople never exceeds stations or 6, never below 1", () => {
  assert.equal(clampPeople(6, 4), 4); // 6 people, 4 stations => 4
  assert.equal(clampPeople(9, 8), 6); // cap at 6
  assert.equal(clampPeople(0, 6), 1); // floor at 1
});

test("migrate maps legacy mode to people and drops mode", () => {
  const solo = migrate({ mode: "solo", stations: [{ ex: "A" }], ladder: [[20, 10]] });
  assert.equal(solo.people, 1);
  assert.equal(solo.mode, undefined);
  const duo = migrate({ mode: "duo", stations: [{ ex: "A" }], ladder: [[20, 10]] });
  assert.equal(duo.people, 2);
});

test("sanitize clamps people to station count and trims names", () => {
  const c = sanitize({
    people: 6, personNames: ["Ana", "Ben", "Cam", "Dev"],
    stations: [{ ex: "A" }, { ex: "B" }, { ex: "C" }], ladder: [[20, 10]],
    prep: 5, targetMin: 0, volume: 0.8, theme: "Volt",
  });
  assert.equal(c.people, 3);            // capped to 3 stations
  assert.equal(c.personNames.length, 3); // trimmed to people
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement placement + cap in `engine.js`**

Append to `engine.js`:

```js
export function offsetFor(k, P, N) {
  return Math.round(k * N / (P || 1));
}

export function clampPeople(people, N) {
  return Math.max(1, Math.min(people || 1, Math.min(6, N)));
}

export function occupants(block, P, N) {
  const out = [];
  for (let k = 0; k < P; k++) {
    out.push({ person: k, station: ((block + offsetFor(k, P, N)) % N + N) % N });
  }
  return out;
}
```

- [ ] **Step 4: Implement `migrate` and `sanitize` in `engine.js`**

The catalog default is passed in so `engine.js` stays data-free. Add:

```js
// DEFAULT_CONFIG is injected by the caller (app.js) via setDefaults(); tests pass a
// literal. This keeps engine.js free of catalog data.
let DEFAULTS = { people: 2, prep: 5, theme: "Volt", volume: 0.8, targetMin: 0 };
export function setDefaults(d) { DEFAULTS = { ...DEFAULTS, ...d }; }

export function migrate(c) {
  const out = { ...DEFAULTS, ...(c || {}) };
  if (out.mode !== undefined) {
    if (out.people === undefined) out.people = out.mode === "solo" ? 1 : 2;
    delete out.mode;
  }
  if (out.people === undefined) out.people = 2;
  if (!Array.isArray(out.personNames)) out.personNames = [];
  return out;
}

export function sanitize(c) {
  c.stations = (c.stations || []).map(s => ({
    ex: (s.ex || "").trim() || "Exercise",
    gear: (s.gear || "").trim(),
    rep: (s.rep || "").trim(),
    url: s.url || "",
  }));
  if (!c.stations.length) c.stations = [{ ex: "Exercise", gear: "", rep: "" }];
  c.ladder = (c.ladder || []).map(p => [
    Math.max(1, parseInt(p[0]) || 1),
    Math.max(0, parseInt(p[1]) || 0),
  ]);
  if (!c.ladder.length) c.ladder = [[30, 15]];
  c.prep = Math.max(0, Math.min(60, parseInt(c.prep) || 0));
  c.targetMin = Math.max(0, Math.min(180, parseInt(c.targetMin) || 0));
  c.volume = Math.max(0, Math.min(1, c.volume));
  c.people = clampPeople(c.people, c.stations.length);
  c.personNames = (c.personNames || []).slice(0, c.people);
  return c;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test`
Expected: PASS — all placement/cap/migrate/sanitize tests green.

- [ ] **Step 6: Commit**

```bash
git add engine.js tests/engine.test.mjs
git commit -m "feat: N-person placement math, people cap, and mode->people migration"
```

---

### Task 4: Extract data into `catalog.js` (constants + WORKOUTS)

Move constants out of `index.html` and add the catalog dataset. Data only — no logic, no DOM.

**Files:**
- Create: `catalog.js`

**Interfaces:**
- Produces (all named exports): `THEMES`, `LADDERS`, `LENGTHS`, `EXERCISES`, `DEFAULT`, `WORKOUTS`, `YT(query)`, `howto(station)`.

- [ ] **Step 1: Create `catalog.js` with the existing constants**

Copy `THEMES`, `LADDERS`, `LENGTHS`, `EXERCISES`, `YT`, `howto` verbatim from `index.html` (lines 277–312) and convert to exports. Change `DEFAULT` to use `people` instead of `mode`:

```js
export const YT = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

export const THEMES = {
  Volt:  { work:"#c6f24e", rest:"#ffb13d", rotate:"#ff4d6d", prep:"#56d3ff" },
  Ember: { work:"#ff7a2e", rest:"#ffd23d", rotate:"#ff2e7a", prep:"#5fd0ff" },
  Ice:   { work:"#42e8ff", rest:"#8a8fff", rotate:"#ff5c8a", prep:"#bdfff0" },
  Mono:  { work:"#f1f1ea", rest:"#9aa0aa", rotate:"#ff5b5b", prep:"#6aa6ff" },
  Candy: { work:"#ff5cae", rest:"#ffe14d", rotate:"#a05cff", prep:"#4ce0ff" },
};

export const LADDERS = {
  "Descending": [[60,30],[50,25],[40,20],[30,15],[20,10]],
  "Ascending":  [[20,10],[30,15],[40,20],[50,25],[60,30]],
  "Pyramid":    [[20,10],[40,20],[60,30],[40,20],[20,10]],
  "Tabata":     [[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10]],
  "Flat 40/20": [[40,20],[40,20],[40,20],[40,20],[40,20]],
};

export const LENGTHS = [
  {label:"1 pass", min:0},{label:"15 min", min:15},{label:"20", min:20},
  {label:"30", min:30},{label:"45", min:45},{label:"60", min:60},
];

export const EXERCISES = [
  {ex:"KB Swing",         gear:"25 lb",      rep:"15 reps",       url:YT("kettlebell swing form technique")},
  {ex:"Goblet Squat",     gear:"15 lb",      rep:"15 reps",       url:YT("kettlebell goblet squat form")},
  {ex:"KB Clean & Press", gear:"25 lb",      rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
  {ex:"KB Deadlift",      gear:"25 lb",      rep:"12 reps",       url:YT("kettlebell deadlift form")},
  {ex:"KB Row",           gear:"25 lb",      rep:"10/arm",        url:YT("kettlebell bent over row form")},
  {ex:"Vest Squats",      gear:"Vest",       rep:"15 reps",       url:YT("bodyweight squat proper form")},
  {ex:"Walking Lunges",   gear:"Vest",       rep:"10/leg",        url:YT("walking lunge form")},
  {ex:"Push-ups",         gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  {ex:"Mountain Climbers",gear:"Bodyweight", rep:"30 sec",        url:YT("mountain climbers form")},
  {ex:"Plank",            gear:"Vest",       rep:"Hold",          url:YT("forearm plank form")},
  {ex:"Plate G-to-OH",    gear:"10 lb",      rep:"12 reps",       url:YT("weight plate ground to overhead")},
  {ex:"Jump Rope",        gear:"Rope",       rep:"To time",       url:YT("jump rope basics beginners")},
];

export function howto(s){ return (s && s.url) ? s.url : YT(((s && s.ex) || "exercise") + " proper form"); }

export const DEFAULT = {
  people: 2, prep: 5,
  ladder: [[60,30],[50,25],[40,20],[30,15],[20,10]],
  stations: [
    {ex:"KB Swings",   gear:"25 lb",      rep:"15 reps",        url:YT("kettlebell swing form technique")},
    {ex:"Jump Rope",   gear:"Rope",       rep:"To time",        url:YT("jump rope basics beginners")},
    {ex:"Vest Squats", gear:"Vest",       rep:"12 reps",        url:YT("bodyweight squat proper form")},
    {ex:"Clean & Press",gear:"25 lb",     rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
    {ex:"Goblet Squats",gear:"15 lb",     rep:"15 reps",        url:YT("kettlebell goblet squat form")},
    {ex:"Push-ups",    gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  ],
  personNames: [],
  theme: "Volt", voice: false, ticks: true, haptics: false, keepAwake: true, volume: 0.8,
  targetMin: 0, workoutId: "kb-ladder",
};
```

- [ ] **Step 2: Add the `WORKOUTS` catalog**

Append to `catalog.js`. Each seeds a full config when chosen:

```js
export const WORKOUTS = [
  {
    id: "kb-ladder", name: "Full-Body KB Ladder", category: "Strength · Descending 60→20s",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Volt", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "tabata", name: "Tabata Burner", category: "Cardio · 8× 20/10",
    defaultPeople: 1, ladder: LADDERS["Tabata"], theme: "Ember", prep: 5, targetMin: 0,
    stations: [
      {ex:"Burpees",         gear:"Bodyweight", rep:"Max", url:YT("burpee proper form")},
      {ex:"Mountain Climbers",gear:"Bodyweight", rep:"Fast", url:YT("mountain climbers form")},
      {ex:"Jump Squats",     gear:"Bodyweight", rep:"Max", url:YT("jump squat form")},
      {ex:"High Knees",      gear:"Bodyweight", rep:"Fast", url:YT("high knees exercise form")},
    ],
  },
  {
    id: "bw-pyramid", name: "Bodyweight Pyramid", category: "No gear · 20→60→20s",
    defaultPeople: 2, ladder: LADDERS["Pyramid"], theme: "Ice", prep: 5, targetMin: 0,
    stations: [
      {ex:"Push-ups",       gear:"Bodyweight", rep:"12–15", url:YT("push up proper form")},
      {ex:"Air Squats",     gear:"Bodyweight", rep:"20",    url:YT("air squat form")},
      {ex:"Walking Lunges", gear:"Bodyweight", rep:"10/leg",url:YT("walking lunge form")},
      {ex:"Plank",          gear:"Bodyweight", rep:"Hold",  url:YT("forearm plank form")},
      {ex:"Mountain Climbers",gear:"Bodyweight",rep:"30s",  url:YT("mountain climbers form")},
      {ex:"Jump Rope",      gear:"Rope",       rep:"To time",url:YT("jump rope basics beginners")},
    ],
  },
  {
    id: "partner-circuit", name: "Partner Circuit", category: "Strength · Descending",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Candy", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "quick-15", name: "Quick 15", category: "Flat 40/20 · 15 min",
    defaultPeople: 2, ladder: LADDERS["Flat 40/20"], theme: "Mono", prep: 5, targetMin: 15,
    stations: [
      {ex:"KB Swings",   gear:"25 lb",      rep:"15", url:YT("kettlebell swing form technique")},
      {ex:"Push-ups",    gear:"Bodyweight", rep:"12", url:YT("push up proper form")},
      {ex:"Goblet Squats",gear:"15 lb",     rep:"15", url:YT("kettlebell goblet squat form")},
      {ex:"Jump Rope",   gear:"Rope",       rep:"time",url:YT("jump rope basics beginners")},
    ],
  },
];

// Build a full editable config from a catalog workout.
export function workoutToConfig(w) {
  return {
    ...DEFAULT,
    workoutId: w.id,
    people: w.defaultPeople,
    ladder: JSON.parse(JSON.stringify(w.ladder)),
    stations: JSON.parse(JSON.stringify(w.stations)),
    theme: w.theme || DEFAULT.theme,
    prep: w.prep ?? DEFAULT.prep,
    targetMin: w.targetMin ?? 0,
    personNames: [],
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add catalog.js
git commit -m "feat: add catalog.js with constants and WORKOUTS dataset"
```

---

### Task 5: Split styles into `styles.css` and wire up module `app.js` (behavior-preserving)

Move CSS and JS out of `index.html`. Convert the IIFE to a module that imports `engine.js`/`catalog.js`. **The running app must behave identically** to the pre-split version at the end of this task (still Solo/Duo UI — the people picker comes in Task 7). This is the riskiest task; verify carefully in a browser.

**Files:**
- Modify: `index.html` (remove `<style>` and inline `<script>`; add links)
- Create: `styles.css`
- Create: `app.js`

**Interfaces:**
- Consumes: everything exported from `engine.js` and `catalog.js`.
- Produces: a working modular app identical in behavior to the original.

- [ ] **Step 1: Create `styles.css`**

Move the entire contents of the `<style>` block (`index.html` lines 20–161) into `styles.css` verbatim. Prepend the token block from `design-tokens.css` `:root` so the per-person `--p1..--p6` vars exist (they'll be used in Task 8).

- [ ] **Step 2: Update `index.html` head + body links**

Replace the inline `<style>…</style>` with:

```html
<link rel="stylesheet" href="./styles.css">
```

Replace the closing `<script>(function(){ … })();</script>` with:

```html
<script type="module" src="./app.js"></script>
```

Keep all existing markup (`.wrap`, `.timer`, `.pair`, settings sheet, etc.) unchanged for now.

- [ ] **Step 3: Create `app.js` from the existing IIFE**

Move the inline JS (`index.html` lines 272–616) into `app.js`. At the top, replace the in-file constant/function definitions that now live in modules with imports, and delete their old definitions:

```js
import {
  THEMES, LADDERS, LENGTHS, EXERCISES, DEFAULT, WORKOUTS, YT, howto, workoutToConfig,
} from "./catalog.js";
import {
  blockLenOf, blocksFor, buildPhases, enc, dec, migrate, sanitize,
  offsetFor, clampPeople, occupants, setDefaults,
} from "./engine.js";

setDefaults({ people: DEFAULT.people, prep: DEFAULT.prep, theme: DEFAULT.theme, volume: DEFAULT.volume, targetMin: DEFAULT.targetMin });
```

Then, inside the former IIFE body:
- **Delete** the now-duplicated definitions of `THEMES`, `LADDERS`, `LENGTHS`, `EXERCISES`, `YT`, `howto`, `DEFAULT`, `blockLenOf`, `blocksFor`, `enc`, `dec`, `migrate`, `sanitize`.
- **Replace** the local phase-build in `build()` with `buildPhases`:

```js
function build() {
  const r = buildPhases(config);
  phases = r.phases; cum = r.cum; WORKOUT_TOTAL = r.total;
  N = r.N; LADN = r.LADN; TOTBLOCKS = r.TOTBLOCKS;
  OFFSET = Math.max(1, Math.floor(N / 2)); // still used by the legacy 2-card render until Task 7
}
```

- A module is not an IIFE; either keep the `(function(){ … })();` wrapper inside `app.js` (valid) or remove the wrapper and let module scope encapsulate it. Removing it is cleaner — module top-level is already private.

- [ ] **Step 4: Verify in the browser**

Serve the folder over http (relative module imports do not work from `file://`):

Run: `python -m http.server 8000` (or `npx serve`), then open `http://localhost:8000`.
Expected:
- App loads with no console errors.
- Start/pause/reset, the ring, dots, both partner cards, settings sheet, presets, theme swatches, share-link copy all behave exactly as before.
- `localStorage` config from a prior version still loads (migrate maps old `mode`).

- [ ] **Step 5: Run logic tests (unchanged, still green)**

Run: `node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css app.js
git commit -m "refactor: split index.html into styles.css + module app.js (behavior preserved)"
```

---

### Task 6: Screen routing + Home (catalog) screen

Introduce three screens (`home`, `customize`, `live`) and a minimal router. Render the catalog on Home. The existing timer markup becomes the `live` screen.

**Files:**
- Modify: `index.html` (wrap existing timer in a `#screen-live`; add `#screen-home`, `#screen-customize`)
- Modify: `styles.css` (screen show/hide + Home card styles)
- Modify: `app.js` (router + catalog render)

**Interfaces:**
- Consumes: `WORKOUTS`, `workoutToConfig` (Task 4).
- Produces: `showScreen(name)`; `renderCatalog()`; global `config` seeded on selection.

- [ ] **Step 1: Add screen containers to `index.html`**

Wrap the current `.wrap` (the timer) in `<section id="screen-live" class="screen">`. Before it add:

```html
<section id="screen-home" class="screen">
  <div class="home">
    <div class="brand"><b>Ladder</b> Circuit</div>
    <div class="lab">Pick a workout</div>
    <div class="stack" id="catalogStack"></div>
    <button class="browse" id="buildOwn">+ Build my own from scratch</button>
  </div>
</section>

<section id="screen-customize" class="screen"><!-- filled in Task 7 --></section>
```

- [ ] **Step 2: Add screen + Home card CSS to `styles.css`**

Port the Home card styles from the approved mock (`.home`, `.stack`, `.wcard`, `.wtop`, `.wname`, `.wtag`, `.wdur`, `.exmini`, `.wfoot`, `.browse`) and add routing:

```css
.screen{ display:none; }
.screen.active{ display:block; }
```

(Use the exact rule bodies from the `home.html` mock created during brainstorming — same class names.)

- [ ] **Step 3: Implement router + catalog render in `app.js`**

```js
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
}

function renderCatalog() {
  const stack = document.getElementById("catalogStack");
  stack.innerHTML = "";
  WORKOUTS.forEach(w => {
    const card = document.createElement("div");
    card.className = "wcard";
    const mins = estimateMinutes(workoutToConfig(w));
    card.innerHTML =
      '<div class="wtop"><div><div class="wname">' + esc(w.name) + '</div>' +
      '<div class="wtag">' + esc(w.category) + '</div></div>' +
      '<div class="wdur">~' + mins + ' min</div></div>' +
      '<div class="exmini">' + w.stations.map(s => '<span>' + esc(s.ex) + '</span>').join("") + '</div>' +
      '<div class="wfoot"><button class="cust">Customize</button><button class="go">Start ▸</button></div>';
    card.querySelector(".cust").onclick = () => openCustomize(w);
    card.querySelector(".go").onclick = () => { config = sanitize(workoutToConfig(w)); startLive(); };
    stack.appendChild(card);
  });
}

function estimateMinutes(cfg) {
  const r = buildPhases(cfg);
  return Math.round(r.total / 60);
}
```

`openCustomize` and `startLive` are defined in Tasks 7–8; for now stub them to `showScreen("customize")` / `showScreen("live")` so Home is testable.

- [ ] **Step 4: Boot into Home**

Change the init (end of `app.js`) so that with no share-link config the app opens Home:

```js
applyTheme(config.theme);
renderCatalog();
const hasShared = (location.hash || "").indexOf("c=") >= 0;
showScreen(hasShared ? "live" : "home");
if (hasShared) { build(); setupView(); reset(); }
```

- [ ] **Step 5: Verify in the browser**

Run: `python -m http.server 8000`, open `http://localhost:8000`.
Expected: Home shows 5 catalog cards with correct names, categories, `~N min`, and exercise chips. "Start ▸" jumps to the timer and runs. A shared `#c=…` link still boots straight into the timer.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: screen router + Home catalog screen"
```

---

### Task 7: Customize screen (people picker + names) and remove the Solo/Duo mode UI

Build the Customize screen: the capped people picker, optional per-person names, length, and links into the existing editor. Replace the old `mode` segmented control.

**Files:**
- Modify: `index.html` (`#screen-customize` contents; remove Mode `.seg` from settings)
- Modify: `styles.css` (Customize styles from the mock)
- Modify: `app.js` (`openCustomize`, people picker, name fields; delete `modeDuo/modeSolo` handlers)

**Interfaces:**
- Consumes: `clampPeople`, `sanitize`, `workoutToConfig`, `LENGTHS`.
- Produces: `openCustomize(workout)`; `draft` config; `renderPeoplePicker()`; `startLive()` entry.

- [ ] **Step 1: Add Customize markup to `index.html`**

Fill `#screen-customize` using the approved `customize.html` mock structure (top bar with `‹ Catalog`, title, the `Who's working out?` picker `#peopleRow`, `#nameList`, `Length` chips `#custLenSeg`, collapsed `Stations & ladder` / `Theme & sound` summaries that call `openSettings()`, and a sticky `Go ▸` button `#goBtn`).

- [ ] **Step 2: Port Customize CSS**

Copy the `.cz …` rules from the `customize.html` mock into `styles.css` (rename the wrapper to match the real markup). Include the `.people`, `.pp`, `.pp{n}`, `.names`, `.nrow`, `.dot`, sticky `.gobar`, `.go`.

- [ ] **Step 3: Implement `openCustomize` + people picker in `app.js`**

```js
let draft = null;

function openCustomize(workout) {
  draft = sanitize(workout ? workoutToConfig(workout) : clone(DEFAULT));
  document.getElementById("custTitle").textContent = workout ? workout.name : "Custom workout";
  renderPeoplePicker();
  renderNameList();
  renderCustLen();
  showScreen("customize");
}

function renderPeoplePicker() {
  const row = document.getElementById("peopleRow");
  const maxP = Math.min(6, draft.stations.length);
  row.innerHTML = "";
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement("div");
    b.className = "pp pp" + n + (n <= draft.people ? " on" : "") + (n > maxP ? " disabled" : "");
    b.textContent = n;
    if (n <= maxP) b.onclick = () => { draft.people = n; draft.personNames = draft.personNames.slice(0, n); renderPeoplePicker(); renderNameList(); };
    row.appendChild(b);
  }
}

function renderNameList() {
  const list = document.getElementById("nameList");
  list.innerHTML = "";
  for (let k = 0; k < draft.people; k++) {
    const wrap = document.createElement("div");
    wrap.className = "nrow";
    wrap.innerHTML = '<span class="dot" style="background:var(--p' + (k + 1) + ')"></span>' +
      '<input placeholder="Person ' + (k + 1) + ' name (optional)">';
    const input = wrap.querySelector("input");
    input.value = draft.personNames[k] || "";
    input.oninput = () => { draft.personNames[k] = input.value; };
    list.appendChild(wrap);
  }
}
```

The `.pp{n}.on` colors come from Task 8's CSS (`--p{n}`); add a small rule now so selected numbers fill with their color:

```css
.pp.on.pp1{background:var(--p1);color:#0b0c0e}
.pp.on.pp2{background:var(--p2);color:#0b0c0e}
/* …through pp6… */
.pp.disabled{opacity:.35;pointer-events:none}
```

- [ ] **Step 4: Wire length chips + Go, and back navigation**

```js
function renderCustLen() {
  const c = document.getElementById("custLenSeg");
  c.innerHTML = "";
  LENGTHS.forEach(L => {
    const b = document.createElement("button");
    b.textContent = L.label;
    if (draft.targetMin === L.min) b.className = "on";
    b.onclick = () => { draft.targetMin = L.min; renderCustLen(); };
    c.appendChild(b);
  });
}

document.getElementById("goBtn").onclick = () => { config = sanitize(clone(draft)); persist(); startLive(); };
document.getElementById("custBack").onclick = () => showScreen("home");
document.getElementById("buildOwn").onclick = () => openCustomize(null);
```

- [ ] **Step 5: Remove the old Mode UI**

- In `index.html`, delete the `<div class="sec"><div class="lab">Mode</div> … #modeDuo/#modeSolo …</div>` block from the settings sheet.
- In `app.js`, delete the `$("modeDuo")`/`$("modeSolo")` click handlers and the `draft.mode` reads/writes in `fillSettings`. The settings sheet no longer sets people; Customize owns it.
- `startLive()`: `build(); setupView(); reset(); showScreen("live"); ensureAudio();` then user taps Start (or auto-start — keep manual Start to match today).

- [ ] **Step 6: Verify in the browser**

Expected:
- Tapping **Customize** on a card opens the screen pre-filled; the people picker caps at the station count (e.g. Tabata = 4 stations → 5 and 6 disabled).
- Name fields add/remove as people change; blanks are allowed.
- **Go ▸** lands on the live timer.
- The old Mode toggle is gone from settings; nothing references `config.mode`.

Run: `node --test` → still PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: Customize screen with capped people picker and names; remove mode UI"
```

---

### Task 8: N-person live rendering (portrait cards) + F1 crash fix

Rewrite the live render/announce path from two fixed partner cards to `P` cards driven by `occupants`, and fix the wraparound crash.

**Files:**
- Modify: `index.html` (replace the fixed `.cardA`/`.cardB` pair with a `#personCards` container)
- Modify: `styles.css` (wrapping person-card grid)
- Modify: `app.js` (`render`, `enterPhase`, `setupView`)

**Interfaces:**
- Consumes: `occupants(block, P, N)`, `howto`.
- Produces: `renderPersonCards(block)`.

- [ ] **Step 1: Write a failing test proving the wraparound fix at the engine level**

The crash is a missing `% N`; `occupants` already wraps, but add an explicit regression test tying it to the old crash scenario (block ≥ N). Append to `tests/engine.test.mjs`:

```js
test("occupants never returns an out-of-range station when block >= N (F1)", () => {
  const N = 6, P = 1;
  for (let block = 0; block < 20; block++) {
    for (const o of occupants(block, P, N)) {
      assert.ok(o.station >= 0 && o.station < N, `station ${o.station} out of range at block ${block}`);
    }
  }
});
```

Run: `node --test` → PASS (proves the engine math is safe; the app must now use it everywhere).

- [ ] **Step 2: Replace the partner markup in `index.html`**

Replace the `<div class="pair" id="pair"> … cardA … cardB … </div>` with:

```html
<div class="pair" id="personCards"></div>
```

- [ ] **Step 3: Add person-card CSS**

```css
#personCards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
.pcard{ background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:12px 13px; position:relative; overflow:hidden; }
.pcard .who{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.16em; font-size:12px; text-transform:uppercase; }
.pcard .ex{ font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:21px; line-height:1.02; margin-top:5px; text-transform:uppercase; }
.pcard .meta{ display:flex; gap:6px; flex-wrap:wrap; margin-top:9px; }
.pcard.rotate-flash{ animation:flash 1s ease-in-out infinite; }
```

Each card is tinted by its person color via an inline `--person` (set in JS) on the `.who` accent.

- [ ] **Step 4: Rewrite `renderPersonCards` and call it from `render`**

Replace the old A/B block in `render()` with:

```js
function personLabel(k) {
  return (config.personNames && config.personNames[k] && config.personNames[k].trim())
    ? config.personNames[k].trim() : "P" + (k + 1);
}

function renderPersonCards(block) {
  const host = document.getElementById("personCards");
  const occ = occupants(block, config.people, N);
  host.innerHTML = "";
  occ.forEach(o => {
    const s = config.stations[o.station];      // o.station already wrapped — F1 safe
    const card = document.createElement("div");
    card.className = "pcard";
    card.style.setProperty("--person", "var(--p" + (o.person + 1) + ")");
    card.innerHTML =
      '<div class="stnum">' + (o.station + 1) + '</div>' +
      '<div class="who" style="color:var(--person)">' + esc(personLabel(o.person)) + '</div>' +
      '<div class="ex">' + esc(s.ex || "—") + '</div>' +
      '<div class="meta"><span class="tag gear">' + esc(s.gear || "") + '</span>' +
      '<span class="tag">' + esc(s.rep || "") + '</span></div>';
    host.appendChild(card);
  });
}
```

In `render()`, where it currently computes `disp`/`rot` and sets the A/B DOM, call `renderPersonCards(disp)` and keep the existing `rot` flash by toggling `.rotate-flash` on all `.pcard` when `rot` is true.

- [ ] **Step 5: Fix the crash in `enterPhase` (F1) and generalize the solo voice cue**

Replace the solo callout `config.stations[p.block].ex` with a wrapped lookup and generalize to "first person's station":

```js
if (p.type === "work") {
  sWork(); buzz([50, 40, 80]);
  if (config.people === 1 && firstWorkOfBlock) {
    const st = occupants(p.block, 1, N)[0].station;   // wrapped
    say(config.stations[st].ex);
  } else {
    say("Work");
  }
}
```

- [ ] **Step 6: Update `setupView` (drop solo/duo class logic)**

```js
function setupView() {
  elLad.textContent = config.ladder.map(x => x[0]).join("·") + "s";
  renderDots();
}
```

Remove references to `.pair.solo`, `elWhoA`, and the old A/B element handles that no longer exist.

- [ ] **Step 7: Verify in the browser**

Run: `python -m http.server 8000`.
Expected:
- Pick a workout → Customize → 1 person → Go: **one** card shows, and it never crashes when the workout cycles past the station count (previously the solo crash). Let a short workout run to completion.
- 4 people → four cards, each labeled/colored distinctly, rotating each block.
- Voice (if on) announces the exercise name in solo, "Work" otherwise.

Run: `node --test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css app.js tests/engine.test.mjs
git commit -m "feat: N-person live cards + fix late-workout wraparound crash (F1)"
```

---

### Task 9: Live big-screen (landscape) color-coded circuit

Add the wide-display layout: the full circuit as a color-coded station list with the timer on the right. Reuses the same render data; a CSS breakpoint swaps layouts.

**Files:**
- Modify: `index.html` (add a `#bigCircuit` list + right-panel structure inside `#screen-live`, shown only on wide screens)
- Modify: `styles.css` (breakpoint + big-screen styles from the mock)
- Modify: `app.js` (`renderBigCircuit`)

**Interfaces:**
- Consumes: `occupants`, `config.stations`, `personLabel`.
- Produces: `renderBigCircuit(block)`.

- [ ] **Step 1: Add big-screen markup**

Inside `#screen-live`, add a landscape container that mirrors the mock (`big-screen.html`): a left `#bigCircuit` list of station rows and a right panel reusing the existing ring/phase/dots plus a `#legend`. Wrap in `<div class="bigscreen">`.

- [ ] **Step 2: Add breakpoint CSS**

```css
.bigscreen{ display:none; }
@media (min-width:900px) and (orientation:landscape){
  .wrap{ display:none; }        /* hide portrait timer */
  .bigscreen{ display:grid; grid-template-columns:1.35fr 1fr; }
}
```

Port `.bs …` styles (station rows, `.lit`, `.st.A…F` → use `--p1..--p6`, right-panel ring, legend) from the `big-screen.html` mock into `styles.css`, keyed to the real markup. Use the person palette: a lit row sets `background:var(--p{n}); color:var(--on-person)`.

- [ ] **Step 3: Implement `renderBigCircuit`**

```js
function renderBigCircuit(block) {
  const host = document.getElementById("bigCircuit");
  if (!host) return;
  const occ = occupants(block, config.people, N);
  const byStation = {};
  occ.forEach(o => { byStation[o.station] = o.person; });
  host.innerHTML = "";
  for (let i = 0; i < N; i++) {
    const s = config.stations[i];
    const person = byStation[i];
    const lit = person !== undefined;
    const row = document.createElement("div");
    row.className = "st" + (lit ? " lit" : "");
    if (lit) row.style.background = "var(--p" + (person + 1) + ")";
    row.innerHTML =
      '<span class="num">' + (i + 1) + '</span>' +
      '<span class="nm">' + esc(s.ex || "—") + '</span>' +
      (lit ? '<span class="who">' + esc(personLabel(person)) + '</span>' : '<span class="who"></span>') +
      '<span class="rep">' + esc(s.rep || "") + '</span>';
    host.appendChild(row);
  }
}

function renderLegend() {
  const el = document.getElementById("legend");
  if (!el) return;
  let h = "";
  for (let k = 0; k < config.people; k++) {
    h += '<span><i style="background:var(--p' + (k + 1) + ')"></i>' + esc(personLabel(k)) + '</span>';
  }
  el.innerHTML = h;
}
```

Call `renderBigCircuit(disp)` from `render()` (right after `renderPersonCards`), and `renderLegend()` from `setupView()`. Both layouts render every frame; CSS decides which is visible, so no JS breakpoint logic is needed.

- [ ] **Step 4: Verify in the browser**

Run: `python -m http.server 8000`; widen the window past 900px (landscape).
Expected:
- The portrait timer hides; the big-screen shows the full station list.
- Occupied stations glow in each person's color and slide down on rotate; empty stations stay dark.
- The right panel ring/phase/dots/legend track the workout. Narrowing the window returns to the portrait cards.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: landscape big-screen color-coded circuit + person legend"
```

---

### Task 10: Clear completion state (F2)

Replace the bare checkmark with an unmistakable "WORKOUT COMPLETE" summary.

**Files:**
- Modify: `index.html` (a `#doneCard` overlay/section inside `#screen-live`)
- Modify: `styles.css` (done-card styles)
- Modify: `app.js` (`showComplete()` in the loop's finish branch)

**Interfaces:**
- Consumes: `WORKOUT_TOTAL`, `TOTBLOCKS`, `config.people`, `fmt`.
- Produces: `showComplete()`.

- [ ] **Step 1: Add the done markup**

Inside `#screen-live`, add:

```html
<div class="donecard" id="doneCard" hidden>
  <div class="donebig">✓ Workout Complete</div>
  <div class="donesum" id="doneSum"></div>
  <button class="main" id="doneRestart">Back to workouts</button>
</div>
```

- [ ] **Step 2: Add done-card CSS**

```css
.donecard{ text-align:center; padding:26px 18px; border:1px solid var(--work); border-radius:22px;
  background:linear-gradient(180deg,#16181d,#0e1014); display:flex; flex-direction:column; gap:14px; align-items:center; }
.donebig{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
  font-size:26px; color:var(--work); }
.donesum{ font-family:'Barlow Condensed',sans-serif; font-weight:600; letter-spacing:.06em; color:var(--dim); }
.donesum b{ color:var(--ink); }
```

- [ ] **Step 3: Implement `showComplete` and call it on finish**

In the `loop()` finish branch (where `finished = true` is set), after `sDone(); say("Workout complete");` add `showComplete();`:

```js
function showComplete() {
  const card = document.getElementById("doneCard");
  const sum = document.getElementById("doneSum");
  const who = config.people === 1 ? "solo" : (config.people + " people");
  sum.innerHTML =
    "<b>" + fmt(WORKOUT_TOTAL) + "</b> total · <b>" + TOTBLOCKS + "</b> blocks · <b>" +
    N + "</b> stations · " + who;
  card.hidden = false;
  document.getElementById("tcard").style.display = "none"; // hide the ring card
}
document.getElementById("doneRestart").onclick = () => {
  document.getElementById("doneCard").hidden = true;
  document.getElementById("tcard").style.display = "";
  reset(); showScreen("home");
};
```

Ensure `reset()` also hides `#doneCard` and restores `#tcard` so a restart mid-app is clean.

- [ ] **Step 4: Verify in the browser**

Run a short workout (e.g. "1 pass" length) to the end.
Expected: a clear "✓ WORKOUT COMPLETE" card with total time, blocks, stations, and people; "Back to workouts" returns to Home. No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: explicit WORKOUT COMPLETE summary screen (F2)"
```

---

### Task 11: Final integration pass + cleanup

Verify the full flow end-to-end and remove dead code.

**Files:**
- Modify: `app.js` (delete unused element handles/functions), `index.html`, `styles.css` (remove orphaned rules)

- [ ] **Step 1: Grep for dead references**

Run: `grep -n "mode\|cardA\|cardB\|elWhoA\|OFFSET" app.js`
Expected: no remaining reads of `config.mode`, no references to removed elements. Remove any stragglers (e.g. drop the now-unused `OFFSET` variable if nothing uses it).

- [ ] **Step 2: Full manual smoke test (served over http)**

Run: `python -m http.server 8000`. Verify:
- Home shows 5 workouts. Customize caps people correctly per workout. Names optional.
- 1, 2, 3, 6 people each run correctly (cards + big-screen), rotate correctly, complete cleanly.
- Long/cycling workouts (targetMin 45–60) never crash.
- Share-link copy produces a `#c=…` URL that boots straight into Live with the same config; presets still save/load; themes/sound/voice/haptics/wake-lock still work.

- [ ] **Step 3: Run logic tests**

Run: `node --test`
Expected: PASS — all engine tests green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: integration cleanup and dead-code removal"
```

---

## Self-Review

- **Spec coverage:** Home/catalog (T6), people 1–6 (T3,T7), Customize + names (T7), color-coded big-screen (T9), rotation cue (T8/T9 reuse existing flash+callout), people cap (T3,T7), file split (T4,T5), GitHub-Pages relative paths (T5 constraint), F1 crash (T3,T8), F2 completion (T10), tests (T1–T3,T8). All covered.
- **Placeholder scan:** No "TBD"/"add error handling" placeholders; every code step carries real code. UI CSS ports reference the exact class names from the brainstorm mocks (`home.html`, `customize.html`, `big-screen.html`) that already exist in `.superpowers/brainstorm/`.
- **Type/name consistency:** `occupants`, `offsetFor`, `clampPeople`, `buildPhases`, `personLabel`, `workoutToConfig`, `showScreen` are named identically across producer and consumer tasks. `config.people`/`personNames`/`workoutId` used consistently; `config.mode` fully removed by T7 and verified in T11.

## Execution note

Serve over HTTP for every browser check (`python -m http.server 8000`) — ES module imports fail from `file://`. Node ≥ 18 required for the built-in test runner and global `btoa`/`atob`.
