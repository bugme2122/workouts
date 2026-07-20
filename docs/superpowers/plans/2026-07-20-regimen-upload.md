# Bring Your Own Workout (BYOW) — Implementation Plan

> **Feature name:** **Bring Your Own Workout (BYOW)**. `regimen@1` is the JSON schema identifier;
> "BYOW" is the product feature.

> **For agentic workers:** implement this plan task-by-task. Each task is independently
> shippable and testable. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design spec:** `docs/superpowers/specs/2026-07-20-regimen-upload-design.md` (APPROVED, v1 scope).

**Goal:** Let a user upload/paste a `regimen@1` JSON workout and run it with the **existing**
timer (Start/Pause/Resume/Reset, per-second countdown, and the built-in "Halfway" chime), by
adding a second **phase source** alongside the ladder engine.

**v1 decisions (locked):** groups+rounds YES · single shared track (no rotation) · file
upload/download only (no URL share) · rest may be 0s · regimen presets namespaced separately ·
entry point in the Customize/Settings sheet · dedicated "regimen mode" live view.

**Architecture:** Keep the ladder engine untouched. Add pure functions `sanitizeRegimen()` and
`buildRegimenPhases()` to `engine.js` (DOM-free, Node-testable). `app.js` gains an "adopt phases"
path that reuses `loop()`, `start()`, `reset()`, `secondCue()`, `say()`, `tone()`, `buzz()`,
`acquireWake()` verbatim. New UI: an import control + a regimen live view.

**Tech stack:** unchanged — vanilla ES modules, plain CSS/HTML, `node --test`. No bundler/deps.

## Global constraints

- **`engine.js` stays DOM-free** — `sanitizeRegimen`/`buildRegimenPhases` use no `document`/`window`.
- **Reuse, don't fork the clock.** `loop()`, `start()`, `reset()` must not be duplicated; the
  regimen path feeds the same `phases`/`cum`/`WORKOUT_TOTAL` globals `build()` already sets.
- **Untrusted input.** Sanitize every uploaded regimen (caps + coercion) as `sanitize()` does.
- **Text only** — render `name`/`label`/`say` with `textContent`, never `innerHTML`.
- **Backward compatible** — ladder configs, presets, and `#w=`/`#c=` share links keep working.
- Phase shape MUST match the ladder engine: `{ type, dur, ... }`, `cum[]` monotonic, `total`
  excludes `prep` (so the ring + "X:XX total" summary stay correct).

---

### Task 1: `sanitizeRegimen()` — harden untrusted input (pure + tested)

Coerce and cap an arbitrary parsed object into a safe `regimen@1` structure, or return an error.

**Files:** edit `engine.js`; create `tests/regimen.test.mjs`.

**Interfaces (produces):**
- `validateRegimen(obj) -> { ok: true, regimen } | { ok: false, error: string }` — checks
  `schema === "regimen@1"`, non-empty `name`, non-empty `segments`.
- `sanitizeRegimen(regimen) -> regimen` — coerces types; enforces caps
  `MAX_SEGMENTS=500`, `MAX_ROUNDS=50`, `MAX_SECONDS=3600`, nesting depth 1; drops unknown
  segment `type`s; `work`/`prep` seconds → ≥1, `rest` seconds → ≥0; strings coerced, never throws.

- [ ] **Step 1:** Write failing tests: valid regimen passes; missing `schema`/`name`/`segments`
  fails with a message; hostile inputs (non-object segments, `null` label, string `seconds`,
  `rounds: 9999`, nested `group` in `group`, 10k segments) are coerced/capped and never throw.
- [ ] **Step 2:** Implement `validateRegimen` + `sanitizeRegimen` to pass. Mirror the coercion
  discipline in existing `sanitize()`.
- [ ] **Step 3:** `node --test` green.

---

### Task 2: `buildRegimenPhases()` — compile regimen → phase list (pure + tested)

Flatten a sanitized regimen into the exact `{ phases, cum, total }` shape `buildPhases()` returns.

**Files:** edit `engine.js`; extend `tests/regimen.test.mjs`.

**Interfaces (produces):**
- `buildRegimenPhases(regimen) -> { phases, cum, total }` where `phases[0]` is
  `{ type:"prep", dur }` (from `defaults.prep`), each timed segment becomes
  `{ type, dur, label, say }`, `group` expands `rounds` times, `cum` is monotonic, `total`
  excludes prep.

- [ ] **Step 1:** Failing tests — flat list flattens 1:1; a `group{rounds:3}` triples its inner
  segments; `total` = sum of non-prep durs; `cum[k]` monotonic; a `dur>=12` segment makes
  `secondCue(phase, round(dur/2)).chime === true` (proves the halfway feature works through the
  **existing** function with no new halfway code).
- [ ] **Step 2:** Implement to pass.
- [ ] **Step 3:** `node --test` green.

---

### Task 3: Runtime adoption + per-segment voice (app.js)

Make the app able to run a regimen using the existing controls.

**Files:** edit `app.js`.

- [ ] **Step 1:** Add `adoptRegimen(regimen)` — sets `phases/cum/WORKOUT_TOTAL` from
  `buildRegimenPhases()`, records `activeKind = "regimen"` (vs `"ladder"`), then `reset()` +
  `render()`. Do **not** touch `loop()`/`start()`.
- [ ] **Step 2:** Extend `enterPhase(p, ...)` — when the active phase has a `say`/`label`
  (regimen), speak that via existing `say()`; otherwise keep current ladder callouts. `work`/`rest`
  still map to the same accent colors and beeps.
- [ ] **Step 3:** Confirm Start/Pause/Resume/Reset and the "Halfway" line
  (`if(cue.chime && config.halfChime) say("Halfway")`) fire unchanged on a regimen.

---

### Task 4: Import UI — file + paste, validate, preview/confirm

**Files:** edit `index.html`, `app.js`, `styles.css`.

- [ ] **Step 1:** Add an "Import workout (JSON)" control in the Settings/Customize sheet near
  presets: a `<input type="file" accept="application/json,.json">` **and** a paste `<textarea>`.
- [ ] **Step 2:** On file/paste → guarded `JSON.parse` → `validateRegimen` → `sanitizeRegimen`.
  Errors render **inline** next to the control (no `alert`).
- [ ] **Step 3:** Preview card: name, segment count, total time, rounds; "Use this workout"
  button calls `adoptRegimen()`. Cancel leaves the current workout untouched.

---

### Task 5: Regimen live view (UR-3 A)

**Files:** edit `index.html`, `app.js`, `styles.css`.

- [ ] **Step 1:** Add a regimen live view: current segment `label`, big countdown, and "up next".
- [ ] **Step 2:** In `render()`, branch on `activeKind`: `"regimen"` → new view; `"ladder"` →
  existing person-cards/big-circuit path (unchanged).
- [ ] **Step 3:** Honor `defaults.theme` if it's a known `THEMES` key; else keep current theme.

---

### Task 6: Export / download current regimen

**Files:** edit `app.js`, `index.html`.

- [ ] **Step 1:** "Download `.json`" action that serializes the active regimen (`Blob` +
  object URL). Round-trips: export → re-import yields an equivalent phase list.
- [ ] **Step 2:** Test (TR-4) in `tests/regimen.test.mjs` on the pure serialize/parse path.

---

### Task 7: Persistence & presets (namespaced)

**Files:** edit `app.js`, `store.js`; verify against `firebase-backend.js`.

- [ ] **Step 1:** Persist the adopted regimen through `store.js` (guest → `localStorage`).
- [ ] **Step 2:** Save/load regimen presets under a **separate namespace** from ladder presets.
- [ ] **Step 3:** Signed-in: save via existing cloud interface. Regimen serializes to a JSON
  **string** (Firestore rejects nested arrays — existing `firebase-backend.js` already stores
  `{ json: JSON.stringify(...) }`, so this reuses that path).

---

## Test plan (all `node --test`, DOM-free)

- TR-1 `buildRegimenPhases` flatten/expand/total/cum (Task 2)
- TR-2 `sanitizeRegimen` caps + hostile coercion never throws (Task 1)
- TR-3 halfway via existing `secondCue` on a regimen phase (Task 2)
- TR-4 export→import round-trip (Task 6)

## Out of scope (v1)

Per-person regimens · URL share links for regimens · visual drag-and-drop builder · importing
third-party formats · server-side validation · rewriting the ladder engine.
