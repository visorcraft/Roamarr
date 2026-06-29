<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Roamarr Documentation

Welcome to the Roamarr documentation. Roamarr is a self-hosted,
single-container travel organizer — a TripIt-style tool for managing trips,
segments, sharing, reminders, documents, and more.

## Getting started

- [Setup and first steps](./getting-started.md) — installation, env vars, and
  creating your first trip.

## Core features

- [Trips](./trips.md) — creating, editing, duplicating, and archiving trips.
- [Segments](./segments.md) — flights, hotels, events, and every segment type.
- [Sharing](./sharing.md) — user/group sharing, public links, calendar feeds.
- [Expenses](./expenses.md) — multi-currency expenses with receipt attachments.
- [Reminders](./reminders.md) — flight check-in, custom, and segment reminders.
- [Maps](./maps.md) — MapLibre GL integration and tile provider configuration.
- [Import/Export](./import-export.md) — trip backup and restore.

## Identity & security

- [Account security](./account-security.md) — passwords, 2FA (TOTP + backup
  codes), passkeys (WebAuthn), sessions, and forced password resets.
- [Notifications](./notifications.md) — admin SMTP, webhooks, and per-user SMTP
  override.
- [Admin](./admin.md) — user management, jobs, backups, audit logs, map tiles.

## New feature guides

- [Visited places](./visited-places.md) — track countries and U.S. states you
  have visited, with auto-marking from past trips.
- [Weather](./weather.md) — trip-level and per-day weather forecasting via
  Open-Meteo.
- [MCP / AI integration](./mcp-ai.md) — connect AI assistants over OAuth 2.1
  with granular scopes; includes tool and prompt reference.
- [Per-user SMTP](./per-user-smtp.md) — send notifications from your own
  mailbox.

## How these docs are organized

Each feature PR ships its own page here; this index is the consolidation point.
Keep examples runnable against the current UI.
