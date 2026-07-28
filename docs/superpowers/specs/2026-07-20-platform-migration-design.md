# Platform Migration — static/Firebase → Railway + MongoDB (server-backed) — Tech Spec

**Date:** 2026-07-20
**Status:** APPROVED (v1 scope) — hosting/backend decisions locked (§3). Auth details in the
companion spec `2026-07-20-auth-swap-facs-design.md`.
**Target repo:** `bugme2122/workouts`.
**Reference implementation:** `bugme2122/functional-activity-certification-system` (FACS) —
`docs/deploy.md`, root `Dockerfile`, `railway.json`, `deploy/cloudflare-worker.js`, `server/**`,
`client/**`.

---

## 1. Goal

Fundamentally change how `workouts` is hosted and backed: move from a **static, serverless** app
(vanilla ES modules on **GitHub Pages** + **Firebase** Auth/Firestore) to a **single-service,
server-backed** app — **Express serving both the API and the app**, backed by **MongoDB Atlas**,
deployed on **Railway** behind a **Cloudflare** route at **`flywren-technologies.com/workouts`** —
mirroring the FACS deployment model exactly.

This spec owns the **platform** (hosting, backend runtime, data store, build/serve, deploy,
cutover). The **auth swap** (Firebase Google → JWT) is a sub-epic with its own spec/plan.

---

## 2. Current vs target architecture

**Current**
```
GitHub Pages (static)  ──▶  index.html + ES modules (no build)
                            └─ Firebase JS SDK ──▶ Firebase Auth (Google) + Firestore
```

**Target (mirrors FACS)**
```
Browser ─▶ flywren-technologies.com/workouts/*
           │  Cloudflare Worker route  (deploy/cloudflare-worker.js)
           ▼
       Railway service ── Docker ──▶ Express (BASE_PATH=/workouts)
           │                          ├─ /workouts/api/*  → auth + data API
           │                          └─ /workouts/*      → the app (static assets)
           ▼
       MongoDB Atlas   (users, refresh tokens, workout state/presets)
```

---

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Hosting stack** | **Mirror FACS** — Railway (one service, Express serves API + app) + MongoDB Atlas + Cloudflare. |
| 2 | **URL** | **Path**: `flywren-technologies.com/workouts` via a Cloudflare Worker; `BASE_PATH=/workouts` (baked at build **and** read at runtime, as FACS does). |
| 3 | **Self-registration** | **No** — admin-provisioned only. Port FACS's `create-admin` script; no `/auth/register`. |
| 4 | **Infrastructure** | **Separate** — own Railway project + own Atlas cluster (or at minimum a dedicated DB) + own secrets. No coupling to FACS infra. |
| 5 | **Data** | **Fresh start** — no Firestore→Mongo migration tool; guests' localStorage uploads on first login (existing `decideMigration`). |
| 6 | **Build** | Introduce a minimal build so `BASE_PATH` can be baked into the app and assets served under `/workouts` (see §6). |

---

## 4. Epics (this migration)

Tracked under a parent epic; the auth swap is reused, not duplicated.

- **E0 — Parent: Platform Migration** (tracking).
- **E1 — Backend foundation & runtime.** Express app, Mongo connection, config/env, `helmet`,
  `TRUST_PROXY`, `BASE_PATH` mount, `/api/health`, test harness. *(Overlaps Auth Task 1 — that
  server scaffold is the concrete first deliverable of this epic.)*
- **E2 — Auth swap → JWT** = **existing Epic #9** (admin-only per Decision 3). Included as a
  sub-epic; no new issues here.
- **E3 — Data layer on Mongo & Firebase decommission.** `WorkoutState` model + `/api/state`,
  `/api/presets`, `/api/account`; rewrite `store.js` cloud backend to REST; delete
  `firebase-backend.js`, `firebase-config.js`, `firestore.rules`; remove Firestore from CSP.
  *(Config/presets endpoints overlap Auth Task 4/7; this epic owns the Firebase removal + cutover.)*
- **E4 — Serve the app under the `/workouts` subpath.** Today the app assumes it lives at the
  site root (GitHub Pages). After migration Express serves it under `/workouts`. This epic makes
  every URL the app relies on — assets, API calls, PWA manifest/icons/service-worker — resolve
  correctly under that subpath, with `BASE_PATH` supplied at serve time (no hardcoding) so the same
  code runs at root locally and under `/workouts` in prod.
- **E5 — Infra provisioning, deploy & cutover.** Port FACS `Dockerfile` + `railway.json`; create
  Railway project + Atlas cluster + secrets; Cloudflare Worker route for `/workouts*`; healthcheck;
  `create-admin`; smoke test; **decommission GitHub Pages + Firebase project**.

Dependency order: **E1 → (E2, E3) → E4 → E5**.

---

## 5. Backend runtime (E1)

Node ESM, **Express 5**, **Mongoose 8**, `helmet`, `express-rate-limit` — same deps as FACS.
Layout ported from FACS: `server/src/{app.js,index.js,db.js,config.js,routes,controllers,services,
middleware,models,utils}`. `BASE_PATH` mounts the whole app (API + static) under `/workouts`.
Health at `/workouts/api/health`. Tests: **Vitest + supertest + mongodb-memory-server**.

## 6. Serve the app under the `/workouts` subpath (E4)

The app stays **no-build** vanilla ESM. The only real problem to solve is that it currently assumes
it lives at `/` and will now be served by Express under `/workouts`. Four things must resolve under
that subpath:

1. **Assets** (scripts, styles, icons): set the page's base once — a single `<base href="/workouts/">`
   tag (or an injected `window.__BASE__` constant) — so relative references load from `/workouts/…`
   rather than `/…`.
2. **API base**: the app's data calls target `/workouts/api/*` (the base `api.js` uses, from E2/E3).
3. **PWA**: the web-app manifest's `start_url`/`scope` and icon paths must sit under `/workouts`, or
   "Add to Home Screen" and the service-worker scope break.
4. **Runtime injection, not hardcoding**: Express injects the `BASE_PATH` value into `index.html`
   when it serves it (string-replace a placeholder), so the same source runs at `/` locally and at
   `/workouts` in prod — no build step, matching the app's existing no-build nature.

Express serves the files via `express.static` under `BASE_PATH` and serves the injected
`index.html` for the app entry.

> CSP tightening and removing the Firebase/Google client bits are **not** here — they live in E2
> (Google sign-in UI) and E3 (Firestore/CSP), to keep this epic strictly about the subpath.

## 7. Data layer (E3)

`WorkoutState { userId, configJson, presetsJson }` keyed by the JWT user (config/presets stored as
JSON strings — same shape the Firestore backend used). `store.js` keeps its `local` (localStorage)
backend + `decideMigration()`; only the **cloud** backend swaps Firestore → REST via `api.js`.
Then **remove all Firebase**: modules, config, `firestore.rules`, and `*.googleapis`/`*.firebaseio`/
`*.firebaseapp`/`accounts.google`/`apis.google` from the CSP.

## 8. Deploy & cutover (E5), mirroring FACS `deploy.md`

1. **Atlas** M0 cluster (separate); `MONGODB_URI` → `/workouts` db; network access for Railway.
2. **Railway** project (separate) from the repo; root `Dockerfile` + `railway.json`. Variables:
   `MONGODB_URI`, `JWT_SECRET`, `TRUST_PROXY=true`, `NODE_ENV=production`, `BASE_PATH=/workouts`,
   `CLIENT_ORIGIN=https://flywren-technologies.com`, `AUTH_RATE_LIMIT_MAX`, `EMAIL_PROVIDER=stub`.
   Healthcheck `/workouts/api/health`.
3. **First admin** via ported `npm run create-admin` (no self-registration).
4. **Cloudflare** Worker (port `deploy/cloudflare-worker.js`, set `RAILWAY_ORIGIN`) + route
   `flywren-technologies.com/workouts*` → Worker.
5. **Cutover:** smoke-test login + sync at the new URL, then **decommission** GitHub Pages for the
   repo and the **Firebase project** (`workout-system-73cf8`).

## 9. Security (inherited)

All FACS auth security items (bcrypt cost 12, in-memory access JWT, hashed rotating refresh tokens,
generic auth errors, rate-limited `/auth/*`, `helmet`, `TRUST_PROXY`) — see the auth spec §6.
Same-origin (Express serves the app) ⇒ **no CORS** in normal use.

## 10. Non-goals (v1)

Self-registration, Google/social login, real password-reset email, multi-region, real-time sync,
CI/CD pipeline beyond Railway's build, Firestore→Mongo migration tooling.

## 11. Risks

- **Base-path correctness** (PWA manifest, service-worker scope, icons, asset URLs, API base) is
  the most error-prone part of a `/path` deploy — dedicated attention in E4 + smoke test in E5.
  Runtime injection (not a build step) keeps the app's no-build nature intact.
- **Cutover** is user-visible: verify before decommissioning Pages/Firebase (E5 ordering).
