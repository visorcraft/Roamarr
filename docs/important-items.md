<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Important items

Important items track valuables, devices, and luggage trackers on a trip.

## Fields

- required name;
- optional companion carrying it;
- serial number;
- tracker ID;
- notes.

Serial numbers, tracker IDs, and notes are stored as private application data
but are not among Roamarr's encrypted-at-rest field list. Protect the database,
backups, edit shares, and integration scopes accordingly.

## Current access

The current **Prep** panel does not render important-item controls. Use an
OAuth/MCP client:

- `roamarr_important_item_list`;
- `roamarr_important_item_create`;
- `roamarr_important_item_delete`.

Writes require edit access. The list tool accepts a viewable trip with
`items:read`, so a read-shared user's authorized client can receive these
fields. Deletion requires `confirm: true`.

Important items are excluded from public links, calendar feeds, notifications,
and printable itineraries.
