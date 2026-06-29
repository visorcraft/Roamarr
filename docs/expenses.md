<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Expenses

Track what a trip costs on the **Money** tab. Each expense is an amount in any
currency, normalized into the trip's base currency for totals.

## Adding an expense

| Field | Notes |
| --- | --- |
| Description | Required (e.g. "Hotel — 2 nights"). |
| Amount + currency | The original amount and its currency (e.g. `120 EUR`). |
| Category | `lodging`, `transport`, `food`, `activities`, `other`. |
| Paid by | Optional [companion](./companions.md) who fronted the money. |
| Split among | Optional companions sharing the cost. |
| Receipt | Optional image/PDF attachment. |

When the expense currency differs from the trip's base currency, Roamarr
converts it using a stored exchange rate and records both the original
`amount` and a normalized `base_amount`. Totals in the Money tab and in
[budgets](./budgets.md) are always shown in the trip's base currency.

## Categories

The five fixed categories match the budget categories so spending rolls up
cleanly:

- **lodging** — hotels, rentals.
- **transport** — flights, trains, rentals, rides.
- **food** — restaurants, groceries.
- **activities** — tickets, tours.
- **other** — anything else.

## Receipt attachments

Attach a photo or PDF receipt to each expense. Attachments are stored on disk
(under `ATTACHMENTS_PATH`) and are private — they are never exposed through
public share links or calendar feeds. Delete the attachment from the expense
row at any time.

## Splitting costs

Set **Paid by** to one companion and **Split among** to the people sharing that
cost, to keep a running sense of who owes what. Splits are informational; they
do not move money.

## Privacy

Expenses, amounts, and receipts are personal data. They are visible only to the
trip owner and any shared users/groups — never through public links or the
calendar feed.
