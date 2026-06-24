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
npm run dev              # http://localhost:5173 (Vite dev server)
```

On first boot, open `http://localhost:5173/setup` to create the admin account.

## Production build

```sh
npm install
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr.db"
export ORIGIN=https://roamarr.example.com
npm run build            # outputs to ./build
node build               # starts the adapter-node server
```

The production server listens on `PORT` (default `3000`). Set `ORIGIN` to your public URL so cookies and redirects work correctly behind a reverse proxy.

## Preview the production build

```sh
npm run build
npm run preview          # preview locally on the Vite dev port
```

## Tests and type-checking

```sh
npm test                 # run the Vitest suite once
npm run test:watch       # run tests in watch mode
npm run check            # TypeScript + Svelte type-check
```

## Database migrations

Migrations are applied automatically on startup. To generate a new migration after editing `src/lib/server/db/schema.ts`:

```sh
npm run db:generate      # emit SQL into ./drizzle
```

To push schema changes directly to the configured database (use with care):

```sh
npm run db:push
```

## Configuration

| Variable        | Required | Default            | Notes                                                            |
| --------------- | -------- | ------------------ | ---------------------------------------------------------------- |
| `ROAMARR_SECRET`| yes      | —                  | base64 32-byte key; AES-256-GCM at rest; refuses to boot if unset|
| `DATABASE_PATH` | no       | `/data/roamarr.db` | SQLite file path                                                 |
| `PORT`          | no       | `3000`             | adapter-node listen port                                         |
| `ORIGIN`        | no       | —                  | public origin (cookies / redirects)                              |

See `.env.example`. SMTP and webhook settings are configured via `/settings` in the app.

## Architecture

Single SvelteKit (`@sveltejs/adapter-node`) app over SQLite (Drizzle + better-sqlite3).
All server logic lives under `src/lib/server/`; routes are thin. Authorization is
centralized (`sharing.ts` for reads, `ownership.ts` for mutations). Sensitive fields
(document numbers, API keys, SMTP password) are AES-256-GCM encrypted at rest.
