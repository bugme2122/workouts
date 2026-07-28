# Workouts — Deployment (Railway + MongoDB Atlas + Cloudflare `/workouts`)

Single-service deploy: one Railway container runs Express, which serves **both** the API and the
vanilla client. The whole app is mounted under a base path (**`/workouts`**) so it can live at
`https://flywren-technologies.com/workouts` behind a Cloudflare route. Infrastructure is
**separate** from FACS (own Railway project + own Atlas cluster). Accounts are
**admin-provisioned** (no self-registration).

```
Browser ──▶ flywren-technologies.com/workouts/*
            │  (Cloudflare Worker route)
            ▼
        Railway service  ── Docker ──▶  Express (BASE_PATH=/workouts)
            │                              ├─ /workouts/api/*   → API
            │                              ├─ /workouts/base.js → injects window.__BASE__
            │                              └─ /workouts/*       → client (server/public)
            ▼
        MongoDB Atlas
```

## 1. MongoDB Atlas (separate cluster)

1. Create a free **M0** cluster at https://www.mongodb.com/atlas.
2. Create a database user; under **Network Access** allow Railway (simplest: `0.0.0.0/0`, or
   Railway's egress IPs).
3. Copy the SRV connection string and append `/workouts`:
   `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/workouts`

## 2. Railway service (separate project)

1. New Project → **Deploy from GitHub repo** → pick `workouts`. Railway detects the root
   `Dockerfile` (and `railway.json`).
2. **Variables** (Settings → Variables):
   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | your Atlas SRV string (…/workouts) |
   | `JWT_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
   | `TRUST_PROXY` | `true` (Railway + Cloudflare sit in front) |
   | `NODE_ENV` | `production` |
   | `BASE_PATH` | `/workouts` |
   | `CLIENT_ORIGIN` | `https://flywren-technologies.com` |
   | `AUTH_RATE_LIMIT_MAX` | `10` (optional) |
   | `EMAIL_PROVIDER` | `stub` (password-reset email not wired yet) |

   > `BASE_PATH` must match the Dockerfile ARG (`/workouts`) and the Cloudflare route below. To
   > deploy at the root instead, build with `--build-arg BASE_PATH=` and set `BASE_PATH=` empty.

3. Deploy. Healthcheck is `/workouts/api/health`. Note the public URL, e.g.
   `https://workouts-production.up.railway.app` — the app is reachable at `…/workouts`.

## 3. Create the first admin (one time)

There is **no self-registration** — an admin must exist before anyone can log in. Run from your
machine against Atlas:

```bash
cd server
ADMIN_EMAIL="you@flywren-technologies.com" ADMIN_PASSWORD="a-strong-password" \
ADMIN_FIRST="Jane" ADMIN_LAST="Doe" \
MONGODB_URI="<your atlas uri>" npm run create-admin
```
Non-destructive. Log in with that account; add more users from the Administration area (later).

## 4. Cloudflare — route `/workouts` to Railway

Your zone `flywren-technologies.com` must be on Cloudflare.

1. **Workers & Pages → Create → Worker.** Paste `deploy/cloudflare-worker.js`, set
   `RAILWAY_ORIGIN` to your Railway URL, and deploy it.
2. **Add a route:** `flywren-technologies.com/workouts*` → the Worker. Every other path falls
   through to your existing site.
3. Visit **https://flywren-technologies.com/workouts** — the login card loads.

> **Simpler alternative (subdomain):** add a Railway **custom domain**
> `workouts.flywren-technologies.com`, CNAME it in Cloudflare, and deploy with `BASE_PATH=` empty
> (root). No Worker needed.

## 5. Cutover

1. Smoke-test at the new URL: log in (admin), confirm the workout config + presets sync, sign out.
2. Then **decommission**: turn off GitHub Pages for this repo, and delete/disable the old Firebase
   project `workout-system-73cf8`.

## Notes
- Same-origin (client + API on one host) ⇒ **no CORS** in normal use; `CLIENT_ORIGIN` is
  belt-and-suspenders.
- Tokens: access token in memory, refresh token in `localStorage`/`sessionStorage` (Remember me).
- Guests are unaffected by the backend; their local config uploads on first login.
- The server should also send `X-Content-Type-Options: nosniff` and `frame-ancestors 'none'` /
  `X-Frame-Options: DENY` as HTTP headers (meta CSP can't enforce framing).
