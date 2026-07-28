<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Packing templates

A packing template is a private user-owned snapshot of checklist labels and
categories.

## Behavior

- Creating from a trip copies its current checklist.
- Packed/done state is not copied.
- Applying appends items to the destination trip.
- Existing checklist rows remain.
- Applying the same template twice can create repeated items.
- Templates are not shared with trip collaborators.

## Current access

The trip **Prep** tab renders and edits the checklist. The current page does not
render separate save/apply template controls, although the server actions
exist.

Use an OAuth/MCP client with the narrow required scopes:

- `roamarr_packing_template_list`;
- `roamarr_packing_template_create`;
- `roamarr_packing_template_delete`;
- `roamarr_packing_list_build`;

Template deletion is destructive and requires `confirm: true` over MCP.
Applying a template requires edit access to the destination trip.

See [Templates and trip merge](./templates-and-merge.md).
