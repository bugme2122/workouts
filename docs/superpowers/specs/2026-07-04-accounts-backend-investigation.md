# Accounts + Backend Investigation (Landing page, Sign-up, Auth)

**Date:** 2026-07-04
**Status:** Investigation / decision doc — NOT yet a spec or plan. Needs a few decisions (below) before we brainstorm the real design.
**Prompted by:** "Plan a home/landing page before the circuit page, plus sign-up and auth. I have MongoDB Atlas; also want to investigate Firebase and what I'd need."

---

## 1. The core constraint

Today the app is a **100% static, serverless site** — plain HTML/CSS/ES-module JS, relative paths, hostable on GitHub Pages, no build step, no dependencies. All state lives in `localStorage` and the URL (`#w=`/`#c=` share links).

**Real authentication cannot be done in pure client-side JS.** There is no server to validate a password against, no safe place to store credentials, and any client-only "login" is trivially bypassed by reading the (public) static source. So adding real accounts means introducing a backend or a managed auth provider. This is an architectural change, not a screen you can add in isolation.

## 2. Critical finding — MongoDB's client-facing stack is end-of-life

MongoDB retired the pieces that used to let a browser app talk to Atlas or get auth "for free":

- **Atlas App Services, Atlas Data API, and Custom HTTPS Endpoints — end-of-life Sept 30, 2025.**
- **Atlas Device Sync / Atlas Device SDKs (formerly Realm) — end-of-life Sept 30, 2025.**

Consequence: you **cannot** point the static app straight at MongoDB Atlas anymore, and Atlas no longer ships a built-in auth/user system. To use the MongoDB Atlas you already have, you must **run your own backend** (a small serverless API) that (a) handles auth or delegates it to an auth provider, and (b) does the database reads/writes to Atlas using a server-side driver + secret connection string. The browser never touches Atlas directly.

Firebase (and Supabase) are the opposite: they are **designed to be called directly from a static browser app**, with a built-in user/auth system and per-user database security rules — no server code required.

## 3. What "accounts" would actually buy this app

The likely purpose (given you want a real database) is **cross-device persistence**: sign in on your phone and on the gym big-screen and see the same saved workouts / presets / (future) history, instead of today's per-device `localStorage`. Auth is the means; the payoff is a synced, per-user store of configs. Everything the app needs to store is tiny JSON (a config is ~1 KB), so data volume and cost are negligible.

> Note: even with accounts, keep a **"continue as guest"** path — the app should still work with no login, using today's local behavior. Auth becomes an *upgrade* (sync), not a gate.

## 4. Options compared

| | **A. Firebase (Auth + Firestore)** | **B. MongoDB Atlas + your own backend** | **C. Supabase (Auth + Postgres)** |
|---|---|---|---|
| Talks directly from static browser? | **Yes** (client SDK) | **No** — needs a serverless API in front | **Yes** (client SDK) |
| Built-in auth (email + Google/Apple)? | **Yes** | No — add an auth provider or roll your own on the backend | **Yes** |
| Server code you must write/host? | **None** | A backend API (Vercel/Netlify/Cloud Run functions) + secret Atlas connection string | None |
| Uses the Atlas you already have? | No (Google Cloud) | **Yes** | No (its own Postgres) |
| Per-user data security | Firestore security rules (declarative) | You enforce it in your API | Row-Level Security (SQL policies) |
| Free tier fit for this app | **Huge headroom** (see §5) | Atlas free M0 cluster + free serverless tier | Generous free tier |
| Effort to ship | **Lowest** | **Highest** (extra service to build, deploy, secure) | Low |
| Works on GitHub Pages | Yes (add your `*.github.io` domain to Firebase authorized domains) | Yes (static site calls your API host) | Yes |
| Vendor lock-in / portability | Google; data is JSON, exportable | Standard MongoDB; most portable | Open-source, self-hostable |

**Hybrid worth knowing about:** Firebase Auth (just for login) + MongoDB Atlas (for data via your own API). You get Google/Apple sign-in cheaply *and* keep data in Mongo — but you still pay the "own-a-backend" cost of Option B, so it only makes sense if you specifically want data in Atlas.

## 5. Free-tier reality (this app will not come close to paying)

- **Firebase Spark (free):** Authentication up to **50,000 monthly active users** (email + social); Firestore **50,000 reads / 20,000 writes per day** and **1 GB** stored. A single user saving/loading workouts makes a handful of reads/writes per session — you'd need thousands of daily users to approach the limits.
- **MongoDB Atlas M0 (free):** 512 MB shared cluster — fine for tiny JSON configs; the cost/effort is the *backend you must run*, not the database.

## 6. Recommendation

**Use Firebase (Auth + Firestore)** for this app.

Rationale: it's the only option that adds accounts + cross-device sync **without introducing a backend to build, deploy, and secure**, it's free at our scale, it drops into a static GitHub-Pages site, and its security rules give clean per-user isolation. Your existing MongoDB Atlas is a great tool, but because its client/BaaS layer is now EOL, using it here means building and hosting a whole API service — a lot more work for no user-visible benefit on an app that stores ~1 KB of JSON per person.

Pick **MongoDB Atlas + a serverless backend** instead only if you specifically want the data to live in Mongo (e.g. to reuse it in other Mongo-based projects) or want richer server-side queries/analytics later. If so, the cleanest shape is: **Firebase Auth for login → a small serverless function verifies the Firebase ID token → reads/writes Atlas.**

## 7. What you'd need — Firebase path (concrete checklist)

Steps marked **(you)** involve creating an account / a project / entering credentials — those are yours to do; I won't create accounts or handle your credentials. Steps marked **(me)** are code I can scaffold once the project exists.

1. **(you)** Create a Firebase project at the Firebase console (free Spark plan).
2. **(you)** Enable Authentication → sign-in methods: **Email/Password** and/or **Google** (Google is one click for users, no password handling).
3. **(you)** Create a **Firestore** database (production mode).
4. **(you)** In Auth settings, add your dev origin (`localhost`) and your `*.github.io` domain to **Authorized domains**.
5. **(you)** Copy the project's **web config** object (apiKey, authDomain, projectId, …) and paste it to me. *This config is safe to commit in client code — it is an identifier, not a secret; security is enforced by Firestore rules, not by hiding the key.*
6. **(me)** Add the Firebase modular SDK via CDN ES-imports — but the app's strict CSP/offline story changes: Firebase requires network calls to Google, so the "works fully offline / zero external requests" property is relaxed for signed-in users (guest mode stays local/offline). We'll load `firebase-app`, `firebase-auth`, `firebase-firestore` from `gstatic` CDN.
7. **(me)** New `auth.js` module: sign-in/up/out, current-user state, guest mode.
8. **(me)** New persistence layer: when signed in, read/write the user's config doc at `users/{uid}/state/current` (and `users/{uid}/presets/*`); when guest, use today's `localStorage`. On first sign-in, offer to **import the local config into the cloud**.
9. **(me)** Firestore **security rules** so each user can read/write only their own docs: `match /users/{uid}/{doc=**} { allow read, write: if request.auth.uid == uid; }`.
10. **(me)** Landing page + auth screens wired into the existing screen router (`showScreen`).

**MongoDB path adds, instead of 6–9:** build a serverless API (auth-token verification + Atlas driver), store the Atlas connection string as a server secret, deploy it (Vercel/Netlify/Cloud Run), and point the app at it. Materially more work.

## 8. How the current app changes (either path)

- **New landing screen** before Home: brand + "Sign in" and "Continue as guest" (guest = today's behavior). Fits the existing `#screen-*` router.
- **New auth screen(s):** sign in / sign up (or a single Google button).
- **Persistence becomes pluggable:** the current `loadConfig`/`persist` get a cloud backend when signed in, `localStorage` when guest. Share links (`#w=`/`#c=`) keep working regardless.
- **Presets** move from `localStorage` to per-user cloud docs when signed in.
- This becomes its own brainstorm → spec → plan → implementation cycle (it's a bigger change than the audio/short-link features).

## 9. Open decisions before we build

1. **Provider:** Firebase (recommended) vs MongoDB Atlas + serverless vs Supabase.
2. **Sign-in methods:** Google-only (simplest, no passwords) vs Email/Password vs both.
3. **Landing page style (still unanswered):** (a) minimal "Welcome + Start", (b) "Welcome + Sign in / Continue as guest", or (c) a fuller marketing page. Recommend (b) since we're adding auth.
4. **Is guest mode required?** (Strongly recommend yes — keeps the app usable with zero friction.)
5. **What syncs:** just the current workout + presets (recommended v1), or also a workout **history** log (a new feature)?

## 10. Security & privacy notes

- A static site's JS is always public; that's fine. Firebase/Supabase security is enforced by **server-side rules**, not by secrecy of the client config.
- I will not create accounts, enter passwords, or handle your DB/connection-string credentials — those steps stay with you. I scaffold code and rules; you provision the project and paste the *public* web config.
- Collecting user emails/accounts introduces privacy obligations (a basic privacy note, account deletion). Minor, but worth a line in the eventual spec.

## Sources
- MongoDB Atlas App Services / Data API / HTTPS Endpoints EOL (2025-09-30) — https://www.mongodb.com/docs/atlas/app-services/data-api/data-api-deprecation/ and forum https://www.mongodb.com/community/forums/t/mongodb-atlas-data-api-and-custom-https-endpoints-end-of-life-and-deprecation/296686
- Atlas Device Sync / Device SDKs (Realm) EOL (2025-09-30) — https://www.mongodb.com/community/forums/t/atlas-device-sync-end-of-life-and-deprecation/296687 and https://www.couchbase.com/blog/realm-mongodb-eol-day-2025/
- Firebase pricing / free Spark plan — https://firebase.google.com/pricing and https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Firebase Auth limits — https://firebase.google.com/docs/auth/limits ; Firestore quotas — https://firebase.google.com/docs/firestore/quotas
