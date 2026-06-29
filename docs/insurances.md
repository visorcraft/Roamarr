<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Insurance

Track travel insurance policies and attach them to trips. Manage policies from
the **Insurance** page (profile-level) or from a trip's **Documents** tab.

## Policy fields

| Field | Notes |
| --- | --- |
| Provider | Required (e.g. "World Nomads"). |
| Policy number | Free text; sensitive, never shown publicly. |
| Coverage summary | Short description of what's covered. |
| Coverage amount + currency | The insured sum (e.g. `100000 USD`). |
| Start / end date | When the policy is in force. |
| Trip | Optional trip to attach the policy to. |
| Notes | Free text. |

## Attaching a policy to a trip

A policy can optionally be linked to one trip. When attached, it appears on
that trip's **Documents** tab alongside travel documents and document links,
giving you one view of everything relevant to the trip.

- Attach from the policy editor by choosing a trip, or
- Add a policy from the trip's **Documents** tab.

Detaching (clearing the trip) keeps the policy on your profile but removes it
from the trip view.

## Benefit templates

Some credit cards and policies bundle named benefits (e.g. "Primary CDW",
"Trip cancellation $10k"). To standardize these across cards and policies,
Roamarr keeps **benefit templates** (managed on the **Cards** page):

- Each template has a **benefit type**, **name**, optional **coverage amount**
  and **currency**, and a **description**.
- Templates are seeded with sensible defaults at boot and can be edited by
  admins; card and policy benefits reference these types for consistency.

## Privacy

Policy numbers, coverage amounts, and notes are personal. They are visible
only to you (and trip editors where attached) — never through public share
links or the calendar feed.

## Reminders

A policy's end date doesn't currently drive a dedicated reminder, but travel
**document** expiry (passport/visa) does — see [Reminders](./reminders.md).
Keep policy end dates current so coverage doesn't lapse unnoticed.
