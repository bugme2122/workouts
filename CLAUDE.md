# CLAUDE.md — Ladder Circuit Timer

Vanilla-JS interval-timer web app with a buildless client and an Express 5 + MongoDB API
(email/password JWT accounts, per-user cloud sync).
**Architecture & narrative:** see `PROJECT.md`. **Audit ledger (every past weakness and how it was closed):** see `GAPS.md`.

## Commands

```sh
npm test                      # client: node --test tests/*.test.mjs   (86 tests, all must pass)
npm run test:watch            # client watch mode
npm start                     # npx http-server on :8000  (client only, no API)

cd server && npm run dev:local # WHOLE STACK on :4000 — Express + embedded MongoDB, seeds an admin
cd server && npx vitest run    # server: 32 tests, all must pass
cd server && npm run create-admin  # provision a user (there is no self-registration)
```

- **Both suites must be green before any change is claimed done.** Client `npm test` (86) and
  server `npx vitest run` (32). CI (`.github/workflows/test.yml`) runs both on push and PR.
- The **client** is buildless with **zero npm dependencies** — do not add client-side packages.
  The **server** (`server/`) uses Express 5 + Mongoose 8 and has its own `package.json`; deps go
  there. `server/scripts/build-client.mjs` only *copies* client files into `server/public` and
  injects `BASE_PATH`; it is not a bundler and must not become one.
- Deploy = Docker → Railway, behind a Cloudflare route at `flywren-technologies.com/workouts`
  (`BASE_PATH=/workouts`). See `docs/deploy.md`.
- App must be served over HTTP (ES modules); opening `index.html` via `file://` won't work.

## Layout & conventions

- `engine.js` — pure logic, **no DOM, no imports from other app files**. Tested.
- `catalog.js` — data (THEMES/LADDERS/EXERCISES/WORKOUTS/DEFAULT) + share-link encShare/decShare. Tested.
- `store.js` — localStorage backend + `decideMigration` + the cloud backend built on `api.js`. Tested.
- `api.js` — the single `fetch` entry point: attaches the Bearer access token, transparently
  refreshes once on a 401 (single-flight), surfaces the server's `error` message.
- `auth.js` — email/password JWT sessions. Access token in memory only; the rotating refresh token
  goes to `localStorage` when "Remember me" is on, else `sessionStorage`.
- `app.js` — all DOM/UI/timer/boot/sync orchestration. **Untested**; be extra careful here.
- Import direction is strictly: app.js → (engine, catalog, store, auth) → api. Never make
  engine/catalog/store import app.
- `server/src/` — `routes/ → controllers/ → models/`, with `middleware/auth.js` (`verifyJWT`)
  applied per-route, not router-wide, so it never intercepts siblings like `/api/health`.
- Tests: client `tests/*.test.mjs` (`node:test` + `node:assert/strict`); server `server/tests/`
  (`vitest` + `supertest` + `mongodb-memory-server`). New pure logic gets a test; put logic in
  engine.js (or extract from app.js) to make it testable.
- Style: compact vanilla JS, `const $ = id => document.getElementById(id)`, string-built
  `innerHTML` with the local `esc()` helper. **Every dynamic value interpolated into HTML must go
  through `esc()`**; `esc()` escapes both quote styles, but double-quoted attributes stay the convention.
- Errors: cloud/auth failures degrade to local-only by design — never let an API error break the
  timer — but they are no longer silent: route every cloud catch through `noteSync()` in app.js,
  which console.warns and drives the sync dot on the identity chip.
- CSS: `styles.css` is the only stylesheet and the single source of truth for tokens (the unlinked
  `design-tokens.css` was deleted). Destructive confirmations use `askConfirm()` + `#confirmBox`,
  never the native `confirm()`.

## The rules (violate none of these casually)

1. **Every config from storage, a share link, cloud, or a preset must pass `sanitize(migrate(cfg))`**
   (engine.js) before use; **every uploaded regimen must pass `validateRegimen` then
   `sanitizeRegimen`**. This is the app's security trust boundary (XSS/crash protection for
   attacker-controlled `#c=` links and uploaded JSON). Both mutate their argument — clone first if
   you need the original.
2. **Share-link backward compatibility is a requirement.** Existing `#w=` and `#c=` URLs in the wild
   must keep decoding. Don't change `enc`/`dec` output format or `LIGHT_FIELDS` semantics without
   round-trip tests proving old links still work.
3. **Workout `id`s in `catalog.js` must be URL-safe slugs with no `~`** (`~` delimits the share-link delta tail).
4. **Don't touch the CSP `<meta>` in index.html without reading its comment block.** Since the move
   off Google sign-in the only third party left is Google Fonts. `framebust.js` must stay an
   external file loaded first in `<head>` (no `'unsafe-inline'` in script-src).
5. **Don't remove the render caches** in app.js (`_contentSig`, `_pcardKey`, `_bigKey`) — they
   prevent 60fps DOM rebuilds and keep the `.rotate-flash` animation working. If you change what
   person-cards/big-circuit display, update `_contentSig` to include the new inputs.
6. **`engine.js` defaults are injected** via `setDefaults()` from app.js; tests rely on engine's
   built-in fallbacks. Keep both in sync if you add config fields, and add the field to `sanitize`,
   `migrate`, `LIGHT_FIELDS` (if shareable), and `DEFAULT` in catalog.js.
7. **The server must not trust the client's sanitize.** Anything written through the API is
   re-validated server-side; every collection is scoped by `userId` and every query filters on the
   JWT's user. No cross-user reads.
8. **Run both suites before claiming any change done.** 86 client + 32 server, all green.

## Pure seams to prefer (added 2026-09-12)

`app.js` is untested, so new decision logic goes in `engine.js` and gets a test. Already there and
already used by app.js — use them rather than re-deriving the logic inline:

- `decideBoot(hash, hasLocal)` — what a URL hash means for the boot screen, the config source, and
  whether to clear the hash. A share hash is honored **only** for a genuine recipient.
- `isIdle({ activeScreen, running, freshShare })` — the one gate for swapping the live config out
  from under the user (cloud sign-in sync and cross-tab `storage` sync both use it).
- `advancePhases(phases, idx, remaining)` — the leftover-carrying phase advance, used by both the
  rAF loop and the `visibilitychange` handler. Announce only the phase landed on, never `skipped`.
- `store.decideMigration(local, cloud, { localAt, cloudAt })` is newest-wins when both sides are
  stamped, and `store.mergePresetMaps()` merges presets — never replace a preset map wholesale.

## Gotchas

- **Server env:** `server/.env` needs `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `BASE_PATH`.
  `npm run dev:local` overrides `MONGODB_URI` with an embedded MongoDB (persistent dbPath at
  `server/.data/mongo`) and generates an ephemeral `JWT_SECRET` if none is set — so it boots on a
  clean machine. `.env` is never committed; the pre-commit hook in `.claude/settings.json` blocks
  any staged content matching `apiKey`. Don't `--no-verify` without telling the user.
- **Accounts are admin-provisioned — there is no self-registration.** `dev:local` seeds
  `admin@local.test` / `LocalAdmin!2026` on first run (idempotent; it never rewrites an existing
  user's password). If sign-in fails in a new environment, check that a user exists before
  suspecting the code.
- **Welcome screen always shows on normal boot** — deliberate ("no silent auto-login"). Don't "fix" it.
- **The welcome screen is the app's one light surface.** `body.auth-light` is a scoped token
  override toggled in exactly one place, inside `showScreen()`. Never move those tokens into
  `:root`, and never toggle the class anywhere else — the two states would desync.
- **`prep: 0` creates a 0-duration phase**; `render()` guards a 0/0 NaN for the ring. Preserve that guard.
- **Settings sheet serves two flows** distinguished only by `sheetFromCustomize`: gear-button →
  edits `config` (Apply = sanitize+persist+rebuild); customize screen → edits the customize `draft`
  (Apply just closes). Check the flag before changing sheet behavior.
- **Guest workout locks (`GUEST_FREE`) are a UI nudge, not security** — all catalog data ships to the client.
- **`WorkoutState` stores config/presets as JSON strings** (`{userId, configJson, presetsJson}`).
  This shape is inherited from Firestore (which rejected the nested arrays in `config.ladder`) and
  is kept deliberately. Don't "normalize" it into document fields.
- **Regimens are currently smuggled into the presets document** under the reserved `__regimens__`
  key (`store.js`). This is a known wart with a real fix planned — see the custom-workouts plan in
  `docs/superpowers/plans/`.
- **Two pre-existing console errors on load** are known and unrelated to app code: `frame-ancestors`
  is ignored in a `<meta>` CSP (which is why `framebust.js` exists), and the `data:` web-app
  manifest is blocked by `default-src 'self'`. Don't chase them as regressions.
- **Docs in `docs/superpowers/` are point-in-time specs/plans** — some describe superseded behavior
  (e.g. the Firebase-era accounts spec). Trust code over docs. `docs/agents/prompt.md` is an
  agent-pipeline prompt template, not app docs.
- **`archive/firebase-era` (tag)** marks the last Firebase-era commit, if you need to see how
  Google auth / Firestore worked before the migration.
- Windows repo (CRLF warnings from git are normal); shell is PowerShell/Git Bash.
