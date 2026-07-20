# Auth Swap → FACS-style JWT (full swap from Firebase Google) — Requirements & Design Spec

**Date:** 2026-07-20
**Status:** DRAFT — requirements for review. No implementation yet.
**Target repo:** `bugme2122/workouts`.
**Source of the approach:** `bugme2122/functional-activity-certification-system` (FACS) — its
`docs/deploy.md` + `server/src/{utils,models,services,middleware,routes,controllers}` auth module
and `client/src/{api,context,routes}` auth glue. This spec **ports FACS's auth approach**, adapted
to workouts' vanilla-JS front end.

---

## 1. Goal

**Full swap** of authentication in `workouts` from **Firebase Google sign-in (popup) + Firestore**
to the **FACS JWT model**: email/password login, short-lived in-memory **access JWT**, rotating
server-side **refresh token**, bcrypt password hashing, role middleware, rate-limited auth routes,
and a fetch client that transparently refreshes on 401.

> "Copy the approach referred to in FACS `deploy.md`" = adopt the same auth architecture, token
> model, storage strategy, and deploy shape (Railway + MongoDB Atlas + Cloudflare, one Express
> service serving API + app under a base path).

---

## 2. The central consequence: workouts gains a backend

`workouts` today is **static & serverless** — vanilla ES modules on GitHub Pages, no build step,
Firebase client SDK for auth + data. FACS auth is **server-enforced** (Express + MongoDB + JWT).
So a full swap **requires standing up a backend** for workouts. This is the biggest change and the
thing to confirm first (see §11 Decision 1).

**Recommended shape (mirrors FACS exactly):**
```
Browser ──▶ (Cloudflare) ──▶ Railway service ── Express ──┬─ /api/*      → auth + data API
                                                          └─ /*          → static workouts app
                                             │
                                             ▼
                                        MongoDB Atlas   (users, refresh tokens, workout state)
```
The current static app is **served by Express** instead of GitHub Pages (or kept on Pages with the
API on its own origin + CORS — see Decision 5).

---

## 3. What gets removed from workouts

| Removed | Replaced by |
|---|---|
| `auth.js` (Firebase `signInWithGoogle`, `onAuthStateChanged`) | `auth.js` rewritten to call `/api/auth/*` (login/refresh/logout) |
| `firebase-backend.js` (Firestore per-uid config/presets) | API-backed store (`/api/state`, `/api/presets`) on the new server |
| `firebase-config.js`, `firestore.rules` | deleted (no Firebase) |
| Firebase SDK CDN imports + `connect-src *.googleapis/*.firebaseio`, `frame-src *.firebaseapp/accounts.google/apis.google` CSP entries in `index.html` | tightened CSP: `connect-src 'self'` (+ API origin if cross-origin) |
| "Sign in with Google" / avatar-from-Google UI (`#signInBtn`, account row) | email/password **login card** + optional **register**; account row shows name/email |

`store.js`'s **`local` (localStorage)** backend and its pluggable-backend seam **stay** — only the
**cloud backend implementation** changes (Firestore → REST). Guest/offline mode is preserved.

---

## 4. Server design — port of FACS auth (adapted role set)

New `workouts/server/` (Express 5, Mongoose 8, `jsonwebtoken`, `bcryptjs`, `express-rate-limit`,
`helmet`), structured like FACS. **Ported near-verbatim** from FACS:

| FACS file | Port | Change |
|---|---|---|
| `utils/tokens.js` | ✅ as-is | access JWT `{sub, roles, email}` @15m; refresh = 48-byte hex, sha256-hashed, 7d, rotated |
| `utils/password.js` | ✅ as-is | bcrypt cost 12, min length 10 |
| `utils/httpError.js`, `asyncHandler.js`, `serializers.js` | ✅ as-is | — |
| `models/User.js` | ✅ adapt | **roles simplified** to `['User','Admin']` (workouts has no Supervisor/Auditor). Keep multi-role array + `role` virtual. `supervisorId` dropped. |
| `models/RefreshToken.js` | ✅ as-is | hashed token + TTL index |
| `services/auth.service.js` | ✅ mostly | `login`/`refresh`/`logout`/`forgot`/`reset` identical token logic. **Add `register`** if self-signup is chosen (Decision 2). |
| `middleware/auth.js` (`verifyJWT`) | ✅ as-is | Bearer → `req.user` |
| `middleware/requireRole.js` | ✅ as-is | kept for future admin-only routes |
| `middleware/rateLimit.js` | ✅ as-is | throttle `/auth/*` |
| `routes/auth.routes.js` + `controllers/auth.controller.js` | ✅ adapt | same endpoints; audit logging optional for v1 (Decision 6) |

**New (workouts-specific) data API** replacing Firestore, all behind `verifyJWT`:
- `GET/PUT  /api/state`   → the user's current workout config (was Firestore `users/{uid}/state/current`)
- `GET/PUT  /api/presets` → the user's presets map (was `users/{uid}/data/presets`)
- `DELETE   /api/account` → delete-all (mirrors `firebase-backend.deleteAll`)
- `GET      /api/users/me`→ profile (used by client session-restore, as FACS does)

Backed by a `WorkoutState` model keyed by `userId` (store config/presets as JSON — same shape the
Firestore backend already used, since it stored `{ json: JSON.stringify(...) }`).

**Env vars** (names, from FACS `.env.example` — values are secrets, never committed): `PORT`,
`MONGODB_URI`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `CLIENT_ORIGIN`,
`TRUST_PROXY`, `AUTH_RATE_LIMIT_MAX`, `NODE_ENV`, `BASE_PATH`, `EMAIL_PROVIDER`.

**First admin:** port FACS's `scripts/create-admin.mjs` (unless self-registration makes it moot).

---

## 5. Client design — port of FACS auth glue to vanilla JS

FACS's client is **React** (`AuthContext`, `ProtectedRoute`, `api/client.js`). Workouts is
**vanilla ES modules** — port the *approach*, not JSX:

- **New `api.js`** — single fetch entry point mirroring FACS `api/client.js`: attaches
  `Authorization: Bearer <access>`, **single-flight refresh-on-401** (one refresh shared across
  concurrent 401s), surfaces server `error` messages. Access token held in a module variable
  (in-memory); refresh token read via callback.
- **Rewrite `auth.js`** — `login(email,password,remember)`, `logout()`, `restore()` (silent
  refresh on load), exposing the current user + an `onChange` hook, replacing the Firebase module's
  surface so `app.js`'s `connectAuth`/`onAuthChange` wiring changes minimally.
- **Token storage (identical strategy to FACS):** access token **in memory only** (XSS
  mitigation); refresh token in **`localStorage` when "Remember me"** else **`sessionStorage`**;
  a page refresh restores the session via `/auth/refresh` → `/users/me`.
- **Rewrite `store.js` cloud backend** — same interface (`loadConfig/saveConfig/loadPresets/
  savePresets/deleteAll`) but implemented over `api.js` (`/api/state`, `/api/presets`) instead of
  Firestore. `decideMigration()` (cloud-wins) is unchanged; guest→signed-in upload still works.
- **Screen guard** — the existing landing/`showScreen` router replaces Google buttons with the
  login card; the app already supports guest mode, so "protected" is soft (guest allowed, sync
  needs login), matching today's UX rather than FACS's hard redirect.

---

## 6. Security requirements (inherited from FACS)

- **SR-1** Passwords: bcrypt cost 12; min length 10; never returned (`passwordHash` `select:false`).
- **SR-2** Access JWT short-lived (15m), in memory only; never in localStorage.
- **SR-3** Refresh tokens: opaque, **stored hashed** (sha256), rotated on every refresh, revoked on
  logout and on password reset; TTL-indexed cleanup.
- **SR-4** Generic auth errors — login never reveals whether email or password was wrong;
  deactivated accounts get a distinct 403.
- **SR-5** Rate-limit `/auth/*` (`AUTH_RATE_LIMIT_MAX`); `helmet` on; `TRUST_PROXY` behind CF/Railway.
- **SR-6** Password-reset tokens signed with per-user secret (`JWT_SECRET + passwordHash`) → single-use.
- **SR-7** Tighten `index.html` CSP once Firebase/Google origins are gone.

---

## 7. Data migration

Firestore and MongoDB are different stores — **existing signed-in users' cloud data does not
auto-migrate.** Mitigations:
- **Guests are unaffected** (localStorage untouched); on first login their local config uploads via
  the existing `decideMigration('upload-local')` path.
- For the (currently tiny) set of Firebase-synced users: either accept a **fresh start** (cloud
  re-seeded from their local cache on first login) or provide a one-time **export from Firestore →
  import to the API**. Recommend fresh-start for v1 given low user count (Decision 4).

---

## 8. Deploy (mirrors FACS `deploy.md`)

- **MongoDB Atlas** M0 cluster; `MONGODB_URI` → `/workouts` db.
- **Railway** service from the repo, root `Dockerfile` (port FACS's), env vars as §4; healthcheck
  `/api/health`.
- **Cloudflare** optional path/subdomain route (port `deploy/cloudflare-worker.js`) — e.g.
  `workouts.<domain>` or `<domain>/workouts` with `BASE_PATH` baked at build + read at runtime.
- Same-origin (Express serves the app) ⇒ **no CORS**; `CLIENT_ORIGIN` belt-and-suspenders.

---

## 9. Testing (match both repos' conventions)

- Server: **Vitest + supertest + mongodb-memory-server** (as FACS) — port FACS's
  `tests/integration/auth.test.js`, `rbac.test.js`, `unit/authMiddleware.test.js`, adapted.
- Client pure logic: keep workouts' `node --test`; add tests for `api.js` refresh-single-flight and
  the token-storage helper (DOM-free parts).

---

## 10. Non-goals (v1)

- Multi-provider / social login (Google/Apple) — the swap **removes** Google on purpose.
- Email delivery for password reset (use FACS's `EMAIL_PROVIDER=stub`; wire real email later).
- Supervisor/Auditor roles, audit-log UI, org hierarchy (FACS domain features not relevant here).
- Real-time multi-device sync (still sync-on-load + on-save).

---

## 11. Decisions needed (defaults chosen where safe)

1. **Backend hosting — CONFIRM.** Full swap requires a server. Default: **new Railway service +
   Atlas DB for workouts**, Express serving API + app (exactly FACS's shape). Alternative: keep the
   app on GitHub Pages and run only an API service (adds CORS). *(Recommend: mirror FACS.)*
2. **Self-registration?** FACS has **none** (admin provisions users). A personal workout app usually
   wants public sign-up. Default: **add `POST /api/auth/register`** (public), keeping everything
   else identical. Alternative: keep FACS's admin-only model + `create-admin` script.
3. **Roles.** Default: collapse FACS's 4 roles to **`['User','Admin']`**, keep `requireRole` for
   future admin routes. Confirm you don't need the full FACS role set.
4. **Firestore data.** Default: **fresh start** (re-seed cloud from local on first login); no
   Firestore→Mongo migration tool. Confirm.
5. **App hosting origin.** Same-origin via Express (no CORS) vs. Pages + separate API (CORS). Tied
   to Decision 1. *(Recommend: same-origin.)*
6. **Audit logging.** Port FACS's login/reset audit logs in v1, or defer. *(Default: defer; keep the
   hooks.)*

---

## 12. Suggested implementation slices (see plan)

1. Scaffold `server/` (Express + Mongo connect + health) — no auth yet.
2. Port auth core (models, utils, service, middleware) + server tests.
3. Auth routes/controllers + rate limit + (optional) register.
4. Data API (`/api/state`, `/api/presets`, `/api/account`, `/users/me`) + `WorkoutState` model.
5. Client `api.js` (Bearer + single-flight refresh).
6. Rewrite `auth.js` (login/logout/restore) + token storage.
7. Rewrite `store.js` cloud backend (Firestore → REST); remove Firebase files.
8. Login/register UI + CSP tightening; remove Google buttons.
9. Dockerfile + Railway + Atlas + optional Cloudflare (port FACS deploy).
