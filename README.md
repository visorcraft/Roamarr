# Roamarr

Roamarr is a self-hosted, single-container TripIt alternative. It is built as a SvelteKit app over SQLite and is currently a v0.1 walking skeleton: the major subsystems are present end to end, with intentionally shallow implementations that establish the architecture for later depth.

## Requirements

- Node.js 22 for local development and production builds.
- npm, using the checked-in `package-lock.json`.
- Docker or Podman for containerized deployment.
- A persistent volume or database path for SQLite.
- `ROAMARR_SECRET`, generated with `openssl rand -base64 32`.

## Quick Start With Docker

```sh
docker build -t roamarr .
docker run -p 3000:3000 -v roamarr-data:/data \
  -e ROAMARR_SECRET="$(openssl rand -base64 32)" \
  -e ORIGIN=http://localhost:3000 \
  roamarr
```

Open `http://localhost:3000` and complete first-run setup to create the admin account.

## Quick Start With Podman

The same image builds and runs with Podman:

```sh
podman build -t localhost/roamarr:latest -f Dockerfile .
podman volume create roamarr-data
podman run --replace -d --name roamarr \
  -p 3000:3000 \
  -v roamarr-data:/data \
  -e ROAMARR_SECRET="$(openssl rand -base64 32)" \
  -e ORIGIN=http://localhost:3000 \
  localhost/roamarr:latest
```

For a rootless systemd/Quadlet service, see `deploy/podman/`.

## Local Development

```sh
npm ci
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr.db"
npm run dev
```

Open `http://localhost:5173/setup` on first boot.

The npm scripts use `--env-file-if-exists=.env`, so you may also keep local values in an ignored `.env` file:

```sh
ROAMARR_SECRET=replace-with-output-from-openssl
DATABASE_PATH=./roamarr.db
PORT=3000
ORIGIN=http://localhost:5173
```

Do not commit real env files. Use `.env.example` as the public template.

## Production Without A Container

```sh
npm ci
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr.db"
export ORIGIN=https://roamarr.example.com
npm run build
node build
```

The production server listens on `PORT` or `3000` by default. Set `ORIGIN` to the public URL when Roamarr is behind a reverse proxy so cookies and redirects are generated correctly.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ROAMARR_SECRET` | yes | none | Base64 32-byte key used for AES-256-GCM encryption. The app refuses to boot if unset. |
| `DATABASE_PATH` | no | `/data/roamarr.db` | SQLite file path. Use a mounted `/data` volume in containers. |
| `PORT` | no | `3000` | adapter-node listen port. |
| `ORIGIN` | no | none | Public origin for cookies and redirects, especially behind reverse proxies. |

SMTP and webhook settings are configured in the app under Settings.

## Public Repository Safety

This repository is intended to be safe to publish. The ignore files exclude local secrets, databases, logs, build output, and local QA artifacts, including:

- Local env files such as `.env`, non-template `.env.*`, `.podman.env`, `podman.env`, and `deploy/podman/roamarr.env`
- SQLite files such as `*.db`, `*.db-wal`, `*.db-shm`, and `/data`
- `node_modules`, `.svelte-kit`, `build`, logs, Playwright artifacts, and generated screenshots

Only commit template files such as `.env.example` and `deploy/podman/roamarr.env.example`. Do not commit generated secrets, real SMTP credentials, API keys, webhook secrets, production databases, or local test accounts.

## Commands

```sh
npm run check            # Svelte + TypeScript check
npm test                 # Vitest suite once
npm run test:watch       # Vitest watch mode
npm run build            # production build to ./build
npm run preview          # preview production build locally
npm run db:generate      # generate SQL migrations after schema changes
npm run db:push          # push schema directly to the configured DB; use carefully
```

Migrations are applied automatically during application boot before the scheduler starts.

## Features

- Trips and itinerary segments with overlap warnings, notes, tags, favorite/archive flags, comments, and bulk actions.
- Sharing with users, groups, public token links, calendar feeds, read/edit/detail controls, and token expiry.
- Dashboard summary cards for upcoming trips, unread notifications, expiring documents, and fare watches.
- JSON/CSV trip export and JSON/CSV import with dry-run preview.
- Flight check-in, document-expiry, trip, segment, and custom reminders.
- Fare-watch provider framework with configurable provider accounts and connection testing.
- Travel documents, loyalty programs, cards, global benefit templates, and insurance policies.
- In-app notifications, optional SMTP, signed webhook delivery, and per-user notification channel toggles.
- Admin settings for users, audit logs, scheduled jobs, backups/restores, demo-data seeding, instance stats, and registration control.
- Health and deep-health endpoints plus PWA manifest/icons.

## Architecture

Roamarr is a single long-running SvelteKit app using `@sveltejs/adapter-node`. The server uses SQLite through Drizzle and `better-sqlite3`; every connection enables WAL mode and foreign keys. Startup requires `ROAMARR_SECRET`, applies migrations, ensures settings exist, then starts a guarded in-process scheduler that ticks every 60 seconds.

All server-side business logic lives under `src/lib/server/`; SvelteKit routes stay thin and call those modules from load functions and form actions. Authorization is centralized in `sharing.ts` for reads and `ownership.ts` for mutations. Public shares and calendar feeds expose only the reduced viewer projection.

Sensitive fields currently encrypted at rest are travel document numbers, fare-provider API keys, and the SMTP password. Card data is intentionally limited to network and last four digits.

## Development Notes

- Tailwind CSS v4 is configured in `src/app.css` through `@theme`; there is no `tailwind.config.js`.
- Reuse shared app classes from `src/app.css` and shared components from `src/lib/components/` before adding one-off UI styles.
- Keep route actions thin: validate input, enforce ownership/authorization, call server modules, and return SvelteKit `fail`, `redirect`, or `error` responses.
- Add or update tests for non-trivial server logic, route actions, schema changes, auth/authorization paths, and security-sensitive behavior.
- When changing the schema, edit `src/lib/server/db/schema.ts`, run `npm run db:generate`, review the generated SQL in `drizzle/`, and run tests.
