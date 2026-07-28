<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Templates, duplication, and merge

Roamarr provides three related workflows: lightweight trip templates, exact
trip duplication, and donor-to-recipient merge.

## Trip templates

A trip template belongs to one user. It snapshots:

- template name;
- trip name and destination fields;
- trip notes and tags;
- segment type, title, and location.

It intentionally omits trip dates and segment times. Applying a template
creates a new owned trip and gives template segments current UTC timing, ready
for editing.

The new-trip form can apply an existing template. Creation and management are
also available through the scoped MCP tools:

- `trip_template_create`;
- `trip_template_list`;
- `trip_template_apply`;
- `trip_template_delete`.

Templates do not carry shares, public tokens, calendar tokens, companions,
expenses, documents, reminders, receipts, or account records.

## Packing templates

A packing template belongs to one user and stores a named set of checklist item
labels and categories. Applying one adds its items to a trip checklist. It does
not delete existing checklist rows.

Create a template from a useful checklist or manage it through:

- `packing_template_create`;
- `packing_template_list`;
- `packing_template_delete`;
- `packing_list_build`;

See [Packing templates](./packing-templates.md).

## Duplicate a trip

Only the owner can duplicate a trip. Duplication copies the trip's core fields
and itinerary segments into a new owned trip.

It does not copy:

- direct or group shares;
- pending invitations;
- public or calendar tokens;
- companion and attendee records;
- expenses, budgets, receipts, or settlements;
- checklist and other private planning modules;
- document links, reminders, comments, or polls;
- user-owned wallet or identity records.

Use duplication when the itinerary shape is useful but access and private
planning state should start clean.

## Merge trips

Merge fixes a confirmation imported into the wrong trip or two independently
created records that represent one journey. Only the owner can merge, and the
donor and recipient must be different owned trips.

The recipient survives. Roamarr moves or combines the donor's:

- segments and fare watches;
- companions and expense references;
- expenses and receipts;
- journal entries and comments;
- document links;
- polls;
- home tasks, medications, entry requirements, and important items;
- reminders;
- direct/group shares;
- tags, notes, destination/date context, and poster where applicable.

It also updates templates that referenced the donor and then permanently
deletes the donor trip.

When equivalent linked users or shares already exist, Roamarr reconciles them
instead of leaving duplicate access rows. It preserves the stronger share
permission and **Show details** setting. Same-category budget rows combine only
when their currencies match. The merged date window expands to contain both
trips, and tags are unioned.

## Before merging

Merge is destructive and has no undo button:

1. export both trips for reference;
2. take a full backup when the data matters;
3. verify donor and recipient carefully;
4. review shares and private data on both trips;
5. run the merge;
6. inspect itinerary order, companions, money, documents, reminders, and
   access afterward.

Use **Trips → Merge** or the OAuth-protected mobile merge route. MCP does not
expose a merge tool.
