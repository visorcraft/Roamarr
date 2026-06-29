<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Loyalty programs

Keep all your frequent-flyer, hotel, and rewards numbers in one place. Loyalty
programs are **profile-level** — they belong to you, not to any single trip —
so you can reference them wherever you travel.

## Managing programs

From **Profile → Loyalty** (the loyalty page), add a program with:

| Field | Notes |
| --- | --- |
| Program name | Required (e.g. "United MileagePlus", "Marriott Bonvoy"). |
| Membership number | Free text; sensitive, never shown publicly. |
| Balance | Optional points/miles balance (whole number). |
| Notes | Free text (e.g. elite status, expiry rules). |

Edit or delete a program from its row. There is no per-trip ownership — the
same program is available everywhere once added.

## Using program numbers

Because membership numbers are sensitive, they are **not** exposed in public
share links or calendar feeds. Reference them when booking or checking in by
opening your profile. For per-segment payment tracking, link a [card](./cards.md)
instead — segments have a `card_id` field for the card used to pay.

## Privacy

- Program name, membership number, balance, and notes are private to you.
- Shared users and groups on a trip do not see your loyalty programs.
- Public links and the iCal/calendar feed never include them.

## Notes

- Loyalty programs are distinct from [insurance](./insurances.md) policies
  (which can be attached to a trip) and from [travel documents](./travel-documents.md)
  (passports/visas, which drive expiry reminders).
- Keep balances current by editing the number after each redemption; Roamarr
  does not sync with provider APIs.
