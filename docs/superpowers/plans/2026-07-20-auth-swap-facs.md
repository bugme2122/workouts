# Auth Swap → FACS-style JWT — Implementation Plan

> **For agentic workers:** implement task-by-task. Server tasks are independently testable
> (Vitest + mongodb-memory-server); client tasks reuse workouts' `node --test`. Checkbox steps.

**Design spec:** `docs/superpowers/specs/2026-07-20-auth-swap-facs-design.md`.
**Source approach:** `bugme2122/functional-activity-certification-system` (FACS) — port its
`server/src/**` auth module + `client/src/{api,context,routes}` glue, adapted to vanilla JS.

**Goal:** Replace Firebase Google sign-in + Firestore with FACS's JWT auth (access-in-memory +
rotating hashed refresh token, bcrypt, RBAC middleware, rate-limited routes) and an API-backed
store, standing up an Express + MongoDB backend for workouts.

**⚠️ Confirm before Task 1 (spec §11):** backend hosting (new Railway+Atlas, Express serves app),
self-registration yes/no, role set `['User','Admin']`, fresh-start on Firestore data. These change
scope.

## Global constraints
- **Port, don't reinvent** — copy FACS files near-verbatim; adapt only the role set, `supervisorId`
  removal, and the data API.
- **Keep guest/offline** — `store.js` `local` backend and `decideMigration()` are unchanged.
- **No React** — port the client approach into workouts' vanilla ES modules.
- **Secrets never committed** — `.env.example` with names only; real values in Railway.
- **Tighten CSP** only after Firebase/Google origins are removed.

---

### Task 1: Server scaffold (Express + Mongo + health)
**Files:** `server/package.json`, `server/src/index.js`, `server/src/app.js`, `server/src/db.js`,
`server/.env.example`, `server/vitest.config.js`.
- [ ] Express 5 app, `helmet`, JSON body parser, `TRUST_PROXY`, `BASE_PATH` mount.
- [ ] Mongoose connect from `MONGODB_URI`; `GET /api/health` → `{ok:true}`.
- [ ] Vitest + `mongodb-memory-server` harness with one passing health test.

### Task 2: Port auth core (models + utils) + unit tests
**Files:** port `utils/tokens.js`, `utils/password.js`, `utils/httpError.js`,
`utils/asyncHandler.js`, `utils/serializers.js`, `models/User.js` (roles→`['User','Admin']`, drop
`supervisorId`), `models/RefreshToken.js`; `tests/unit/*`.
- [ ] Copy utils verbatim; adapt `User` schema roles/virtual.
- [ ] Unit tests: token sign/verify, refresh hash, bcrypt hash/verify, password validation.

### Task 3: Auth service + middleware + routes/controllers (+ optional register)
**Files:** port `services/auth.service.js`, `middleware/auth.js`, `middleware/requireRole.js`,
`middleware/rateLimit.js`, `routes/auth.routes.js`, `controllers/auth.controller.js`.
- [ ] `login`/`refresh`/`logout`/`forgot-password`/`reset-password` with FACS token logic.
- [ ] `verifyJWT` + `requireRole`; rate-limit `/auth/*`.
- [ ] **If Decision 2 = self-signup:** add `POST /api/auth/register` (public) → creates `User` with
  role `['User']`, issues tokens.
- [ ] Integration tests (supertest): login success/failure, refresh rotation, logout revoke,
  reset flow, rate-limit — ported from FACS `tests/integration/auth.test.js`.

### Task 4: Data API replacing Firestore
**Files:** `models/WorkoutState.js`, `routes/state.routes.js`, `controllers/state.controller.js`,
`routes/users.routes.js` (`/users/me`).
- [ ] `WorkoutState { userId, configJson, presetsJson }` keyed by user.
- [ ] `GET/PUT /api/state`, `GET/PUT /api/presets`, `DELETE /api/account`, `GET /api/users/me` —
  all behind `verifyJWT`; store config/presets as JSON (same shape the Firestore backend used).
- [ ] Integration tests: a user only reads/writes their own state.

### Task 5: Client `api.js` (Bearer + single-flight refresh-on-401)
**Files:** `api.js` (new); `tests/api.test.mjs`.
- [ ] Port FACS `api/client.js`: `Authorization: Bearer`, one shared refresh across concurrent
  401s, surface server `error`, in-memory access token + refresh via callback.
- [ ] DOM-free tests for the single-flight refresh path (mock fetch).

### Task 6: Rewrite `auth.js` (login/logout/restore) + token storage
**Files:** `auth.js` (rewrite).
- [ ] `login(email,password,remember)`, `logout()`, `restore()` (silent `/auth/refresh` →
  `/users/me` on load), `onChange` hook — API surface close to today's so `app.js` wiring changes
  little.
- [ ] Token storage: access **in memory**; refresh in `localStorage` (remember) else
  `sessionStorage`; port FACS's persist/read/clear helpers.

### Task 7: Rewrite `store.js` cloud backend + remove Firebase
**Files:** `store.js` (cloud backend), delete `firebase-backend.js`, `firebase-config.js`,
`firestore.rules`; update `app.js` imports.
- [ ] Cloud backend implements the existing interface over `api.js` (`/api/state`,`/api/presets`).
- [ ] `local` backend + `decideMigration()` unchanged; guest→login upload still works.
- [ ] Remove Firebase modules and their imports.

### Task 8: Auth UI + CSP
**Files:** `index.html`, `app.js`, `styles.css`.
- [ ] Replace `#signInBtn` "Sign in with Google" / account-row Google bits with an email/password
  **login card** (+ **register** if enabled, + "Remember me"), inline errors.
- [ ] Rewire `connectAuth`/`onAuthChange`/`signOut` to the new `auth.js`.
- [ ] Tighten CSP: drop `*.googleapis`/`*.firebaseio`/`*.firebaseapp`/`accounts.google`/
  `apis.google`; `connect-src 'self'` (+ API origin if cross-origin).

### Task 9: Deploy (port FACS)
**Files:** `Dockerfile`, `railway.json`, `deploy/cloudflare-worker.js`, `docs/deploy.md`.
- [ ] Port FACS Dockerfile: build static app, Express serves API + app under `BASE_PATH`.
- [ ] Railway + Atlas env; healthcheck `/api/health`; port `create-admin` script (if admin model).
- [ ] Optional Cloudflare route (subdomain or path); document in `docs/deploy.md`.

---

## Test plan
- Server unit (Task 2) + integration (Tasks 3–4) via Vitest + supertest + mongodb-memory-server.
- Client `node --test` for `api.js` single-flight refresh (Task 5).
- Manual: guest → register/login → sync config across a refresh → logout revokes refresh token.

## Out of scope (v1)
Google/social login, real email for reset, Supervisor/Auditor roles + audit UI, Firestore→Mongo
migration tooling, real-time multi-device sync.
