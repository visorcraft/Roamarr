<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Entry requirements

Entry requirements track user-entered visa, vaccination, and other destination
tasks. Roamarr does not fetch or verify government rules.

## Fields

- country;
- requirement type;
- status: `needed`, `in_progress`, `complete`, or `not_needed`;
- optional due date;
- notes.

Always confirm official requirements with the destination government and
carrier. Rules can change after a record is saved.

## Current access

The current **Prep** panel does not render requirement controls. Use an
OAuth/MCP client:

- `roamarr_entry_requirement_list`;
- `roamarr_entry_requirement_create`;
- `roamarr_entry_requirement_update`;
- `roamarr_entry_requirement_delete`.

Writes require edit access. The list tool accepts a viewable trip with
`requirements:read`. Deletion requires `confirm: true`.

Requirements are excluded from public links, calendars, printable itineraries,
and notifications. Notes can still contain health or application details.
