# Roamarr Improvements Design

Date: 2026-06-25

## Goal

Implement 10 small-to-medium missing features and quality-of-life improvements into the Roamarr v0.1 walking skeleton. Each item should follow existing server/UI patterns, include tests where appropriate, and leave the codebase in a green `npm run check` / `npm test` state.

## Selected Improvements

### 1. Centralized `Icon` component
**Problem:** Inline SVGs are duplicated across routes and components (nav, dashboard, buttons).  
**Solution:** Add a typed `Icon.svelte` component that accepts a `name` prop and renders a 24×24 SVG from a registry. Replace the most common duplicated icons first: plus, back arrow, user, group, document, bell, settings, logout, menu, check.  
**Files:** `src/lib/components/Icon.svelte`, update `src/routes/+layout.svelte`, `src/routes/+page.svelte`, and a few other high-traffic routes.  
**Tests:** Component unit test verifying each named icon renders an `<svg>`.

### 2. Toast variants and manual dismiss
**Problem:** `Toast.svelte` only shows a green success checkmark, cannot be dismissed, and uses hard-coded colors.  
**Solution:** Add `variant: 'success' | 'error' | 'info' | 'warning'` and an optional `dismissible` prop. Use semantic theme classes for backgrounds/borders. Update `setFlash` / `flash` plumbing to carry variant if needed; keep the simple string path working.  
**Files:** `src/lib/components/Toast.svelte`, `src/lib/server/flash.ts`, `src/lib/components/Toast.test.ts`.  
**Tests:** Variant rendering, dismiss button, aria-live attributes.

### 3. Button loading / pending states
**Problem:** Form submissions show no spinner or disabled state, allowing double submits.  
**Solution:** Add a `.btn-loading` CSS class (spinner via pseudo-element or inline SVG) and wire SvelteKit `use:enhance` callbacks on primary forms to set a local `submitting` state that disables the button and shows the spinner. Start with the most-used forms: profile save, new trip, login, and trip share actions.  
**Files:** `src/app.css`, targeted `.svelte` route files.  
**Tests:** Visual regression is enough; no new server tests required.

### 4. Mobile sidebar accessibility
**Problem:** The mobile sidebar closes only on backdrop click or nav click; no Escape handler, focus trap, or body scroll lock.  
**Solution:** Add a `svelte:window` `keydown` Escape handler, programmatically focus the first nav link when opened, restore focus to the hamburger button when closed, and toggle `overflow-hidden` on `<body>` while open.  
**Files:** `src/routes/+layout.svelte`.  
**Tests:** One happy-path unit test for Escape closing the sidebar.

### 5. High-contrast accessibility theme
**Problem:** Several fun themes trade readability for style; there is no dedicated accessible theme.  
**Solution:** Add a `high-contrast` theme to `src/lib/themes.ts` and `src/app.css` using strong black/white/blue contrast, larger effective contrast ratios, and a visible focus ring. Ensure it works in both light and dark OS modes by making it an explicit dark-mode theme.  
**Files:** `src/lib/themes.ts`, `src/app.css`.  
**Tests:** Add theme validation test; verify `normalizeThemeId('high-contrast')` returns the new theme.

### 6. Dashboard "Today's agenda"
**Problem:** The dashboard shows upcoming trips and expiring documents, but not what is happening today.  
**Solution:** Add a "Today" panel to `/` that lists segments starting or ending today (in the user's timezone), plus trips whose date range includes today. Include type badges and links.  
**Files:** `src/routes/+page.server.ts`, `src/routes/+page.svelte`.  
**Tests:** Server test for `+page.server.ts` agenda data when segments/trips span today.

### 7. Aggregate calendar feed
**Problem:** Calendar feeds are per-trip only; users with many trips must subscribe to each feed individually.  
**Solution:** Add a user-level calendar token stored on `users.calendarToken` and a new endpoint `/calendar/feed?token=...` that emits an ICS file containing all viewable trips (owned + shared) for that user. Reuse `ical.ts` and `viewerProjection`. Allow regenerating the token from `/profile`.  
**Files:** `src/lib/server/db/schema.ts` (add `users.calendarToken`, `users.calendarTokenExpiresAt`), migration, `src/routes/calendar/feed/+server.ts`, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`, `src/lib/server/ical.ts` helper for multi-trip.  
**Tests:** Route test for the feed; token regeneration action test.

### 8. Public share "Show details" toggle
**Problem:** User/group shares support `showDetails`, but public token shares always hide confirmation numbers and `detailsJson`.  
**Solution:** Add `trips.publicShowDetails` boolean (default false). When creating a public link, include a checkbox to enable details. Update `/share/[token]` to pass the flag into `viewerProjection`. Allow toggling on the share page.  
**Files:** `src/lib/server/db/schema.ts`, migration, `src/routes/trips/[id]/share/+page.server.ts`, `src/routes/trips/[id]/share/+page.svelte`, `src/routes/share/[token]/+page.server.ts`.  
**Tests:** Public share detail visibility test.

### 9. Admin create and delete users
**Problem:** Admins can edit users and send resets, but cannot create or delete accounts from `/settings/users`.  
**Solution:** Add `?/create` action (generate random password, mark `mustResetPassword`) and a `?/delete` action with confirmation. Surface both in the settings users page. Deleting a user cascades via foreign keys; require the target not be the only admin.  
**Files:** `src/routes/settings/users/+page.server.ts`, `src/routes/settings/users/+page.svelte`, `src/lib/server/users.ts`.  
**Tests:** Action tests for create and delete, including "cannot delete only admin" guard.

### 10. Self-service email change
**Problem:** Users cannot change their own email from `/profile`; only admins can change emails in `/settings/users`.  
**Solution:** Add an email-change form on `/profile` that requires current password, validates the new email is not in use, and updates the account. (Out of scope: full verification email flow; this is self-service for authenticated users in a trusted session.)  
**Files:** `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`.  
**Tests:** Profile action test for email change success and duplicate-email rejection.

## Cross-cutting Constraints

- All UI changes must remain readable across existing themes. Use CSS variables and semantic app classes, not hard-coded colors.
- Schema changes require `npm run db:generate`, a reviewed migration, and an updated `schema.test.ts` if assertions exist.
- Security-relevant mutations must call `logAudit`.
- Keep route files thin; put reusable logic in `src/lib/server/`.
- Run `npm run check` and `npm test` before finishing.

## Out of Scope

- Real fare-provider integrations.
- File attachments or document uploads.
- Geocoding or maps.
- Email verification for the self-service email change.
- Locale/date-format preferences.

## Verification

- `npm run check` passes.
- `npm test` passes.
- New features have focused tests where non-trivial.
