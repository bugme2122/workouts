# PROJECT.md — Ladder Circuit Timer

_Knowledge-transfer document, written 2026-07-10 after a full read of the codebase, updated
2026-08-29 for the migration off Firebase onto a self-hosted Express + MongoDB backend. Companion
files: `GAPS.md` (known weaknesses, severity-ordered) and `CLAUDE.md` (operational rules for AI
sessions)._

## What this is

**Ladder Circuit Timer** is a single-page web app that runs group interval-circuit workouts. One phone/tablet/TV drives the session: 1–6 people rotate through exercise stations while the app counts down "ladder" intervals (e.g. 60s on / 30s off, then 50/25, 40/20, 30/15, 20/10 = one "block"), announces cues by voice and beeps, and shows who is at which station in a color-coded layout. It's built for a home/garage-gym user (the repo owner works out with a partner — the default workout is a 2-person kettlebell circuit).

Users can:
- Pick a workout from a small built-in catalog (5 workouts), customize people/names/length, or build one from scratch.
- Save named presets, share a workout via URL (`#w=<id>` short links or `#c=<blob>` full links).
- Use it as a guest (everything in `localStorage`) or sign in with an email/password account to sync the current config + presets to MongoDB across devices.
- Upload or paste a `regimen@1` JSON workout ("Bring Your Own Workout") and run it on the same timer, audio cues included.

## Tech stack and why

| Piece | What | Why (evident from code/docs) |
|---|---|---|
| Vanilla JS ES modules | No framework, no bundler, no client dependencies | Deliberate and still in force **for the client**: it stays buildless, and `server/scripts/build-client.mjs` only copies files and injects `BASE_PATH`. |
| Express 5 + Mongoose 8 + MongoDB | One service serving both `/api/*` and the app itself | Replaced Firebase in the 2026-07-20 platform migration. Mirrors the FACS deployment model: Railway + MongoDB Atlas behind a Cloudflare route at `flywren-technologies.com/workouts`. See `docs/superpowers/specs/2026-07-20-platform-migration-design.md`. |
| JWT auth (access + rotating refresh) | Email/password accounts, **admin-provisioned, no self-registration** | Replaced Google popup sign-in. Access token in memory only (XSS mitigation); refresh token in `localStorage` ("Remember me") or `sessionStorage`. See `docs/superpowers/specs/2026-07-20-auth-swap-facs-design.md`. |
| `node --test` (client) / `vitest` + `supertest` + `mongodb-memory-server` (server) | Two suites, 86 + 32 tests (run on push/PR by `.github/workflows/test.yml`) | Client keeps zero dependencies; the server tests run against an in-memory MongoDB, so no Atlas access is needed to run them. |
| Google Fonts (Anton, Barlow, Barlow Condensed) | The "sporty poster" typography | The only remaining third-party origin. |
| `npm run dev:local` (server) | Whole stack on :4000 with an embedded MongoDB | Atlas requires IP allowlisting, which blocks local work; `mongodb-memory-server` against a persistent dbPath avoids it. `npm start` at the root still serves the client alone for pure UI work. |

The root `package.json` still has **no dependencies** — it exists only for scripts and
`"type": "module"`. All packages live in `server/package.json`.

## Architecture

```
index.html  (4 <section class="screen"> + settings <div class="sheet"> + account menu)
   │  loads framebust.js (sync, head) and app.js (module)
   ▼
app.js  ───────────────  THE monolith: all DOM, UI state, timer loop, audio, boot flow
   │            │
   │  pure      │  persistence
   ▼            ▼
engine.js    store.js ──── localStorage (guest + offline cache; keys ladder.last / ladder.presets)
catalog.js      │
                │  (only when signed in)
                ▼
             auth.js ──── email/password JWT sessions, refresh-token rotation
                │
                ▼
             api.js  ──── fetch + Bearer + single-flight refresh-on-401
                │
                ▼
   Express (server/src) ──▶ MongoDB
       /api/auth/*   login, refresh, logout
       /api/users/me the signed-in user
       /api/state    WorkoutState.configJson
       /api/presets  WorkoutState.presetsJson
       /api/account  delete-all
```

**Module roles (import direction is strictly downward — keep it that way):**

- **`engine.js`** — pure logic, zero DOM, imported by both the browser and Node tests. Phase building (`buildPhases`), block math (`blockLenOf`, `blocksFor`), station occupancy (`occupants`, `offsetFor`, `clampPeople`), config repair (`migrate` → `sanitize`), per-second audio-cue decisions (`secondCue`), base64 codec (`enc`/`dec`), and share-link delta helpers (`sameCircuit`, `lightDelta`, `applyLight`, `LIGHT_FIELDS`). Engine defaults are **injected** by app.js via `setDefaults()` so engine.js stays free of catalog data.
- **`catalog.js`** — data + share-link policy. `THEMES`, `LADDERS`, `LENGTHS`, `EXERCISES`, `DEFAULT` config, the `WORKOUTS` catalog, `workoutToConfig()`, and `encShare`/`decShare` (short-link logic built on engine helpers).
- **`store.js`** — the `local` localStorage backend (config plus a sidecar `ladder.last.at` write stamp), `decideMigration(localCfg, cloudCfg, {localAt, cloudAt})` (**newest wins** when both sides are stamped, cloud otherwise), `mergePresetMaps()` (presets merge, never replace), the preset namespace helpers (`splitPresets`/`mergePresets`), and the cloud backend built on `api.js`. DOM-free and unit-testable.
- **`auth.js` / `api.js`** — `auth.js` owns the session (login, `/auth/refresh` restore on page load, logout, `onAuthChange`); `api.js` owns every request, attaching the Bearer token and retrying once through a single-flight refresh on a 401 so a rotated-out token never causes a spurious logout.
- **`app.js` (~640 lines)** — everything else: boot flow, screen router (`showScreen`), the rAF timer loop, Web Audio beeps + speechSynthesis voice + vibration + wake lock, all rendering (string-built `innerHTML` with a local `esc()` helper), the settings sheet, the customize screen, catalog rendering with guest locks, and the auth/cloud orchestration (`onAuthChange`, debounced `cloudSaveConfig`).

### The config object — the app's single most important data structure

Everything revolves around one plain object (`config`):

```js
{ people, prep, ladder: [[on,off],...], stations: [{ex,gear,rep,url},...],
  personNames: [], theme, voice, ticks, haptics, keepAwake, volume, halfChime,
  targetMin, workoutId }
```

- `targetMin: 0` means "one pass" (blocks = station count); otherwise blocks ≈ `targetMin*60 / blockLen`.
- **Every config from an untrusted or persisted source must pass `sanitize(migrate(cfg))`** before use. `sanitize` is the trust boundary: it caps array sizes (40 stations / 60 ladder rows — a share link is attacker-controlled JSON), coerces malformed entries, clamps numbers, drops non-http(s) `url`s (blocks `javascript:` URLs), and clamps `people` to `min(6, stations.length)`. Note it **mutates its argument in place**.
- `sanitize` lives in engine.js but is also re-exported from catalog.js.

### Data flow: persistence & sync

- **Guest:** `persist()` → `store.local.saveConfig()` (localStorage). That's it.
- **Signed in:** `persist()` additionally debounces (1.2s) a `PUT /api/state`. Config and presets are
  stored on one `WorkoutState` document per user as **JSON strings** — `{userId, configJson,
  presetsJson}`. That shape is inherited from Firestore (which rejected the nested arrays in
  `config.ladder`) and was kept deliberately: it keeps the schema versioned by the same `migrate()`
  path as localStorage. Don't normalize it into document fields.
- **Regimens** (uploaded `regimen@1` workouts) currently ride along inside `presetsJson` under the
  reserved `__regimens__` key — see `store.js` `splitPresets`/`mergePresets`. A known wart.
- **On sign-in** (`onAuthChange`): `GET /api/state` (which returns the document's `updatedAt`) → `decideMigration`: the **newer** of local/cloud wins when both are timestamped, otherwise cloud. The cloud copy is always cached to localStorage; the in-memory `config` is only replaced when `isIdle(...)` — welcome/home screen, nothing running, no fresh share. Presets **merge** (`mergePresetMaps`, cloud winning a name collision) and the merge is pushed back up, so presets made locally since the last sync are never discarded. Every cloud failure goes through `noteSync()`: a `console.warn` plus the sync dot on the identity chip.
- **Authorization** is server-side: `verifyJWT` is applied per-route (not router-wide, so it never
  intercepts siblings like `/api/health`), and every controller scopes its query to `req.user.id`.
  A user can only ever read or write their own state.

### Data flow: share links

Two hash formats, both decoded on boot and by `decShare`:
- `#w=<workoutId>` — catalog workout, unmodified circuit. If the user changed "light" fields (people, names, theme, length… — anything in `LIGHT_FIELDS`, i.e. NOT `stations`/`ladder`), a `~<base64-delta>` tail carries just the diff: `#w=kb-ladder~eyJ...`.
- `#c=<base64-of-whole-config>` — used when stations/ladder were hand-edited (a static site has no server to reference custom circuits from). Also the legacy format; still decodes.

**Workout `id`s must be URL-safe slugs containing no `~`** (the `~` delimits the delta tail).

### Boot flow (subtle — read carefully before touching)

```
loadConfig(): hash #w=/#c= → decode+sanitize | else localStorage | else DEFAULT
freshShare = hash present AND no localStorage   → deep-link straight to the LIVE screen
otherwise:
  - any hash is treated as STALE and stripped via history.replaceState
  - ALWAYS show the welcome/sign-in gate (sign-in is explicit; no silent auto-login)
```

A returning signed-in user still lands on the welcome screen rather than being silently resumed — a deliberate product decision ("no silent auto-login," commit d930413), not an oversight. `auth.js` does attempt a session restore via `/auth/refresh` → `/users/me`, so the welcome screen greets them by name ("Signed in as …") instead of asking them to log in again.

### The timer loop

`start()` → `requestAnimationFrame(loop)`. `loop()` subtracts real elapsed time (`performance.now()`) from `remaining`, fires per-second cues via the pure `secondCue()`, and when `remaining <= 0` advances phases in a `while` loop **carrying the leftover milliseconds** so timing never drifts. Rendering is cheap by design: `renderPersonCards`/`renderBigCircuit` compare a cache key (`block + _contentSig`) and early-return on the ~60fps calls; the DOM is rebuilt only when the block rotates or config changes (this also keeps the `.rotate-flash` CSS animation from restarting every frame). Guard to know about: `prep: 0` gives a phase of duration 0 — `render()` explicitly avoids the 0/0 NaN when computing the ring fraction.

### UI structure

Four screens toggled by `showScreen(name)` adding `.active` to `#screen-welcome | -home | -customize | -live`. One shared **settings sheet** serves two masters: opened from a gear button it edits `config` directly (Apply = sanitize + persist + rebuild); opened from the customize screen (`sheetFromCustomize = true`) it edits the customize `draft` and Apply just closes back to customize. The `draft` variable is shared between the sheet and the customize screen — that flag is the only thing distinguishing the flows.

Guest gating: workouts beyond `GUEST_FREE = 2` render locked with a "Sign in to unlock" button. This is **client-side cosmetics only** — the full catalog ships in `catalog.js`, so treat it as a nudge, never as security.

## Key design decisions (inferred + documented)

1. **Buildless static site is a hard constraint.** No bundler, no npm deps, no server. Every feature (auth, sync, share links) is designed around this. Don't introduce a build step casually.
2. **The cloud is an optional upgrade.** Guests never call the API at all. Every auth/cloud call is wrapped in try/catch — on any error the app keeps working locally (silently; see GAPS #6). A logging or network failure must never break the timer.
3. **Purity boundary for testability.** Everything that can be tested without a DOM lives in engine/catalog/store; app.js is consciously the untested integration layer.
4. **`sanitize(migrate())` as the single trust boundary** for share links, localStorage, cloud data, and presets. Hardened over multiple commits (acf10ee) against crafted configs — nulls, wrong types, huge arrays, `javascript:` URLs, NaN volume.
5. **Layered security posture:** the CSP `<meta>` (heavily commented in index.html) is now down to `'self'` plus Google Fonts; `frame-ancestors` doesn't work in a meta CSP, so `framebust.js` provides the clickjacking guard. The server adds `helmet` and rate limiting. A pre-commit hook in `.claude/settings.json` scans staged files for secret patterns. Real authorization is server-side per-user scoping.
6. **`WorkoutState` stores JSON strings, not documents** — inherited from Firestore's nested-array limitation and kept because it keeps the schema trivially versioned by the same `migrate()` path as localStorage.
7. **Cloud-wins conflict resolution** — simple, predictable, but can lose local edits (GAPS #1).

## Critical paths (ranked)

**Load-bearing — change with tests and care:**
- `engine.js` `sanitize`/`migrate` — every config in the app funnels through here; a regression is an XSS or crash vector.
- `engine.js` `buildPhases`/`occupants`/`blocksFor` — the workout math. `occupants` must never return an out-of-range station (regression test exists, "F1").
- `catalog.js` `encShare`/`decShare` — share links in the wild must keep decoding; `#c=` backward compatibility is a stated requirement.
- `app.js` boot block (~lines 530–560) and `onAuthChange` — the trickiest state interactions in the app.
- `app.js` `loop()`/`render()` — timing correctness and the render-caching contract (`_contentSig`, `_pcardKey`, `_bigKey`).
- `index.html` CSP meta — read its comment block before editing. Since the de-Googling the only
  third party left is Google Fonts, but the historical lesson stands: a wrong origin breaks auth
  with opaque errors (a missing `apis.google.com` once caused `auth/internal-error`, commit cca9529).
- `server/src/middleware/auth.js` and every controller's `userId` scoping — this is the real
  authorization boundary now that rules files are gone.

**Safe to change casually:** `styles.css` visuals, `catalog.js` data (EXERCISES, WORKOUTS — respect the id rules), copy/labels in index.html, THEMES/LADDERS entries.

## Things that will trip you up

1. **Secrets now live in `server/.env`** (`MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `BASE_PATH`), which is gitignored. The **pre-commit hook blocks any commit whose staged files match `apiKey`** — that guard is still live and still worth respecting. `npm run dev:local` needs none of it: it supplies an embedded MongoDB and generates an ephemeral `JWT_SECRET`.
2. **`styles.css` is the only stylesheet.** The never-linked `design-tokens.css`, which duplicated the token block, was deleted (GAPS #11). Themes are applied by JS `style.setProperty`, not a data attribute.
3. **Themes are two different mechanisms:** the 4 phase colors come from `THEMES` in catalog.js applied via `applyTheme()`; the 6 per-person colors (`--p1..--p6`) are fixed in styles.css and do not change with theme.
4. **`sanitize` mutates in place.** Callers that need the original clone first (`sanitize(clone(draft))` is the idiom).
5. **Engine defaults mirror catalog DEFAULT.** `engine.js` keeps internal `DEFAULTS` for `migrate`/`sanitize` fallbacks (tests rely on them), overridden at startup by `setDefaults(...)` in app.js — which now passes **every** field, `haptics`/`keepAwake` included. Add a new config field to both, plus `sanitize`, `migrate`, `LIGHT_FIELDS` and catalog `DEFAULT`.
6. **A share link opened by an existing user is ignored completely** — `decideBoot()` returns `configSource: "local"`, so the hash is stripped, welcome is shown, and `loadConfig()` never reads the link. (It used to half-apply; see GAPS #5.)
7. **rAF timer in a backgrounded tab:** the loop stops getting frames. On return, `advancePhases()` fast-forwards with exact wall-clock accounting and announces **only the phase landed on** (the phases flown past come back as `skipped` and are deliberately silent), and the `visibilitychange` handler re-renders immediately.
8. **There is no self-registration.** A new environment has no users until one is provisioned — `cd server && npm run create-admin`, or just `npm run dev:local`, which seeds `admin@local.test` / `LocalAdmin!2026` on first run. If sign-in "breaks" in a fresh environment, check that a user exists before suspecting the code.
9. **`docs/superpowers/`** contains the design specs and implementation plans (brainstorm → spec → plan workflow) for the catalog, audio cues, share links, and accounts features. They explain most "why"s; the accounts spec documents locked-in decisions. `docs/agents/prompt.md` is an orchestration prompt template for driving the `.claude/agents/*` subagent pipeline — not app documentation.
