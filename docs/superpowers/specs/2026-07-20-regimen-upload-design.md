# Bring Your Own Workout (BYOW) — Requirements & Design Spec

> **Feature name:** **Bring Your Own Workout (BYOW)** — the user-facing name for uploading a
> JSON workout the app runs on the existing timer. `regimen@1` is the wire/schema identifier
> inside the JSON file; "BYOW" is the product feature.

**Date:** 2026-07-20
**Status:** APPROVED (v1 scope) — decisions locked (see §10). Ready for implementation plan.
**Target repo:** `bugme2122/workouts` (this repo). Chosen because it is the only version
with **Google sign-on** (`auth.js` → `signInWithGoogle()` via Firebase project
`workout-system-73cf8`) and Firestore cloud sync (`firebase-backend.js`). The
`bugme2122/ladder-timer` repo is a single-file prototype with no auth and is **not** the target.

---

## 1. Summary / Goal

Let a user **upload (or paste) a JSON file** describing an arbitrary workout regimen, have the
app **ingest and validate** it, and then **run it using the timer machinery that already
exists** — the same Start/Pause/Resume/Reset controls, the same per-second countdown loop, the
same voice callouts, and the same **"Halfway" chime** the app already fires partway through a
timed phase.

The core insight: the engine already compiles a workout into a **flat array of timed phases**
(`{ type, dur, ... }`) and a single clock loop drives them. This feature adds a **second source**
for that phase array — an uploaded regimen — without touching the clock, audio, or halfway logic.

> **Non-goal restatement:** we are *not* rewriting the timer. We are adding an input path that
> produces the exact data structure the timer already consumes.

---

## 2. What already exists (reuse inventory)

Understanding the current pipeline is what makes this feature small. Confirmed by reading the code:

| Capability | Where | Reuse plan |
|---|---|---|
| Compile a config → phase list `{ phases, cum, total }` | `engine.js` → `buildPhases(config)` | **Add a sibling** `buildRegimenPhases(regimen)` that returns the *same shape*. |
| Per-second cue decision (countdown beeps, **halfway chime**) | `engine.js` → `secondCue(phase, secLeft)` — fires `chime` when `dur >= 12 && secLeft === round(dur/2)` | **Reuse verbatim.** Halfway already works for any phase ≥12s. |
| The clock | `app.js` → `loop()` (rAF-driven, decrements `remaining`, advances `idx`) | **Reuse verbatim.** It only reads the `phases`/`cum` arrays. |
| Start / Pause / Resume | `app.js` → `start()` (toggles `running`) | **Reuse verbatim.** |
| Reset | `app.js` → `reset()` | **Reuse verbatim.** |
| Halfway announcement | `app.js` → `loop()`: `if(cue.chime && config.halfChime) say("Halfway")` | **Reuse verbatim.** |
| Voice / beeps / haptics / screen wake-lock | `app.js` → `say()`, `tone()`, `buzz()`, `acquireWake()` | **Reuse verbatim** (audio) / small extension (`enterPhase` label speech). |
| Phase-entry callouts ("Go", "Work", "Rest", "Rotate") | `app.js` → `enterPhase(p, ...)` | **Extend** to speak a per-segment `say` label when present. |
| Untrusted-input hardening (caps + coercion) | `engine.js` → `sanitize(c)` (`MAX_STATIONS=40`, `MAX_LADDER=60`) | **Mirror the pattern** in a new `sanitizeRegimen()`. |
| Local + cloud persistence behind one interface | `store.js`, `firebase-backend.js` | Reuse for saving an ingested regimen (see §7). |
| Existing share-link import (`#w=`/`#c=` → `dec()` → `sanitize`) | `engine.js` `dec()`, `app.js` `loadConfig()` | Precedent for "ingest untrusted JSON safely"; the upload path follows the same discipline. |

**The clock loop is schema-agnostic.** `loop()` only ever reads `phases[idx].type`, `.dur`, and
`remaining`. As long as `buildRegimenPhases()` emits phases with `type` ∈ the known set and a
numeric `dur`, Start/Pause/Reset/countdown/halfway all work with **zero changes**.

---

## 3. The current schema vs. the proposed schema

### 3.1 Today's config (rigid "ladder circuit")
```
config = {
  stations: [{ ex, gear, rep, url }],     // the exercises
  ladder:   [[on, off], ...],             // repeating work/rest second-pairs
  people, prep, targetMin, theme, volume, // knobs
  voice, ticks, halfChime, haptics, keepAwake, personNames
}
```
`buildPhases()` multiplies `stations × ladder × blocks` into a uniform, repeating structure with
person-rotation. Great for a circuit; it **cannot express** an arbitrary sequence like
"45s plank → 20s rest → 60s squats → 30s rest → 3 rounds of burpees…".

### 3.2 Proposed regimen schema (`regimen@1`)
A regimen is an **explicit, ordered list of timed segments**, with optional repeatable groups.

```jsonc
{
  "schema": "regimen@1",              // REQUIRED version tag — gates parsing
  "name": "Full-Body 30",            // REQUIRED display name
  "meta": {                           // OPTIONAL, informational only
    "author": "you@example.com",
    "notes": "Weighted, minimal rest"
  },
  "defaults": {                       // OPTIONAL — seed the run's knobs
    "prep": 10,                       // lead-in countdown (s)
    "voice": true,
    "halfChime": true,                // enable the "Halfway" announcement
    "volume": 0.8,
    "theme": "Volt"                   // must be a known THEME key or is ignored
  },
  "segments": [                       // REQUIRED, ordered, ≥1 entry
    { "type": "work", "label": "Push-ups", "seconds": 45, "say": "Push ups", "halfway": true },
    { "type": "rest", "seconds": 15 },
    { "type": "work", "label": "Goblet Squat", "seconds": 60, "say": "Squats" },
    { "type": "rest", "seconds": 30 },
    {
      "type": "group",               // repeatable block
      "rounds": 3,
      "segments": [
        { "type": "work", "label": "Burpees", "seconds": 30 },
        { "type": "rest", "seconds": 20 }
      ]
    }
  ]
}
```

**Segment fields**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"work" \| "rest" \| "prep" \| "group"` | yes | `work`/`rest`/`prep` map directly to engine phase types (drives color + default callout). `group` = repeat container. |
| `seconds` | number | yes for timed types | Coerced to int ≥1 (rest may allow 0? — see Open Q). Capped (see §6). |
| `label` | string | no | Shown on screen as the current move. |
| `say` | string | no | Spoken at phase entry (extends `enterPhase`). Defaults to the label, else the type ("Work"/"Rest"). |
| `halfway` | boolean | no | Per-segment override for the halfway chime. Defaults to `defaults.halfChime`. (Engine still requires `dur ≥ 12` for a chime to be meaningful.) |
| `rounds` | number | for `group` | 1–N (capped). Group's inner `segments` are expanded `rounds` times. |
| `segments` | array | for `group` | Nested segments. **One level of nesting only** in v1. |

**Why this shape:** it's a superset of what the timer needs (an ordered list of `{type, dur, say}`)
and it flattens trivially into the engine's existing phase array.

---

## 4. Ingest → run mapping (the whole feature in one flow)

```
Uploaded file / pasted text
        │
        ▼
  JSON.parse (guarded)                    ── FR-2
        │
        ▼
  validate schema tag + shape             ── FR-3  (reject with a clear message)
        │
        ▼
  sanitizeRegimen(regimen)                ── FR-4  (caps, coercion — mirrors sanitize())
        │
        ▼
  buildRegimenPhases(regimen)             ── FR-5  → { phases, cum, total }
        │                                            (expands groups×rounds; prepends prep)
        ▼
  build() adopts phases/cum/WORKOUT_TOTAL ── FR-6  (same globals the ladder path sets)
        │
        ▼
  reset() → render() → Start              ── FR-7  (existing controls, unchanged)
        │
        ├─ loop() counts down each phase                    (reused)
        ├─ secondCue() fires beeps + halfway chime          (reused)
        ├─ enterPhase() speaks `say`/label at each segment  (extended)
        └─ completion screen on last phase                  (reused)
```

`buildRegimenPhases()` must produce phases whose `cum`/`total` are computed the same way
`buildPhases()` does (prep excluded from the countdown total), so the progress ring and the
"X:XX total" summary stay correct.

---

## 5. Functional requirements

- **FR-1 Upload entry point.** From the Home or Customize screen, the user can (a) pick a `.json`
  file via a file input, and/or (b) paste JSON into a textarea. Both routes converge on the same
  ingest pipeline.
- **FR-2 Safe parse.** Invalid JSON is caught; the user sees a human-readable error (e.g. "That
  file isn't valid JSON") and nothing changes.
- **FR-3 Schema validation.** Require `schema === "regimen@1"`, a non-empty `name`, and a
  non-empty `segments` array. On failure, show what's wrong (missing/unknown field) and abort.
- **FR-4 Sanitize untrusted input.** A new `sanitizeRegimen()` coerces types and enforces caps
  (§6) the way `engine.js#sanitize()` already does for configs — the uploaded file is untrusted.
- **FR-5 Compile to phases.** `buildRegimenPhases(regimen)` returns `{ phases, cum, total }` in
  the exact shape `buildPhases()` returns, expanding `group.rounds` and prepending a `prep` phase.
- **FR-6 Adopt into the runtime.** The app can switch the live `phases`/`cum`/`WORKOUT_TOTAL`
  globals to the regimen's, so the timer runs it.
- **FR-7 Reuse controls.** Start, Pause, Resume, and Reset operate on the uploaded regimen with
  no behavioral change.
- **FR-8 Halfway callout.** For each timed segment ≥12s (and unless `halfway:false`), the app
  announces the midpoint using the existing `secondCue().chime` → `say("Halfway")` path.
- **FR-9 Per-segment callout.** At each segment's start, speak its `say` (fallback: `label`, then
  the type word), reusing `say()`.
- **FR-10 On-screen segment view.** While running a regimen, the current-segment view shows the
  `label`, the countdown, and progress. (This is the one UI piece that is genuinely new — see §8.)
- **FR-11 Completion.** The existing completion screen shows total time and segment count.
- **FR-12 Round-trip / export (recommended).** The user can **download** the current regimen as a
  `.json` file, so upload/edit/re-upload is a real loop. Low cost; high usability.
- **FR-13 Backward compatibility.** Existing ladder configs, presets, and share links (`#w=`/`#c=`)
  keep working unchanged. A file without `schema:"regimen@1"` is not treated as a regimen.

---

## 6. Validation & security requirements

The uploaded JSON is **untrusted** (arbitrary file, or a shared link someone sent). Follow the
discipline already established in `engine.js#sanitize()`:

- **SR-1 Caps to protect the main thread.** Building thousands of phases would stall phase/DOM
  construction. Enforce, e.g.:
  - `MAX_SEGMENTS` total flattened phases (proposed **500**),
  - `MAX_ROUNDS` per group (proposed **50**),
  - `MAX_SECONDS` per segment (proposed **3600**),
  - nesting depth **1** (a `group` may not contain a `group`).
- **SR-2 Type coercion, never throw.** Non-object segments, missing `seconds`, string durations,
  `null` labels, etc. are coerced to safe defaults exactly like `sanitize()` coerces stations.
- **SR-3 Whitelist enumerated fields.** `type` must be one of the known set or the segment is
  dropped/coerced; `theme` must be a known `THEMES` key or ignored.
- **SR-4 No code execution.** Only `JSON.parse` — never `eval`/`Function`. No HTML injection: any
  `label`/`say`/`name` is rendered as **text**, never `innerHTML` (note existing render helpers use
  `textContent` for user strings; keep that).
- **SR-5 URL safety.** If a future segment carries a `url` (e.g. demo video), apply the existing
  `^https?://` allow-test used in `sanitize()`.
- **SR-6 Clear rejection.** Every validation failure yields a specific, non-technical message and
  leaves the current workout untouched.

---

## 7. Persistence & accounts (fits the existing store)

- **PR-1 Guest works.** Upload/run requires no sign-in; guest mode persists to `localStorage`
  through `store.js`, matching today's behavior.
- **PR-2 Signed-in sync.** For a signed-in user, an adopted regimen can be saved via the existing
  `store.js` → `firebase-backend.js` interface. **Note the existing constraint:** Firestore rejects
  nested arrays, so the backend stores config **as a JSON string** (`{ json: JSON.stringify(c) }`).
  A regimen serializes cleanly as a string, so it reuses that path directly.
- **PR-3 Presets.** A regimen may be savable as a named preset alongside ladder presets
  (`store.local.savePresets` / `cloud.savePresets`). **Open question:** unify preset storage or
  namespace regimens separately (see §10).
- **PR-4 Sharing (optional / later).** Regimens could piggyback on the share-link mechanism
  (`enc()`/`dec()` + `#w=`/`#c=`), but a large regimen base64-encoded may exceed comfortable URL
  length. Recommend **file share first**, URL sharing as a follow-up.

---

## 8. UI / UX requirements

- **UR-1 Discoverable entry.** An "Import workout" affordance (file picker + paste) in
  Settings/Customize, near presets.
- **UR-2 Preview before run.** After a valid upload, show a summary — name, number of segments,
  total time, rounds — and a confirm ("Use this workout") before it replaces the current one.
- **UR-3 Live segment view.** The running view for a regimen needs to display the **current
  segment label + countdown**. The existing live view (`renderPersonCards`/`renderBigCircuit`) is
  built around stations/people/rotation, which a generic regimen doesn't have. Options:
  - **(A)** A lightweight "regimen mode" view (label + big timer + up-next), shown when the active
    workout came from an upload. *(Recommended — cleanest separation.)*
  - **(B)** Represent each segment as a single-station "circuit" and reuse the big-circuit card.
    Less new UI but forces regimen data into a station-shaped mold.
- **UR-4 Theme.** Honor `defaults.theme` if it's a known key; otherwise keep the current theme.
- **UR-5 Errors inline.** Validation errors appear next to the import control, not as `alert()`.

---

## 9. Testing requirements

The repo already runs pure-logic tests via `node --test` (`tests/engine.test.mjs`,
`store.test.mjs`, `sharelinks.test.mjs`). New logic must be **DOM-free and unit-tested** the same way:

- **TR-1** `buildRegimenPhases()` — flattens a known regimen to the expected phase list; `total`
  excludes prep; groups expand by `rounds`; `cum` is monotonic.
- **TR-2** `sanitizeRegimen()` — caps enforced; malformed/hostile inputs coerced, never throw
  (mirror the adversarial cases already covered for `sanitize()`).
- **TR-3** Reuse check — a regimen phase of `dur ≥ 12` yields `secondCue().chime === true` at the
  midpoint (proves the halfway feature works via the existing function, no new halfway code).
- **TR-4** Round-trip — export → parse → `buildRegimenPhases()` yields an equivalent phase list.

---

## 10. Decisions (LOCKED for v1)

1. **Schema surface — `group`/`rounds` INCLUDED.** v1 supports repeatable blocks (one level of
   nesting). Drives FR-5 group expansion and SR-1 round caps.
2. **Multi-person — SINGLE SHARED TRACK.** Regimens are one sequence everyone follows; **no**
   per-person station rotation in v1. Simplifies the live view (UR-3) and drops
   people/rotation concerns from the regimen path entirely.
3. **Sharing — FILE UPLOAD/DOWNLOAD ONLY.** Import a `.json`, export the current regimen as
   `.json` (FR-12). URL share links (§7 PR-4) are explicitly deferred.

### Resolved with recommended defaults (change before building if desired)

4. **Rest = 0 allowed.** A `rest` segment may be `0s` (back-to-back moves); `work`/`prep` coerce
   to ≥1s. Negative/NaN → 0 for rest, 1 for work.
5. **Presets namespaced separately.** Regimens save under a distinct presets namespace so they
   never collide with ladder-circuit presets in `store.js`.
6. **Entry point: Customize/Settings sheet**, near the presets list (UR-1).
7. **Live view: UR-3 option (A)** — a lightweight dedicated "regimen mode" view (label + big
   timer + up-next). Cleanest given the single-track decision.

---

## 11. Non-goals (v1)

- Rewriting or replacing the ladder/circuit engine — it stays as-is.
- Real-time multi-device sync (matches the accounts spec's non-goals).
- Server-side validation — all parsing/sanitizing is client-side (no backend beyond Firebase).
- A visual regimen *builder* UI — v1 is upload/paste + export; drag-and-drop authoring is later.
- Importing third-party formats (e.g. someone else's app export). v1 defines **our** `regimen@1`.

---

## 12. Suggested implementation slices (for a later plan)

1. `engine.js`: add `sanitizeRegimen()` + `buildRegimenPhases()` + tests (pure, no UI). Nothing
   user-visible; fully testable.
2. `app.js`: wire an "adopt phases from regimen" path into `build()`/`reset()`; extend
   `enterPhase()` to speak `say`/`label`.
3. UI: import control (file + paste), validation messages, preview/confirm.
4. Live regimen view (UR-3 A).
5. Export/download (FR-12).
6. Persistence/presets + optional cloud save.
