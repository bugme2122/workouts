# Short Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode a catalog-workout URL as a short `#w=<id>` (plus a tiny delta of changed light settings) instead of the always-long `#c=<full-config>`, falling back to `#c=` only for hand-edited circuits.

**Architecture:** Pure DOM-free helpers in `engine.js` decide circuit-equality and the light-field delta; catalog-aware (still DOM-free, unit-testable) `encShare`/`decShare` in `catalog.js` build/parse the hash; `app.js` rewires its four hash touch points to use them.

**Tech Stack:** Vanilla ES modules, Node ≥18 `node --test`. No dependencies.

## Global Constraints

- **Relative asset paths only**; **ES modules**; `engine.js` stays **DOM-free**; `catalog.js` stays DOM-free (imports only from `engine.js`).
- **Dependency direction:** `catalog.js → engine.js`; `app.js → {catalog, engine}`. `engine.js` imports nothing (no cycles).
- **Light fields** (may differ without changing the circuit): `people, personNames, targetMin, theme, prep, volume, voice, ticks, haptics, keepAwake, halfChime`. `stations`/`ladder` are NOT light.
- **Backward compatible:** existing `#c=` links must still decode.
- Hash forms: `#w=<id>`, `#w=<id>~<enc(delta)>`, `#c=<enc(config)>`.

---

### Task 1: Pure encode/decode logic (engine helpers + catalog `encShare`/`decShare`) with tests (TDD)

Add DOM-free circuit/delta helpers to `engine.js` and the catalog-aware `encShare`/`decShare` to `catalog.js`, test-first in a new `tests/sharelinks.test.mjs`.

**Files:**
- Modify: `engine.js`
- Modify: `catalog.js`
- Create: `tests/sharelinks.test.mjs`

**Interfaces:**
- Produces (engine.js):
  - `LIGHT_FIELDS: string[]`
  - `sameCircuit(a, b) -> boolean`
  - `lightDelta(config, base, fields=LIGHT_FIELDS) -> object`
  - `applyLight(base, delta) -> object`
- Produces (catalog.js):
  - `encShare(config) -> string` (`"w=…"` or `"c=…"`, no leading `#`)
  - `decShare(str) -> object|null`

- [ ] **Step 1: Write the failing tests**

Create `tests/sharelinks.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { sameCircuit, lightDelta, applyLight, LIGHT_FIELDS } from "../engine.js";
import { encShare, decShare, workoutToConfig, WORKOUTS, sanitize } from "../catalog.js";

// --- engine helpers ---
const A = { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[20, 10]] };

test("sameCircuit: identical stations+ladder is true", () => {
  assert.equal(sameCircuit({ ...A }, { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[20, 10]] }), true);
});
test("sameCircuit: an edited station or ladder is false", () => {
  assert.equal(sameCircuit(A, { stations: [{ ex: "A" }, { ex: "Z" }], ladder: [[20, 10]] }), false);
  assert.equal(sameCircuit(A, { stations: [{ ex: "A" }, { ex: "B" }], ladder: [[30, 10]] }), false);
});
test("LIGHT_FIELDS excludes stations and ladder", () => {
  assert.ok(!LIGHT_FIELDS.includes("stations"));
  assert.ok(!LIGHT_FIELDS.includes("ladder"));
  assert.ok(LIGHT_FIELDS.includes("people") && LIGHT_FIELDS.includes("theme"));
});
test("lightDelta captures only changed light fields; applyLight restores them", () => {
  const base = { people: 2, theme: "Volt", targetMin: 0, personNames: [] };
  const cfg = { people: 4, theme: "Volt", targetMin: 30, personNames: ["Ana"] };
  const d = lightDelta(cfg, base, ["people", "theme", "targetMin", "personNames"]);
  assert.deepEqual(d, { people: 4, targetMin: 30, personNames: ["Ana"] }); // theme unchanged -> omitted
  const restored = applyLight(base, d);
  assert.equal(restored.people, 4);
  assert.equal(restored.targetMin, 30);
  assert.deepEqual(restored.personNames, ["Ana"]);
});
test("lightDelta of identical configs is empty", () => {
  const base = { people: 2, theme: "Volt" };
  assert.deepEqual(lightDelta({ people: 2, theme: "Volt" }, base, ["people", "theme"]), {});
});

// --- catalog encShare/decShare round-trips ---
const kb = WORKOUTS.find(w => w.id === "kb-ladder");

test("encShare: unedited catalog workout -> bare w=<id>", () => {
  const cfg = sanitize(workoutToConfig(kb));
  assert.equal(encShare(cfg), "w=kb-ladder");
});
test("encShare/decShare round-trips a light tweak via w=<id>~tail", () => {
  const cfg = sanitize(workoutToConfig(kb));
  cfg.people = 3; cfg.targetMin = 30; cfg.personNames = ["Ana", "Ben", "Cam"];
  const hash = encShare(cfg);
  assert.ok(hash.startsWith("w=kb-ladder~"), "expected short w= form, got " + hash);
  const back = decShare(hash);
  assert.equal(back.people, 3);
  assert.equal(back.targetMin, 30);
  assert.deepEqual(back.personNames, ["Ana", "Ben", "Cam"]);
  assert.deepEqual(back.stations, cfg.stations); // circuit came from the catalog baseline
});
test("encShare falls back to c= for an edited circuit and round-trips", () => {
  const cfg = sanitize(workoutToConfig(kb));
  cfg.stations[0].ex = "Custom Move";
  const hash = encShare(cfg);
  assert.ok(hash.startsWith("c="), "expected full c= form, got " + hash);
  const back = decShare(hash);
  assert.equal(back.stations[0].ex, "Custom Move");
});
test("decShare tolerates a leading # and an unknown id without throwing", () => {
  assert.deepEqual(decShare("#w=kb-ladder"), decShare("w=kb-ladder"));
  const back = decShare("w=does-not-exist");
  assert.ok(back && Array.isArray(back.stations) && back.stations.length >= 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'sameCircuit'` (and/or `encShare`).

- [ ] **Step 3: Add the pure helpers to `engine.js`**

Append to `engine.js`:

```js
// --- Short share-link helpers (pure) ---
export const LIGHT_FIELDS = [
  "people", "personNames", "targetMin", "theme", "prep", "volume",
  "voice", "ticks", "haptics", "keepAwake", "halfChime",
];

export function sameCircuit(a, b) {
  return JSON.stringify(a.stations) === JSON.stringify(b.stations)
      && JSON.stringify(a.ladder) === JSON.stringify(b.ladder);
}

export function lightDelta(config, base, fields = LIGHT_FIELDS) {
  const d = {};
  for (const f of fields) {
    if (JSON.stringify(config[f]) !== JSON.stringify(base[f])) d[f] = config[f];
  }
  return d;
}

export function applyLight(base, delta) {
  return { ...base, ...(delta || {}) };
}
```

- [ ] **Step 4: Add `encShare`/`decShare` to `catalog.js`**

At the TOP of `catalog.js`, add an import from `engine.js`:

```js
import { enc, dec, sanitize, sameCircuit, lightDelta, applyLight } from "./engine.js";
```

Re-export `sanitize` so the test (and any consumer) can pull it from catalog too — add this line near the other exports:

```js
export { sanitize };
```

At the END of `catalog.js`, append:

```js
// Build the sanitized baseline config for a catalog workout id (or null).
function baselineFor(id) {
  const w = WORKOUTS.find(x => x.id === id);
  return w ? sanitize(workoutToConfig(w)) : null;
}

// Encode a config to the shortest lossless hash body (no leading '#').
export function encShare(config) {
  const base = baselineFor(config.workoutId);
  if (base && sameCircuit(config, base)) {
    const d = lightDelta(config, base);
    const tail = Object.keys(d).length ? "~" + enc(d) : "";
    return "w=" + encodeURIComponent(config.workoutId) + tail;
  }
  return "c=" + enc(config);
}

// Decode a hash body ('w=…' or 'c=…', optional leading '#') back to a config, or null.
export function decShare(str) {
  if (!str) return null;
  const body = str.replace(/^#/, "");
  if (body.startsWith("w=")) {
    const rest = body.slice(2);
    const ti = rest.indexOf("~");
    const id = decodeURIComponent(ti >= 0 ? rest.slice(0, ti) : rest);
    const delta = ti >= 0 ? (dec(rest.slice(ti + 1)) || {}) : {};
    const base = baselineFor(id) || sanitize(JSON.parse(JSON.stringify(DEFAULT)));
    return applyLight(base, delta);
  }
  if (body.startsWith("c=")) return dec(body.slice(2));
  return null;
}
```

Note: `WORKOUTS`, `workoutToConfig`, and `DEFAULT` are already defined earlier in `catalog.js`; `sanitize`/`enc`/`dec`/`sameCircuit`/`lightDelta`/`applyLight` come from the new engine import.

- [ ] **Step 5: Run to verify pass**

Run: `node --test`
Expected: PASS — all prior tests (18) plus the new `sharelinks` tests green, output pristine.

- [ ] **Step 6: Commit**

```bash
git add engine.js catalog.js tests/sharelinks.test.mjs
git commit -m "feat: short share-link encode/decode logic (engine helpers + catalog encShare/decShare)"
```

---

### Task 2: Wire `app.js` to the short-link encoder/decoder

Route the four hash touch points through `encShare`/`decShare`.

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `encShare(config)`, `decShare(str)` (Task 1, from `catalog.js`).

- [ ] **Step 1: Import `encShare`/`decShare`**

In `app.js`, the catalog import (lines 1-3) is:
```js
import {
  THEMES, LADDERS, LENGTHS, EXERCISES, DEFAULT, WORKOUTS, howto, workoutToConfig,
} from "./catalog.js";
```
Add `encShare, decShare`:
```js
import {
  THEMES, LADDERS, LENGTHS, EXERCISES, DEFAULT, WORKOUTS, howto, workoutToConfig,
  encShare, decShare,
} from "./catalog.js";
```

- [ ] **Step 2: Decode in `loadConfig`**

Replace the current `loadConfig` (app.js:15-21):
```js
function loadConfig(){
  const h=location.hash||"";
  const i=h.indexOf("c=");
  if(i>=0){ const c=dec(h.slice(i+2)); if(c) return sanitize(migrate(c)); }
  try{ const s=localStorage.getItem("ladder.last"); if(s){ const c=JSON.parse(s); if(c) return sanitize(migrate(c)); } }catch(e){}
  return sanitize(clone(DEFAULT));
}
```
with:
```js
function loadConfig(){
  const body=(location.hash||"").replace(/^#/,"");
  if(body.startsWith("w=")||body.startsWith("c=")){ const c=decShare(body); if(c) return sanitize(migrate(c)); }
  try{ const s=localStorage.getItem("ladder.last"); if(s){ const c=JSON.parse(s); if(c) return sanitize(migrate(c)); } }catch(e){}
  return sanitize(clone(DEFAULT));
}
```

- [ ] **Step 3: Encode in `persist`**

Replace the `replaceState` line in `persist` (app.js:24):
```js
  try{ history.replaceState(null,"","#c="+enc(config)); }catch(e){}
```
with:
```js
  try{ history.replaceState(null,"","#"+encShare(config)); }catch(e){}
```

- [ ] **Step 4: Encode in the Copy-link button**

Replace the link-building line in the `copyLink` handler (app.js:336):
```js
$("copyLink").onclick=()=>{ const link=location.origin+location.pathname+"#c="+enc(sanitize(clone(draft)));
```
with:
```js
$("copyLink").onclick=()=>{ const link=location.origin+location.pathname+"#"+encShare(sanitize(clone(draft)));
```

- [ ] **Step 5: Detect a shared link at boot**

Replace the boot detection (app.js:450):
```js
const hasShared = (location.hash || "").indexOf("c=") >= 0;
```
with:
```js
const hasShared = /^#?[wc]=/.test(location.hash || "");
```

- [ ] **Step 6: Verify**

Run: `node --test`
Expected: PASS — unchanged test count from Task 1 (this task touches no tests).

Run: `node --check app.js`
Expected: no output (syntax OK).

Static self-review: `enc(`/`dec(` are still imported (used elsewhere — do not remove them); `encShare`/`decShare` are imported from `./catalog.js`; grep `app.js` for `"#c="` → zero matches (all four sites now use `encShare`/`#`); `loadConfig`, `persist`, `copyLink`, and the boot `hasShared` all route through the new functions. The controller will run a headless `decShare(encShare(config))` round-trip and a full workout-driver boot from a `#w=` hash.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: use short #w= share links in app persistence, copy-link, and boot"
```

---

## Self-Review

- **Spec coverage:** `#w=<id>` + `~delta` short form (T1 `encShare`), `#c=` fallback for edited circuits (T1 `sameCircuit` gate), light-field set (T1 `LIGHT_FIELDS`), always-reflect-in-URL (T2 `persist`), backward-compatible `#c=` decode (T1 `decShare` `c=` branch + T2 `loadConfig`), copy-link + boot detection (T2 S4/S5), unknown-id fallback (T1 `decShare` baseline fallback), DOM-free/testable catalog logic (T1 in `catalog.js` + `tests/sharelinks.test.mjs`). All covered.
- **Placeholder scan:** none — every code step carries literal code with exact line anchors.
- **Type consistency:** `encShare(config) -> string` and `decShare(str) -> object|null` are used identically in T1 (definition/tests) and T2 (wiring). `sameCircuit`/`lightDelta`/`applyLight`/`LIGHT_FIELDS` names match between engine and catalog. `#w=`/`#c=`/`~` hash grammar is consistent across `encShare`, `decShare`, `loadConfig`, and the boot regex.
