<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Day notes

Each trip day on the itinerary can carry one optional note — a short text
with an optional icon — shown inside its day card on the trip page.

## Note fields

- local trip day (`YYYY-MM-DD`), one note per day per trip;
- optional icon (a small set of built-in icon names such as note, info,
  warning, highlight, reminder);
- required body, at most 10,000 characters.

Owners and edit shares can add, edit, and delete day notes inline on the
trip page. Anyone who can view the trip sees saved notes read-only. An
itinerary toolbar toggle shows or hides day notes for the current session.

Note bodies render the same safe Markdown subset as trip notes (headings,
bold/italic, links, lists, code) on the trip page; other projections keep the
raw text.

MCP tools are:

- `roamarr_trip_day_notes_list`;
- `roamarr_trip_day_notes_set` (upserts the note for a trip day);
- `roamarr_trip_day_notes_delete` (requires `confirm: true`).

Reads require `day-notes:read` and view access to the trip; writes require
`day-notes:write` and edit access.

## Visibility

Day notes are private trip details. Public share links, calendar feeds,
printable itineraries, and the viewer projection omit them. Keep trip shares
and OAuth scopes narrow when notes contain private plans.
