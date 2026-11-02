<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Mail holds

A trip can record one or more mail holds so you know which days away from home
are covered. USPS is the default carrier. Any other carrier name is allowed.

## Fields

- carrier, default `USPS`;
- start date and end date (`end` must be on or after `start`);
- optional confirmation number, address label, and notes;
- status: `requested`, `active`, `ended`, or `cancelled`.

A USPS hold longer than 30 days is saved. Roamarr warns that USPS caps a single
hold at 30 days and does not block the save. Cancelled holds do not cover
dates. The renewal date is the day the hold ends.

## Coverage

When the trip has a start and an end, coverage lists each away day that no
active, requested, or ended hold covers, plus a suggested next 30-day window
when the latest covering hold ends before the trip does. The Prep panel and
`roamarr_mail_hold_coverage` both use this report. **Next 30 days** creates the
following back-to-back hold with the same carrier and address label.

## Reminders

Saving a requested or active hold arms a reminder for the trip owner. It fires
at 09:00 in the owner's timezone, the configured number of days before the hold
ends. The default lead is 3 days. Change it on **Profile** or set the default
for new users under **Configuration → General**.

Deleting a hold, marking it cancelled or ended, or changing its dates replaces
or removes that reminder. The notification does not include the confirmation
number, address, or notes.

## Access

The trip **Prep** panel lists, adds, edits, and deletes holds for people who
can edit the trip. It links to [USPS Hold Mail](https://holdmail.usps.com/holdmail/).

MCP tools:

- `roamarr_mail_hold_list` (`mail-holds:read`);
- `roamarr_mail_hold_create`, `roamarr_mail_hold_update`, and
  `roamarr_mail_hold_delete` (`mail-holds:write`);
- `roamarr_mail_hold_coverage` (`mail-holds:read`).

Delete requires `confirm: true`. List, coverage, and writes all require edit
access to the trip. A read-only collaborator cannot load holds.

Mail holds are omitted from public share links and calendar feeds because they
show when a home is empty. JSON trip export and import include them with the
rest of the trip. CSV export stays segment-only. Database backups include the
`trip_mail_holds` table with the other trip data.
