<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Budgets

Set spending targets per trip and watch actuals roll up against them. Budgets
live on the trip page's **Money** tab, next to [expenses](./expenses.md).

## Budget categories

Budgets use the same five fixed categories as expenses:

- **lodging**
- **transport**
- **food**
- **activities**
- **other**

Setting a budget per category is optional — leave one blank to budget only the
categories you care about.

## Setting a budget

For each category you want to cap:

1. Open the trip's **Money** tab and choose **Set budget**.
2. Enter an **amount** and **currency** for each category.
3. Save.

Amounts must be positive whole numbers in the chosen currency. Each category
can use a different currency; Roamarr normalizes them into the trip's base
currency for comparison against spending.

## Spent vs budgeted

The Money tab shows, per category:

- **Budgeted** — the amount you set (converted to base currency).
- **Spent** — the sum of expenses in that category (converted to base currency
  using each expense's stored exchange rate).
- **Remaining / over** — the difference, highlighted when you exceed the cap.

A top-level total shows overall budget vs spending across all categories.

## Multi-currency notes

- Each **budget** line stores its own currency.
- Each **expense** stores its original currency, an exchange rate, and a
  normalized base amount.
- Totals are always presented in the trip's **base currency** (set when
  creating or editing the trip).
- Editing the base currency does not retroactively change stored amounts; it
  only changes the unit used to sum them.

## Privacy

Budgets are part of the trip's money data and follow the same visibility rules
as expenses: visible to the owner and shared users/groups, never exposed
through public links or the calendar feed.
