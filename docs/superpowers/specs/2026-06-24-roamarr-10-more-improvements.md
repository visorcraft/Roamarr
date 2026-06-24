# Roamarr v0.1 — 10 More Improvements

> Design spec for the next walking-skeleton pass.
> Date: 2026-06-24
> Status: draft

## Goal

Add 10 small, well-scoped improvements that fill obvious gaps in the v0.1 skeleton without building deep production features. Each item should establish a clear seam (data model, route, or UI pattern) and ship with tests.

## Improvements

### 1. Demo data seeder

**What:** An admin-only action at `/settings/seed` that wipes the current non-admin data and seeds a handful of sample users, trips, segments, cards, insurance policies, and loyalty programs. Useful for first-time evaluators and screenshots.

**Why:** New deployments currently start empty; a seed makes the walking skeleton demonstrable.

**Scope:**
- Add `src/lib/server/seed.ts` with idempotent `seedDemoData(actorId)`.
- Add `/settings/seed` route with a destructive confirmation.
- Log a `demo_seed` audit event.
- Tests: seed runs, creates expected records, preserves the admin user.

### 2. PWA manifest and icons

**What:** Add a web app manifest, theme/meta tags, and placeholder icons so Roamarr installs like a simple PWA.

**Why:** v0.1 is used on phones; the manifest is a shallow but high-value seam.

**Scope:**
- Add `static/manifest.json`, `static/icon-192.png`, `static/icon-512.png` (generated simple SVG-derived PNGs or SVGs if accepted).
- Update `src/app.html` with `theme-color`, `manifest`, and apple-touch-icon links.
- No service worker yet (out of scope).

### 3. Mobile-responsive sidebar

**What:** Collapse the sidebar into a hamburger menu on narrow viewports.

**Why:** The current fixed sidebar is unusable on small screens.

**Scope:**
- Add a header bar with a menu toggle on mobile in `src/routes/+layout.svelte`.
- Use a Svelte 5 rune for open/closed state.
- Keep the desktop layout unchanged.

### 4. Dashboard summary cards

**What:** Show four quick-stats on the dashboard: upcoming trips, expiring travel documents, unread notifications, and active fare watches.

**Why:** The dashboard currently just lists trips; summary cards give users an at-a-glance overview.

**Scope:**
- Extend dashboard `load` to compute the counts.
- Add a card grid above the trips list.
- Tests: counts respect visibility/sharing and only include items for the current user.

### 5. Segment overlap warnings

**What:** When a trip segment is created or updated, detect whether it overlaps an existing segment on the same trip and surface a warning (but allow the save).

**Why:** Helps catch data-entry mistakes without blocking unusual itineraries.

**Scope:**
- Add `hasOverlappingSegment(tripId, segmentId?, startAt, endAt)` in `src/lib/server/segments.ts`.
- Return `overlapWarning` from segment add/update actions.
- Display the warning in segment forms.
- Tests: overlaps detected, non-overlaps ignored, edited segment excluded from itself.

### 6. Per-trip comments / activity

**What:** A simple comment thread on each trip detail page. Comments are plain text, owned by the author, visible to anyone who can view the trip.

**Why:** Travel planning needs lightweight discussion; this establishes the activity-feed seam.

**Scope:**
- New `trip_comments` table: `id`, `tripId`, `userId`, `body`, `createdAt`.
- Add `listComments(tripId)`, `addComment(userId, tripId, body)`, `deleteComment(userId, commentId)` in a new `src/lib/server/tripComments.ts`.
- Add comments section to trip detail; owners can delete their own comments.
- Tests: CRUD and authorization.

### 7. Public share / calendar token expiry

**What:** Allow setting an optional expiry date/time for public share tokens and calendar feed tokens. Expired tokens return 404.

**Why:** Public links should not live forever by default.

**Scope:**
- Add `publicTokenExpiresAt` and `calendarTokenExpiresAt` columns to `trips`.
- Update share/calendar-feed loads to reject expired tokens.
- Add expiry inputs to the trip share page.
- Tests: valid tokens work, expired tokens 404, null expiry means no expiration.

### 8. Audit log export

**What:** Export the filtered audit log as CSV from `/settings/audit-logs`.

**Why:** Admins may need to archive or analyze security events outside the app.

**Scope:**
- Add CSV formatter in `src/lib/server/audit.ts` (reuse `listAuditLogs` filters).
- Add `?export=csv` query parameter or export button to audit-logs page.
- Tests: CSV contains expected rows and respects filters.

### 9. Deep health check

**What:** Add `/health/deep` that verifies the database is writable and the scheduler is running.

**Why:** Container orchestrators need a health endpoint that catches real failures.

**Scope:**
- Add `GET /health/deep` endpoint.
- Check DB by writing/reading a tiny `health_check` row or using `PRAGMA quick_check`.
- Report scheduler status from `isSchedulerRunning()`.
- Return 200/503 accordingly.
- Tests: healthy and unhealthy states.

### 10. Database restore from backup

**What:** Allow an admin to upload a previously downloaded `roamarr.db` backup to replace the current database, with a confirmation and validation that the file is a valid SQLite database.

**Why:** Backup is only half the story; restore completes the operational loop.

**Scope:**
- Add `POST /settings/backup` action that accepts a file upload.
- Validate the uploaded file with SQLite `PRAGMA schema_version` / `PRAGMA quick_check`.
- Swap the file atomically (copy to `DATABASE_PATH` after shutting down writes). In v0.1 this can be a direct copy with a warning that the app must be restarted.
- Log a `db_restore` audit event.
- Tests: valid restore accepted, invalid file rejected.

## Schema changes

Two migrations required:
1. `trips`: add `public_token_expires_at text` and `calendar_token_expires_at text` (ISO-8601 UTC, nullable).
2. New table `trip_comments`.

## Non-goals

- Real-time activity updates (no WebSockets).
- Full offline PWA support (no service worker).
- Automatic backup scheduling.
- Comment threading/replies.

## Success criteria

- All 10 improvements have co-located tests.
- `npm run check`, `npm test`, and `npm run build` pass.
- Changes are committed and pushed to `master`.
