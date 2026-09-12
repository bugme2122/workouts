# Ladder Circuit Timer

A group interval-timer web app: a buildless vanilla-JS client and an Express 5 + MongoDB API with
email/password JWT accounts and per-user cloud sync. Run a station circuit for up to six people,
with a descending work/rest ladder, spoken cues, and rotation prompts.

- **How it works, end to end:** [`PROJECT.md`](PROJECT.md)
- **Known weaknesses and their scoped fixes:** [`GAPS.md`](GAPS.md)
- **Conventions and rules for changing the code:** [`CLAUDE.md`](CLAUDE.md)
- **Deployment (Docker → Railway, behind Cloudflare):** [`docs/deploy.md`](docs/deploy.md)

## Quick start

```sh
npm test                         # client suite (node --test)
npm start                        # client only, no API, on :8000

cd server && npm install
cp .env.example .env             # if present; dev:local fills in sane defaults
npm run dev:local                # whole stack on :4000 with an embedded MongoDB
npx vitest run                   # server suite
```

`npm run dev:local` seeds an admin account (`admin@local.test` / `LocalAdmin!2026`) on first run.
There is no self-registration — additional users are provisioned with `npm run create-admin`.

The client is ES modules, so it must be served over HTTP; opening `index.html` via `file://`
will not work.

## Layout

| Path | Responsibility |
|---|---|
| `engine.js` | Pure logic (phases, sanitize/migrate, share codec, boot decisions). No DOM. |
| `catalog.js` | Workout/theme/exercise data and share-link helpers. |
| `store.js` | localStorage backend, sync decisions, cloud backend over `api.js`. |
| `api.js` / `auth.js` | Single fetch entry point; email/password JWT sessions. |
| `app.js` | All DOM, timer loop, boot and sync orchestration. |
| `server/src/` | `routes/ → controllers/ → models/`, JWT-verified per route. |

## License

MIT — see [`LICENSE`](LICENSE).
