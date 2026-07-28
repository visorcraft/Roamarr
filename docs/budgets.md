<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Budgets

Budgets are optional category caps on a trip's **Budget** tab.

## Categories

- `lodging`
- `transport`
- `food`
- `activities`
- `other`

There is at most one stored cap per category and trip.

## Set a cap

Enter a positive amount with at most two decimal places. The web action creates
the line in the current editor's profile default currency. Updating an existing
line changes its amount but keeps its stored currency.

To change that currency, remove the cap, set the desired profile default
currency, and create it again, or use an authorized integration that supports
the required field.

## Spending calculation

Roamarr groups expenses by category and normalized currency. A budget line
counts only expenses in the same category and same currency.

For example, a `500 USD` lodging cap does not include a `200 EUR` lodging
expense. Roamarr performs no live conversion for this comparison.

The line reports:

- cap;
- matching spent amount;
- remaining or overage;
- alert state: normal, near at 80 percent, or over at 100 percent.

Trip-level money summary cards can use base-amount fields, but that does not
turn budget category comparisons into live FX conversion.

## Currency fields

- Trip base currency defaults to `USD` and is editable on the trip.
- A user's default currency drives new web budget lines.
- Each expense has its own original currency and optional stored rate.
- Each budget category stores its own currency.

Changing a profile or trip currency does not rewrite existing budget or
expense amounts.

## Access

Owners and edit shares can set or remove caps. Read shares, public links, and
calendar feeds cannot see trip money. See [Sharing](./sharing.md).
