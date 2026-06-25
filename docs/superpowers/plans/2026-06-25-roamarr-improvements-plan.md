# Roamarr Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each feature is implemented by a focused subagent with the full design spec and this plan.

**Goal:** Implement 10 small-to-medium improvements into Roamarr following existing patterns.

**Architecture:** Each feature is self-contained and touches only the files it needs. Schema changes are limited to aggregate calendar feeds and public-share details. UI improvements reuse existing app classes and CSS variables.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Tailwind CSS v4, better-sqlite3, Drizzle ORM, Vitest, Luxon.

---

## File Map

| Feature | New files | Modified files |
|---|---|---|
| 1. Icon component | `src/lib/components/Icon.svelte`, `src/lib/components/Icon.test.ts` | `src/routes/+layout.svelte`, `src/routes/+page.svelte`, others as time allows |
| 2. Toast variants | `src/lib/components/Toast.test.ts` | `src/lib/components/Toast.svelte`, `src/lib/server/flash.ts`, `src/routes/+layout.svelte` |
| 3. Button loading | — | `src/app.css`, `src/routes/profile/+page.svelte`, `src/routes/trips/new/+page.svelte`, `src/routes/login/+page.svelte`, `src/routes/trips/[id]/share/+page.svelte` |
| 4. Mobile sidebar a11y | — | `src/routes/+layout.svelte` |
| 5. High-contrast theme | — | `src/lib/themes.ts`, `src/app.css` |
| 6. Dashboard today agenda | — | `src/routes/+page.server.ts`, `src/routes/+page.svelte` |
| 7. Aggregate calendar feed | `src/routes/calendar/feed/+server.ts` | `src/lib/server/db/schema.ts`, migration, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`, `src/lib/server/ical.ts` |
| 8. Public share show details | — | `src/lib/server/db/schema.ts`, migration, `src/routes/trips/[id]/share/+page.server.ts`, `src/routes/trips/[id]/share/+page.svelte`, `src/routes/share/[token]/+page.server.ts` |
| 9. Admin create/delete users | — | `src/routes/settings/users/+page.server.ts`, `src/routes/settings/users/+page.svelte`, `src/lib/server/users.ts` |
| 10. Self-service email change | — | `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte` |

---

## Tasks

### Task 1: Centralized `Icon` component

**Files:**
- Create: `src/lib/components/Icon.svelte`
- Create: `src/lib/components/Icon.test.ts`
- Modify: `src/routes/+layout.svelte`, `src/routes/+page.svelte`

- [ ] Step 1: Create `Icon.svelte` with a `name` prop and a map of common SVG paths (`plus`, `back`, `user`, `users`, `document`, `bell`, `settings`, `logout`, `menu`, `check`). Render a 24×24 SVG with `aria-hidden="true"`.
- [ ] Step 2: Write `Icon.test.ts` verifying each name renders an `<svg>` element.
- [ ] Step 3: Replace duplicated inline SVGs in `+layout.svelte` (nav, menu, logout) and `+page.svelte` (new-trip button) with `<Icon ... />`.
- [ ] Step 4: Run `npm test -- src/lib/components/Icon.test.ts` and `npm run check`.

### Task 2: Toast variants and dismiss

**Files:**
- Modify: `src/lib/components/Toast.svelte`, `src/lib/server/flash.ts`, `src/routes/+layout.svelte`
- Create: `src/lib/components/Toast.test.ts`

- [ ] Step 1: Extend `Toast.svelte` to accept `variant?: 'success' | 'error' | 'info' | 'warning'` and `dismissible?: boolean`. Use theme-aware classes for each variant and add a close button.
- [ ] Step 2: Update `flash.ts` to allow carrying a variant (e.g. `{ message, variant }`) while remaining backward-compatible with plain strings.
- [ ] Step 3: Update `+layout.svelte` to pass variant to `<Toast />`.
- [ ] Step 4: Write `Toast.test.ts` covering variants and dismiss behavior.

### Task 3: Button loading states

**Files:**
- Modify: `src/app.css`, targeted route `.svelte` files

- [ ] Step 1: Add `.btn-loading` to `src/app.css` (disabled cursor, spinner via `::after` or inline SVG, preserve width).
- [ ] Step 2: Add `use:enhance` pending state to primary forms on `profile/+page.svelte`, `trips/new/+page.svelte`, `login/+page.svelte`, and `trips/[id]/share/+page.svelte` so the submit button gets `disabled` and `class:btn-loading={submitting}`.
- [ ] Step 3: Verify no visual regression with `npm run check`.

### Task 4: Mobile sidebar accessibility

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] Step 1: Add `svelte:window on:keydown` handler to close the sidebar on `Escape`.
- [ ] Step 2: When opening the sidebar, focus the first nav link and add `overflow-hidden` to `document.body`.
- [ ] Step 3: When closing, restore focus to the hamburger button and remove `overflow-hidden`.
- [ ] Step 4: Add a test or manual verification step.

### Task 5: High-contrast theme

**Files:**
- Modify: `src/lib/themes.ts`, `src/app.css`

- [ ] Step 1: Add `high-contrast` entry to `THEMES` in `src/lib/themes.ts` with strong black/white/blue colors and `colorScheme: 'dark'`.
- [ ] Step 2: Add `[data-theme="high-contrast"]` CSS tokens to `src/app.css` with explicit focus rings and high contrast ratios.
- [ ] Step 3: Update `src/lib/server/db/schema.ts` default theme? No — keep default unchanged; just register the new theme.
- [ ] Step 4: Add a test verifying `isThemeId('high-contrast')` is true.

### Task 6: Dashboard today's agenda

**Files:**
- Modify: `src/routes/+page.server.ts`, `src/routes/+page.svelte`

- [ ] Step 1: In `+page.server.ts`, query segments whose `startAt` or `endAt` falls within today in the user's timezone, plus trips covering today, and return them as `agenda`.
- [ ] Step 2: In `+page.svelte`, render a "Today" panel with items, type badges, and links.
- [ ] Step 3: Write a server test for the agenda query.

### Task 7: Aggregate calendar feed

**Files:**
- Modify: `src/lib/server/db/schema.ts`, migration
- Create: `src/routes/calendar/feed/+server.ts`
- Modify: `src/lib/server/ical.ts`, `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`

- [ ] Step 1: Add `calendarToken` and `calendarTokenExpiresAt` columns to `users` table in schema.
- [ ] Step 2: Run `npm run db:generate` and review the migration.
- [ ] Step 3: Add helper in `ical.ts` to build a calendar from multiple trips.
- [ ] Step 4: Create `/calendar/feed/+server.ts` that validates a user token and emits an ICS for all viewable trips.
- [ ] Step 5: Add regenerate-calendar-token action to `/profile/+page.server.ts` and UI to `/profile/+page.svelte`.
- [ ] Step 6: Write tests for the feed endpoint and token regeneration.

### Task 8: Public share show details

**Files:**
- Modify: `src/lib/server/db/schema.ts`, migration, `src/routes/trips/[id]/share/+page.server.ts`, `src/routes/trips/[id]/share/+page.svelte`, `src/routes/share/[token]/+page.server.ts`

- [ ] Step 1: Add `publicShowDetails` boolean to `trips` schema.
- [ ] Step 2: Run `npm run db:generate` and review the migration.
- [ ] Step 3: Update `share/+page.server.ts` `makePublic` action to accept and store `publicShowDetails`; add `setPublicShowDetails` action.
- [ ] Step 4: Update `share/+page.svelte` to show the toggle.
- [ ] Step 5: Update `share/[token]/+page.server.ts` to pass `publicShowDetails` to `viewerProjection`.
- [ ] Step 6: Write a test verifying details are hidden/shown as configured.

### Task 9: Admin create/delete users

**Files:**
- Modify: `src/routes/settings/users/+page.server.ts`, `src/routes/settings/users/+page.svelte`, `src/lib/server/users.ts`

- [ ] Step 1: Add `createUser` helper in `src/lib/server/users.ts` that creates a user with a random password and `mustResetPassword=true`.
- [ ] Step 2: Add `adminDeleteUser` helper that refuses to delete the only admin.
- [ ] Step 3: Add `?/create` and `?/delete` actions in `+page.server.ts`, auditing each.
- [ ] Step 4: Add create-user form and delete button in `+page.svelte`.
- [ ] Step 5: Write action tests.

### Task 10: Self-service email change

**Files:**
- Modify: `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`

- [ ] Step 1: Add `?/changeEmail` action requiring current password, validating new email format and uniqueness.
- [ ] Step 2: Add email change form to `profile/+page.svelte`.
- [ ] Step 3: Audit the change via `logAudit`.
- [ ] Step 4: Write an action test.

---

## Verification

Run from repository root:

```bash
npm run check
npm test
```

Expected: both commands exit 0.

---

## Self-Review

- Spec coverage: all 10 features map to a task above.
- Placeholders: none; each task names exact files.
- Type consistency: variant and token names match between tasks.
