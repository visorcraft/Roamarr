<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Sharing

Roamarr offers three ways to let others see or help with a trip. Open
**Share** from the trip page menu.

## 1. Share with people (user-to-user)

Invite any registered user by email and choose a permission:

- **read** — can view the trip and its segments.
- **edit** — full editing: add/edit/delete segments, expenses, companions, etc.

Per-share, toggle **Show details** to reveal confirmation numbers, payment
status, and notes for that viewer (off by default). Remove a share to revoke
access instantly.

## 2. Share with groups

Create groups on the **Groups** page (e.g. "Family", "Cycling club"). Sharing a
trip with a group grants the chosen permission (`read`/`edit`) to every member,
with its own **Show details** toggle — ideal when you share many trips with the
same people.

## 3. Public links

Generate a link anyone can open without an account:

- **Optional expiry** — a date/time after which the link stops working.
- **Show details** — whether confirmation numbers/details are visible (off by
  default).
- **Revoke** — destroys the token immediately; creating a new link issues a
  fresh token.

Public links are read-only and expose only the [viewer projection](#what-each-audience-can-see).

## Calendar feed

Each trip has a separate **calendar token** that produces an iCal feed of its
segments (subscribe from Google/Apple Calendar, etc.). Regenerate it from the
trip's **Tools** tab if it leaks; the old feed URL stops working.

## What each audience can see

| Data | Owner / editors | Shared users / groups | Public link / calendar |
| --- | --- | --- | --- |
| Segments, times, locations | Yes | Yes | Yes |
| Confirmation numbers, payment, notes | Yes | Only if **Show details** is on | Never |
| Expenses, budgets, companions | Yes | Yes (read) or editable (edit) | Never |
| Travel documents, loyalty numbers | Yes | Never | Never |

## Notes

- Only the trip **owner** can manage shares, public links, and the calendar
  token; duplicating a trip copies the trip and segments only, **not** its
  shares. See [Notifications](./notifications.md) for how shared users learn of
  changes.
