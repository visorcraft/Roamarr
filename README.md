# Roamarr

A self-hosted, single-container TripIt alternative. SvelteKit + SQLite, every planned
subsystem present but shallow (walking skeleton, v0.1).

## Quick start (Docker)

```sh
docker build -t roamarr .
docker run -p 3000:3000 -v roamarr-data:/data \
  -e ROAMARR_SECRET="$(openssl rand -base64 32)" \
  -e ORIGIN=http://localhost:3000 \
  roamarr
# open http://localhost:3000 → first-run /setup creates the admin account
```

The container refuses to boot without `ROAMARR_SECRET` (a base64-encoded 32-byte key
used for at-rest encryption). On startup it applies database migrations, then starts
the in-process scheduler (reminders + fare-watch ticks every 60s).

## Local development

```sh
npm install
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr.db"   # default /data/roamarr.db
npm run dev
```

Tests (Vitest):

```sh
npm test                 # run once
npm run test:watch       # watch
```

Schema migrations are generated with Drizzle Kit:

```sh
npm run db:generate      # emit SQL into ./drizzle after schema changes
```

## Configuration

| Variable        | Required | Default            | Notes                                                            |
| --------------- | -------- | ------------------ | ---------------------------------------------------------------- |
| `ROAMARR_SECRET`| yes      | —                  | base64 32-byte key; AES-256-GCM at rest; refuses to boot if unset|
| `DATABASE_PATH` | no       | `/data/roamarr.db` | SQLite file path                                                 |
| `PORT`          | no       | `3000`             | adapter-node listen port                                         |
| `ORIGIN`        | no       | —                  | public origin (cookies / redirects)                              |

See `.env.example`.

## Architecture

Single SvelteKit (`@sveltejs/adapter-node`) app over SQLite (Drizzle + better-sqlite3).
All server logic lives under `src/lib/server/`; routes are thin. Authorization is
centralized (`sharing.ts` for reads, `ownership.ts` for mutations). Sensitive fields
(document numbers, API keys, SMTP password) are AES-256-GCM encrypted at rest.
