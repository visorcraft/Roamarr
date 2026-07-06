<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Import and export

Move trips in and out of Roamarr, and configure fare-watch providers.

## Export

From the **Trips** page (use the **Import** / **Export** buttons at the top of
the trips list), download all of your owned trips in either format:

- **JSON** — a structured `{ "trips": [...] }` payload with each trip's
  segments, tags, currency, dates, and notes. Best for backups and re-import.
- **CSV** — one row per trip with flattened segment counts, for spreadsheets.

Export includes only trips you own. Sensitive fields (confirmation numbers,
payment status, encrypted notes) are included in your own export so the data
round-trips — keep the exported file private.

## Import

Upload a previously exported JSON file (or hand-written JSON matching the
shape) to create trips. Each trip in the file becomes a new trip owned by you,
with its segments recreated. Import:

- does **not** overwrite existing trips — it always creates new ones;
- skips/normalizes unknown segment types and invalid dates;
- preserves confirmation numbers and notes from the file.

Use import to restore from a backup, migrate between instances, or bring in
trips authored elsewhere.

## Round-tripping

The recommended backup flow is: **Export JSON** → store with your
`ROAMARR_SECRET` → on a new instance, **Import JSON**. Because encrypted fields
are keyed to the original secret, reusing the same `ROAMARR_SECRET` keeps
prior exports consistent across instances.

## Related

- [Fare providers](./fare-providers.md) — separate configuration for fare-watch providers.
- [Trips](./trips.md) — trip fields and the Tools tab.
