<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Getting started

This guide runs Roamarr from source, creates the first administrator, and
builds a first itinerary. For a durable internet-facing installation, continue
with [Deployment and upgrades](./deployment.md).

## 1. Install

Requirements:

- Node.js 24 or newer;
- npm;
- OpenSSL for secret generation;
- a writable persistent data directory.

```sh
git clone https://github.com/visorcraft/Roamarr.git
cd Roamarr
npm ci
cp .env.example .env
openssl rand -base64 32
```

Put the generated value in `.env`:

```env
ROAMARR_SECRET=replace-with-the-generated-value
DATABASE_PATH=./roamarr-db
PORT=3000
ORIGIN=http://localhost:5173
```

`ROAMARR_SECRET` is mandatory and must decode to exactly 32 bytes. Reuse it
across upgrades, rebuilds, and restores. A different value cannot open the
existing encrypted database.

`DATABASE_USER` and `DATABASE_PASS` are optional. Set both before the database
is first created if MongrelDB credential authentication is required. Keep both
unchanged afterward.

## 2. Start development

```sh
npm run dev
```

Open `http://localhost:5173/setup`.

Maintainer worktrees may include a gitignored `compose.local.yml`. It is not
distributed in the public repository. When that file is present:

```sh
export ROAMARR_SECRET="$(openssl rand -base64 32)"
podman compose -f compose.local.yml up -d
```

It serves `http://127.0.0.1:3002` and uses a separate
`roamarr-dev-data` volume. This compose file is for development only. Public
clones should use `npm run dev` unless they provide an equivalent local file.

## 3. Create the first account

The setup page asks for:

- instance name;
- administrator display name;
- email;
- password;
- timezone.

The first account is an administrator and is signed in. Setup becomes
unreachable after that user exists. Additional public registration works only
when an administrator enables it under **Configuration → General**.

## 4. Create a trip

1. Open **Trips** and choose **New trip**.
2. Enter the required trip name.
3. Optionally choose country, state/province, city, dates, notes, tags, a trip
   template, and the visibility label.
4. Save.

New trips start with status `booked`. The visibility label does not itself
grant another person access. Direct/group shares and public links are managed
from the trip's **Share** page.

If Maps are disabled, free-text trip and segment saves remain available.
Resolved GeoNames cities and coordinates need Maps.

## 5. Add itinerary segments

Open the trip's **Itinerary** tab and choose **Add segment**. Select a type,
then enter title, local start/timezone, optional end, location, booking detail,
and status. A resolved city supplies map coordinates.

The itinerary supports Timeline, List, and Board views. Select a segment to
open details, travelers, notes, and reminders. See
[Segments](./segments.md).

## 6. Configure useful services

Administrators can then open:

- **Configuration → Maps** for GeoNames, the globe texture, and raster tiles;
- **Configuration → Email** for SMTP, global IMAP, and optional AI parsing;
- **Configuration → Webhooks** for signed notification delivery;
- **Configuration → MCP Clients** for OAuth/MCP policy;
- **Maintenance** for health, jobs, audits, backup, and database tools.

Users can open **Profile** for timezone, notification preferences, reminder
lead times, default currency, sessions, account calendar, theme, and email
settings.

## 7. Protect the installation

Before entering real travel data:

- move the database and attachments to persistent storage;
- set the exact public HTTPS `ORIGIN`;
- protect the secret and optional database credentials;
- configure a reverse proxy and upload limits;
- create and test a full backup;
- enable TOTP or a passkey for administrator accounts.

Next read [Trips](./trips.md), [Sharing](./sharing.md),
[Backup and restore](./backup-restore.md), and
[Account security](./account-security.md).
