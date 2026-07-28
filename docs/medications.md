<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Medications

Medication records are private trip planning data.

## Fields

- required name;
- optional companion;
- dosage;
- schedule;
- start/end timestamps;
- notes.

The companion, when supplied, must belong to the same trip. Roamarr does not
provide clinical advice, interaction checking, dose calculation, or pharmacy
fulfillment.

## Current access

The current **Prep** panel does not render medication controls. Use an
OAuth/MCP client:

- `roamarr_medication_list`;
- `roamarr_medication_create`;
- `roamarr_medication_delete`.

Create/delete requires edit access. The list tool accepts a viewable trip when
the client has `medications:read`. This can expose health information to a
read-shared user's authorized client, so grant trip access and OAuth scopes
carefully. Deletion requires `confirm: true`.

Medication data is excluded from public links, calendar feeds, notifications,
and printable itineraries.
