<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Roamarr Documentation

Welcome to the Roamarr documentation. Roamarr is a self-hosted,
single-container travel organizer — a TripIt-style tool for managing trips,
segments, sharing, reminders, documents, and more.

## Getting started

- [Getting started](./getting-started.md) — installation, env vars, first
  trip, and map setup.

## Core features

- [Trips](./trips.md) — creating, editing, duplicating, archiving, statuses.
- [Segments](./segments.md) — flights, hotels, events, and every segment type.
- [Companions](./companions.md) — travel companions, dietary, assignments.
- [Sharing](./sharing.md) — user/group sharing, public links, calendar feeds.
- [Expenses](./expenses.md) — multi-currency expenses with receipt attachments.
- [Budgets](./budgets.md) — budget categories with spent tracking.
- [Reminders](./reminders.md) — flight check-in, custom, and segment reminders.
- [Maps](./maps.md) — MapLibre GL integration and tile provider configuration.
- [Packing templates](./packing-templates.md) — reusable checklist templates.
- [Polls](./polls.md) — group decision-making on trips.
- [Insurances](./insurances.md) — insurance policies and benefit templates.
- [Loyalty](./loyalty.md) — loyalty program tracking.
- [Import/Export](./import-export.md) — trip backup and restore.
- [Printable itinerary](./printable-itinerary.md) — print-friendly trip view.
- [Fare providers](./fare-providers.md) — price watches on flight segments.
- [Groups](./groups.md) — reusable sharing groups.

## Traveler details

- [Travel documents](./travel-documents.md) — passports, visas, and expiry reminders.
- [Cards](./cards.md) — payment cards and travel benefits.
- [Medications](./medications.md) — trip medications on the Prep tab.
- [Entry requirements](./entry-requirements.md) — visa and vaccination tracking.
- [Important items](./important-items.md) — valuables, serial numbers, and trackers.
- [Home tasks](./home-tasks.md) — pre-departure to-dos.
- [Journal](./journal.md) — daily trip notes.

## Identity & security

- [Account security](./account-security.md) — passwords, 2FA (TOTP + backup
  codes), passkeys (WebAuthn), sessions, and forced password resets.
- [Notifications](./notifications.md) — admin SMTP, webhooks, and per-user SMTP.
- [Admin](./admin.md) — user management, jobs, backups, audit logs, map tiles.

## Integrations and advanced features

- [Visited places](./visited-places.md) — track countries and U.S. states.
- [Weather](./weather.md) — trip-level and per-day forecasting via Open-Meteo.
- [OAuth 2.1 integration](./oauth.md) — generic OAuth 2.1 + PKCE reference:
  scopes, endpoints, discovery, token lifecycle, allow-list.
- [MCP / AI integration](./mcp-ai.md) — setup, least-privilege scope recipes,
  tools, prompts, resources, protocol testing, and troubleshooting.
- [Per-user SMTP](./per-user-smtp.md) — send notifications from your own mailbox.

## Conventions

- Markdown only; link from the main `README.md` Documentation section.
- Keep examples runnable against the current UI.
- Each feature PR includes/updates its own doc page.

## Policies

- [Security](./SECURITY.md) — security policy, scope, and disclosure process.
