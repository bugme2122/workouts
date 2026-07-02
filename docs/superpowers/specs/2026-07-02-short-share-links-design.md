# Short Share Links — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design confirmed; implementing autonomously via delegated loop)
**Branch:** `feat/short-links`

## Goal

Replace the always-long `#c=<base64-of-whole-config>` URL with a short, readable link that references the selected catalog workout by id (`#w=kb-ladder`), carrying only the settings the user changed. Hand-edited workouts (custom stations/ladder) keep the long `#c=` form, since a static page has no server to reference custom data from.

## Current state (baseline)

- `persist()` writes `history.replaceState(null,"","#c="+enc(config))` on every save (`app.js:22-25`).
- `loadConfig()` reads `#c=…`, `dec`odes, `sanitize(migrate(...))` (`app.js:15-21`).
- `copyLink` builds `location.origin+location.pathname+"#c="+enc(...)` (`app.js:336`).
- Boot detects a shared link via `location.hash.indexOf("c=")>=0` (`app.js:450-452`).
- `enc`/`dec` (engine.js) are URL-safe base64 of `JSON.stringify(config)`.
- `config.workoutId` identifies the catalog workout (set by `workoutToConfig`, `catalog.js:106`); `DEFAULT.workoutId` is `"kb-ladder"`.

## Locked-in decisions

1. **Short form carries the workout + the user's light settings.** A catalog workout with an unedited circuit encodes as `#w=<id>` plus, only if any light field differs from that workout's defaults, a compact `~<blob>` tail encoding **just the changed light fields**.
2. **The URL always reflects the current workout** during normal use (same behavior as today, but short).
3. **Hand-edited circuits stay `#c=<full-blob>`.** Editing stations or the ladder makes the circuit non-catalog, so its data must travel in the URL.
4. **Backward compatible:** existing `#c=` links still decode unchanged.

**Light fields** (safe to override without changing the circuit):
`people, personNames, targetMin, theme, prep, volume, voice, ticks, haptics, keepAwake, halfChime`. `stations` and `ladder` are **not** light — a difference in either forces the `#c=` form.

## Format

- `#w=<id>` — catalog workout, circuit unedited, all light fields at that workout's defaults.
- `#w=<id>~<blob>` — same, but `<blob>` is the URL-safe base64 (`enc`) of an object holding only the light fields that differ from the workout's defaults.
- `#c=<blob>` — full config (`enc(config)`), used when the circuit is edited or `workoutId` isn't a known catalog id.

Example: pick "Full-Body KB Ladder" → `#w=kb-ladder`; set 3 people + 30 min → `#w=kb-ladder~<~15-char blob>`; edit a station → `#c=<long blob>`.

## Architecture (pure-engine / catalog / DOM-app split)

- **`engine.js`** (pure, DOM-free, unit-tested) gains:
  - `LIGHT_FIELDS` — the exported list above.
  - `sameCircuit(a, b) -> boolean` — `JSON.stringify` equality of `stations` **and** `ladder`.
  - `lightDelta(config, base, fields=LIGHT_FIELDS) -> object` — the fields where `config` differs from `base` (compared via `JSON.stringify`).
  - `applyLight(base, delta) -> object` — `{ ...base, ...delta }`.
- **`catalog.js`** (catalog-aware, still DOM-free → unit-testable) imports `{ enc, dec, sanitize, sameCircuit, lightDelta, applyLight }` from `engine.js` and gains:
  - `encShare(config) -> "w=…" | "c=…"` — resolves the baseline `sanitize(workoutToConfig(WORKOUTS[config.workoutId]))`; if that baseline exists and `sameCircuit(config, base)`, returns `"w="+encodeURIComponent(id)` plus `"~"+enc(lightDelta(config, base))` when the delta is non-empty; otherwise `"c="+enc(config)`.
  - `decShare(str) -> config | null` — strips a leading `#`; for `w=…` splits id and optional `~tail`, rebuilds `applyLight(base, tail?dec(tail):{})` where `base` is the id's baseline (falling back to a `DEFAULT` clone for an unknown id); for `c=…` returns `dec(...)`; else `null`.
- **`app.js`** imports `{ encShare, decShare }` from `catalog.js` and rewires the four touch points to use them:
  - `persist()` → `history.replaceState(null,"","#"+encShare(config))`.
  - `loadConfig()` → if the hash body starts with `w=` or `c=`, `const c=decShare(body); if(c) return sanitize(migrate(c));`.
  - `copyLink` → `…+"#"+encShare(sanitize(clone(draft)))`.
  - Boot "has shared config?" → hash body starts with `w=` **or** `c=`.

Dependency direction stays acyclic: `catalog.js → engine.js`; `app.js → {catalog, engine}`. `engine.js` imports nothing.

## Edge cases

- **Unknown/renamed workout id** in a `#w=` link → `decShare` falls back to a `DEFAULT`-based baseline, applies the delta, and loads sanely (no throw). Then `sanitize(migrate(...))` normalizes.
- **Edited circuit** → `sameCircuit` is false → `encShare` returns `c=…` (full blob), preserving all data.
- **Legacy `#c=` links** → decode via the unchanged `c=` branch.
- **Light delta with names/unicode** → carried losslessly because the tail reuses `enc`/`dec` (base64 of JSON), same as today.
- **`url` field on stations** — `sanitize` already normalizes it; catalog picks keep the catalog url, edited exercises clear it, so `sameCircuit` reflects real edits.

## Testing

New `tests/sharelinks.test.mjs` (imports from both `../engine.js` and `../catalog.js`), run by `node --test`:
- `sameCircuit`: identical stations+ladder → true; a single edited station → false; an edited ladder → false.
- `lightDelta` / `applyLight`: `applyLight(base, lightDelta(cfg, base))` restores every light field of `cfg`; identical inputs → empty delta.
- `encShare`/`decShare` round-trips: an unedited catalog config → `"w=<id>"` (no tail) and `decShare` reconstructs its circuit + light fields; a catalog config with `people`/`targetMin`/`personNames` changed → `"w=<id>~…"` and round-trips; an edited-circuit config → `"c=…"` and round-trips; an unknown-id `"w=nope"` decodes to a sane default without throwing.

App wiring (persist/loadConfig/copyLink/boot) is verified by the controller's headless driver plus a `decShare(encShare(cfg))` round-trip check and code review (no browser available).

## Out of scope

- No server/URL-shortener backend. No change to preset storage. No change to what `enc`/`dec` do. Custom (edited-circuit) links remain long by design. No migration of already-saved `localStorage` configs (they load and re-persist in the new short form automatically on next save).
