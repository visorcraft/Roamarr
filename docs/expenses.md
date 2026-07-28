<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Expenses

Trip expenses live on the **Budget** tab and are available only to the owner
and edit shares.

## Fields

| Field | Behavior |
| --- | --- |
| Description | Required label. |
| Amount | Positive amount stored as integer minor units. |
| Currency | Uppercase currency code accepted by the current endpoint. |
| Category | `lodging`, `transport`, `food`, `activities`, or `other`. |
| Exchange rate | Optional stored rate, scaled to four decimal places by supported APIs. |
| Payer | Optional trip companion. |
| Splits | Optional companion IDs sharing the expense. |
| Receipt | Optional encrypted JPEG, PNG, WebP, or PDF. |

The current trip-page quick form collects description, amount, currency, and
category. Scoped API/MCP operations can manage payer, splits, and stored
exchange-rate fields.

## Currency

Roamarr does not fetch foreign-exchange rates. An expense keeps:

- original amount and currency;
- stored exchange rate;
- computed base amount.

The default rate is `1.0`. Entering a different rate is the caller's
responsibility. Historical values do not update when market rates change.

Category budgets compare only expenses whose currency matches that budget
line. See [Budgets](./budgets.md).

## Receipts

Supported content:

- JPEG;
- PNG;
- WebP;
- PDF;
- maximum 10 MB per attachment.

Roamarr validates content signatures, encrypts attachment chunks with
AES-256-GCM, and stores them under `ATTACHMENTS_PATH`. A renamed unsupported
file is rejected.

The adapter-node and proxy request limits must allow the upload. See
[Deployment and upgrades](./deployment.md#adapter-node-variables).

Receipts under the default attachment directory are part of the full
administrator backup. A custom attachment path outside the database parent
needs its own backup. Receipts are not included in trip JSON/CSV export.

## Splits and settlements

Payer and split assignments provide an informational view of who covered an
expense and who shares it. Roamarr does not transfer funds, charge cards, or
settle balances.

Deleting a companion can affect these references. Review trip money after
companion changes.

## Export

The Budget tab can export expense rows as CSV for local analysis. Treat this
file as private financial and travel data.

Trip JSON/CSV export is a separate itinerary portability feature and does not
carry receipts or the whole money graph.

## Visibility

Expenses, rates, payer/split data, and receipts are never included in:

- read-only direct/group trip projections;
- public links;
- calendar feeds;
- printable itineraries.

An edit share can view and modify money data. Grant edit access accordingly.
