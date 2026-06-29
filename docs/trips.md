<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Trips

A trip is the top-level container for everything you plan: segments, people,
expenses, documents, and prep work. Create one from **New trip** in the sidebar.

## Trip fields

| Field | Notes |
| --- | --- |
| Trip name | Required. Shown in lists and the page title. |
| Destination country / city | Optional but recommended for maps and "visited places". City autocomplete uses GeoNames. |
| Start / End date | Drives dashboard ordering and the itinerary timeline. |
| Base currency | Used for expense/budget totals (default `USD`). |
| Default visibility | `private`, `groups`, or `public`. See [Sharing](./sharing.md). |
| Status | `planning`, `booked`, `active`, `completed`. |
| Tags / Notes | Comma-separated labels for filtering; free-text notes. |

## Trip statuses

- **planning** — early ideas, dates/destinations not locked.
- **booked** — confirmations in hand (default for new trips).
- **active** — the trip is happening now.
- **completed** — finished; shows in history.

Change status from the trip page menu or the edit form.

## Quick actions

Each trip page exposes these in the header/menu:

- **Edit** — name, dates, destination, currency, status, tags, notes.
- **Duplicate** — copies the trip and its segments as a starting point.
- **Favorite/Unfavorite** — pins the trip to the top of the dashboard.
- **Archive/Unarchive** — hides from the default dashboard without deleting; archived trips stay searchable and restorable.
- **Share**, **Print** — opens [sharing](./sharing.md) / a printable itinerary.
- **Delete** — permanently removes the trip and all of its segments, expenses, companions, checklists, and reminders.

## Trip-page tabs

The trip page is organized into tabs (your selection is remembered per trip):

| Tab | Contents |
| --- | --- |
| **Itinerary** | The segment timeline and trip map. |
| **Prep** | Checklist, important items, home tasks, medications, entry requirements. |
| **Money** | [Expenses](./expenses.md) and [budgets](./budgets.md). |
| **People** | [Companions](./companions.md) and emergency contacts. |
| **Notes** | Free-form notes and journal entries. |
| **Documents** | Travel documents, [insurance](./insurances.md), document links. |
| **Tools** | Fare watch, [polls](./polls.md), calendar feed (editors only). |

Some tabs appear only once they have content, or for trip editors.

## Dashboard

The home dashboard lists non-archived trips sorted by start date (favorites
first). Search by name/destination; toggle **Show archived** to recover hidden trips.
