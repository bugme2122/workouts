# Accounts, Auth & Landing Page — Design Spec

**Date:** 2026-07-04
**Status:** DRAFT — decisions set to recommended defaults via delegated autonomy (user was away). **Needs user confirmation + console prerequisites before implementation.**
**Depends on:** `2026-07-04-accounts-backend-investigation.md` (chose Firebase).
**Firebase project:** `workout-system-73cf8` (Spark/free), Web SDK **v12.15.0** via CDN ES modules.

---

## Locked-in decisions (recommended defaults — change any before we build)

1. **Provider:** Firebase (Auth + Firestore).
2. **Sign-in method:** **Google only** (popup; no passwords to store/reset). Requires "Google" enabled in the Auth console.
3. **Landing page:** **Welcome → "Sign in with Google" / "Continue as guest".**
4. **Guest mode preserved:** the app works with no login using today's `localStorage` behavior; sign-in is an *upgrade* (cloud sync), never a gate.
5. **v1 sync scope:** the **current workout config + presets**. Workout **history is deferred** (own feature later).

## Prerequisites (user, in Firebase console — code won't work until done)

- **Authentication → Get started → enable Google** provider.
- **Firestore Database → Create database → Production mode →** choose region.
- **Authentication → Settings → Authorized domains:** add `localhost` (dev) and later `<user>.github.io`.

## Non-goals / out of scope (v1)

- Email/password, password reset, account linking, multi-provider.
- Workout history logging/UI.
- Real-time multi-device live updates (we sync on load + on save, not a live socket).
- Server-side code / MongoDB (Firebase client SDK only; no backend).

---

## Architecture

Static app unchanged in shape; Firebase added as **CDN ES-module imports** (no npm/build). New pieces:

- **`firebase-config.js`** — exports the public `firebaseConfig` object (safe to commit; security is via Firestore rules, not secrecy).
- **`auth.js`** (new module) — initializes Firebase lazily, exposes: `onAuth(cb)` (auth-state listener), `signInWithGoogle()`, `signOutUser()`, `currentUser()`. DOM-free except Firebase calls; imported by `app.js`.
- **`store.js`** (new module) — a **pluggable persistence layer** with one interface used by `app.js`:
  - `loadState()` → returns the config to boot with.
  - `saveState(config)` → persists it.
  - `loadPresets()` / `savePresets(obj)`.
  - Two backends behind that interface: **local** (today's `localStorage`, synchronous, always the offline cache) and **cloud** (Firestore, async). When signed in, cloud is source of truth with local as a mirror; when guest, local only.
- **`app.js`** — gains: the landing/auth screens in the `#screen-*` router; wires `auth.js` state to UI (account row + Sign out in settings; landing reflects signed-in/guest); routes `loadConfig`/`persist`/preset save/load through `store.js`. Share links (`#w=`/`#c=`) keep working in both modes.

**Dependency direction:** `app.js → {auth.js, store.js, catalog.js, engine.js}`; `auth.js`/`store.js` → Firebase CDN. `engine.js`/`catalog.js` stay Firebase-free and unit-testable.

### Data model (Firestore)

Per user, keyed by Firebase `uid`:
- `users/{uid}/state/current` → one document: the sanitized config JSON (same shape as `localStorage["ladder.last"]`).
- `users/{uid}/presets/{presetName}` → one doc per preset (or a single `users/{uid}/presets/all` map document — decide in plan; per-doc is cleaner for large sets, a single map is fewer reads for this small app → **use a single map doc** `users/{uid}/data/presets`).

Configs are ~1 KB; reads/writes per session are a handful — far under the free tier (50k reads / 20k writes per day).

### Firestore security rules (per-user isolation — critical)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
No user can read or write another user's data; unauthenticated access is denied. These rules are the real security boundary (the client `apiKey` being public is expected).

## Flows

### Boot
1. `app.js` starts; `auth.js` attaches `onAuthStateChanged`.
2. If a `#w=`/`#c=` share link is present, it still wins (boots straight into Live with that config) regardless of auth — share links are portable.
3. Else: **guest** → `store.local.loadState()` (today's behavior) → Home. **Signed-in** → `store.cloud.loadState()`; if cloud empty but local has data, **migrate** (upload local once), then Home.
4. Landing screen (`#screen-welcome`) shows on first visit / when signed out; a returning signed-in or returning guest can skip straight to Home (remember a "has entered" flag locally).

### Sign in (Google)
`signInWithGoogle()` → Google popup → on success, `onAuth` fires with the user → switch `store` to cloud → load cloud state (or migrate local) → re-render. Show the account (email/name) + **Sign out** in Settings.

### Save
Any `persist()` writes local immediately (offline cache) and, if signed in, writes cloud (debounced ~1–2 s to avoid excess writes). Presets likewise.

### Sign out
`signOutUser()` → `onAuth` fires null → `store` reverts to local → keep the last config locally so the user isn't dumped to defaults.

### First-sign-in migration
If `users/{uid}/state/current` doesn't exist yet and local has a saved config/presets, upload them (so a guest who signs in keeps their setup). If both exist, **cloud wins** (it's the cross-device source of truth); optionally surface a small "keep this device's copy?" choice — deferred, cloud-wins for v1.

## Screens (added to the existing router)

- **`#screen-welcome`** (new landing, shown before Home): brand/logo, one-line tagline, **"Sign in with Google"** button, **"Continue as guest"** button, and (if already signed in) the user's name + **"Enter"**.
- **Settings** gains an **Account** section: signed-out → "Sign in to sync"; signed-in → name/email + **Sign out**.
- No separate email/password screen (Google popup handles it).

## Offline / CSP implications

- **Guest mode stays fully offline** and makes zero external requests (unchanged).
- **Signed-in mode** requires network access to Firebase (Google domains: `*.gstatic.com`, `*.googleapis.com`, `*.firebaseapp.com`). The app's current "no external requests" property is relaxed **only** for signed-in users. The PWA still loads offline for guests; signed-in sync needs connectivity (writes queue to local and reconcile when back online — Firestore's local persistence handles basic offline).

## Testing & verification

- **Unit-testable (node --test):** the `store` backend-selection logic and the guest/local path (pure), plus any config-shape helpers. Firebase calls are mocked/injected so `store.js`'s branching is testable without network.
- **NOT headless-testable:** the real Google popup, live Firestore reads/writes, security-rule enforcement. These require a **real browser + the completed Firebase console setup**. The plan will include a **manual test checklist** (sign in, save on device A, load on device B, sign out reverts to local, rules deny cross-user access via the console Rules Playground).
- The controller's headless workout driver continues to validate the timer itself is unaffected.

## Security & privacy

- Client `firebaseConfig` (incl. `apiKey`) is public by design — safe to commit.
- Firestore rules are the security boundary; they must be deployed before real use.
- Collecting accounts/emails implies minimal privacy hygiene: a short privacy note and an **account-deletion** path (delete the user's Firestore docs + Firebase Auth user) — include a "Delete my data" action in the Account settings. (Small; include in plan.)
- I (the assistant) will not create accounts, enter passwords, or handle secret credentials; the user provisions the project and pastes only the public config.

## Open questions for confirmation

1. Confirm **Google-only** (vs adding Email/password).
2. Confirm the **Welcome → Sign in / Guest** landing (vs minimal / marketing).
3. Confirm **cloud-wins** on first-sign-in migration conflict (vs prompting).
4. OK to relax the strict-offline/no-external-requests property for signed-in users? (Guests stay offline.)
5. Include the small **"Delete my data"** action in v1? (Recommended.)

## Implementation sizing

Bigger than the audio/short-link features: ~3–4 tasks — (1) `firebase-config.js` + `auth.js` + `store.js` interface with the local backend and unit tests; (2) cloud (Firestore) backend + rules + migration; (3) landing + auth UI + settings Account section wiring; (4) integration + manual-test checklist. Each gated by review as usual. Verification of the live Firebase path is manual (browser + console), which the plan will spell out.
