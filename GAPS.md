# GAPS.md — Honest audit of weaknesses

_Written 2026-07-10 from a full read of the codebase. Ordered by severity, most important first. Each item says what, where, why it matters, and a small, self-contained suggested fix. Severity scale: CRITICAL / HIGH / MEDIUM / LOW._

---

## 1. HIGH — Cloud-wins sync can silently destroy local data on sign-in

**What:** When a user signs in, `decideMigration()` makes the cloud config win whenever *any* cloud config exists — with no timestamp, no comparison, no prompt. Presets are worse: if the cloud has *any* presets, they wholesale overwrite the local preset store (`store.local.savePresets(cp)`), discarding every preset created locally since the last sync.
**Where:** `store.js:15-19` (`decideMigration`), `app.js:69-73` (preset branch in `onAuthChange`).
**Why it matters:** Real scenario: user customizes a workout and saves 3 presets as a guest on a new phone, then signs in → all of it is silently replaced by a possibly months-old cloud snapshot. There is no undo.
**Update (2026-08-29):** addressed by Task 3 of the custom-workouts plan (`docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md`), which merges rather than replaces.
**Fix (small):** Merge presets by key instead of replacing (`{...local, ...cloud}` and upload the merge). For config, add an `updatedAt` timestamp to the saved JSON in both `store.local.saveConfig` and `cloudBackend.saveConfig`, and make `decideMigration` prefer the newer one. Both behaviors are already unit-tested (`tests/store.test.mjs`) — extend those tests first.

## 2. ~~HIGH~~ OBSOLETE — `firebase-config.js` is simultaneously tracked, gitignored, and blocked by the commit hook

**Status: resolved by the MERN migration (2026-07-20).** `firebase-config.js` no longer exists;
there is no public Firebase key to reconcile. Secrets now live in `server/.env` (gitignored), and
`npm run dev:local` needs none of them. The pre-commit `apiKey` hook is still live and still
correct — it now guards a file set that genuinely shouldn't contain keys. The old key remains in
git history below the `archive/firebase-era` tag; it was rotated and the project is deleted, so
nothing is exposed. No action.

## 3. HIGH — `app.js` (the entire UI, timer, boot, and sync orchestration) has zero tests

**What:** 37 tests cover engine/catalog/store, but nothing exercises the ~640-line integration layer: the rAF timer loop with leftover-carrying phase advance, the boot/`freshShare` branches, `onAuthChange`'s idle-gating, the settings-sheet dual mode (`sheetFromCustomize`), guest catalog locking, or any rendering.
**Where:** `app.js` (all of it); `tests/` (absence).
**Why it matters:** These are the paths users actually hit, and they contain the app's subtlest state (see items 5, 8). Refactors of app.js currently fly blind; the render-cache keys (`_pcardKey`, `_contentSig`) are exactly the kind of invariant a test should pin.
**Fix (small, incremental):** Don't try to test the DOM wholesale. Step 1: extract the pure decision helpers out of app.js into engine.js or a new `flow.js` — e.g. a `decideBoot(hash, hasLocal)` → `{screen, config-source, clearHash}` function and an `isIdle(activeScreen, running, freshShare)` predicate — and unit-test those. Each extraction is a single safe task.

## 4. MEDIUM — Uncommitted work-in-progress sitting in the working tree

**What (updated 2026-08-29):** Mostly cleared. The Firebase key is gone (item 2), and the welcome
redesign that replaced the "Sign in" chip is committed and verified end to end. What remains
untracked is only ambiguous-ownership scratch: `image.png` (a 64KB reference screenshot),
`prompt.md` (an agent-pipeline template, not app docs), `.claude/` (session settings incl. the
pre-commit hook), and `ScottPlan-2026-08-29.md` (superseded — the same plan is now committed at
`docs/superpowers/plans/2026-08-29-custom-workouts-and-logging.md`).
**Where:** `git status`.
**Why it matters:** Low now. `.claude/` is the one that actually matters: it holds the secret-scanning
pre-commit hook, so it protects nobody until it is committed and shared.
**Fix (small):** Commit `.claude/` so the hook travels with the repo; gitignore `image.png` and the
root `ScottPlan-*.md`; decide whether `prompt.md` belongs in `docs/`.

## 5. MEDIUM — A share link opened by an existing user half-applies

**What:** On boot, `loadConfig()` decodes a `#w=`/`#c=` hash into `config` unconditionally. But the boot logic only honors the link as a deep-link when localStorage is empty (`freshShare`). For a returning user the hash is stripped as "stale" and the welcome screen shows — yet the in-memory `config` is now the shared one, and the next `persist()` (e.g. opening settings and hitting Save) writes it over their own saved workout without them ever choosing it.
**Where:** `app.js:18-23` (`loadConfig`), `app.js:531-546` (boot).
**Why it matters:** Inconsistent semantics — the link is neither applied (no navigation) nor ignored (config replaced). Silent config loss for the user's own workout.
**Fix (small):** In the non-`freshShare` boot path, reload config from localStorage (ignore the hash entirely): `if (bootedFromShare && !freshShare) { config = sanitize(migrate(store.local.loadConfig() || clone(DEFAULT))); … }`. Alternatively (bigger): prompt "Load shared workout?" — but the one-liner restores consistency.

## 6. MEDIUM — All cloud failures are swallowed silently

**What:** Every Firestore/auth call is wrapped in `catch(()=>{})` or `catch(e){}` — debounced config saves, preset saves, `deleteAll`, the entire `onAuthChange` cloud block. A signed-in user whose writes fail (rules change, quota, offline) believes they're synced. The one exception (`reportSignInError`) exists precisely because a blanket catch once hid a real `auth/internal-error` — its comment says "never do that again," yet the save path still does exactly that.
**Where:** `app.js:36-41` (`cloudSaveConfig`/`cloudSavePresets`), `app.js:52-74`, `app.js:594-600`, `firebase-backend.js` callers.
**Why it matters:** Undetectable data-loss for the app's headline feature (sync). Also makes support/debugging impossible.
**Fix (small):** Minimum viable: `console.warn("cloud save failed", e)` in each catch. Better one-task fix: a tiny sync-status dot on the identity chip (green = last save ok, amber = failed) driven by the promise results — no new dependencies needed.

## 7. MEDIUM — Timer behavior in a backgrounded tab: cue burst and skipped feedback

**What:** The loop uses `requestAnimationFrame`, which stops in hidden tabs. Wall-clock accounting is correct (elapsed time is subtracted on resume), but the catch-up `while` loop calls `enterPhase()` for every missed phase, firing a rapid burst of beeps/speech, and no cues at all were heard while hidden.
**Where:** `app.js:260-278` (`loop`), phase advance at 271-276.
**Why it matters:** A group-workout timer is exactly the app someone switches away from; audio is its primary output.
**Fix (small):** Two independent tasks: (a) in the catch-up loop, only call `enterPhase` for the final phase landed on (skip intermediate ones); (b) add a `visibilitychange` handler that recomputes and re-renders immediately on return (the wake-lock re-acquire handler at `app.js:122` is the place to hook).

## 8. MEDIUM — The `draft`/settings-sheet state machine is fragile

**What:** One mutable module-global `draft` is shared by two different editors (settings sheet editing `config`, customize screen editing a catalog workout), disambiguated only by the `sheetFromCustomize` boolean. `renderPresets`'s Load button does `draft = migrate(ps[n])` **without `sanitize`** — the only config path in the app that skips it (Apply does sanitize later, but the sheet re-renders unsanitized data first, and customize-mode Apply only clamps people).
**Where:** `app.js:311-313`, `app.js:392` (preset load), `app.js:412-422` (Apply), `app.js:522` (`openCustomizeEditor`).
**Why it matters:** Any new entry point that forgets the flag or the sanitize step corrupts the wrong object. Presets from the cloud are semi-trusted (another device, older schema).
**Fix (small):** Change line 392 to `draft = sanitize(migrate(ps[n]))`. Separately consider renaming the two flows' state (`sheetDraft` vs `custDraft`) — bigger, optional.

## 9. LOW–MEDIUM — Guest workout-locking is client-side only

**What:** `GUEST_FREE = 2` hides catalog workouts behind "Sign in to unlock," but all workout data ships in `catalog.js` and the lock is a CSS class; anyone can read the source or craft a `#w=tabata` link (decShare has no lock check) to use a "locked" workout as a guest.
**Where:** `app.js:431-458` (`renderCatalog`), `catalog.js:62-105`.
**Why it matters:** Only matters if anyone ever treats this as monetization or real gating. As a sign-in nudge it's fine.
**Fix (small):** Document the intent (a comment: "nudge, not security"). If real gating is ever wanted, it requires server-side delivery of catalog content — an architecture change; don't attempt it client-side.

## 10. LOW — Boolean config fields are never sanitized; engine defaults drift from catalog defaults

**What:** `sanitize` clamps numbers and coerces strings/arrays but passes `voice/ticks/haptics/keepAwake/halfChime` through untouched (a crafted config can carry `voice: "yes"` — truthy, survives). `migrate`'s fallback `DEFAULTS` in engine.js and the subset app.js passes to `setDefaults` both omit `haptics`/`keepAwake`, so a legacy/crafted config missing `keepAwake` ends up `undefined` (falsy) even though the product default (`catalog.js` DEFAULT) is `true` — the screen sleeps mid-workout.
**Where:** `engine.js:66` (DEFAULTS), `engine.js:86-117` (sanitize), `app.js:12` (setDefaults call).
**Why it matters:** Edge-case only (normal save paths write complete configs), but it contradicts the "sanitize is the trust boundary" design.
**Fix (small):** In `sanitize`, coerce the five booleans with `c.x = c.x === undefined ? DEFAULTS.x : !!c.x`, and add `haptics: false, keepAwake: true` to both engine DEFAULTS and the `setDefaults` call. Add matching tests to `tests/engine.test.mjs`.

## 11. LOW — Dead code and duplicate sources of truth

**What:** (a) `design-tokens.css` is not linked from `index.html`; its token block was hand-copied into `styles.css`, so the two can drift. Its `[data-theme=…]` selectors are used by nothing (JS sets CSS vars directly). (b) `engine.js` `enc`/`dec` use deprecated `escape`/`unescape`. (c) `styles.css` header comment claims "the original inline `:root` … follows it" but only a one-line `--brand` rule remains.
**Where:** `design-tokens.css` (whole file), `engine.js:34-46`, `styles.css:1-7`.
**Why it matters:** Drift and confusion — an agent told to "change the person colors" may edit the dead file. `escape`/`unescape` still work everywhere but are officially deprecated (Annex B).
**Fix (small):** Either delete `design-tokens.css` or link it and delete the duplicated block from `styles.css` (linking is truer to its "single source of truth" comment). Replace `escape`/`unescape` with `TextEncoder`/`TextDecoder`-based base64 **only with the round-trip tests green** — existing `#c=` links must keep decoding (encode format must stay byte-identical: UTF-8 → binary string → btoa).

## 12. LOW — Multi-tab and multi-device write races

**What:** Two open tabs (or two devices) each hold an in-memory `config`, write localStorage on every change, and race the 1.2s-debounced Firestore write. Last write wins with no detection; there's no `storage` event listener, so tabs never see each other's changes.
**Where:** `app.js:24-41`, `store.js`.
**Why it matters:** Low frequency in practice (one shared phone driving a workout), but sync makes it more likely over time.
**Fix (small):** Add a `window.addEventListener("storage", …)` that reloads config when `ladder.last` changes and the app is idle (reuse the `idle` condition from `onAuthChange`). Full conflict resolution is out of scope.

## 13. ~~LOW~~ OBSOLETE — Firestore rules do no schema or size validation

**Status: resolved by the MERN migration (2026-07-20).** `firestore.rules` is gone. Authorization
is now server-side: `verifyJWT` per route plus a `userId` filter in every controller query. The
*spirit* of this gap survives as a new concern, though — the API does not yet cap the size of
`configJson`/`presetsJson`, so a compromised session can still stash a large blob. Tracked as #16.

## 14. LOW — No README, no LICENSE, no CI

**What:** The repo has no README.md (this file set now partially fills that role), no license, and nothing runs the tests automatically (no GitHub Actions).
**Where:** repo root; `.github/` (absent).
**Why it matters:** Tests only protect what gets run. The pre-commit hook only exists inside Claude Code sessions.
**Fix (small):** One task: add `.github/workflows/test.yml` running `node --test` on push (Node 20+). Another: a 20-line README pointing at PROJECT.md.

## 15. LOW — Minor consistency and robustness nits

- **`npm start` requires Python** (`python -m http.server`) while `npm run dev` uses npx live-server — two toolchains for one job. Fix: make `start` use `npx --yes http-server -p 8000` or document the Python requirement. (`package.json:6-7`)
- **`esc()` doesn't escape single quotes** (`app.js:396`). Currently safe because all generated attributes use double quotes, but it's a one-character landmine for future templates. Fix: add `.replace(/'/g,"&#39;")`.
- **`confirm()` for cloud deletion** (`app.js:596`) — a blocking native dialog, inconsistent with the app's sheet-based UI, and it blocks automation/testing. Fix: reuse the account-menu styling for a small in-app confirm.
- **`say()` calls `speechSynthesis.cancel()` globally** (`app.js:115`) — cancels any other speech on the page/OS-level utterances queued by the app itself; deliberate (cues must not queue up) but worth a comment.
- **`renderCatalog` runs `buildPhases` per card on every auth change** (`app.js:441`) — negligible now (5 workouts), becomes visible if the catalog grows to hundreds. No action needed today.
- **Docs describe superseded behavior** — e.g. the share-links spec says "the URL always reflects the current workout," but commit 7bb5e9b removed URL-writing on save. The `docs/superpowers/` specs are point-in-time; trust code over docs. Fix: add a one-line "superseded by" note at the top of that spec.

---

## 16. LOW — No size cap on `configJson` / `presetsJson`

**What:** `PUT /api/state` and `PUT /api/presets` stringify whatever the client sends and store it
with no length check. Inherited from old #13 (Firestore rules had the same hole).
**Where:** `server/src/controllers/state.controller.js`.
**Why it matters:** A compromised or hostile session can stash arbitrary data in its own document.
Per-user scoping means it can't touch anyone else, so this is a quota/cost concern, not a breach.
**Fix (small):** Reject bodies whose serialized form exceeds a cap (~50 KB is generous — the
largest legitimate config is a few KB) with a 413, and add an integration test for it.

---

_Audit refreshed 2026-08-29: items #2 and #13 closed by the migration off Firebase; #16 added.
Items #1, #3, #5, #6, #7, #8, #9, #10, #11, #12, #14, #15 stand as written._
