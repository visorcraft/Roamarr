<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Roamarr documentation

Roamarr is a private, self-hosted travel organizer. This manual covers using,
operating, securing, integrating, and contributing to the application.

## Start here

- [Getting started](./getting-started.md): install from source, create the
  first administrator, and build a first trip.
- [Deployment and upgrades](./deployment.md): production environment,
  persistent data, reverse proxies, health checks, upgrades, and rollback.
- [Troubleshooting](./troubleshooting.md): startup, database, upload, map,
  email, search, OAuth, and MCP failures.

## Trips and itineraries

- [Trips](./trips.md): fields, statuses, tabs, duplication, merge, archive,
  deletion, and dashboard behavior.
- [Segments](./segments.md): every itinerary type, times, statuses, attendees,
  details, and privacy.
- [Trip checklists](./checklists.md): preparation items, assignments, packed
  state, tools, and visibility.
- [Companions](./companions.md): travelers, linked users, invitations,
  preferences, assignments, and sensitive details.
- [Sharing](./sharing.md): direct and group access, public links, exact data
  visibility, expiry, and revocation.
- [Calendars](./calendars.md): downloads, per-trip subscription feeds, the
  account feed, token rotation, and event contents.
- [Printable itinerary](./printable-itinerary.md): print/PDF output and its
  privacy boundary.
- [Import and export](./import-export.md): JSON/CSV schemas, preview behavior,
  limitations, and why export is not a backup.
- [Trip document links](./document-links.md): external voucher/file URLs,
  management, security, and privacy.
- [Templates and trip merge](./templates-and-merge.md): trip templates,
  packing templates, duplication, and donor-to-recipient merge behavior.
- [Maps](./maps.md): map enablement, GeoNames, the globe, tile providers,
  network access, and attribution.
- [Weather](./weather.md): Open-Meteo forecasts, cache behavior, advisories,
  privacy, and limitations.
- [Search](./search.md): lexical search, optional local semantic search,
  indexing, model storage, access controls, and privacy.
- [Visited places](./visited-places.md): countries and U.S. states.

## Planning and collaboration

- [Expenses](./expenses.md): currencies, exchange rates, categories, splits,
  receipts, and visibility.
- [Budgets](./budgets.md): category targets and same-currency comparisons.
- [Packing templates](./packing-templates.md): reusable checklist snapshots.
- [Polls](./polls.md): options, votes, deadlines, and deletion.
- [Reminders](./reminders.md): automatic and custom reminders, delivery, and
  scheduler behavior.
- [Fare providers](./fare-providers.md): provider accounts and price watches.
- [Groups](./groups.md): reusable dynamic sharing groups.
- [Journal](./journal.md): dated trip entries.
- [Home tasks](./home-tasks.md): pre-departure tasks.
- [Medications](./medications.md): trip medication lists.
- [Entry requirements](./entry-requirements.md): visa, vaccination, and other
  destination requirements.
- [Important items](./important-items.md): valuables and trackers.

## Personal data and account

- [Account and profile](./accounts-and-profile.md): profile preferences,
  emergency contacts, sessions, themes, notification preferences, and the
  account calendar.
- [Account security](./account-security.md): passwords, reset flow, TOTP,
  backup codes, passkeys, and session revocation.
- [Travel documents](./travel-documents.md): passports, visas, licenses,
  encryption, ownership, and expiry reminders.
- [Cards](./cards.md): safe card metadata and travel benefits.
- [Loyalty](./loyalty.md): memberships, balances, and privacy.
- [Insurance](./insurances.md): policies, benefits, trip links, and privacy.
- [Notifications](./notifications.md): in-app, SMTP, and signed webhook
  delivery.
- [Personal SMTP](./per-user-smtp.md): user-owned outgoing mail settings and
  fallback behavior.
- [Email processing](./email-processing.md): global and personal IMAP,
  parsing, matching, deduplication, security, and replies.

## Administration and operations

- [Administration](./admin.md): instance settings, users, registration, email,
  maps, webhooks, MCP policy, and maintenance navigation.
- [Operations](./operations.md): scheduler jobs, health endpoints, audit logs,
  database maintenance, demo data, and operational checks.
- [Backup and restore](./backup-restore.md): archive contents, exclusions,
  validation, restart workflow, recovery, and secret handling.
- [Deployment and upgrades](./deployment.md): runtime variables, storage,
  single-process requirement, uploads, monitoring, and upgrades.
- [Security and privacy](./SECURITY.md): protection boundaries, outbound data,
  deployment controls, and private vulnerability reporting.

## Integrations

- [OAuth 2.1](./oauth.md): discovery, client registration, PKCE, consent,
  scopes, tokens, revocation, and administrator controls.
- [MCP and AI](./mcp-ai.md): Streamable HTTP setup, tools, prompts, resources,
  privacy gates, client examples, and protocol troubleshooting.
- [HTTP JSON API](./http-api.md): supported bearer-authenticated route
  families, methods, scopes, errors, and compatibility expectations.

## Development

- [Repository README](../README.md): product overview, source setup,
  architecture, commands, and license.
- [Contributing](../CONTRIBUTING.md): code layout, standards, tests,
  documentation, dependencies, and pull requests.

All paths and menu labels describe the current release. For settings that hold
credentials, leaving the displayed secret field blank preserves the saved
value unless the page explicitly says it will clear it.
