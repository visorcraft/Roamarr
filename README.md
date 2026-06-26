# Roamarr

Roamarr is a self-hosted, single-container TripIt-style travel organizer built
with SvelteKit and SQLite. It is an early but broad application: the major
subsystems are wired end to end, and feature depth is improving incrementally.

## Requirements

- Node.js 22.12 or newer for local development and production builds.
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
npm run dev              # Vite dev server on http://localhost:5173
npm run check            # Svelte + TypeScript check
npm run check:watch      # Svelte + TypeScript check in watch mode
npm test                 # Vitest suite once
npm run test:watch       # Vitest watch mode
npm run build            # production build to ./build
npm run preview          # preview production build locally
npm run db:generate      # generate SQL migrations after schema changes
npm run db:push          # push schema directly to the configured DB; use carefully
```

Migrations are applied automatically during application boot before the scheduler starts.

## Features

- Application shell with left navigation, a sticky global search field,
  top-right user menu, and a sidebar app/version link to the About page. App name
  and version are read from `package.json`.
- Trips and itinerary segments with overlap warnings, notes, tags, favorite/archive flags, comments, bulk actions, and trip status lifecycle.
- Segment details: end timezone, status tracking, and optional meeting/rally point for group coordination.
- Sharing with users, groups, public token links, read/edit/detail controls, and token expiry; per-trip calendar feeds plus an aggregate feed for all viewable trips.
- Dashboard summary cards, a "Today" agenda, upcoming trips, and expiring documents.
- JSON/CSV trip export and JSON/CSV import with dry-run preview.
- Flight check-in, document-expiry, trip, segment, and custom reminders.
- Fare-watch provider framework with configurable provider accounts and connection testing.
- Travel documents (including documents linked to trip companions), loyalty programs, cards, global benefit templates, and insurance policies.
- Group/family helpers: trip companions with dietary/allergy/medical notes, seat/bed preferences, accessibility/room notes, kid gear needs (car seat, stroller, crib, kids meal), reusable packing checklist templates, per-trip expense tracking with split and settlement math, segment attendees, trip polls and voting, trip budget categories with alerts, and emergency-contact itinerary sharing.
- Multi-currency expense support with per-expense exchange rates and a trip base-currency total.
- Expense receipt attachments (JPEG, PNG, WebP, PDF) stored next to the database with a secure download route.
- Saved trip templates that clone a trip and its segments for reuse.
- Home-preparation task list with due dates and completion toggles.
- Medication and first-aid schedule with dosage, schedule, start/end times, and companion association.
- Visa, vaccination, and entry-requirement tracker with status and due dates.
- Segment payment status and payment due dates.
- Important-items registry with serial numbers, tracker IDs, and companion association.
- Trip journal entries, trip document links, and a printable itinerary view.
- In-app notifications, optional SMTP, signed webhook delivery, and per-user notification channel toggles.
- Per-user color themes from the profile page, including a High Contrast
  accessibility theme. The registry lives in `src/lib/themes.ts`.
- Admin settings for user creation/deletion, audit logs, scheduled jobs, backups/restores, demo-data seeding, instance stats, registration control, and a settings-style About page.
- Profile management with session revocation, password change, self-service email change, and aggregate calendar feed token.
- Shared UI components (`Icon`, `Toast` with variants, loading states), theme-aware shell controls, and mobile sidebar accessibility.
- Health and deep-health endpoints plus PWA manifest/icons.

## Architecture

Roamarr is a single long-running SvelteKit app using `@sveltejs/adapter-node`. The server uses SQLite through Drizzle and `better-sqlite3`; every connection enables WAL mode and foreign keys. Startup requires `ROAMARR_SECRET`, applies migrations, ensures settings and default benefit templates exist, then starts a guarded in-process scheduler that ticks every 60 seconds.

All server-side business logic lives under `src/lib/server/`; SvelteKit routes stay thin and call those modules from load functions and form actions. Authorization is centralized in `sharing.ts` for reads and `ownership.ts` for mutations. Public shares and calendar feeds expose only the reduced viewer projection.

The authenticated app shell is implemented in `src/routes/+layout.svelte` and `+layout.server.ts`. The About page lives at `/settings/about`; its app name/version come from `src/lib/appInfo.ts`, which reads `package.json`.

Sensitive fields currently encrypted at rest are travel document numbers, fare-provider API keys, and the SMTP password. Card data is intentionally limited to network and last four digits.

## Development Notes

- Tailwind CSS v4 is configured in `src/app.css` through `@theme`; there is no `tailwind.config.js`.
- Reuse shared app classes from `src/app.css` and shared components from `src/lib/components/` before adding one-off UI styles.
- For themed UI, prefer semantic app classes and CSS variables over hard-coded slate/indigo/white utilities so Light and dark themes stay readable.
- Keep global shell controls theme-aware: sticky search bar, top-right user menu, and sidebar app/version footer should work across all registered themes.
- Keep route actions thin: validate input, enforce ownership/authorization, call server modules, and return SvelteKit `fail`, `redirect`, or `error` responses.
- Add or update tests for non-trivial server logic, route actions, schema changes, auth/authorization paths, and security-sensitive behavior.
- When changing the schema, edit `src/lib/server/db/schema.ts`, run `npm run db:generate`, review the generated SQL in `drizzle/`, and run tests.
