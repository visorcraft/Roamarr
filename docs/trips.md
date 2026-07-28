<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Trips

A trip owns itinerary segments and trip-specific planning records. Create one
from **Trips → New trip**.

## Fields

| Field | Behavior |
| --- | --- |
| Name | Required, up to the current form limit. |
| Destination | Optional country, state/province, city, and coordinates. |
| Start/end date | Optional inclusive travel window; end cannot precede start. |
| Status | `planning`, `booked`, `active`, or `completed`. |
| Base currency | Three-letter code used by trip money summaries; defaults to `USD` and is editable after creation. |
| Default visibility | `private`, `groups`, or `public` label. Access still requires an actual share or public token. |
| Notes | Private owner/editor text. |
| Tags | Comma-separated labels used for trip filtering. |
| Poster | Optional trip image. |

New trips default to `booked`. City resolution uses local GeoNames data when
Maps are enabled. Without it, ordinary free-text planning still works.

## Statuses

- `planning`: ideas and tentative arrangements.
- `booked`: reservations exist. This is the creation default.
- `active`: travel is in progress.
- `completed`: travel is finished.

Status is explicit. Roamarr does not automatically change it from the current
date.

## Trip page

Visible tabs depend on access and available content:

| Tab | Current contents |
| --- | --- |
| **Itinerary** | Timeline, List, and Board segment views; map/globe; weather; segment panel. |
| **Prep** | Shared trip checklist. |
| **Budget** | Expenses, category budgets, money metrics, and fare-watch counts. |
| **People** | Companion roster. |
| **Notes** | Trip journal and comments. |
| **Documents** | External trip document links. |

Editors also have server, API, or MCP access to polls, home tasks, medications,
entry requirements, important items, packing templates, and fare watches.
Those modules are not all rendered as dedicated panels in the current trip
page.

## Menu actions

Depending on ownership and edit access, the trip menu offers:

- edit fields;
- favorite/unfavorite;
- share;
- print;
- calendar download;
- duplicate;
- mark destination places visited;
- archive/unarchive.

Deletion is permanent and removes dependent trip data. Public, calendar, and
share tokens stop working. Take a full backup when deletion cannot be
recreated.

## Access

- Owner: all trip actions, shares, tokens, duplication, archive, and delete.
- Edit share: itinerary and private trip-module changes, subject to each
  operation's ownership rule.
- Read share: reduced trip/segment projection and sanitized companion names.
- Public link: reduced read-only projection.

Some actions displayed to an editor can still be owner-only at the server.
For example, duplication, merge, sharing administration, and archive require
ownership.

See [Sharing](./sharing.md) for the exact data matrix.

## Poster image

An owner or editor can click the poster area to upload or replace a JPEG, PNG,
or WebP image up to 10 MB. Roamarr validates the file, stores it as an encrypted
attachment, and attempts to remove the replaced image. Signed-in users who can
view the trip can load the poster. Public links and calendar feeds do not
expose the poster file.

## Favorite and archive

Favorite is a personal flag on an owned trip. Archive removes the trip from
the default active list without deleting it. Use the Trips filter to show
archived records and restore them.

Archived trips are excluded from global search. They remain addressable to
authorized users.

## Duplicate

Duplication is owner-only and copies core trip fields and segments. It does not
copy shares, public/calendar tokens, companions, money, checklists, private
modules, documents, reminders, comments, or receipts.

See [Templates and trip merge](./templates-and-merge.md).

## Merge

**Trips → Merge** moves a donor owned trip into a different recipient owned
trip, reconciles related rows, and deletes the donor. Use it after an email
import creates a duplicate trip. Merge is destructive.

The merge can move itinerary, companions, money, documents, reminders,
comments, polls, planning modules, and shares. It combines dates, tags, notes,
posters, and same-currency budgets according to conflict rules.

Read [Templates and trip merge](./templates-and-merge.md) before using it.

## Trips list and dashboard

The Trips page supports query, tag, status, archive/favorite filters, sort
field, and order. Shared trips appear only while a valid direct or group share
exists.

The dashboard emphasizes upcoming non-archived travel plus reminders,
documents, and recent activity. The global search is separate and follows
[Search](./search.md).

## Portability

JSON/CSV export includes owned trip core fields and segments, not the complete
trip graph. Full disaster recovery uses the administrator backup.

See [Import and export](./import-export.md) and
[Backup and restore](./backup-restore.md).
