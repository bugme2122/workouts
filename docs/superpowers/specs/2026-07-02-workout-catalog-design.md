# Ladder Circuit Timer — Catalog + N-Person Redesign

**Date:** 2026-07-02
**Status:** Approved design (pre-implementation)

## Summary

Turn the single-workout Ladder Circuit Timer into a small **app with a flow**:
a Home screen that lists a catalog of ready-made workouts, a Customize screen
that sets how many people are training (1–6, each color-coded) and tunes the
workout, and a Live screen that runs it. The live view gains a landscape
"big-screen" mode that shows the whole circuit color-coded by person, with the
timer on the right. Along the way, fix a late-workout crash and make workout
completion unmistakable.

## Goals

- Home / landing page with a browsable **catalog** of workouts.
- Choose **number of people (1–6)**, generalizing the current Solo/Duo engine.
- **Customize** a chosen workout before starting (people, names, length, stations,
  ladder, theme, sound).
- **Color-code each person** across the circuit on a shared big screen.
- **Fix** the late-workout crash and the unclear completion state.

## Non-goals (YAGNI)

- No accounts, cloud sync, or backend. Persistence stays `localStorage` + share links.
- No per-person separate devices / "who am I" flow. One shared screen.
- No new build tooling (bundler, framework). Plain static files.
- No more-people-than-stations doubling-up. People are capped at station count.

## Core mechanic (confirmed)

A **block** is one full pass of the interval ladder at a single station
(e.g. Descending `60/50/40/30/20s` on with rests ≈ 5 minutes). The rules:

- **One person per station per block.** A person works one station for the whole
  block, then everyone **rotates** to the next station for the next block.
- With **P people and N stations (P ≤ N)**, P stations are occupied each block and
  the remaining `N − P` stations sit empty; people rotate through all stations
  across the workout.
- Rotation happens on the last rest of each block (existing behavior), signalled
  by the existing ROTATE flash + voice callout.

## Screens & flow

```
Home (catalog)  ──tap workout──►  Customize  ──Go──►  Live
   list of                        people + names        big-screen (wide)
   workout cards                  + tune it             or portrait (phone)
```

### Home (catalog)
- Vertical **stack of workout cards** (scrollable). No people picker here.
- Each card shows: name, category + ladder summary, duration estimate, the
  stations as a compact list/chips, and two actions: **Customize** and **Start ▸**
  (Start uses the workout's default people count and jumps straight to Live).
- A **"Build my own from scratch"** entry opens Customize on a blank/default config.

### Customize
- **Who's working out?** — a 1–6 picker; each number fills with that person's color.
  The picker is **capped at the chosen workout's station count** (numbers above
  `N` are disabled with a hint).
- **Optional name per person** — text field beside each active person's color dot.
  Blank falls back to color + `P1`/`P2`/… on the Live screen.
- **Length** chips + a live duration estimate (reuses existing `lenSummary`).
- **Stations & ladder** and **Theme & sound** — collapsed summaries that expand into
  the *existing* editor controls (station rows, ladder rows, theme swatches, sound
  toggles). No second editor is built.
- Sticky **Go ▸** launches Live.

### Live
- **Wide displays** (landscape / min-width breakpoint): the **big-screen** —
  - Left: all `N` stations as a list. Each station occupied this block is **lit in
    its current person's color** (exercise, person name/label, reps). Empty stations
    stay dark.
  - Right: the timer — phase label, countdown ring, current interval (`on/off`),
    ladder dots, total remaining, and a person→color legend.
  - On rotate, the colored rows slide down one station.
- **Phones** (narrow): keep the **existing portrait timer**, extended from 2 fixed
  cards to **P person cards** that wrap in a grid.

## Data model

### `config` (persisted)
```
{
  people:      1..6,          // NEW — replaces `mode`
  personNames: string[],      // NEW — optional, index-aligned to person 0..people-1
  workoutId:   string|null,   // NEW — which catalog item seeded this config
  prep, ladder, stations, theme, voice, ticks, haptics, keepAwake, volume, targetMin
}
```
- **Removed:** `mode`. Migration in `migrate()`: legacy `mode:"solo"` → `people:1`;
  `mode:"duo"` → `people:2`; missing → `people:2`.
- `sanitize()` clamps `people` to `1..min(6, stations.length)` and trims
  `personNames` to `people` entries.

### Catalog item (`catalog.js`, data only)
```
{
  id:           string,
  name:         string,
  category:     string,         // e.g. "Strength", "Cardio", "No gear"
  defaultPeople:number,         // starting people count on Customize
  ladder:       [[on,off],...], // or a named ladder key
  stations:     [{ex,gear,rep,url}, ...],
  prep, theme                    // optional overrides
}
```
The catalog is seeded from the workouts already present in the app (the current
default KB circuit and the existing `LADDERS`/`EXERCISES` building blocks). Content
is data and easy to extend later.

## N-person engine

- `N = stations.length`, `P = people` (guaranteed `1 ≤ P ≤ N`).
- **Placement:** person `k` (0-based) occupies station `(block + offset(k)) % N`,
  where `offset(k) = Math.round(k * N / P)`. For `P=2` this yields
  `offset(1) = round(N/2) = floor(N/2)`, matching today's duo behavior.
- **Every** station/block lookup is taken **`% N`** (this is the crash fix — see below).
- Live big-screen highlights the `P` occupied stations for the current block, each
  tinted `--p{k+1}`.

## Fixes

### F1 — Late-workout crash
Root cause: in solo mode the first-work-of-block voice line reads
`config.stations[p.block].ex` **without** wraparound. Once a workout cycles
(`TOTBLOCKS > N`, which happens with longer lengths), `p.block ≥ N` makes
`config.stations[p.block]` undefined → `.ex` throws. Fix: all block-indexed station
access uses `% N`. Covered by tests.

### F2 — Unclear completion
Replace the bare checkmark with an explicit **"WORKOUT COMPLETE"** state: summary of
total time, blocks completed, station count, and people. Distinct, celebratory,
unmistakable; keeps the done chime.

## Architecture (file split)

The app is already served as a folder (PWA manifest `start_url:"."`), so splitting
the ~620-line `index.html` costs nothing at deploy time and keeps each file focused:

- `index.html` — markup, screen containers, asset links.
- `styles.css` — all CSS incl. design tokens (from `design-tokens.css`).
- `catalog.js` — the workout catalog data + exercise/ladder building blocks.
- `app.js` — engine, screen routing, persistence, audio/voice/haptics/wake-lock.

Share links, presets, and the PWA manifest are unaffected.

### Deployment (GitHub Pages)
The app is hosted on GitHub Pages (static). Requirements baked into the split:
- **Relative asset paths only** (`./styles.css`, `./app.js`, `./catalog.js`) — Pages
  serves from a repo subpath (`https://<user>.github.io/<repo>/`), so absolute
  paths (`/styles.css`) 404. `start_url:"."` in the manifest already follows this.
- **HTTPS is automatic** on Pages, which is required for the secure-context APIs the
  app uses: `navigator.wakeLock`, `navigator.clipboard`, `speechSynthesis`.
- Share links (`#c=…` hash) and the inline data-URL manifest work unchanged.

## Testing

No test setup exists today. Add a lightweight harness (a `tests.html` that loads the
pure functions and asserts, or a small standalone Node script) covering **pure
logic** — no DOM/audio:

- `offset(k)` / placement math for P = 1..6 across various N (incl. P=2 == legacy).
- People cap/clamp in `sanitize()` (e.g. 6 people on a 4-station workout → 4).
- `build()` phase list: correct count, block/interval indices, total duration.
- **Wraparound fix:** station lookup for `block ≥ N` never goes out of range.
- `blocksFor()` / duration estimate for `targetMin` values.
- Config `enc`/`dec` round-trip and `migrate()` (legacy `mode` → `people`).

## Resolved decisions

- **Architecture split** — approved. Four files, relative paths, GitHub Pages hosting.
- **Catalog contents** — seeded from existing app workouts; exact per-workout
  exercises finalized in the implementation plan.
