# Custom Workouts & Progress Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **First action of Task 0:** copy this file to `docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md` and commit it, so the plan lives with the repo.

**Goal:** Consolidate onto the MERN version, give users a real in-app workout builder (plus JSON upload and share-link import) that reuses the existing audio-cue engine, and persist a custom-workout library, completed-session history, and voice-dictated strength set logs to MongoDB.

**Architecture:** Keep the buildless vanilla-JS client and the Express 5 + Mongoose 8 API already on `mern-local`. Custom workouts use the **existing `regimen@1` schema** in `engine.js` (validate/sanitize/build already written and tested) — we add a builder UI that produces that object rather than inventing a new format. Logging is **additive**: two new Mongo collections (`WorkoutSession`, `SetLog`) behind new `/api/sessions` and `/api/logs` routes. The circuit config model and share-link formats are untouched. Voice set-logging uses on-device `webkitSpeechRecognition` and a **pure, tested parser in `engine.js`** — no external speech service, no audio leaves the device.

**Tech Stack:** Vanilla ES modules (no client build, no client deps), Express 5, Mongoose 8, JWT auth, `node --test` (client), `vitest` + `supertest` + `mongodb-memory-server` (server).

**Spec:** This document. Supporting context: `PROJECT.md`, `GAPS.md`, `CLAUDE.md` (all three describe the **Firebase era** and are rewritten in Task 0).

---

## Context

The repo has two *backend* generations of one app, not two apps:

- **`master` ("old")** — Firebase: `firebase-backend.js`, `firebase-config.js`, `firestore.rules`, Google popup auth.
- **`mern-local` ("new", current HEAD `2fde3cf`)** — those three files deleted; `api.js` + `server/` (Express 5, Mongoose 8, JWT with refresh-token rotation, admin-provisioned email/password accounts), `Dockerfile`, `railway.json`, 65 client tests + 28 server tests. Its last 7 commits are an unfinished welcome/sign-in redesign.

The static client (`index.html`, `app.js`, `engine.js`, `catalog.js`, `store.js`, `auth.js`, `styles.css`) is **shared by both** — nothing needs porting.

What already works and must be reused, not rebuilt:

- **Audio cues** — `app.js:147-164` (`ensureAudio`, `tone`, `sWork/sRest/sRotate/sTick/sDone`, `say()` via `speechSynthesis`, `buzz()` via `navigator.vibrate`, wake lock) driven by the pure `secondCue(phase, secLeft)` in `engine.js:121-135`. Any workout that compiles to a phase array gets these for free.
- **Custom workout ingest (BYOW)** — `REGIMEN_SCHEMA = "regimen@1"`, `validateRegimen`, `sanitizeRegimen` (caps: 500 flattened segments, 50 rounds/group, 3600 s/segment, group nesting depth 1), `buildRegimenPhases` at `engine.js:161-274`, with `.json` import/export wired in `app.js` and 8 tests in `tests/regimen.test.mjs`. **JSON upload already exists.**
- **Circuit customization** — the settings sheet is already a full station/ladder editor with named presets.

What is missing, and is what this plan builds:

1. Custom workouts can only be authored by hand-editing JSON outside the app — there is no builder UI.
2. Regimens sync to the cloud only as a stringified blob smuggled into the presets document under the reserved `__regimens__` key (`store.js:14`) — no real library, no per-workout records.
3. There is **no record that a workout was ever performed**. Grepping `history|log|session|completed|streak` across the client and server models finds one hit, `history.replaceState`. `showComplete()` just draws a card.
4. No strength logging at all (sets/reps/weight) and no voice capture for it.
5. The docs (`CLAUDE.md`, `PROJECT.md`, `GAPS.md`, dated 2026-07-10) describe Firebase and assert a "zero npm dependencies" rule that `server/` already breaks.

Intended outcome: one trunk, a workout you can build in the app, and a database that remembers what you actually did.

## Global Constraints

- **Client stays buildless with zero npm dependencies.** No bundler, no framework, no client-side packages. Server deps live only in `server/package.json`.
- **Every circuit config from storage, a share link, the cloud, or a preset must pass `sanitize(migrate(cfg))`; every regimen must pass `validateRegimen` then `sanitizeRegimen`.** This is the XSS/crash trust boundary. Both mutate — clone first if the original is needed.
- **Share-link back-compat is a requirement.** Existing `#w=` and `#c=` URLs must keep decoding. Do not change `enc`/`dec` output or `LIGHT_FIELDS` semantics.
- **Every dynamic value interpolated into HTML goes through the local `esc()` helper, and generated attributes use double quotes** (`esc()` does not escape single quotes).
- **Do not remove the render caches** `_contentSig`, `_pcardKey`, `_bigKey` in `app.js`. If you change what a card displays, extend `_contentSig` with the new inputs.
- **Do not touch the CSP `<meta>` in `index.html`** without reading its comment block. `framebust.js` stays an external file loaded first in `<head>`; no `'unsafe-inline'` in `script-src`.
- Import direction is strictly `app.js → (engine, catalog, store, auth, api)`. `engine.js` stays DOM-free and imports nothing from the app.
- Cloud/auth failures degrade silently to local-only. **A logging or network failure must never break the timer.**
- Client tests: `npm test` (`node --test tests/*.test.mjs`) — 65 passing today. Server tests: `cd server && npx vitest run` — 28 passing today. **Both suites green before any task is claimed done.**
- New pure logic goes in `engine.js` (or is extracted there) so it can be tested. `app.js` is untested — keep new logic out of it.
- Mongo ids are `ObjectId`; every new collection is scoped by `userId` and every query filters on the JWT's user. No cross-user reads.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `server/src/models/WorkoutSession.js` | One completed timer run per document. |
| `server/src/models/SetLog.js` | One strength set-group per document (exercise, sets, reps, weight). |
| `server/src/models/Regimen.js` | A user's custom workout library (one doc per workout). |
| `server/src/controllers/log.controller.js` | List/create/delete for sessions and set logs; stats aggregate. |
| `server/src/controllers/regimen.controller.js` | CRUD for the regimen library. |
| `server/src/routes/log.routes.js` | `/api/sessions`, `/api/logs`, `/api/stats`. |
| `server/src/routes/regimen.routes.js` | `/api/regimens`. |
| `server/src/utils/regimenSchema.js` | Server-side mirror of the regimen shape gate (server must not trust the client's sanitize). |
| `server/tests/integration/logs.test.js` | Session/set-log/stat route tests incl. per-user isolation. |
| `server/tests/integration/regimens.test.js` | Regimen CRUD tests incl. per-user isolation. |
| `builder.js` | Pure-ish builder state module: draft regimen → DOM rows → `regimen@1` object. Client. |
| `tests/setparse.test.mjs` | Tests for the voice/text set parser. |
| `tests/builder.test.mjs` | Tests for the pure builder helpers exported from `engine.js`. |
| `docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md` | This plan, in-repo. |

**Modified**

| File | Change |
|---|---|
| `engine.js` | Add `parseSetPhrase()`, `blankRegimen()`, `addSegment()`/`moveSegment()`/`removeSegment()` pure helpers, `summarizeSession()`. |
| `store.js` | Add `cloudBackend()` methods for regimens/sessions/logs; retire the `__regimens__` presets smuggling after migration. |
| `app.js` | Builder screen wiring, share-link `#r=` import, session-complete write, voice set-log capture, History screen. |
| `index.html` | Builder screen markup, History screen markup, voice-log button. |
| `styles.css` | Builder + history styles. |
| `server/src/app.js` | Mount the two new routers. |
| `CLAUDE.md`, `PROJECT.md`, `GAPS.md` | Rewrite for the MERN era (Task 0). |

---

## Task 0: Consolidate onto one trunk and re-document

**Files:**
- Modify: `CLAUDE.md`, `PROJECT.md`, `GAPS.md`
- Create: `docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md`
- Delete (verify already absent): `firebase-backend.js`, `firebase-config.js`, `firestore.rules`

- [ ] **Step 1: Copy this plan into the repo**

```bash
cp "C:/Users/bugme2122/.claude/plans/goal-is-to-turn-delightful-coral.md" docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md
```

- [ ] **Step 2: Confirm both suites are green on the current HEAD before changing anything**

```bash
npm test
cd server && npx vitest run && cd ..
```
Expected: 65 client tests pass, 28 server tests pass. If not, stop and report — do not build on a red baseline.

- [ ] **Step 3: Verify no Firebase artifacts remain**

```bash
git ls-files | grep -iE "firebase|firestore"
grep -rniE "firebase|firestore" --include=*.js --include=*.html --include=*.css --include=*.json . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.data
```
Expected: no tracked files; only prose mentions in `PROJECT.md`/`GAPS.md`/`CLAUDE.md`, which Step 5 rewrites. If a live code reference appears, delete it and note it in the commit.

- [ ] **Step 4: Make `mern-local` the trunk**

```bash
git checkout master
git merge --ff-only mern-local || git merge -X theirs mern-local
git branch -m master master-firebase-archive 2>/dev/null; true
```
If `--ff-only` fails, prefer: `git checkout mern-local && git branch -f master mern-local && git checkout master`. Tag the old tip first so nothing is lost:
```bash
git tag archive/firebase-era origin/master
```

- [ ] **Step 5: Rewrite the three docs**

Concretely, in `CLAUDE.md`:
- Replace the "zero npm dependencies / no build step" hard constraint with: *"The **client** is buildless with zero npm dependencies — do not add client-side packages. The **server** (`server/`) uses Express 5 + Mongoose 8 and has its own `package.json`."*
- Replace the `firebase-config.js` trap gotcha with the MongoDB/JWT env setup: `server/.env` needs `MONGO_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `BASE_PATH`; local dev uses `mongodb-memory-server` via `server/scripts/dev-local.mjs`.
- Replace the Firebase console-setup gotcha with: *"Auth is admin-provisioned email/password (no self-registration). Seed a user via the server's admin script before testing sign-in."*
- Update the test counts to `npm test` (client) and `cd server && npx vitest run` (server), and state both must be green.
- Update the layout section: `auth.js` + `api.js` replace `auth.js` + `firebase-backend.js`; import direction is `app.js → (engine, catalog, store, auth) → api`.

In `PROJECT.md`: replace the Firestore persistence section with the `/api/state`, `/api/presets`, `/api/account` contract and the `WorkoutState` model (`{userId, configJson, presetsJson}` — still JSON strings, a shape inherited from Firestore that we keep because `config.ladder` is a nested array).

In `GAPS.md`: mark items **#2** (firebase-config trap) and **#13** (Firestore rules) as **obsolete — resolved by the MERN migration**. Keep #1, #3, #5, #6, #7, #8, #9, #10 open verbatim; they still apply. Add a note that #1 (cloud-always-wins sync destroying local presets) is addressed by Task 3 of this plan.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md PROJECT.md GAPS.md docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md
git commit -m "docs: retire the Firebase era, document the MERN trunk"
```

---

## Task 1: Regimen library collection and API

**Files:**
- Create: `server/src/models/Regimen.js`, `server/src/utils/regimenSchema.js`, `server/src/controllers/regimen.controller.js`, `server/src/routes/regimen.routes.js`, `server/tests/integration/regimens.test.js`
- Modify: `server/src/app.js:46` (mount the router)

**Interfaces:**
- Consumes: `verifyJWT` from `server/src/middleware/auth.js`, `asyncHandler` from `server/src/utils/asyncHandler.js` (both used by `state.routes.js` — copy that pattern exactly).
- Produces:
  - `GET  /api/regimens` → `{ regimens: [{ id, name, updatedAt, segmentCount, totalSeconds }] }`
  - `GET  /api/regimens/:id` → `{ regimen: <regimen@1 object> }`
  - `POST /api/regimens` body `{ regimen }` → `201 { id, regimen }`
  - `PUT  /api/regimens/:id` body `{ regimen }` → `{ id, regimen }`
  - `DELETE /api/regimens/:id` → `204`
  - `assertRegimenShape(obj) -> {ok:true}|{ok:false,error:string}` from `regimenSchema.js`

- [ ] **Step 1: Write the failing integration test**

`server/tests/integration/regimens.test.js` — follow the setup used by `server/tests/integration/state.test.js` (same in-memory Mongo harness, same login helper):

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
// Mirror the imports/harness of state.test.js exactly (app factory + memory server + loginAs helper).
import { makeApp, startMemoryMongo, stopMemoryMongo, loginAs } from '../helpers.js';

const VALID = {
  schema: 'regimen@1',
  name: 'Leg Day',
  defaults: { prep: 10, voice: true, halfChime: true, volume: 0.8 },
  segments: [
    { type: 'work', seconds: 40, label: 'Squats', say: 'Squats' },
    { type: 'rest', seconds: 20, label: 'Rest' },
    { type: 'group', rounds: 3, segments: [{ type: 'work', seconds: 30, label: 'Lunges' }] },
  ],
};

describe('/api/regimens', () => {
  let app, aliceToken, bobToken;
  beforeAll(async () => {
    await startMemoryMongo();
    app = makeApp();
    aliceToken = await loginAs(app, 'alice@example.com');
    bobToken = await loginAs(app, 'bob@example.com');
  });
  afterAll(async () => { await stopMemoryMongo(); });

  it('requires auth', async () => {
    await request(app).get('/api/regimens').expect(401);
  });

  it('creates, lists, reads, updates and deletes a regimen', async () => {
    const created = await request(app).post('/api/regimens')
      .set('Authorization', `Bearer ${aliceToken}`).send({ regimen: VALID }).expect(201);
    const { id } = created.body;
    expect(id).toBeTruthy();

    const list = await request(app).get('/api/regimens')
      .set('Authorization', `Bearer ${aliceToken}`).expect(200);
    expect(list.body.regimens).toHaveLength(1);
    expect(list.body.regimens[0].name).toBe('Leg Day');
    // 1 work + 1 rest + 3 rounds x 1 = 5 flattened segments; 40 + 20 + 3*30 = 150 s
    expect(list.body.regimens[0].segmentCount).toBe(5);
    expect(list.body.regimens[0].totalSeconds).toBe(150);

    const read = await request(app).get(`/api/regimens/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`).expect(200);
    expect(read.body.regimen.name).toBe('Leg Day');

    await request(app).put(`/api/regimens/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ regimen: { ...VALID, name: 'Leg Day v2' } }).expect(200);

    await request(app).delete(`/api/regimens/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`).expect(204);
    const after = await request(app).get('/api/regimens')
      .set('Authorization', `Bearer ${aliceToken}`).expect(200);
    expect(after.body.regimens).toHaveLength(0);
  });

  it('rejects a malformed regimen with 400', async () => {
    const res = await request(app).post('/api/regimens')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ regimen: { schema: 'nope', name: 'x', segments: [] } }).expect(400);
    expect(res.body.error).toMatch(/schema/i);
  });

  it('never leaks another user\'s regimens', async () => {
    const created = await request(app).post('/api/regimens')
      .set('Authorization', `Bearer ${aliceToken}`).send({ regimen: VALID }).expect(201);
    await request(app).get(`/api/regimens/${created.body.id}`)
      .set('Authorization', `Bearer ${bobToken}`).expect(404);
    const bobList = await request(app).get('/api/regimens')
      .set('Authorization', `Bearer ${bobToken}`).expect(200);
    expect(bobList.body.regimens).toHaveLength(0);
  });
});
```

If `server/tests/helpers.js` does not exist, extract the harness from `server/tests/integration/state.test.js` into it first (pure move, no behavior change) and run `npx vitest run` to confirm the existing 28 tests still pass before continuing.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && npx vitest run tests/integration/regimens.test.js
```
Expected: FAIL — 404s on every route (router not mounted).

- [ ] **Step 3: Write the shape gate**

`server/src/utils/regimenSchema.js` — the server must not trust that the client sanitized. Same caps as `engine.js`:

```js
export const REGIMEN_SCHEMA = 'regimen@1';
const MAX_SEGMENTS = 500;
const MAX_ROUNDS = 50;
const MAX_SECONDS = 3600;
const TYPES = ['work', 'rest', 'prep'];

// Count the flattened footprint and total seconds of a regimen, and reject anything over the caps.
export function measureRegimen(r) {
  let count = 0, seconds = 0;
  for (const s of r.segments) {
    if (s && s.type === 'group') {
      const rounds = parseInt(s.rounds) || 1;
      const inner = Array.isArray(s.segments) ? s.segments : [];
      count += rounds * inner.length;
      for (const g of inner) seconds += rounds * (parseInt(g && g.seconds) || 0);
    } else {
      count += 1;
      seconds += parseInt(s && s.seconds) || 0;
    }
  }
  return { segmentCount: count, totalSeconds: seconds };
}

// assertRegimenShape(obj) -> {ok:true, measured} | {ok:false, error}
export function assertRegimenShape(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { ok: false, error: "Not a workout object." };
  if (obj.schema !== REGIMEN_SCHEMA)
    return { ok: false, error: `Unsupported schema — expected "${REGIMEN_SCHEMA}".` };
  if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > 120)
    return { ok: false, error: "A workout needs a name of 1-120 characters." };
  if (!Array.isArray(obj.segments) || obj.segments.length === 0)
    return { ok: false, error: "A workout needs at least one segment." };
  for (const s of obj.segments) {
    if (!s || typeof s !== 'object') return { ok: false, error: "Bad segment." };
    if (s.type === 'group') {
      const rounds = parseInt(s.rounds) || 1;
      if (rounds < 1 || rounds > MAX_ROUNDS)
        return { ok: false, error: `Rounds must be 1-${MAX_ROUNDS}.` };
      if (!Array.isArray(s.segments) || !s.segments.length)
        return { ok: false, error: "A group needs at least one segment." };
      for (const g of s.segments) {
        if (!g || g.type === 'group') return { ok: false, error: "Groups cannot nest." };
        if (!TYPES.includes(g.type)) return { ok: false, error: "Bad segment type." };
        const secs = parseInt(g.seconds);
        if (!Number.isFinite(secs) || secs < 0 || secs > MAX_SECONDS)
          return { ok: false, error: `Seconds must be 0-${MAX_SECONDS}.` };
      }
    } else {
      if (!TYPES.includes(s.type)) return { ok: false, error: "Bad segment type." };
      const secs = parseInt(s.seconds);
      if (!Number.isFinite(secs) || secs < 0 || secs > MAX_SECONDS)
        return { ok: false, error: `Seconds must be 0-${MAX_SECONDS}.` };
    }
  }
  const measured = measureRegimen(obj);
  if (measured.segmentCount > MAX_SEGMENTS)
    return { ok: false, error: `Too many segments (max ${MAX_SEGMENTS}).` };
  return { ok: true, measured };
}
```

- [ ] **Step 4: Write the model**

`server/src/models/Regimen.js` — store the regimen as a JSON string, matching the `WorkoutState` precedent (Mongo handles nested arrays fine, but keeping one shape across the codebase avoids two serialization stories; the denormalized `name`/`segmentCount`/`totalSeconds` make listing cheap):

```js
import mongoose from 'mongoose';

const regimenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  json: { type: String, required: true },
  segmentCount: { type: Number, default: 0 },
  totalSeconds: { type: Number, default: 0 },
}, { timestamps: true });

regimenSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model('Regimen', regimenSchema);
```

- [ ] **Step 5: Write the controller**

`server/src/controllers/regimen.controller.js`:

```js
import Regimen from '../models/Regimen.js';
import { assertRegimenShape } from '../utils/regimenSchema.js';

const MAX_PER_USER = 200;

export async function list(req, res) {
  const docs = await Regimen.find({ userId: req.user.id })
    .sort({ updatedAt: -1 }).select('name segmentCount totalSeconds updatedAt').lean();
  res.json({ regimens: docs.map(d => ({
    id: String(d._id), name: d.name,
    segmentCount: d.segmentCount, totalSeconds: d.totalSeconds, updatedAt: d.updatedAt,
  })) });
}

export async function get(req, res) {
  const doc = await Regimen.findOne({ _id: req.params.id, userId: req.user.id }).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ id: String(doc._id), regimen: JSON.parse(doc.json) });
}

export async function create(req, res) {
  const check = assertRegimenShape(req.body && req.body.regimen);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const count = await Regimen.countDocuments({ userId: req.user.id });
  if (count >= MAX_PER_USER)
    return res.status(400).json({ error: `Workout library is full (max ${MAX_PER_USER}).` });
  const r = req.body.regimen;
  const doc = await Regimen.create({
    userId: req.user.id, name: r.name.trim(), json: JSON.stringify(r),
    segmentCount: check.measured.segmentCount, totalSeconds: check.measured.totalSeconds,
  });
  res.status(201).json({ id: String(doc._id), regimen: r });
}

export async function update(req, res) {
  const check = assertRegimenShape(req.body && req.body.regimen);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const r = req.body.regimen;
  const doc = await Regimen.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { name: r.name.trim(), json: JSON.stringify(r),
      segmentCount: check.measured.segmentCount, totalSeconds: check.measured.totalSeconds },
    { new: true },
  );
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ id: String(doc._id), regimen: r });
}

export async function remove(req, res) {
  const doc = await Regimen.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}
```

A malformed `:id` (not a valid ObjectId) makes Mongoose throw a `CastError`; confirm `server/src/middleware/errorHandler.js` maps that to a 400 or 404 rather than a 500. If it does not, add that mapping and a test for it.

- [ ] **Step 6: Write the router and mount it**

`server/src/routes/regimen.routes.js`:

```js
import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as regimen from '../controllers/regimen.controller.js';

const router = Router();
router.get('/', verifyJWT, asyncHandler(regimen.list));
router.post('/', verifyJWT, asyncHandler(regimen.create));
router.get('/:id', verifyJWT, asyncHandler(regimen.get));
router.put('/:id', verifyJWT, asyncHandler(regimen.update));
router.delete('/:id', verifyJWT, asyncHandler(regimen.remove));
export default router;
```

In `server/src/app.js`, beside the existing mounts at line 45-47:

```js
import regimenRoutes from './routes/regimen.routes.js';
// ...
router.use('/api/regimens', regimenRoutes);
```

- [ ] **Step 7: Run the tests**

```bash
cd server && npx vitest run
```
Expected: PASS — 28 existing + 4 new.

- [ ] **Step 8: Commit**

```bash
git add server/src/models/Regimen.js server/src/utils/regimenSchema.js \
        server/src/controllers/regimen.controller.js server/src/routes/regimen.routes.js \
        server/src/app.js server/tests/integration/regimens.test.js server/tests/helpers.js
git commit -m "feat(api): custom workout library collection and CRUD routes"
```

---

## Task 2: Session and set-log collections and API

**Files:**
- Create: `server/src/models/WorkoutSession.js`, `server/src/models/SetLog.js`, `server/src/controllers/log.controller.js`, `server/src/routes/log.routes.js`, `server/tests/integration/logs.test.js`
- Modify: `server/src/app.js` (mount)

**Interfaces:**
- Produces:
  - `POST /api/sessions` body `{ session: { kind, workoutId?, regimenId?, name, startedAt, durationSec, completed, phasesDone, totalPhases } }` → `201 { id }`
  - `GET  /api/sessions?limit=50&before=<ISO>` → `{ sessions: [...] }`
  - `DELETE /api/sessions/:id` → `204`
  - `POST /api/logs` body `{ log: { exercise, sets, reps, weight, unit, note, performedAt, sessionId? } }` → `201 { id, log }`
  - `GET  /api/logs?exercise=&limit=` → `{ logs: [...] }`
  - `DELETE /api/logs/:id` → `204`
  - `GET  /api/stats` → `{ totalSessions, totalSeconds, currentStreakDays, last7Days:[{date,count,seconds}], topExercises:[{exercise,sets,maxWeight}] }`

- [ ] **Step 1: Write the failing integration test**

`server/tests/integration/logs.test.js`, same harness as Task 1:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeApp, startMemoryMongo, stopMemoryMongo, loginAs } from '../helpers.js';

describe('/api/sessions, /api/logs, /api/stats', () => {
  let app, alice, bob;
  beforeAll(async () => {
    await startMemoryMongo();
    app = makeApp();
    alice = await loginAs(app, 'alice@example.com');
    bob = await loginAs(app, 'bob@example.com');
  });
  afterAll(async () => { await stopMemoryMongo(); });

  it('requires auth on every route', async () => {
    await request(app).get('/api/sessions').expect(401);
    await request(app).get('/api/logs').expect(401);
    await request(app).get('/api/stats').expect(401);
  });

  it('records a completed session and lists it newest-first', async () => {
    const mk = (name, secs, iso) => request(app).post('/api/sessions')
      .set('Authorization', `Bearer ${alice}`)
      .send({ session: { kind: 'circuit', name, startedAt: iso, durationSec: secs,
                         completed: true, phasesDone: 10, totalPhases: 10 } });
    await mk('Kettlebell Ladder', 600, '2026-08-27T10:00:00.000Z').expect(201);
    await mk('Tabata', 240, '2026-08-28T10:00:00.000Z').expect(201);

    const res = await request(app).get('/api/sessions')
      .set('Authorization', `Bearer ${alice}`).expect(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].name).toBe('Tabata'); // newest first
    expect(res.body.sessions[0].durationSec).toBe(240);
  });

  it('rejects a session with a negative or absurd duration', async () => {
    await request(app).post('/api/sessions').set('Authorization', `Bearer ${alice}`)
      .send({ session: { kind: 'circuit', name: 'x', durationSec: -5 } }).expect(400);
    await request(app).post('/api/sessions').set('Authorization', `Bearer ${alice}`)
      .send({ session: { kind: 'circuit', name: 'x', durationSec: 999999 } }).expect(400);
  });

  it('records a set log and filters by exercise', async () => {
    await request(app).post('/api/logs').set('Authorization', `Bearer ${alice}`)
      .send({ log: { exercise: 'Squats', sets: 3, reps: 5, weight: 200, unit: 'lb' } })
      .expect(201);
    await request(app).post('/api/logs').set('Authorization', `Bearer ${alice}`)
      .send({ log: { exercise: 'Bench Press', sets: 3, reps: 8, weight: 135, unit: 'lb' } })
      .expect(201);

    const all = await request(app).get('/api/logs')
      .set('Authorization', `Bearer ${alice}`).expect(200);
    expect(all.body.logs).toHaveLength(2);

    const squats = await request(app).get('/api/logs?exercise=squats')
      .set('Authorization', `Bearer ${alice}`).expect(200);
    expect(squats.body.logs).toHaveLength(1);
    expect(squats.body.logs[0].weight).toBe(200);
  });

  it('rejects a log with no exercise name', async () => {
    await request(app).post('/api/logs').set('Authorization', `Bearer ${alice}`)
      .send({ log: { exercise: '   ', sets: 3, reps: 5 } }).expect(400);
  });

  it('returns stats for the calling user only', async () => {
    const res = await request(app).get('/api/stats')
      .set('Authorization', `Bearer ${alice}`).expect(200);
    expect(res.body.totalSessions).toBe(2);
    expect(res.body.totalSeconds).toBe(840);
    expect(res.body.topExercises.map(e => e.exercise)).toContain('Squats');

    const bobStats = await request(app).get('/api/stats')
      .set('Authorization', `Bearer ${bob}`).expect(200);
    expect(bobStats.body.totalSessions).toBe(0);
    expect(bobStats.body.topExercises).toHaveLength(0);
  });

  it('never deletes another user\'s data', async () => {
    const mine = await request(app).get('/api/sessions')
      .set('Authorization', `Bearer ${alice}`).expect(200);
    await request(app).delete(`/api/sessions/${mine.body.sessions[0].id}`)
      .set('Authorization', `Bearer ${bob}`).expect(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && npx vitest run tests/integration/logs.test.js
```
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the models**

`server/src/models/WorkoutSession.js`:

```js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['circuit', 'regimen'], required: true },
  workoutId: { type: String, default: null },   // catalog id, e.g. "kb-ladder"
  regimenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Regimen', default: null },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  startedAt: { type: Date, required: true },
  durationSec: { type: Number, required: true, min: 0, max: 86400 },
  completed: { type: Boolean, default: false },
  phasesDone: { type: Number, default: 0, min: 0 },
  totalPhases: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

sessionSchema.index({ userId: 1, startedAt: -1 });

export default mongoose.model('WorkoutSession', sessionSchema);
```

`server/src/models/SetLog.js`:

```js
import mongoose from 'mongoose';

const setLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutSession', default: null },
  exercise: { type: String, required: true, trim: true, maxlength: 80 },
  // Lowercased copy for case-insensitive filtering and grouping without a regex scan.
  exerciseKey: { type: String, required: true, index: true },
  sets: { type: Number, default: 1, min: 0, max: 100 },
  reps: { type: Number, default: 0, min: 0, max: 1000 },
  weight: { type: Number, default: 0, min: 0, max: 10000 },
  unit: { type: String, enum: ['lb', 'kg', 'bw'], default: 'lb' },
  note: { type: String, default: '', maxlength: 500 },
  source: { type: String, enum: ['voice', 'manual'], default: 'manual' },
  performedAt: { type: Date, required: true },
}, { timestamps: true });

setLogSchema.index({ userId: 1, performedAt: -1 });

export default mongoose.model('SetLog', setLogSchema);
```

- [ ] **Step 4: Write the controller**

`server/src/controllers/log.controller.js`. Validation is explicit and rejects with 400 rather than letting Mongoose throw, so error messages are usable in the UI:

```js
import WorkoutSession from '../models/WorkoutSession.js';
import SetLog from '../models/SetLog.js';

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const clampLimit = (v) => Math.max(1, Math.min(200, parseInt(v) || 50));

const sessionOut = (d) => ({
  id: String(d._id), kind: d.kind, name: d.name, workoutId: d.workoutId,
  regimenId: d.regimenId ? String(d.regimenId) : null,
  startedAt: d.startedAt, durationSec: d.durationSec, completed: d.completed,
  phasesDone: d.phasesDone, totalPhases: d.totalPhases,
});

const logOut = (d) => ({
  id: String(d._id), exercise: d.exercise, sets: d.sets, reps: d.reps,
  weight: d.weight, unit: d.unit, note: d.note, source: d.source,
  performedAt: d.performedAt, sessionId: d.sessionId ? String(d.sessionId) : null,
});

export async function createSession(req, res) {
  const s = (req.body && req.body.session) || {};
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'A session needs a name.' });
  if (!['circuit', 'regimen'].includes(s.kind))
    return res.status(400).json({ error: 'kind must be "circuit" or "regimen".' });
  const durationSec = num(s.durationSec, -1);
  if (durationSec < 0 || durationSec > 86400)
    return res.status(400).json({ error: 'durationSec must be 0-86400.' });
  const startedAt = s.startedAt ? new Date(s.startedAt) : new Date();
  if (isNaN(startedAt.getTime()))
    return res.status(400).json({ error: 'startedAt must be a valid date.' });

  const doc = await WorkoutSession.create({
    userId: req.user.id, kind: s.kind, name: name.slice(0, 120),
    workoutId: typeof s.workoutId === 'string' ? s.workoutId.slice(0, 64) : null,
    regimenId: s.regimenId || null,
    startedAt, durationSec, completed: !!s.completed,
    phasesDone: Math.max(0, num(s.phasesDone)), totalPhases: Math.max(0, num(s.totalPhases)),
  });
  res.status(201).json({ id: String(doc._id) });
}

export async function listSessions(req, res) {
  const q = { userId: req.user.id };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!isNaN(before.getTime())) q.startedAt = { $lt: before };
  }
  const docs = await WorkoutSession.find(q)
    .sort({ startedAt: -1 }).limit(clampLimit(req.query.limit)).lean();
  res.json({ sessions: docs.map(sessionOut) });
}

export async function removeSession(req, res) {
  const doc = await WorkoutSession.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  await SetLog.deleteMany({ userId: req.user.id, sessionId: doc._id });
  res.status(204).end();
}

export async function createLog(req, res) {
  const l = (req.body && req.body.log) || {};
  const exercise = typeof l.exercise === 'string' ? l.exercise.trim() : '';
  if (!exercise) return res.status(400).json({ error: 'A log needs an exercise name.' });
  const sets = num(l.sets, 1), reps = num(l.reps, 0), weight = num(l.weight, 0);
  if (sets < 0 || sets > 100) return res.status(400).json({ error: 'sets must be 0-100.' });
  if (reps < 0 || reps > 1000) return res.status(400).json({ error: 'reps must be 0-1000.' });
  if (weight < 0 || weight > 10000)
    return res.status(400).json({ error: 'weight must be 0-10000.' });
  const performedAt = l.performedAt ? new Date(l.performedAt) : new Date();
  if (isNaN(performedAt.getTime()))
    return res.status(400).json({ error: 'performedAt must be a valid date.' });

  const doc = await SetLog.create({
    userId: req.user.id, sessionId: l.sessionId || null,
    exercise: exercise.slice(0, 80), exerciseKey: exercise.toLowerCase().slice(0, 80),
    sets, reps, weight,
    unit: ['lb', 'kg', 'bw'].includes(l.unit) ? l.unit : 'lb',
    note: typeof l.note === 'string' ? l.note.slice(0, 500) : '',
    source: l.source === 'voice' ? 'voice' : 'manual',
    performedAt,
  });
  res.status(201).json({ id: String(doc._id), log: logOut(doc) });
}

export async function listLogs(req, res) {
  const q = { userId: req.user.id };
  if (typeof req.query.exercise === 'string' && req.query.exercise.trim())
    q.exerciseKey = req.query.exercise.trim().toLowerCase();
  const docs = await SetLog.find(q)
    .sort({ performedAt: -1 }).limit(clampLimit(req.query.limit)).lean();
  res.json({ logs: docs.map(logOut) });
}

export async function removeLog(req, res) {
  const doc = await SetLog.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}

// Streak = consecutive days ending today or yesterday that have at least one session.
function streakFromDays(daySet, today) {
  const key = (d) => d.toISOString().slice(0, 10);
  const cur = new Date(today);
  if (!daySet.has(key(cur))) {
    cur.setUTCDate(cur.getUTCDate() - 1);
    if (!daySet.has(key(cur))) return 0;
  }
  let n = 0;
  while (daySet.has(key(cur))) { n++; cur.setUTCDate(cur.getUTCDate() - 1); }
  return n;
}

export async function stats(req, res) {
  const userId = req.user.id;
  const sessions = await WorkoutSession.find({ userId })
    .select('startedAt durationSec').sort({ startedAt: -1 }).limit(2000).lean();

  const totalSessions = sessions.length;
  const totalSeconds = sessions.reduce((a, s) => a + (s.durationSec || 0), 0);
  const days = new Set(sessions.map(s => s.startedAt.toISOString().slice(0, 10)));
  const currentStreakDays = streakFromDays(days, new Date());

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const on = sessions.filter(s => s.startedAt.toISOString().slice(0, 10) === date);
    last7Days.push({ date, count: on.length,
                     seconds: on.reduce((a, s) => a + (s.durationSec || 0), 0) });
  }

  const topExercises = await SetLog.aggregate([
    { $match: { userId: new SetLog.base.Types.ObjectId(String(userId)) } },
    { $group: { _id: '$exerciseKey', exercise: { $first: '$exercise' },
                sets: { $sum: '$sets' }, maxWeight: { $max: '$weight' } } },
    { $sort: { sets: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, exercise: 1, sets: 1, maxWeight: 1 } },
  ]);

  res.json({ totalSessions, totalSeconds, currentStreakDays, last7Days, topExercises });
}
```

- [ ] **Step 5: Write the router and mount it**

`server/src/routes/log.routes.js`:

```js
import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as log from '../controllers/log.controller.js';

const router = Router();
router.post('/sessions', verifyJWT, asyncHandler(log.createSession));
router.get('/sessions', verifyJWT, asyncHandler(log.listSessions));
router.delete('/sessions/:id', verifyJWT, asyncHandler(log.removeSession));
router.post('/logs', verifyJWT, asyncHandler(log.createLog));
router.get('/logs', verifyJWT, asyncHandler(log.listLogs));
router.delete('/logs/:id', verifyJWT, asyncHandler(log.removeLog));
router.get('/stats', verifyJWT, asyncHandler(log.stats));
export default router;
```

In `server/src/app.js`, alongside the other mounts (this one mounts at `/api` like `stateRoutes`, with `verifyJWT` per-route so it never intercepts `/api/health`):

```js
import logRoutes from './routes/log.routes.js';
// ...
router.use('/api', logRoutes);
```

Also extend `deleteAccount` in `server/src/controllers/state.controller.js` to delete this user's `Regimen`, `WorkoutSession` and `SetLog` documents — account deletion must not orphan data. Add an assertion for that to `server/tests/integration/state.test.js`.

- [ ] **Step 6: Run the tests**

```bash
cd server && npx vitest run
```
Expected: PASS — all suites, including the 6 new log tests and the extended account-deletion test.

- [ ] **Step 7: Commit**

```bash
git add server/src/models/WorkoutSession.js server/src/models/SetLog.js \
        server/src/controllers/log.controller.js server/src/controllers/state.controller.js \
        server/src/routes/log.routes.js server/src/app.js \
        server/tests/integration/logs.test.js server/tests/integration/state.test.js
git commit -m "feat(api): workout session and set-log collections with stats"
```

---

## Task 3: Client API surface for regimens, sessions and logs

**Files:**
- Modify: `store.js` (extend `cloudBackend()`)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Consumes: `api.get/put/post/del` from `api.js`; the routes from Tasks 1 and 2.
- Produces, on the object returned by `cloudBackend()`:
  - `listRegimens() -> Promise<[{id,name,segmentCount,totalSeconds,updatedAt}]>`
  - `getRegimen(id) -> Promise<regimen>`
  - `saveRegimen(regimen, id?) -> Promise<{id, regimen}>`
  - `deleteRegimen(id) -> Promise<void>`
  - `logSession(session) -> Promise<{id}>`
  - `listSessions(opts?) -> Promise<[session]>`
  - `logSet(log) -> Promise<{id, log}>`
  - `listLogs(opts?) -> Promise<[log]>`
  - `getStats() -> Promise<stats>`

- [ ] **Step 1: Write the failing test**

Append to `tests/store.test.mjs` (this suite already stubs `localStorage`; stub `api` the same way the existing cloud tests do — if none exist, inject a fake via a module-level setter you add in Step 3):

```js
test("cloudBackend maps regimen and log calls onto the API", async () => {
  const calls = [];
  const fake = {
    get: async (p) => { calls.push(["GET", p]); 
      if (p === "/regimens") return { regimens: [{ id: "a", name: "Leg Day" }] };
      if (p === "/sessions") return { sessions: [{ id: "s1" }] };
      if (p === "/stats") return { totalSessions: 3 };
      return {}; },
    post: async (p, b) => { calls.push(["POST", p, b]); return { id: "new" }; },
    put: async (p, b) => { calls.push(["PUT", p, b]); return { id: "a" }; },
    del: async (p) => { calls.push(["DELETE", p]); },
  };
  const cloud = cloudBackend(fake);

  assert.deepEqual(await cloud.listRegimens(), [{ id: "a", name: "Leg Day" }]);
  await cloud.saveRegimen({ schema: "regimen@1", name: "X" });
  await cloud.saveRegimen({ schema: "regimen@1", name: "X" }, "a");
  await cloud.deleteRegimen("a");
  await cloud.logSession({ kind: "circuit", name: "Tabata", durationSec: 240 });
  await cloud.logSet({ exercise: "Squats", sets: 3, reps: 5, weight: 200 });
  assert.deepEqual(await cloud.getStats(), { totalSessions: 3 });

  assert.deepEqual(calls.map(c => `${c[0]} ${c[1]}`), [
    "GET /regimens",
    "POST /regimens",
    "PUT /regimens/a",
    "DELETE /regimens/a",
    "POST /sessions",
    "POST /logs",
    "GET /stats",
  ]);
});

test("cloudBackend defaults to the real api module when none is injected", () => {
  const cloud = cloudBackend();
  assert.equal(typeof cloud.listRegimens, "function");
  assert.equal(typeof cloud.logSession, "function");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `cloud.listRegimens is not a function`.

- [ ] **Step 3: Extend `cloudBackend`**

In `store.js`, change the signature to accept an injectable client (defaulting to the real one, which keeps every existing caller working) and add the methods:

```js
export function cloudBackend(client = api) {
  return {
    async loadConfig() { const { config } = await client.get("/state"); return config ?? null; },
    async saveConfig(c) { await client.put("/state", { config: c }); },
    async loadPresets() { const { presets } = await client.get("/presets"); return presets || {}; },
    async savePresets(o) { await client.put("/presets", { presets: o }); },
    async deleteAll() { await client.del("/account"); },

    // Custom workout library (regimen@1).
    async listRegimens() { const { regimens } = await client.get("/regimens"); return regimens || []; },
    async getRegimen(id) { const { regimen } = await client.get(`/regimens/${id}`); return regimen; },
    async saveRegimen(regimen, id) {
      return id ? client.put(`/regimens/${id}`, { regimen })
                : client.post("/regimens", { regimen });
    },
    async deleteRegimen(id) { await client.del(`/regimens/${id}`); },

    // Progress.
    async logSession(session) { return client.post("/sessions", { session }); },
    async listSessions({ limit = 50, before } = {}) {
      const q = new URLSearchParams({ limit: String(limit) });
      if (before) q.set("before", before);
      const { sessions } = await client.get(`/sessions?${q}`);
      return sessions || [];
    },
    async logSet(log) { return client.post("/logs", { log }); },
    async listLogs({ limit = 50, exercise } = {}) {
      const q = new URLSearchParams({ limit: String(limit) });
      if (exercise) q.set("exercise", exercise);
      const { logs } = await client.get(`/logs?${q}`);
      return logs || [];
    },
    async getStats() { return client.get("/stats"); },
  };
}
```

Confirm `api.js` exports `post`; if it only has `get/put/del`, add `post` following the identical pattern and add a test for it in `tests/api.test.mjs`.

- [ ] **Step 4: Run the tests**

```bash
npm test
```
Expected: PASS — 65 existing + 2 new.

- [ ] **Step 5: Commit**

```bash
git add store.js api.js tests/store.test.mjs tests/api.test.mjs
git commit -m "feat(client): cloud backend methods for regimens, sessions and logs"
```

---

## Task 4: Pure builder helpers in the engine

**Files:**
- Modify: `engine.js` (append to the BYOW section after `buildRegimenPhases`, line ~274)
- Test: `tests/builder.test.mjs`

**Interfaces:**
- Consumes: `REGIMEN_SCHEMA`, `sanitizeRegimen`, `buildRegimenPhases` (same file).
- Produces:
  - `blankRegimen(name?) -> regimen` — a valid one-segment starting point.
  - `addSegment(regimen, segment, atIndex?) -> regimen` (new object, never mutates)
  - `updateSegment(regimen, index, patch) -> regimen`
  - `removeSegment(regimen, index) -> regimen`
  - `moveSegment(regimen, from, to) -> regimen`
  - `regimenSummary(regimen) -> {segmentCount, totalSeconds, workSeconds, restSeconds}`
  - `circuitToRegimen(config, workoutName) -> regimen` — seed the builder from an existing circuit.

- [ ] **Step 1: Write the failing test**

`tests/builder.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  blankRegimen, addSegment, updateSegment, removeSegment, moveSegment,
  regimenSummary, circuitToRegimen, sanitizeRegimen, REGIMEN_SCHEMA,
} from "../engine.js";

test("blankRegimen produces a valid, sanitizable starting point", () => {
  const r = blankRegimen("My Workout");
  assert.equal(r.schema, REGIMEN_SCHEMA);
  assert.equal(r.name, "My Workout");
  assert.equal(r.segments.length, 1);
  assert.deepEqual(sanitizeRegimen(r).segments, r.segments);
});

test("blankRegimen falls back to a default name", () => {
  assert.equal(blankRegimen().name, "New Workout");
  assert.equal(blankRegimen("   ").name, "New Workout");
});

test("addSegment appends and never mutates the input", () => {
  const a = blankRegimen();
  const b = addSegment(a, { type: "rest", seconds: 20 });
  assert.equal(a.segments.length, 1);
  assert.equal(b.segments.length, 2);
  assert.equal(b.segments[1].type, "rest");
});

test("addSegment inserts at an index", () => {
  const a = addSegment(blankRegimen(), { type: "rest", seconds: 20 });
  const b = addSegment(a, { type: "prep", seconds: 5 }, 0);
  assert.equal(b.segments[0].type, "prep");
  assert.equal(b.segments.length, 3);
});

test("updateSegment patches one segment only", () => {
  const a = addSegment(blankRegimen(), { type: "rest", seconds: 20 });
  const b = updateSegment(a, 1, { seconds: 45, label: "Breather" });
  assert.equal(b.segments[1].seconds, 45);
  assert.equal(b.segments[1].label, "Breather");
  assert.equal(b.segments[0].seconds, a.segments[0].seconds);
  assert.equal(a.segments[1].seconds, 20); // input untouched
});

test("removeSegment keeps at least one segment", () => {
  const a = blankRegimen();
  assert.equal(removeSegment(a, 0).segments.length, 1);
  const b = addSegment(a, { type: "rest", seconds: 20 });
  assert.equal(removeSegment(b, 0).segments.length, 1);
  assert.equal(removeSegment(b, 0).segments[0].type, "rest");
});

test("moveSegment reorders and clamps out-of-range indices", () => {
  let r = blankRegimen();
  r = updateSegment(r, 0, { label: "A" });
  r = addSegment(r, { type: "work", seconds: 30, label: "B" });
  r = addSegment(r, { type: "work", seconds: 30, label: "C" });
  assert.deepEqual(moveSegment(r, 2, 0).segments.map(s => s.label), ["C", "A", "B"]);
  assert.deepEqual(moveSegment(r, 0, 99).segments.map(s => s.label), ["B", "C", "A"]);
  assert.deepEqual(moveSegment(r, 5, 0).segments.map(s => s.label), ["A", "B", "C"]);
});

test("regimenSummary counts flattened segments and seconds including groups", () => {
  const r = {
    schema: REGIMEN_SCHEMA, name: "T", defaults: { prep: 10 },
    segments: [
      { type: "work", seconds: 40 },
      { type: "rest", seconds: 20 },
      { type: "group", rounds: 3, segments: [
        { type: "work", seconds: 30 }, { type: "rest", seconds: 10 },
      ] },
    ],
  };
  assert.deepEqual(regimenSummary(r), {
    segmentCount: 8,      // 1 + 1 + 3*2
    totalSeconds: 180,    // 40 + 20 + 3*(30+10)
    workSeconds: 130,     // 40 + 3*30
    restSeconds: 50,      // 20 + 3*10
  });
});

test("circuitToRegimen turns a circuit config into an equivalent regimen", () => {
  const cfg = {
    prep: 10, theme: "Volt", voice: true, halfChime: true, volume: 0.8,
    ladder: [[40, 20], [30, 15]],
    stations: [{ ex: "Swings" }, { ex: "Push-ups" }],
  };
  const r = circuitToRegimen(cfg, "KB Ladder");
  assert.equal(r.schema, REGIMEN_SCHEMA);
  assert.equal(r.name, "KB Ladder");
  assert.equal(r.defaults.prep, 10);
  assert.equal(r.defaults.theme, "Volt");
  // 2 intervals x (work + rest) = 4 segments, first work labelled from the first station
  assert.equal(r.segments.length, 4);
  assert.equal(r.segments[0].type, "work");
  assert.equal(r.segments[0].seconds, 40);
  assert.equal(r.segments[0].label, "Swings");
  assert.equal(r.segments[1].type, "rest");
  assert.equal(r.segments[1].seconds, 20);
  assert.equal(r.segments[2].seconds, 30);
  assert.equal(r.segments[2].label, "Push-ups");
  assert.deepEqual(sanitizeRegimen(r).segments.length, 4);
});

test("circuitToRegimen drops zero-second rests", () => {
  const r = circuitToRegimen(
    { ladder: [[40, 0]], stations: [{ ex: "Plank" }] }, "No Rest");
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].type, "work");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `blankRegimen is not exported`.

- [ ] **Step 3: Implement the helpers**

Append to the BYOW section of `engine.js`:

```js
// ---- Builder helpers (pure; every function returns a NEW regimen and never mutates its input) ----

const cloneRegimen = (r) => JSON.parse(JSON.stringify(r));

export function blankRegimen(name) {
  const n = (typeof name === "string" && name.trim()) ? name.trim() : "New Workout";
  return {
    schema: REGIMEN_SCHEMA,
    name: n,
    defaults: { prep: 10, voice: true, halfChime: true, volume: DEFAULTS.volume },
    segments: [{ type: "work", seconds: 40, label: "Exercise", say: "Exercise" }],
  };
}

export function addSegment(regimen, segment, atIndex) {
  const out = cloneRegimen(regimen);
  const i = Number.isInteger(atIndex)
    ? Math.max(0, Math.min(out.segments.length, atIndex))
    : out.segments.length;
  out.segments.splice(i, 0, JSON.parse(JSON.stringify(segment)));
  return out;
}

export function updateSegment(regimen, index, patch) {
  const out = cloneRegimen(regimen);
  if (index < 0 || index >= out.segments.length) return out;
  out.segments[index] = { ...out.segments[index], ...patch };
  return out;
}

// Never leaves a regimen with zero segments — an empty one is invalid.
export function removeSegment(regimen, index) {
  const out = cloneRegimen(regimen);
  if (out.segments.length <= 1) return out;
  if (index < 0 || index >= out.segments.length) return out;
  out.segments.splice(index, 1);
  return out;
}

export function moveSegment(regimen, from, to) {
  const out = cloneRegimen(regimen);
  const n = out.segments.length;
  if (from < 0 || from >= n) return out;
  const dest = Math.max(0, Math.min(n - 1, to));
  const [seg] = out.segments.splice(from, 1);
  out.segments.splice(dest, 0, seg);
  return out;
}

// Flattened footprint and time split. Prep is excluded (it matches buildRegimenPhases' `cum`).
export function regimenSummary(regimen) {
  let segmentCount = 0, workSeconds = 0, restSeconds = 0;
  const tally = (s, mult) => {
    const secs = (parseInt(s && s.seconds) || 0) * mult;
    segmentCount += mult;
    if (s && s.type === "rest") restSeconds += secs; else workSeconds += secs;
  };
  for (const s of (regimen && Array.isArray(regimen.segments) ? regimen.segments : [])) {
    if (s && s.type === "group") {
      const rounds = Math.max(1, parseInt(s.rounds) || 1);
      for (const g of (Array.isArray(s.segments) ? s.segments : [])) tally(g, rounds);
    } else {
      tally(s, 1);
    }
  }
  return { segmentCount, totalSeconds: workSeconds + restSeconds, workSeconds, restSeconds };
}

// Seed the builder from an existing circuit config: each ladder interval becomes a work segment
// (labelled from the station at that position) plus a rest segment when off > 0.
export function circuitToRegimen(config, workoutName) {
  const c = config || {};
  const ladder = Array.isArray(c.ladder) && c.ladder.length ? c.ladder : DEFAULTS.ladder;
  const stations = Array.isArray(c.stations) ? c.stations : [];
  const out = blankRegimen(workoutName);
  out.defaults = {
    prep: Math.max(0, Math.min(60, parseInt(c.prep) || 0)),
    voice: c.voice !== false,
    halfChime: c.halfChime !== false,
    volume: Number.isFinite(Number(c.volume)) ? Number(c.volume) : DEFAULTS.volume,
  };
  if (typeof c.theme === "string") out.defaults.theme = c.theme;
  const segments = [];
  ladder.forEach(([on, off], i) => {
    const st = stations[i % (stations.length || 1)];
    const label = (st && typeof st.ex === "string" && st.ex.trim()) ? st.ex.trim() : "Exercise";
    segments.push({ type: "work", seconds: Math.max(1, parseInt(on) || 1), label, say: label });
    const rest = Math.max(0, parseInt(off) || 0);
    if (rest > 0) segments.push({ type: "rest", seconds: rest, label: "Rest" });
  });
  out.segments = segments.length ? segments : out.segments;
  return out;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```
Expected: PASS — all client tests including the 9 new ones.

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/builder.test.mjs
git commit -m "feat(engine): pure builder helpers for regimen authoring"
```

---

## Task 5: The workout builder screen

**Files:**
- Create: `builder.js`
- Modify: `index.html` (new `#screen-builder` section), `app.js` (screen wiring), `styles.css`
- Test: manual (see Verification) — `builder.js` holds only DOM glue; all logic under test lives in `engine.js` from Task 4.

**Interfaces:**
- Consumes: `blankRegimen`, `addSegment`, `updateSegment`, `removeSegment`, `moveSegment`, `regimenSummary`, `circuitToRegimen`, `sanitizeRegimen`, `validateRegimen` from `engine.js`; `THEMES` from `catalog.js`; the local `esc()` helper pattern from `app.js`.
- Produces (exported from `builder.js`):
  - `openBuilder({ regimen, id, onSave, onRun, onCancel })` — render the screen with a draft.
  - `getDraft() -> regimen` — the current draft.

- [ ] **Step 1: Add the builder markup to `index.html`**

Place a new section beside the existing screens (match the class/aria conventions the sibling `#screen-customize` section uses):

```html
<section id="screen-builder" class="screen" hidden aria-labelledby="builderTitle">
  <header class="scr-head">
    <button id="builderBack" class="btn ghost" type="button">Back</button>
    <h2 id="builderTitle">Build a workout</h2>
  </header>

  <label class="fld">
    <span>Name</span>
    <input id="builderName" type="text" maxlength="120" placeholder="Leg Day">
  </label>

  <label class="fld">
    <span>Get-ready seconds</span>
    <input id="builderPrep" type="number" min="0" max="60" step="1" value="10">
  </label>

  <div class="fld-row">
    <label class="sw"><input id="builderVoice" type="checkbox" checked> Spoken cues</label>
    <label class="sw"><input id="builderChime" type="checkbox" checked> Halfway chime</label>
  </div>

  <h3>Segments</h3>
  <div id="builderRows" class="builder-rows"></div>
  <div class="fld-row">
    <button id="addWork" class="btn" type="button">+ Work</button>
    <button id="addRest" class="btn" type="button">+ Rest</button>
    <button id="addGroup" class="btn" type="button">+ Repeat block</button>
  </div>

  <p id="builderSummary" class="builder-summary" aria-live="polite"></p>
  <p id="builderError" class="builder-error" role="alert" hidden></p>

  <div class="fld-row">
    <button id="builderSave" class="btn primary" type="button">Save to my workouts</button>
    <button id="builderRun" class="btn" type="button">Save &amp; start</button>
    <button id="builderExport" class="btn ghost" type="button">Export .json</button>
    <button id="builderShare" class="btn ghost" type="button">Copy share link</button>
  </div>
</section>
```

- [ ] **Step 2: Write `builder.js`**

The draft is a module-global regimen; every edit replaces it with the result of a pure helper and re-renders. Rows are string-built HTML through `esc()` with **double-quoted attributes**, matching the `stRow`/`ladRow` pattern in `app.js`:

```js
// builder.js — DOM glue for the workout builder screen. All state transitions delegate to the pure
// helpers in engine.js so the logic stays testable; this file only renders and wires events.
import {
  blankRegimen, addSegment, updateSegment, removeSegment, moveSegment,
  regimenSummary, sanitizeRegimen,
} from "./engine.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let draft = blankRegimen();
let editingId = null;
let hooks = {};

export function getDraft() { return draft; }

export function openBuilder({ regimen, id, onSave, onRun, onCancel } = {}) {
  draft = regimen ? sanitizeRegimen(regimen) : blankRegimen();
  editingId = id || null;
  hooks = { onSave, onRun, onCancel };
  $("builderName").value = draft.name;
  $("builderPrep").value = draft.defaults?.prep ?? 10;
  $("builderVoice").checked = draft.defaults?.voice !== false;
  $("builderChime").checked = draft.defaults?.halfChime !== false;
  render();
}

// One leaf row. `path` is "i" for a top-level segment or "i.j" for one inside a group.
function leafRow(s, path, label) {
  const isRest = s.type === "rest";
  return `<div class="brow" data-path="${esc(path)}">
    <span class="brow-kind ${isRest ? "rest" : "work"}">${esc(isRest ? "Rest" : "Work")}</span>
    <input class="brow-label" type="text" maxlength="80" placeholder="${esc(isRest ? "Rest" : "Exercise")}" value="${esc(s.label || "")}" aria-label="${esc(label)} name">
    <input class="brow-secs" type="number" min="0" max="3600" step="1" value="${esc(s.seconds)}" aria-label="${esc(label)} seconds">
    <button class="brow-up btn icon" type="button" aria-label="Move up">↑</button>
    <button class="brow-down btn icon" type="button" aria-label="Move down">↓</button>
    <button class="brow-del btn icon" type="button" aria-label="Delete">✕</button>
  </div>`;
}

function groupRow(s, i) {
  const inner = s.segments.map((g, j) => leafRow(g, `${i}.${j}`, `Segment ${i + 1}.${j + 1}`)).join("");
  return `<div class="bgroup" data-path="${esc(i)}">
    <div class="bgroup-head">
      <span>Repeat</span>
      <input class="bgroup-rounds" type="number" min="1" max="50" step="1" value="${esc(s.rounds)}" aria-label="Rounds">
      <span>times</span>
      <button class="bgroup-add btn icon" type="button" aria-label="Add segment to block">+</button>
      <button class="brow-up btn icon" type="button" aria-label="Move up">↑</button>
      <button class="brow-down btn icon" type="button" aria-label="Move down">↓</button>
      <button class="brow-del btn icon" type="button" aria-label="Delete block">✕</button>
    </div>
    ${inner}
  </div>`;
}

function render() {
  $("builderRows").innerHTML = draft.segments
    .map((s, i) => (s.type === "group" ? groupRow(s, i) : leafRow(s, String(i), `Segment ${i + 1}`)))
    .join("");
  const sum = regimenSummary(draft);
  const mins = Math.floor(sum.totalSeconds / 60), secs = sum.totalSeconds % 60;
  $("builderSummary").textContent =
    `${sum.segmentCount} segment${sum.segmentCount === 1 ? "" : "s"} · ` +
    `${mins}:${String(secs).padStart(2, "0")} total · ` +
    `${Math.round(sum.workSeconds / 60)} min work, ${Math.round(sum.restSeconds / 60)} min rest`;
}

function readHeader() {
  const name = $("builderName").value.trim();
  draft = { ...draft, name: name || "New Workout", defaults: {
    ...draft.defaults,
    prep: Math.max(0, Math.min(60, parseInt($("builderPrep").value) || 0)),
    voice: $("builderVoice").checked,
    halfChime: $("builderChime").checked,
  } };
}

// One delegated listener per event type — rows are rebuilt on every render, so per-row handlers
// would leak.
function wire() {
  const rows = $("builderRows");

  rows.addEventListener("input", (e) => {
    const el = e.target;
    const groupEl = el.closest(".bgroup");
    const rowEl = el.closest(".brow");
    if (el.classList.contains("bgroup-rounds") && groupEl) {
      const i = parseInt(groupEl.dataset.path);
      draft = updateSegment(draft, i,
        { rounds: Math.max(1, Math.min(50, parseInt(el.value) || 1)) });
      render();
      return;
    }
    if (!rowEl) return;
    const patch = el.classList.contains("brow-secs")
      ? { seconds: Math.max(0, Math.min(3600, parseInt(el.value) || 0)) }
      : { label: el.value.slice(0, 80), say: el.value.slice(0, 80) };
    const [i, j] = rowEl.dataset.path.split(".").map(Number);
    if (Number.isInteger(j)) {
      const g = draft.segments[i];
      const segs = g.segments.map((s, k) => (k === j ? { ...s, ...patch } : s));
      draft = updateSegment(draft, i, { segments: segs });
    } else {
      draft = updateSegment(draft, i, patch);
    }
    // Update the summary without re-rendering — that would blur the input mid-typing.
    const sum = regimenSummary(draft);
    const mins = Math.floor(sum.totalSeconds / 60), secs2 = sum.totalSeconds % 60;
    $("builderSummary").textContent =
      `${sum.segmentCount} segments · ${mins}:${String(secs2).padStart(2, "0")} total`;
  });

  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const host = btn.closest(".brow") || btn.closest(".bgroup");
    if (!host) return;
    const [i, j] = String(host.dataset.path).split(".").map(Number);
    const inGroup = Number.isInteger(j);

    if (btn.classList.contains("bgroup-add")) {
      const g = draft.segments[i];
      draft = updateSegment(draft, i,
        { segments: [...g.segments, { type: "work", seconds: 30, label: "Exercise" }] });
    } else if (btn.classList.contains("brow-del")) {
      if (inGroup) {
        const g = draft.segments[i];
        const segs = g.segments.filter((_, k) => k !== j);
        draft = segs.length ? updateSegment(draft, i, { segments: segs })
                            : removeSegment(draft, i);
      } else {
        draft = removeSegment(draft, i);
      }
    } else if (btn.classList.contains("brow-up") || btn.classList.contains("brow-down")) {
      const delta = btn.classList.contains("brow-up") ? -1 : 1;
      if (inGroup) {
        const g = draft.segments[i];
        const segs = [...g.segments];
        const to = Math.max(0, Math.min(segs.length - 1, j + delta));
        const [s] = segs.splice(j, 1); segs.splice(to, 0, s);
        draft = updateSegment(draft, i, { segments: segs });
      } else {
        draft = moveSegment(draft, i, i + delta);
      }
    } else {
      return;
    }
    render();
  });

  $("addWork").onclick = () => {
    draft = addSegment(draft, { type: "work", seconds: 40, label: "Exercise" }); render(); };
  $("addRest").onclick = () => {
    draft = addSegment(draft, { type: "rest", seconds: 20, label: "Rest" }); render(); };
  $("addGroup").onclick = () => {
    draft = addSegment(draft, { type: "group", rounds: 3,
      segments: [{ type: "work", seconds: 30, label: "Exercise" },
                 { type: "rest", seconds: 15, label: "Rest" }] });
    render();
  };

  const finish = (run) => () => {
    readHeader();
    const clean = sanitizeRegimen(draft);
    const err = $("builderError");
    err.hidden = true;
    const fn = run ? hooks.onRun : hooks.onSave;
    if (fn) fn(clean, editingId, (message) => { err.textContent = message; err.hidden = false; });
  };
  $("builderSave").onclick = finish(false);
  $("builderRun").onclick = finish(true);
  $("builderBack").onclick = () => { if (hooks.onCancel) hooks.onCancel(); };
}

wire();
```

- [ ] **Step 3: Wire the screen into `app.js`**

- Import `openBuilder` from `./builder.js` and `circuitToRegimen` from `./engine.js`.
- Add "Build a workout" to the home/welcome screen next to the existing `$("buildOwn")` control, and a "New workout" entry point from the settings sheet's regimen panel.
- Change `$("buildOwn")` so it opens the builder rather than the circuit customize screen. Keep the existing sign-in gate at `app.js:762` — a guest can build and run, but saving requires sign-in; on save while signed out, show the sign-in prompt and keep the draft.
- On each catalog card's "Customize", add a secondary "Convert to custom" action that calls `openBuilder({ regimen: circuitToRegimen(sanitize(workoutToConfig(w)), w.name) })`.
- Implement the hooks:

```js
const onSave = async (regimen, id, showError) => {
  try {
    // Local first so a network failure never loses work.
    const presets = store.local.loadRegimenPresets();
    presets[regimen.name] = regimen;
    store.local.saveRegimenPresets(presets);
    if (cloud) {
      const { id: newId } = await cloud.saveRegimen(regimen, id);
      builderCloudId = newId || id;
    }
    showScreen("home");
  } catch (e) {
    // Cloud failures degrade to local-only, per the project rule — but say so.
    showError("Saved on this device; couldn't reach the server.");
  }
};
const onRun = async (regimen, id, showError) => {
  await onSave(regimen, id, showError);
  adoptRegimen(regimen);   // existing app.js:130 — sets activeKind="regimen" and rebuilds
  startLive();
};
```

`adoptRegimen` already routes the regimen through `sanitizeRegimen`, `buildRegimenPhases`, and the shared `loop()`/`secondCue()` path — **so every workout built here gets the existing beeps, spoken cues, countdown and halfway chime with no extra work.** Verify this in Step 5 rather than assuming it.

- Add `#screen-builder` to whatever screen-show/hide helper `app.js` uses so `Back` returns home correctly, and confirm the CSS `hidden` attribute is respected.

- [ ] **Step 4: Add styles to `styles.css`**

Add `.builder-rows`, `.brow` (grid: kind badge / label input / seconds input / three icon buttons), `.bgroup` (indented, left accent border), `.bgroup-head`, `.builder-summary`, `.builder-error`. Reuse the existing token variables and the `.st-row`/`.lad-row` sizing so the builder looks native to the settings sheet.

- [ ] **Step 5: Verify manually**

```bash
npm start   # then open http://localhost:8000
```
Confirm, with the console open: build a 3-segment workout → summary updates live → reorder and delete rows → "Save & start" runs it → **you hear "Get ready", the work beep at each transition, the spoken segment label, the last-3-second countdown and the halfway chime** → completing it reaches the done card. Then reload and confirm the workout is still in the library.

- [ ] **Step 6: Run both suites and commit**

```bash
npm test && cd server && npx vitest run && cd ..
git add builder.js index.html app.js styles.css
git commit -m "feat(ui): in-app workout builder producing regimen@1"
```

---

## Task 6: Regimen share links (`#r=`)

**Files:**
- Modify: `catalog.js` (add `encRegimenShare`/`decRegimenShare` beside the existing `encShare`/`decShare`), `app.js` (hash routing), `builder.js` (`#builderShare` handler)
- Test: `tests/sharelinks.test.mjs`

**Interfaces:**
- Produces: `encRegimenShare(regimen) -> "r=<base64url>"`, `decRegimenShare(hash) -> regimen | null`

**Critical constraint:** this adds a **new** `r=` key. It must not alter `encShare`/`decShare`, `LIGHT_FIELDS`, or the handling of existing `#w=`/`#c=` links.

- [ ] **Step 1: Write the failing test**

Append to `tests/sharelinks.test.mjs`:

```js
test("regimen share links round-trip", () => {
  const r = { schema: "regimen@1", name: "Leg Day", defaults: { prep: 10 },
              segments: [{ type: "work", seconds: 40, label: "Squats" },
                         { type: "rest", seconds: 20 }] };
  const hash = encRegimenShare(r);
  assert.ok(hash.startsWith("r="));
  const back = decRegimenShare(hash);
  assert.equal(back.name, "Leg Day");
  assert.equal(back.segments.length, 2);
  assert.equal(decRegimenShare("#" + hash).name, "Leg Day");
});

test("decRegimenShare returns null for junk and for non-regimen hashes", () => {
  assert.equal(decRegimenShare("r=%%%not-base64%%%"), null);
  assert.equal(decRegimenShare("r=" + btoa("{not json")), null);
  assert.equal(decRegimenShare("w=kb-ladder"), null);
  assert.equal(decRegimenShare(""), null);
});

test("existing w= and c= links are unaffected by the r= addition", () => {
  // Same assertions the pre-existing round-trip tests make — re-run them here as a regression gate.
  const cfgHash = encShare(SOME_CONFIG);   // reuse the fixture the file already defines
  assert.ok(decShare(cfgHash));
  assert.equal(decRegimenShare(cfgHash), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `encRegimenShare is not exported`.

- [ ] **Step 3: Implement the codec**

In `catalog.js`, beside the existing share helpers, reusing the same base64 helpers `encShare`/`decShare` already use (do not introduce a second encoding path):

```js
// Regimen share links use their own `r=` key so an uploaded workout can never be mistaken for a
// circuit config. `w=` and `c=` are untouched.
export function encRegimenShare(regimen) {
  return "r=" + b64encode(JSON.stringify(regimen));
}

export function decRegimenShare(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!h.startsWith("r=")) return null;
  try {
    const obj = JSON.parse(b64decode(h.slice(2)));
    return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : null;
  } catch (e) { return null; }
}
```

`b64encode`/`b64decode` are whatever the file already uses for `c=` — reuse those exact functions so URL-safety and unicode handling stay identical.

- [ ] **Step 4: Route the hash in `app.js`**

In the boot hash handler (near `app.js:771`, where `history.replaceState` clears the hash), **before** the existing `w=`/`c=` branches and without changing them:

```js
const shared = decRegimenShare(location.hash);
if (shared) {
  const v = validateRegimen(shared);
  if (v.ok) {
    // Preview, don't auto-run — an arbitrary link must not hijack the app.
    openBuilder({ regimen: sanitizeRegimen(v.regimen), onSave, onRun, onCancel });
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  toast(v.error);
}
```

Wire `#builderShare` in `builder.js` to `navigator.clipboard.writeText(location.origin + location.pathname + "#" + encRegimenShare(sanitizeRegimen(draft)))` with a confirmation toast, and a fallback that shows the URL in a selectable input when the clipboard API is unavailable.

- [ ] **Step 5: Run the tests**

```bash
npm test
```
Expected: PASS — including the pre-existing `#w=`/`#c=` round-trip tests, which must be untouched.

- [ ] **Step 6: Commit**

```bash
git add catalog.js app.js builder.js tests/sharelinks.test.mjs
git commit -m "feat(share): r= share links for custom workouts"
```

---

## Task 7: Record completed sessions

**Files:**
- Modify: `app.js` (`showComplete` and the run lifecycle), `engine.js` (`summarizeSession`)
- Test: `tests/engine.test.mjs`

**Interfaces:**
- Produces: `summarizeSession({kind, name, workoutId, regimenId, startedAt, endedAt, phasesDone, totalPhases}) -> session` — the exact body `POST /api/sessions` expects.

- [ ] **Step 1: Write the failing test**

Append to `tests/engine.test.mjs`:

```js
test("summarizeSession builds the API session body", () => {
  const s = summarizeSession({
    kind: "circuit", name: "Kettlebell Ladder", workoutId: "kb-ladder",
    startedAt: new Date("2026-08-29T10:00:00Z"),
    endedAt: new Date("2026-08-29T10:10:00Z"),
    phasesDone: 20, totalPhases: 20,
  });
  assert.equal(s.kind, "circuit");
  assert.equal(s.name, "Kettlebell Ladder");
  assert.equal(s.workoutId, "kb-ladder");
  assert.equal(s.durationSec, 600);
  assert.equal(s.completed, true);
  assert.equal(s.startedAt, "2026-08-29T10:00:00.000Z");
});

test("summarizeSession marks a partial run incomplete and floors duration at 0", () => {
  const s = summarizeSession({
    kind: "regimen", name: "Leg Day", regimenId: "abc",
    startedAt: new Date("2026-08-29T10:00:00Z"),
    endedAt: new Date("2026-08-29T10:00:00Z"),
    phasesDone: 4, totalPhases: 12,
  });
  assert.equal(s.completed, false);
  assert.equal(s.durationSec, 0);
  assert.equal(s.regimenId, "abc");
  assert.equal(s.workoutId, null);
});

test("summarizeSession clamps a clock that ran backwards", () => {
  const s = summarizeSession({
    kind: "circuit", name: "x",
    startedAt: new Date("2026-08-29T10:10:00Z"),
    endedAt: new Date("2026-08-29T10:00:00Z"),
    phasesDone: 1, totalPhases: 1,
  });
  assert.equal(s.durationSec, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `summarizeSession is not exported`.

- [ ] **Step 3: Implement it in `engine.js`**

```js
// summarizeSession(run) -> the body POST /api/sessions expects. Pure; no clock reads of its own so
// it stays testable.
export function summarizeSession(run) {
  const r = run || {};
  const started = r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt);
  const ended = r.endedAt instanceof Date ? r.endedAt : new Date(r.endedAt);
  const ms = ended.getTime() - started.getTime();
  const durationSec = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  const phasesDone = Math.max(0, parseInt(r.phasesDone) || 0);
  const totalPhases = Math.max(0, parseInt(r.totalPhases) || 0);
  return {
    kind: r.kind === "regimen" ? "regimen" : "circuit",
    name: (typeof r.name === "string" && r.name.trim()) ? r.name.trim() : "Workout",
    workoutId: typeof r.workoutId === "string" ? r.workoutId : null,
    regimenId: typeof r.regimenId === "string" ? r.regimenId : null,
    startedAt: started.toISOString(),
    durationSec,
    completed: totalPhases > 0 && phasesDone >= totalPhases,
    phasesDone,
    totalPhases,
  };
}
```

- [ ] **Step 4: Wire it into the run lifecycle in `app.js`**

- Record `runStartedAt = new Date()` when `startLive()` enters the live screen (not on pause/resume).
- In `showComplete()`, and also on an explicit "End workout" exit, build and post the session:

```js
async function recordSession(phasesDone, totalPhases) {
  if (!cloud) return;                       // guests keep working, they just aren't recorded
  const body = summarizeSession({
    kind: activeKind === "regimen" ? "regimen" : "circuit",
    name: activeKind === "regimen" ? (activeRegimen && activeRegimen.name) : currentWorkoutName(),
    workoutId: activeKind === "regimen" ? null : config.workoutId,
    regimenId: activeKind === "regimen" ? builderCloudId : null,
    startedAt: runStartedAt, endedAt: new Date(), phasesDone, totalPhases,
  });
  try { lastSessionId = (await cloud.logSession(body)).id; }
  catch (e) { /* per the project rule: never let a network failure break the timer */ }
}
```

Call it with `phases.length` for a completed run and the current phase index for an early exit. Guard against double-posting if `showComplete()` can be re-entered — track a `sessionPosted` flag reset by `startLive()`.

- Show the result on the done card: "Logged — 10:00, 20 of 20 intervals" when it succeeded, or a quiet "Not signed in — this run wasn't saved" when `cloud` is null.

- [ ] **Step 5: Run the tests and verify manually**

```bash
npm test
npm start   # sign in, run a short workout to completion, then check GET /api/sessions
```

- [ ] **Step 6: Commit**

```bash
git add engine.js app.js tests/engine.test.mjs
git commit -m "feat: record completed workout sessions to the API"
```

---

## Task 8: Voice and text set logging

**Files:**
- Modify: `engine.js` (`parseSetPhrase`), `app.js` (mic button + confirm card), `index.html`, `styles.css`
- Test: `tests/setparse.test.mjs`

**Interfaces:**
- Produces: `parseSetPhrase(text) -> {ok:true, log:{exercise,sets,reps,weight,unit,note}} | {ok:false, error}`

Speech capture uses `webkitSpeechRecognition` (Chrome/Edge). Where it is unavailable, the same parser runs on typed text — **the text input is the primary path, the mic is an accelerator**, so the feature works in every browser.

- [ ] **Step 1: Write the failing test**

`tests/setparse.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseSetPhrase } from "../engine.js";

const ok = (text) => { const r = parseSetPhrase(text); assert.ok(r.ok, r.error); return r.log; };

test("parses the canonical phrasing", () => {
  const l = ok("squats three sets of five at two hundred pounds");
  assert.equal(l.exercise, "squats");
  assert.equal(l.sets, 3);
  assert.equal(l.reps, 5);
  assert.equal(l.weight, 200);
  assert.equal(l.unit, "lb");
});

test("parses digits as well as words", () => {
  const l = ok("bench press 3 sets of 8 at 135 lbs");
  assert.equal(l.exercise, "bench press");
  assert.equal(l.sets, 3);
  assert.equal(l.reps, 8);
  assert.equal(l.weight, 135);
});

test("parses the 3x5 shorthand", () => {
  const l = ok("deadlift 3x5 315");
  assert.equal(l.exercise, "deadlift");
  assert.equal(l.sets, 3);
  assert.equal(l.reps, 5);
  assert.equal(l.weight, 315);
});

test("recognises kilograms", () => {
  assert.equal(ok("squats 5x5 at 100 kg").unit, "kg");
  assert.equal(ok("squats 5x5 at 100 kilos").unit, "kg");
});

test("treats bodyweight as unit bw with weight 0", () => {
  const l = ok("push ups 3 sets of 20 bodyweight");
  assert.equal(l.exercise, "push ups");
  assert.equal(l.weight, 0);
  assert.equal(l.unit, "bw");
});

test("defaults sets to 1 when only reps are given", () => {
  const l = ok("pull ups 12 reps");
  assert.equal(l.sets, 1);
  assert.equal(l.reps, 12);
});

test("strips a leading filler phrase", () => {
  const l = ok("I just did squats 3 sets of 5 at 225 pounds");
  assert.equal(l.exercise, "squats");
  assert.equal(l.sets, 3);
});

test("rejects input with no recognisable exercise", () => {
  assert.equal(parseSetPhrase("3 sets of 5 at 200 pounds").ok, false);
  assert.equal(parseSetPhrase("").ok, false);
  assert.equal(parseSetPhrase("   ").ok, false);
});

test("rejects absurd numbers rather than storing them", () => {
  assert.equal(parseSetPhrase("squats 900 sets of 5").ok, false);
  assert.equal(parseSetPhrase("squats 3x5 at 99999 pounds").ok, false);
});

test("keeps the raw phrase as the note for later correction", () => {
  const l = ok("squats 3x5 315");
  assert.equal(l.note, "squats 3x5 315");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `parseSetPhrase is not exported`.

- [ ] **Step 3: Implement the parser in `engine.js`**

```js
// ---- Voice/text set logging (pure) ----
// Turns "squats three sets of five at 200 pounds" into a SetLog body. Deliberately conservative:
// anything it can't read confidently is rejected so the UI can ask rather than store a guess.

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const FILLERS = /^(i\s+)?(just\s+)?(did|finished|completed|logged|log|record)\s+/i;

// "two hundred" -> 200, "three" -> 3, "225" -> 225. Returns null when nothing numeric is present.
function wordsToNumber(text) {
  const t = String(text).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(/[\s-]+/).filter(w => w in WORD_NUMBERS);
  if (!parts.length) return null;
  let total = 0, current = 0;
  for (const w of parts) {
    const n = WORD_NUMBERS[w];
    if (n === 100) current = (current || 1) * 100;
    else current += n;
  }
  total += current;
  return total;
}

// Replace spelled-out numbers with digits so one set of regexes handles both forms.
function digitize(text) {
  return text.replace(
    /\b((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](?:hundred|one|two|three|four|five|six|seven|eight|nine))*)\b/gi,
    (m) => { const n = wordsToNumber(m); return n == null ? m : String(n); },
  );
}

export function parseSetPhrase(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "Nothing to log — try \"squats 3 sets of 5 at 200 pounds\"." };

  let s = digitize(raw.replace(FILLERS, "")).toLowerCase().replace(/\s+/g, " ").trim();

  let sets = null, reps = null, weight = null, unit = "lb";

  // Bodyweight marker.
  if (/\b(body\s?weight|bw|no weight|unweighted)\b/.test(s)) { unit = "bw"; weight = 0; }
  s = s.replace(/\b(body\s?weight|bw|no weight|unweighted)\b/g, " ");

  // Weight + unit: "at 200 pounds", "200 lbs", "100 kg".
  const wm = s.match(/(?:at\s+|@\s*)?(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kilos?|kilograms?|kgs?)\b/);
  if (wm) {
    weight = parseFloat(wm[1]);
    unit = /^k/.test(wm[2]) ? "kg" : "lb";
    s = s.replace(wm[0], " ");
  }

  // "3x5" / "3 x 5" shorthand.
  const xm = s.match(/(\d+)\s*[x×]\s*(\d+)/);
  if (xm) { sets = parseInt(xm[1]); reps = parseInt(xm[2]); s = s.replace(xm[0], " "); }

  // "3 sets" / "3 sets of 5" / "5 reps".
  if (sets == null) {
    const sm = s.match(/(\d+)\s*(?:sets?)\b(?:\s*(?:of|x)\s*(\d+))?/);
    if (sm) { sets = parseInt(sm[1]); if (sm[2]) reps = parseInt(sm[2]); s = s.replace(sm[0], " "); }
  }
  if (reps == null) {
    const rm = s.match(/(\d+)\s*(?:reps?|repetitions?)\b/);
    if (rm) { reps = parseInt(rm[1]); s = s.replace(rm[0], " "); }
  }

  // A bare trailing number after sets/reps is the weight ("deadlift 3x5 315").
  if (weight == null) {
    const bm = s.match(/\b(\d+(?:\.\d+)?)\b/);
    if (bm && (sets != null || reps != null)) { weight = parseFloat(bm[1]); s = s.replace(bm[0], " "); }
  }

  // Whatever prose is left is the exercise name.
  const exercise = s.replace(/\b(of|at|for|and|the|a|an|sets?|reps?|@)\b/g, " ")
                    .replace(/[^a-z0-9\s'-]/g, " ")
                    .replace(/\s+/g, " ").trim();

  if (!exercise || /^\d+$/.test(exercise))
    return { ok: false, error: "I didn't catch the exercise name. Try \"squats 3 sets of 5 at 200 pounds\"." };

  sets = sets == null ? 1 : sets;
  reps = reps == null ? 0 : reps;
  weight = weight == null ? 0 : weight;

  if (sets < 1 || sets > 100) return { ok: false, error: "Sets must be between 1 and 100." };
  if (reps < 0 || reps > 1000) return { ok: false, error: "Reps must be between 0 and 1000." };
  if (weight < 0 || weight > 10000) return { ok: false, error: "That weight looks wrong." };

  return { ok: true, log: { exercise, sets, reps, weight, unit, note: raw } };
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```
Expected: PASS — all 10 new parser tests.

- [ ] **Step 5: Add the capture UI**

`index.html` — a log panel reachable from the done card and from the History screen:

```html
<div id="logPanel" class="log-panel" hidden>
  <h3>Log a set</h3>
  <div class="fld-row">
    <input id="logPhrase" type="text" placeholder='squats 3 sets of 5 at 200 pounds' autocomplete="off">
    <button id="logMic" class="btn icon" type="button" aria-label="Dictate" hidden>🎤</button>
  </div>
  <p id="logHeard" class="log-heard" aria-live="polite"></p>
  <div id="logConfirm" class="log-confirm" hidden></div>
  <p id="logError" class="log-error" role="alert" hidden></p>
  <button id="logSave" class="btn primary" type="button">Save set</button>
</div>
```

`app.js`:

```js
// Show the mic only where the API actually exists — the text field is the universal path.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) $("logMic").hidden = false;

let recog = null;
$("logMic").onclick = () => {
  if (!SR) return;
  if (recog) { recog.stop(); recog = null; return; }
  recog = new SR();
  recog.lang = "en-US";
  recog.interimResults = true;
  recog.continuous = false;
  $("logMic").classList.add("listening");
  recog.onresult = (e) => {
    const text = Array.from(e.results).map(r => r[0].transcript).join(" ");
    $("logPhrase").value = text;
    $("logHeard").textContent = `Heard: "${text}"`;
    if (e.results[e.results.length - 1].isFinal) previewLog(text);
  };
  recog.onerror = (e) => {
    $("logMic").classList.remove("listening");
    showLogError(e.error === "not-allowed"
      ? "Microphone permission denied — type it instead."
      : "Couldn't hear that — type it instead.");
    recog = null;
  };
  recog.onend = () => { $("logMic").classList.remove("listening"); recog = null; };
  recog.start();
};

// Always confirm before writing — a misheard phrase must never land in the database silently.
function previewLog(text) {
  const r = parseSetPhrase(text);
  if (!r.ok) return showLogError(r.error);
  pendingLog = r.log;
  $("logError").hidden = true;
  const w = r.log.unit === "bw" ? "bodyweight" : `${r.log.weight} ${r.log.unit}`;
  $("logConfirm").innerHTML =
    `<strong>${esc(r.log.exercise)}</strong> — ${esc(r.log.sets)} × ${esc(r.log.reps)} @ ${esc(w)}`;
  $("logConfirm").hidden = false;
  say(`${r.log.exercise}, ${r.log.sets} sets of ${r.log.reps}. Save it?`);  // reuse existing TTS
}

$("logPhrase").addEventListener("change", (e) => previewLog(e.target.value));

$("logSave").onclick = async () => {
  if (!pendingLog) return showLogError("Nothing to save yet.");
  if (!cloud) return showLogError("Sign in to save your log.");
  try {
    await cloud.logSet({ ...pendingLog, source: recogUsed ? "voice" : "manual",
                         sessionId: lastSessionId || null,
                         performedAt: new Date().toISOString() });
    pendingLog = null;
    $("logConfirm").hidden = true;
    $("logPhrase").value = "";
    $("logHeard").textContent = "Saved.";
    sDone();                     // reuse the existing completion chime as save feedback
    refreshHistory();
  } catch (e) { showLogError("Couldn't save — check your connection."); }
};
```

`esc()` every interpolated value, double-quoted attributes. `say()` and `sDone()` are the existing helpers at `app.js:147-164` — reuse them, do not write new audio code.

- [ ] **Step 6: Style and verify manually**

Add `.log-panel`, `.log-confirm`, `.log-heard`, `.log-error`, and a `.listening` pulse on the mic button to `styles.css`. Then:

```bash
npm start
```
In Chrome, sign in, open the log panel, click the mic, say "squats three sets of five at two hundred pounds", confirm the preview reads **squats — 3 × 5 @ 200 lb**, save, and confirm it appears in `GET /api/logs`. Then in Firefox confirm the mic button is hidden and typing the same phrase works identically.

- [ ] **Step 7: Commit**

```bash
git add engine.js app.js index.html styles.css tests/setparse.test.mjs
git commit -m "feat: voice and text set logging with a confirm step"
```

---

## Task 9: History screen

**Files:**
- Modify: `app.js`, `index.html`, `styles.css`

**Interfaces:**
- Consumes: `cloud.listSessions()`, `cloud.listLogs()`, `cloud.getStats()` from Task 3.

- [ ] **Step 1: Add the markup**

```html
<section id="screen-history" class="screen" hidden aria-labelledby="historyTitle">
  <header class="scr-head">
    <button id="historyBack" class="btn ghost" type="button">Back</button>
    <h2 id="historyTitle">History</h2>
  </header>
  <div id="statTiles" class="stat-tiles"></div>
  <h3>Recent workouts</h3>
  <ul id="sessionList" class="hist-list"></ul>
  <h3>Recent sets</h3>
  <ul id="logList" class="hist-list"></ul>
  <p id="historyEmpty" class="hist-empty" hidden>
    No workouts recorded yet. Finish a workout and it will appear here.
  </p>
</section>
```

- [ ] **Step 2: Render it in `app.js`**

```js
async function refreshHistory() {
  if (!cloud) { $("historyEmpty").hidden = false; $("historyEmpty").textContent =
    "Sign in to keep a history of your workouts."; return; }
  try {
    const [stats, sessions, logs] = await Promise.all([
      cloud.getStats(), cloud.listSessions({ limit: 30 }), cloud.listLogs({ limit: 30 }),
    ]);
    const mins = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("statTiles").innerHTML = [
      ["Workouts", stats.totalSessions],
      ["Total time", mins(stats.totalSeconds)],
      ["Day streak", stats.currentStreakDays],
    ].map(([k, v]) =>
      `<div class="tile"><span class="tile-v">${esc(v)}</span><span class="tile-k">${esc(k)}</span></div>`
    ).join("");

    $("sessionList").innerHTML = sessions.map(s =>
      `<li class="hist-row"><span class="hist-name">${esc(s.name)}</span>` +
      `<span class="hist-meta">${esc(new Date(s.startedAt).toLocaleDateString())} · ` +
      `${esc(mins(s.durationSec))}${s.completed ? "" : " · partial"}</span></li>`
    ).join("");

    $("logList").innerHTML = logs.map(l => {
      const w = l.unit === "bw" ? "bodyweight" : `${l.weight} ${l.unit}`;
      return `<li class="hist-row"><span class="hist-name">${esc(l.exercise)}</span>` +
             `<span class="hist-meta">${esc(l.sets)} × ${esc(l.reps)} @ ${esc(w)} · ` +
             `${esc(new Date(l.performedAt).toLocaleDateString())}</span></li>`;
    }).join("");

    $("historyEmpty").hidden = !!(sessions.length || logs.length);
  } catch (e) {
    $("historyEmpty").hidden = false;
    $("historyEmpty").textContent = "Couldn't load your history.";
  }
}
```

Add a "History" entry point to the home screen (visible only when signed in) that shows `#screen-history` and calls `refreshHistory()`. Add `#screen-history` to the screen-show/hide helper alongside `#screen-builder`.

- [ ] **Step 3: Style and verify**

Add `.stat-tiles`, `.tile`, `.tile-v`, `.tile-k`, `.hist-list`, `.hist-row`, `.hist-name`, `.hist-meta`, `.hist-empty` to `styles.css`, reusing the existing token variables.

```bash
npm start   # sign in, run two short workouts, log two sets, open History
```
Confirm the three tiles, both lists, and that a signed-out user sees the "Sign in to keep a history" message rather than an error.

- [ ] **Step 4: Run both suites and commit**

```bash
npm test && cd server && npx vitest run && cd ..
git add app.js index.html styles.css
git commit -m "feat(ui): history screen with stats, sessions and set logs"
```

---

## Task 10: Retire the `__regimens__` presets smuggling

**Files:**
- Modify: `store.js`, `app.js`
- Test: `tests/store.test.mjs`

Regimens currently ride inside the single cloud presets document under the reserved `__regimens__` key (`store.js:14`, `splitPresets`/`mergePresets`). Task 1 gave them a real collection. This task migrates existing users once, then stops writing the old location.

- [ ] **Step 1: Write the failing test**

```js
test("migrateRegimenPresets uploads legacy regimens once and clears the reserved key", async () => {
  const uploaded = [];
  const cloud = {
    async loadPresets() { return { "Leg Day": {}, __regimens__: {
      "Old Workout": { schema: "regimen@1", name: "Old Workout",
                       segments: [{ type: "work", seconds: 30 }] } } }; },
    async savePresets(o) { this.saved = o; },
    async listRegimens() { return []; },
    async saveRegimen(r) { uploaded.push(r); return { id: "x" }; },
  };
  const moved = await migrateRegimenPresets(cloud);
  assert.equal(moved, 1);
  assert.equal(uploaded[0].name, "Old Workout");
  assert.equal(cloud.saved.__regimens__, undefined);
  assert.ok(cloud.saved["Leg Day"]);
});

test("migrateRegimenPresets is a no-op when the library already has entries", async () => {
  const cloud = {
    async loadPresets() { return { __regimens__: { A: { schema: "regimen@1", name: "A",
      segments: [{ type: "work", seconds: 30 }] } } }; },
    async savePresets() { throw new Error("should not write"); },
    async listRegimens() { return [{ id: "1", name: "A" }]; },
    async saveRegimen() { throw new Error("should not upload"); },
  };
  assert.equal(await migrateRegimenPresets(cloud), 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test
```
Expected: FAIL — `migrateRegimenPresets is not exported`.

- [ ] **Step 3: Implement it in `store.js`**

```js
// One-time move of legacy regimens out of the presets document and into /api/regimens. Safe to
// call on every sign-in: it does nothing once the library is populated or the key is gone.
export async function migrateRegimenPresets(cloud) {
  const existing = await cloud.listRegimens();
  if (existing.length) return 0;
  const doc = await cloud.loadPresets();
  const { ladder, regimens } = splitPresets(doc);
  const names = Object.keys(regimens);
  if (!names.length) return 0;
  let moved = 0;
  for (const name of names) {
    try { await cloud.saveRegimen({ ...regimens[name], name }); moved++; }
    catch (e) { /* skip one bad regimen rather than abandoning the migration */ }
  }
  if (moved) await cloud.savePresets(ladder);   // ladder has __regimens__ stripped by splitPresets
  return moved;
}
```

- [ ] **Step 4: Call it on sign-in in `app.js`**

In the sign-in sync path (near `app.js:75-81`, where `splitPresets` is used today), after the config/presets sync completes:

```js
try { await migrateRegimenPresets(cloud); } catch (e) { /* local-only degrade */ }
```

Keep `splitPresets`/`mergePresets` and their tests — they are still needed to read legacy documents. Stop *writing* `__regimens__`: the save path now calls `cloud.saveRegimen(...)`.

- [ ] **Step 5: Run both suites**

```bash
npm test && cd server && npx vitest run && cd ..
```
Expected: PASS — including the pre-existing `splitPresets`/`mergePresets` and reserved-namespace tests.

- [ ] **Step 6: Commit**

```bash
git add store.js app.js tests/store.test.mjs
git commit -m "refactor: move regimens out of the presets document into their own collection"
```

---

## Verification

**Automated — both must be green:**

```bash
npm test                              # client: 65 existing + ~25 new
cd server && npx vitest run && cd ..  # server: 28 existing + ~10 new
```

**End-to-end, against a real server:**

```bash
cd server && npm run dev:local   # boots Express against the in-memory Mongo (scripts/dev-local.mjs)
# in another shell, from the repo root:
npm start                        # http://localhost:8000
```

Walk this path and confirm each item:

1. **Sign in** with a seeded account. Legacy regimens (if any) move into the library — check `GET /api/regimens`.
2. **Build** a workout: name it, add two work segments, a rest, and a 3-round repeat block. The summary line updates as you type; reorder and delete rows.
3. **Save & start.** Confirm the full audio chain fires from the existing engine: "Get ready", the transition beep on each phase change, the spoken segment label, the last-3-second countdown, the halfway chime, and the completion fanfare.
4. **Finish it.** The done card reports the run was logged; `GET /api/sessions` shows it with the right `durationSec` and `completed: true`.
5. **Log a set by voice** in Chrome: "squats three sets of five at two hundred pounds" → the confirm card reads *squats — 3 × 5 @ 200 lb* → save → it appears in `GET /api/logs` with `source: "voice"`.
6. **Repeat in Firefox**: the mic button is hidden, typing the same phrase gives an identical result with `source: "manual"`.
7. **History** shows the workout count, total time, day streak, and both lists.
8. **Share**: "Copy share link" produces an `#r=` URL; opening it in a private window opens the builder with that workout **without auto-running it**.
9. **Regression**: an existing `#w=kb-ladder` and an existing `#c=` link still decode and run exactly as before.
10. **Guest path**: signed out, the timer, catalog, builder and share links all still work; only saving and history prompt for sign-in, and nothing throws.
11. **Failure path**: stop the server mid-session and finish a workout — the timer must complete normally and the UI must say the run wasn't saved, never break.
