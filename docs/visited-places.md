<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Visited places

Track countries and U.S. states you have visited. Visit the **Visited** page
under Profile in the sidebar.

## Manual marking

Toggle any country or U.S. state chip to mark or unmark it. Use the filter box
to narrow the list by name or code. Countries are grouped by continent; U.S.
states are shown on their own tab.

Each entry records:
- **Code** — ISO 3166-1 alpha-2 country code (e.g. `FR`, `JP`) or ISO
  3166-2:US state code (e.g. `US-CA`, displayed as `CA`).
- **Visited on** — an optional date (left blank for manual marks).
- **Source** — `manual`, `trip` (auto-marked from a past trip), or `ai`
  (marked via MCP/AI).

## Auto-mark from past trips

Click **Mark from past trips** to scan all your owned trips whose dates are in
the past or whose status is `active`/`completed`. Distinct country codes from
the trip destination and its segments are derived and marked with
`source: trip`.

- **Idempotent** — re-running never un-marks or overwrites an existing entry.
- **U.S. states** are also auto-marked when a segment or trip destination has
  `country_code === 'US'` and includes lat/lng coordinates that fall inside a
  state boundary.

## From a trip page

Open any trip and use the trip menu → **Mark places visited** to auto-mark
places from that specific trip.

## Privacy

Visited-place data is per-user and never exposed through public share links,
calendar feeds, notifications, or the MCP `viewerProjection`.
