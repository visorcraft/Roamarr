<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Insurance

Insurance policies are user-owned records under **Organizer → Insurance**.

## Fields

| Field | Behavior |
| --- | --- |
| Provider | Required. |
| Policy number | Optional private plaintext. |
| Coverage summary | Optional plaintext. |
| Coverage amount | Optional integer minor units. |
| Currency | Three-letter code. |
| Start/end date | Optional coverage window. |
| Trip | Optional owned-trip link. |
| Notes | Optional private plaintext. |

Roamarr does not validate policy coverage, submit claims, or warn when a policy
expires. Confirm terms and dates with the insurer.

## Trip link

A policy can link to one owned trip. The trip's Documents count reflects
linked policy data, but the current Documents panel renders document links
rather than a full policy manager. Manage the policy from Insurance or through
the scoped JSON API/MCP tools.

Removing the trip link keeps the policy. Deleting the policy removes it.

## Benefits

Reusable benefit templates and per-record benefit rows currently belong to
payment cards, not insurance policies. Put policy coverage in Coverage summary
and amount fields.

## Privacy

Policy numbers, summaries, amounts, and notes are not separately
field-encrypted. They rely on encrypted database/storage and ownership
controls.

Read-only/public trip projections, calendars, notifications, and printable
itineraries omit policy data. OAuth/MCP insurance projectors strip policy
numbers and notes; `private-details:read` does not override that wallet
redaction.
