<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Import and export

The Trips page moves owned trip and segment data as JSON or CSV. This is a
portability workflow, not disaster recovery.

## Export scope

Export includes only trips owned by the signed-in user.

JSON carries:

- trip name;
- country, state/province, city, and coordinates;
- start/end dates;
- notes, tags, and default visibility;
- segments with type, title, local start/timezone, end, location,
  confirmation, and structured details.

CSV is flattened for spreadsheet use. It carries trip identifying fields and
segment rows but cannot preserve every nested JSON field. Imports group CSV
rows by trip name and date window.

Export does not include:

- users, passwords, security settings, or sessions;
- direct/group shares, invitations, public tokens, or calendar tokens;
- companions and attendees;
- expenses, budgets, receipts, or attachments;
- checklist, journal, comments, polls, reminders, or other private modules;
- user-owned documents, cards, loyalty, insurance, or emergency contacts;
- administrator configuration and audit records.

Files are plaintext and can contain trip notes, confirmations, and itinerary
details. Protect them.

## Import preview

Upload JSON or CSV and review the dry-run preview before applying it. The
validator checks:

- required names;
- date ranges;
- country/city/coordinate values;
- supported segment types;
- timestamps and timezones;
- visibility and field lengths.

Import always creates new owned trips. It does not overwrite or deduplicate an
existing trip. Valid trips/segments can import while invalid records are
reported, so read the final result instead of assuming all-or-nothing success.

When Maps are enabled, city selection must resolve against local data where
required. With Maps disabled, free-text location data can still import.

A trip imported with public default visibility receives a new public token.
Review and revoke that link if public access was not intended.

## Format guidance

Use JSON for Roamarr-to-Roamarr portability because it retains nested segment
details and coordinates. Use CSV for spreadsheet inspection or simple
hand-authored input.

Do not rely on unknown fields being preserved. Use the shape from a current
export as the template for a hand-authored import, and test with preview.

## After import

Review:

- trip dates and timezones;
- duplicate trips;
- public visibility/tokens;
- confirmations and detail JSON;
- map coordinates;
- missing private modules;
- newly created segments.

Use [Trip merge](./templates-and-merge.md#merge-trips) when an imported trip
must be folded into an existing owned trip.

## Backup is different

A full administrator backup contains the database and default attachment
directory and needs the original `ROAMARR_SECRET`. A custom attachment path
outside the database parent needs a separate backup. Trip export contains
plaintext portable fields and does not depend on the source secret for import.

Use [Backup and restore](./backup-restore.md) to recover an instance.
