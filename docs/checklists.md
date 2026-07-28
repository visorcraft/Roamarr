<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Trip checklists

Each trip has one preparation checklist under **Prep**.

## Item fields

- required text, at most 200 characters;
- packed/done flag;
- optional assignment to a companion on the same trip.

Owners and edit shares can add items and toggle their state in the current
trip page. The assigned companion appears beside the item.

Server and MCP operations also support rename, delete, assignment changes, and
marking all items packed/unpacked. MCP tools are:

- `roamarr_packing_item_add`;
- `roamarr_packing_item_toggle`;
- `roamarr_packing_item_update`;
- `roamarr_packing_item_delete`;
- `roamarr_packing_list_build`.

Writes require `packing:write` and edit access. Destructive deletion requires
`confirm: true`.

## Templates

A user-owned packing template snapshots item labels/categories and can append
them to another editable trip. It does not preserve packed state. See
[Packing templates](./packing-templates.md).

## Visibility

The web trip page loads checklists only for owners/editors. Public links,
calendar feeds, printable itineraries, and notification payloads omit them.

MCP checklist reads require `packing:read` and the tool's trip-access check.
Checklist text can contain private plans, so keep both trip shares and scopes
narrow.

Deleting a companion removes or clears relational assignments according to the
database relationship. Review the checklist after changing the companion
roster.
