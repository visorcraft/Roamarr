<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Payment cards

Cards are user-owned reference records under **Organizer → Cards**. Roamarr
does not process payments or connect to banks.

## Stored card fields

| Field | Values |
| --- | --- |
| Nickname | Required user label. |
| Network | `visa`, `mc`, `amex`, `disc`, or `other`. |
| Last 4 | Optional four digits. |
| Notes | Optional private plaintext note. |

Roamarr intentionally does not store a full primary account number. Never put
a full card number, CVV/CVC, PIN, magnetic-stripe data, online-banking
credential, or one-time code in **any** field, including Notes.

## Benefits

A card can have benefit rows with:

- `trip_delay`;
- `baggage_delay`;
- `trip_cancellation`;
- `other`;
- optional coverage amount in minor units;
- three-letter currency;
- notes.

Boot creates reusable benefit templates. Selecting a template pre-fills a new
card-benefit row; the resulting benefit belongs to the card and can be edited
or removed independently.

## Segment link

An editor can record which user-owned card was used for a segment. Ownership is
validated. This is an informational reference and does not charge the card or
create an expense.

## Privacy

Card rows belong only to their user. Trip sharing does not grant another user
access to the card record. Public links, calendars, notifications, and
printable itineraries omit it.

OAuth/MCP card projectors expose safe metadata and benefits. They never contain
a full PAN. Notes are stripped from AI-facing safe projections where required.
