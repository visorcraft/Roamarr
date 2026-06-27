<!-- SPDX-FileCopyrightText: 2026 VisorCraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

<p align="center">
  <img src="static/icon-512.png" alt="Roamarr logo" width="250" />
</p>

<h1 align="center">Roamarr</h1>

<p align="center">
  <b>A private, self-hosted travel organizer for every moving part of a trip.</b>
  <br />
  Keep flights, stays, documents, companions, reminders, expenses, and sharing in one SQLite-backed itinerary hub.
  <br />
  SvelteKit app shell · single-container deploy · encrypted sensitive fields · no hosted travel account required.
</p>

<p align="center">
  <a href="https://github.com/visorcraft/Roamarr/releases/latest"><img src="https://img.shields.io/github/v/release/visorcraft/Roamarr?sort=semver" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg" alt="License: GPL-3.0-only" /></a>
  <img src="https://img.shields.io/badge/SvelteKit-2-ff3e00?logo=svelte&amp;logoColor=white" alt="Built with SvelteKit 2" />
  <img src="https://img.shields.io/badge/SQLite-Drizzle-003b57?logo=sqlite&amp;logoColor=white" alt="SQLite with Drizzle ORM" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-339933?logo=node.js&amp;logoColor=white" alt="Node.js 22.12 or newer" />
  <img src="https://img.shields.io/badge/container-Docker%20%2F%20Podman-892ca0?logo=podman&amp;logoColor=white" alt="Docker or Podman container" />
</p>

---

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/dashboard.png" alt="Roamarr dashboard with upcoming trips, reminders, and travel planning metrics" />
      <br />
      <sub><b>Dashboard</b> — trips, reminders, documents, and recent activity.</sub>
    </td>
    <td width="50%">
      <img src="docs/screenshots/trip-itinerary.png" alt="Roamarr trip itinerary tab with hero details, timeline cards, and trip stats" />
      <br />
      <sub><b>Trip itinerary</b> — hero details, tabs, timeline cards, and stats.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/trip-prep.png" alt="Roamarr trip prep tab with packing checklist and trip preparation controls" />
      <br />
      <sub><b>Trip prep</b> — packing checklist and before-you-go controls.</sub>
    </td>
    <td width="50%">
      <img src="docs/screenshots/trip-documents.png" alt="Roamarr trip documents tab with linked trip files and insurance sections" />
      <br />
      <sub><b>Trip documents</b> — linked files, notes, and insurance context.</sub>
    </td>
  </tr>
</table>

---

## What is Roamarr?

Roamarr is a TripIt-style travel organizer you run yourself. It is built as a
single Node.js application with a SQLite database, server-rendered SvelteKit
pages, and a practical app shell designed for repeated use rather than a
marketing dashboard.

Roamarr can:

- Track trips, itinerary segments, dates, timezones, booking status, notes,
  tags, favorites, archives, comments, and printable itineraries.
- Manage flights, hotels, trains, rental cars, rideshares, shuttles, boats,
  food plans, events, parking, directions, points of interest, todos, and free
  form notes.
- Share trips with users, groups, public links, and calendar feeds with
  read/edit/detail controls and token expiry.
- Keep traveler context close to the itinerary: companions, documents, loyalty
  programs, payment cards, insurance policies, entry requirements, medications,
  emergency contacts, important items, and home-preparation tasks.
- Coordinate family and group travel with attendee lists, polls, packing
  templates, kid gear, accessibility notes, dietary details, room preferences,
  and emergency itinerary sharing.
- Track trip expenses with multiple currencies, exchange rates, receipt
  attachments, splits, settlements, budgets, and payment due dates.
- Import and export trip data as JSON or CSV, including dry-run previews before
  importing.
- Send reminders and operational notifications in app, by SMTP, or through
  signed webhooks.
- Run admin workflows for setup, users, registration, audit logs, scheduled
  jobs, backups, restores, demo data, instance stats, and health checks.
- Surface license text, runtime credits, package attribution, and app version
  details from the Settings -> About area.

## Your itinerary, under your roof

Travel plans have a strange shape. The critical data is scattered across airline
confirmations, hotel portals, calendar invites, PDF receipts, family texts,
medicine lists, passport dates, and last-minute reminders. Roamarr is meant to
pull that data into one place without handing it to another hosted itinerary
provider.

### One local database

Roamarr stores application data in SQLite through Drizzle ORM and
`better-sqlite3`. By default the database lives at `./roamarr.db`, and receipt
attachments are stored beside it in an `attachments/` directory. Move the
database path, back it up, snapshot it, or keep it on persistent storage that
fits your own setup.

### Private by default

The app requires a `ROAMARR_SECRET` before boot. Sensitive fields such as travel
document numbers, fare-provider API keys, and the SMTP password are encrypted at
rest with AES-256-GCM. Passwords use argon2id, session cookies contain random
tokens, and the database stores only token hashes.

Public share links and calendar feeds use reduced viewer data instead of
dumping every private field attached to a trip. Roamarr is built around the
idea that itinerary sharing should be explicit, scoped, and revocable.

### Built for the actual trip

Roamarr is not just a date list. It tracks the practical, unglamorous work that
happens before and during travel: who is coming, who needs what, what is paid,
what is missing, what expires soon, what needs to be packed, who can see the
itinerary, and what should happen if plans change.

## Setup

### Requirements

- Node.js 22.12 or newer.
- npm, using the checked-in `package-lock.json`.
- SQLite support through the bundled `better-sqlite3` dependency.
- A persistent database path for local app data.
- `ROAMARR_SECRET`, generated with `openssl rand -base64 32`.

If native npm packages need to build on your machine, install your platform's
standard C/C++ build tools before running `npm ci`.

### From source

```bash
git clone https://github.com/visorcraft/Roamarr.git
cd Roamarr

npm ci
cp .env.example .env
openssl rand -base64 32
```

Paste the generated secret into `.env`:

```env
ROAMARR_SECRET=replace-with-output-from-openssl
DATABASE_PATH=./roamarr.db
PORT=3000
ORIGIN=http://localhost:5173
```

Then start the development server:

```bash
npm run dev
```

Open `http://localhost:5173/setup` on first boot.

### Production build

```bash
npm ci
npm run build
npm start
```

The production server listens on `PORT` or `3000` by default. Set `ORIGIN` to
the public URL when Roamarr is behind a reverse proxy so cookies and redirects
are generated correctly.

Deployment packaging should live outside this source repository. This repository
is focused on building, testing, and running the Roamarr application from
source.

## Configure Roamarr

### Environment

| Variable | Required | Default | Notes |
| -------- | -------- | ------- | ----- |
| `ROAMARR_SECRET` | yes | none | Base64 32-byte key used for encryption. The app refuses to boot if unset. |
| `DATABASE_PATH` | no | `./roamarr.db` | SQLite file path. Attachments are stored in an `attachments/` directory beside this database. |
| `PORT` | no | `3000` | adapter-node listen port. |
| `ORIGIN` | no | none | Public origin for cookies and redirects, especially behind reverse proxies. |

SMTP, webhooks, registration policy, themes, fare providers, backups, and most
admin settings are configured inside the app after setup.

### Runtime data

| Data | Default path |
| ---- | ------------ |
| SQLite database | `./roamarr.db` |
| Receipt attachments | `./attachments/` |
| Production build output | `./build/` |
| SvelteKit build cache | `./.svelte-kit/` |

Local `.env` files, databases, logs, build output, dependencies, Playwright
artifacts, and local QA screenshots are ignored by Git. Commit only templates
such as `.env.example`.

## Tweak Roamarr

### Common workflows

```bash
# Start the dev server
npm run dev

# Type-check Svelte and TypeScript
npm run check

# Run the Vitest suite once
npm test

# Build the production app
npm run build

# Run the built app
npm start

# Regenerate bundled license and credits data
npm run credits:generate

# Generate a new Drizzle migration after schema changes
npm run db:generate
```

Migrations are applied automatically during application boot before the
scheduler starts.

### Application settings

After the first setup flow, use Settings for:

- Instance name, public registration, and admin controls.
- SMTP delivery, signed webhooks, and per-user notification channels.
- Fare provider accounts and connection tests.
- Backups, restores, scheduled jobs, audit logs, health information, and demo
  data.
- About, project license, third-party package credits, and runtime component
  acknowledgements.

Use Profile for:

- Password changes, email changes, and active session management.
- Calendar feed token management.
- Per-user theme selection, including High Contrast.

## Architecture

Roamarr is a SvelteKit 2 app using Svelte 5, TypeScript ES modules,
`@sveltejs/adapter-node`, Tailwind CSS v4, Drizzle ORM, SQLite, Luxon,
Nodemailer, and Vitest.

Startup imports `src/hooks.server.ts`, requires `ROAMARR_SECRET`, applies
migrations, ensures default settings and benefit templates exist, then starts a
guarded in-process scheduler. The scheduler runs reminders, fare checks,
expired-session cleanup, and run pruning without duplicate starts or
overlapping ticks.

Routes stay thin. Server-side business logic lives under `src/lib/server/`.
Authorization is centralized in sharing and ownership helpers, while public
share and calendar-feed routes expose only a reduced viewer projection.

The main app shell lives in `src/routes/+layout.svelte` and
`src/routes/+layout.server.ts`. Shared components, icons, themes, labels, and
formatting helpers live under `src/lib/`. Database schema and migrations live
under `src/lib/server/db/` and `drizzle/`.

## Contribute

Contributions are welcome through the standard fork-and-pull-request workflow.
Start with [CONTRIBUTING.md](CONTRIBUTING.md), which covers local setup,
coding standards, tests, documentation expectations, dependency policy, and
pull request requirements.

The short version:

```bash
git clone https://github.com/<you>/Roamarr.git
cd Roamarr
git checkout -b fix-or-feature-name

npm ci
npm run check
npm test
npm run build
```

Before opening a pull request, include focused tests for behavior changes,
update relevant docs, and regenerate license data after dependency changes.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) - contribution guidelines
- [docs/SECURITY.md](docs/SECURITY.md) - security policy and disclosure process
- [LICENSE](LICENSE) - GPL-3.0-only license text
- [static/manifest.json](static/manifest.json) - PWA manifest
- [drizzle/](drizzle/) - generated database migration baseline

## License

Roamarr is licensed under GPL-3.0-only. See [LICENSE](LICENSE) for the full
license text, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines,
and [docs/SECURITY.md](docs/SECURITY.md) for the security disclosure policy.
