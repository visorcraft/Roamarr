# Roamarr — Ten More v0.1 Features

## Overview

This spec adds ten small-to-medium usability and security improvements to the Roamarr v0.1 walking skeleton. Each feature reuses existing seams (auth, scheduler, notifications, import/export, audit, search, ical) without introducing external APIs or large new subsystems.

## Features

### 1. Trip Export (JSON / CSV)

A download counterpart to the existing bulk import. From `/trips`, the user can export their own trips (plus segments) as JSON or a simple CSV. Shared trips are excluded because the user is not the data owner.

- `src/lib/server/export.ts` builds the payload.
- `src/routes/trips/export/+server.ts` serves `application/json` or `text/csv`.
- Link added to `/trips` list page.

### 2. Per-User Notification Channel Toggles

`notify.ts` currently sends SMTP and webhook notifications whenever those channels are configured. Users can now opt in/out of email and webhook delivery independently.

- Add `users.emailNotifications` and `users.webhookNotifications` boolean columns (default true / true for existing users).
- Profile form exposes the two toggles.
- `notify.ts` checks the recipient's preferences before delivering.

### 3. Signed Outbound Webhooks

Webhook payloads are signed with an HMAC-SHA256 using `ROAMARR_SECRET`, exposed in `X-Roamarr-Signature` and `X-Roamarr-Timestamp` headers. Receivers can verify authenticity.

- Implemented in `src/lib/server/notify.ts` webhook channel.
- Settings page shows a short verification hint.
- Tests verify signature using the same secret.

### 4. Full-Text Trip Search Across Segments

The existing trips search only matches trip `name`/`destination`. Extend `listViewableTrips` to also search the user's own segment titles, locations, and confirmation numbers. Shared trips remain searchable only by trip-level fields unless the sharer granted `showDetails`.

- Update `src/lib/server/sharing.ts` search logic.
- No schema change.

### 5. Trip Archive and Favorite Flags

Two new boolean columns on `trips`: `archived` and `favorite`. The trips list supports tabs/filtering (Active / Archived / Favorites) and bulk actions to archive/favorite/delete. The trip detail page has toggle actions.

- Schema migration adds columns with defaults `false`.
- List page filter state via query params.
- Bulk actions remain limited to owned trips.

### 6. Custom Reminders per Segment/Trip

Users can add a one-off custom reminder to any segment or trip: "remind me X minutes/hours/days before". The existing `reminders` table and scheduler are reused; a new `kind='custom'` value is added to the check constraint.

- Extend `reminders.kind` enum.
- Add UI to segment and trip forms.
- `reminders.ts` computes fire time from the referenced trip/segment start.

### 7. Audit Log Filtering and Pagination

`/settings/audit-logs` currently shows the latest 100 rows. Add filters by user, action, and entity type, plus cursor/offset pagination and a date range.

- Extend `src/lib/server/audit.ts` `listAuditLogs` with filters.
- Update route page server + svelte.
- Tests for each filter.

### 8. Session Metadata (IP / User-Agent)

Store `lastIp` and a parsed `userAgent` summary on sessions when they are created or refreshed. Display them in the profile active-session list.

- Schema migration adds `sessions.lastIp` (text) and `sessions.userAgent` (text).
- Capture from `event.getClientAddress()` and `request.headers.get('user-agent')` in `hooks.server.ts`.
- Render in profile session list.

### 9. Calendar Feed for All Segment Types + Trip All-Day Event

`ical.ts` currently only handles `flight` and `lodging`. Extend it to emit sensible VEVENT summaries for all supported segment types and add an all-day VEVENT for the overall trip bounds.

- Update `src/lib/server/ical.ts`.
- Feed endpoint unchanged.

### 10. Import Dry-Run / Preview

Bulk trip import supports a dry-run mode that validates the file and returns the list of trips/segments that would be created, without writing to the DB.

- Add `dryRun` option to `src/lib/server/import.ts`.
- Import page shows a preview table and a confirm-import button.
- Tests verify no DB writes in dry-run mode.

## Security & Boundaries

- Export only returns trips owned by the current user.
- Search across sensitive segment fields (confirmation numbers) is limited to the owner; shared trips use trip-level fields unless `showDetails` is granted.
- Webhook signatures use `ROAMARR_SECRET`; timestamp tolerance is ±5 minutes.
- Audit log filters are admin-only; the existing admin guard remains.
- Bulk actions continue to skip shared trips via `isShared` flag.

## Testing

Each feature gets co-located tests following the existing Vitest patterns:
- Server modules: `export.test.ts`, `notify.test.ts` additions, `sharing.test.ts` additions, `ical.test.ts` additions, `import.test.ts` additions, `audit.test.ts` additions, `reminders.test.ts` additions.
- Routes: profile toggles/sessions, trips list filters/bulk, import preview, audit logs.

## Migrations

- `users` table: add `emailNotifications`, `webhookNotifications`.
- `trips` table: add `archived`, `favorite`.
- `reminders` table: extend `kind` check.
- `sessions` table: add `lastIp`, `userAgent`.
