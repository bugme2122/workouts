# GAPS.md — Honest audit of weaknesses

_Originally written 2026-07-10 from a full read of the codebase; refreshed 2026-08-29 after the
MERN migration. **Worked to closure 2026-09-12** — every item below now carries its resolution.
Severity scale: CRITICAL / HIGH / MEDIUM / LOW._

**Status: no actionable items remain.** Items #1–#16 are resolved, obsolete, or closed as
"working as intended, now documented". The residual risk that outlived its fix is recorded under
[Standing risks](#standing-risks) at the bottom; it is a known, accepted shape of the codebase,
not a queued task. New findings should be appended as #17 onward.

---

## 1. ~~HIGH~~ RESOLVED (2026-09-12) — Cloud-wins sync could silently destroy local data on sign-in

**Was:** `decideMigration()` let the cloud config win whenever *any* cloud config existed — no
timestamp, no comparison, no prompt — and presets were worse: any cloud presets wholesale replaced
the local preset store, discarding everything created locally since the last sync.

**Fixed by:**
- `local.saveConfig` now stamps `ladder.last.at` (a **sidecar** key, so the timestamp can never
  ride a share link or a preset), readable via `local.configUpdatedAt()`.
- `GET /api/state` returns the document's `updatedAt`; `cloudBackend.loadState()` surfaces it.
- `decideMigration(local, cloud, { localAt, cloudAt })` prefers the **newer** config when both
  sides exist and both are stamped, and falls back to the historical cloud-wins rule otherwise.
- Presets **merge** instead of replacing: `mergePresetMaps()` unions the two maps (cloud wins a
  name collision), and the merge is pushed back to the cloud. Regimen presets merge the same way.

**Tests:** `tests/store.test.mjs` (timestamp sidecar, all four newest-wins cases, merge semantics),
`server/tests/integration/state.test.js` (`updatedAt` present on read).

## 2. ~~HIGH~~ OBSOLETE — `firebase-config.js` tracked, gitignored, and hook-blocked

**Status: resolved by the MERN migration (2026-07-20).** `firebase-config.js` no longer exists;
secrets live in `server/.env` (gitignored) and `npm run dev:local` needs none of them. The old key
is below the `archive/firebase-era` tag, was rotated, and the project is deleted. No action.

## 3. ~~HIGH~~ RESOLVED as specified (2026-09-12) — `app.js` had zero tests

**Was:** nothing exercised the integration layer — the boot branches, `onAuthChange`'s idle gating,
the rAF phase advance.

**Fixed by** applying this file's own prescribed fix: the pure decisions were extracted out of
`app.js` into `engine.js` and unit-tested, rather than attempting to test the DOM wholesale.

- `decideBoot(hash, hasLocal)` → `{ bootedFromShare, freshShare, screen, configSource, clearHash }`
- `isIdle({ activeScreen, running, freshShare })` — the one predicate that gates every
  swap-the-config-under-the-user path (cloud sync and, now, cross-tab sync)
- `advancePhases(phases, idx, remaining)` → `{ idx, remaining, finished, skipped }` — the
  leftover-carrying phase advance, formerly an inline `while` loop

`app.js` now calls all three. The remaining DOM/render layer is still untested — see
[Standing risks](#standing-risks).

**Tests:** `tests/engine.test.mjs` (11 new cases across the three helpers).

## 4. ~~MEDIUM~~ RESOLVED (2026-09-12) — Uncommitted work-in-progress in the working tree

**Fixed by:** `.claude/` is committed, so the secret-scanning pre-commit hook travels with the repo
instead of protecting one machine. `prompt.md` moved to `docs/agents/prompt.md`. `image.png` and
the root `ScottPlan-*.md` pattern are gitignored.

**Note:** the untracked `ScottPlan-2026-08-29.md` was deleted rather than merely ignored during
this pass. Its content survives as the committed plan at
`docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md` (the plan's own Task 0 defines
that file as a copy of it).

## 5. ~~MEDIUM~~ RESOLVED (2026-09-12) — A share link opened by an existing user half-applied

**Was:** `loadConfig()` decoded a `#w=`/`#c=` hash into `config` unconditionally, but boot only
honored the link when localStorage was empty. For a returning user the hash was stripped as stale
while the in-memory config had already been replaced — so the next `persist()` overwrote their own
saved workout with a link they never chose to open.

**Fixed by:** `decideBoot()` returns `configSource`, and `loadConfig()` reads the hash **only** when
that is `"share"`. A returning user's config comes from localStorage; the stale hash is cleared and
nothing else about it is honored. Verified in a browser: with a local config seeded, loading
`#c=…` leaves `ladder.last` untouched and shows the welcome screen.

## 6. ~~MEDIUM~~ RESOLVED (2026-09-12) — All cloud failures were swallowed silently

**Was:** every cloud/auth call was wrapped in `catch(()=>{})`, so a signed-in user whose writes
failed believed they were synced.

**Fixed by:** `noteSync(ok, what, e)` — every cloud read/write path now `console.warn`s on failure
**and** drives a small sync dot on the identity chip (green = last write ok, amber = failed, with a
title explaining that changes are saved on this device). Failures still degrade to local-only; the
timer is never broken by an API error. That behavior is by design and is now visible rather than
silent.

## 7. ~~MEDIUM~~ RESOLVED (2026-09-12) — Backgrounded-tab cue burst and skipped feedback

**Was:** the rAF catch-up loop called `enterPhase()` for every missed phase on return from a hidden
tab, firing a rapid burst of beeps and speech.

**Fixed by:** (a) the catch-up is now `advancePhases()` (pure, tested), which returns the phase
actually landed on plus the indexes flown past — only the landing phase is announced; (b) the
`visibilitychange` handler charges the elapsed wall-clock time and re-renders immediately on return,
so the user sees the true position instead of a stale frame.

## 8. ~~MEDIUM~~ RESOLVED (2026-09-12) — Preset load skipped `sanitize`

**Was:** `renderPresets`'s Load button did `draft = migrate(ps[n])` — the only config path in the
app that skipped `sanitize`, on semi-trusted data (another device, an older schema).

**Fixed by:** `draft = sanitize(migrate(clone(ps[n])))`. The clone matters: both functions mutate
their argument, and `ps` is the stored map.

**Still true, by design:** the two editor flows share one `draft` global, disambiguated by
`sheetFromCustomize`. See [Standing risks](#standing-risks).

## 9. ~~LOW–MEDIUM~~ CLOSED as intended (2026-09-12) — Guest workout-locking is client-side only

All catalog data ships to the client, the lock is a CSS class, and `decShare()` has no lock check.
This is a **sign-in nudge, not security**, and the fix this file prescribed — say so in the code —
is applied: `GUEST_FREE` now carries a comment stating the intent and what real gating would cost
(serving catalog content from the API). Nothing to do unless the catalog is ever monetized.

## 10. ~~LOW~~ RESOLVED (2026-09-12) — Booleans unsanitized; engine defaults drifted from catalog

**Was:** `sanitize` passed `voice/ticks/haptics/keepAwake/halfChime` through untouched (a crafted
config could carry `voice: "yes"`), and both engine's `DEFAULTS` and the `setDefaults()` call
omitted `haptics`/`keepAwake` — so a legacy config missing `keepAwake` read as `undefined` and the
screen slept mid-workout.

**Fixed by:** `sanitize` coerces all five (`c.x = c.x === undefined ? DEFAULTS.x : !!c.x`), engine
`DEFAULTS` gained `haptics: false, keepAwake: true`, and `setDefaults()` in app.js now passes every
field from the catalog's `DEFAULT` so the two cannot drift.

**Tests:** `tests/engine.test.mjs` (coercion, defaults-when-absent, explicit-false preserved).

## 11. ~~LOW~~ RESOLVED (2026-09-12) — Dead code and duplicate sources of truth

- **`design-tokens.css` deleted.** It was never linked from `index.html`; its token block had been
  hand-copied into `styles.css`, so the two could drift and an agent told to "change the person
  colors" could edit the dead file. `styles.css` is now the single stylesheet, and its header
  comment says so (the old comment described a second `:root` that no longer exists).
- **`escape`/`unescape` removed** from `enc`/`dec` in favor of `TextEncoder`/`TextDecoder`. The
  wire format is unchanged — UTF-8 bytes → binary string → base64url — and tests pin it: a link
  produced by the legacy encoder still decodes, and `enc()` output is asserted byte-identical to
  the legacy encoder's for the same input.

## 12. ~~LOW~~ RESOLVED (2026-09-12) — Multi-tab write races

**Fixed by:** a `window.addEventListener("storage", …)` that adopts a sibling tab's config when
`ladder.last` changes — but only when `isIdle(...)` (never mid-workout) and never while a regimen
is the live workout. Full multi-device conflict resolution remains out of scope and is not planned;
newest-wins (#1) covers the sign-in case.

## 13. ~~LOW~~ OBSOLETE — Firestore rules did no schema or size validation

**Status: resolved by the MERN migration (2026-07-20).** Authorization is server-side: `verifyJWT`
per route plus a `userId` filter in every controller query. The size half of this concern became
#16, which is now also closed.

## 14. ~~LOW~~ RESOLVED (2026-09-12) — No README, no LICENSE, no CI

**Fixed by:** `README.md` (what the app is, quick start, layout table, pointers to PROJECT/GAPS/
CLAUDE/deploy), `LICENSE` (MIT), and `.github/workflows/test.yml` — two jobs on push/PR running the
client suite (`npm test`, Node 20) and the server suite (`npm ci` + `npx vitest run` in `server/`).
Tests now protect the repo outside a Claude Code session.

## 15. ~~LOW~~ RESOLVED (2026-09-12) — Minor consistency and robustness nits

- **`npm start` no longer requires Python** — it is `npx --yes http-server -p 8000 -c-1`, the same
  toolchain as `npm run dev`.
- **`esc()` now escapes single quotes** (`&#39;`), so an attribute built with single quotes is safe
  too. Double quotes remain the convention.
- **`confirm()` replaced with an in-app dialog** (`#confirmBox` + `askConfirm()`), styled like the
  account menu, dismissed by Cancel / Esc / backdrop. Nothing blocks the page or automation now.
- **`say()`'s global `speechSynthesis.cancel()` is commented** — deliberate, so a cue never queues
  behind a stale one; clipping other utterances is the accepted trade.
- **`renderCatalog` running `buildPhases` per card** stays as-is — negligible at 5 workouts, and
  noted here in case the catalog ever grows to hundreds.
- **Superseded docs** — `docs/superpowers/` holds point-in-time specs; trust code over docs. The
  rule is stated in CLAUDE.md.

## 16. ~~LOW~~ RESOLVED (2026-09-12) — No size cap on `configJson` / `presetsJson`

**Fixed by:** `state.controller.js` serializes through `serializeCapped()`, rejecting any
config/presets payload whose JSON exceeds **64 KB** with a `413` and a descriptive `error` — and
storing nothing. The largest legitimate document is a few KB.

**Tests:** `server/tests/integration/state.test.js` — oversized config 413s and leaves the stored
config null, oversized presets 413 and leave presets empty, a 40-station config still saves.

---

## Standing risks

Not tasks — accepted properties of the codebase, recorded so the next reader is not surprised.

- **The DOM/render layer of `app.js` is untested.** The pure decisions are extracted and covered
  (#3), but rendering, the settings sheet, and the audio wiring are verified by hand. Anything new
  and testable belongs in `engine.js`.
- **One `draft` global serves two editors** (settings sheet vs. customize screen), disambiguated by
  `sheetFromCustomize`. Every entry point must set that flag; renaming the two into `sheetDraft` /
  `custDraft` was judged a bigger change than the risk warrants (#8).
- **Guest locks are a nudge, not security** (#9).
- **Regimens are still smuggled into the presets document** under the reserved `__regimens__` key.
  This is a known wart with a real fix scoped in
  `docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md` (Tasks 1 and 10) — feature
  work, not a gap fix.
- **Two console errors on load are expected**: `frame-ancestors` is ignored in a `<meta>` CSP (which
  is why `framebust.js` exists), and the `data:` web-app manifest is blocked by `default-src 'self'`.
