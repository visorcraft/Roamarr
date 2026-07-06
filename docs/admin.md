<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Admin

The first user created during [setup](./getting-started.md) is an admin. Admins
reach these pages under **Settings** in the sidebar.

## Settings overview

The main **Settings** page holds instance-wide configuration:

- **General** — instance name, default currency/timezone, **Allow registration**,
  default flight-check-in lead hours, default document-expiry lead days.
- **Maps** — GeoNames `cities1000.zip` import and tile-provider configuration.
  See [Maps](./maps.md).
- **Email (SMTP)** — host, port, transport security, credentials, from address,
  and **Send test email**. Password is encrypted at rest. See
  [Notifications](./notifications.md).
- **Webhook** — outbound URL with **Send test notification** (fans out to all
  enabled channels).
- **Notification channels / recent activity** — per-account toggles and log.
- **OAuth clients** — server-side allow-list of permitted client IDs for the
  [MCP / AI integration](./mcp-ai.md). When the allow-list is empty, users can
  authorize any client; populated lists restrict authorization to listed IDs.

## User management — Settings → Users

Admins can **create** users (role `admin`/`user`), **disable** (blocks login,
invalidates sessions, keeps data), **force password reset**, **delete**
(cascades to trips/groups), and change a role or email. Each action is recorded
in the audit log — prefer it over editing the database directly.

## Audit logs — Settings → Audit logs

Every security-relevant mutation (`logAudit()`) is recorded: logins, share
changes, user create/disable/delete, settings changes, backups, etc. Filter by
action or user; entries include the actor, entity type/id, and metadata JSON.

## Backups — Settings → Backup

Snapshot the MongrelDB database via the kit backup API; download or restore
a previous snapshot. Capture `ROAMARR_SECRET` alongside any backup — encrypted
fields are unreadable without it.

## Jobs — Settings → Jobs

Inspect recent **scheduler runs** (start, finish, success, error) to confirm
reminders, fare checks, and session cleanup are firing on the 60-second tick.

## Demo data — Settings → Seed

Seed a starter dataset (sample trips, segments, expenses) for evaluation or a
fresh install — handy for trying features without manual data entry.

## Fare providers — Settings → Fare providers

Register fare-watch providers and their (encrypted) API keys. See
[Fare providers](./fare-providers.md).

## Maintenance — Settings → Maintenance

Run low-level MongrelDB operations against the live database:

- **Integrity check** — verifies database file structure.
- **Garbage collect** — reclaims unused space.
- **Flush** — forces pending writes to disk.
- **Doctor** — runs diagnostics and reports anomalies.

Each action returns its raw output for inspection. Prefer the **Backup** page
before running maintenance against a production database.

## GeoNames import — Settings → Maps

Upload `cities1000.zip` to populate city autocomplete. See [Maps](./maps.md).
