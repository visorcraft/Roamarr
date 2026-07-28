<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Reminders

Reminders are user-owned alerts tied to a trip, segment, document, or explicit
time.

## Kinds

| Kind | Source | Schedule |
| --- | --- | --- |
| Flight check-in | Flight segment | User's lead hours before start. |
| Document expiry | Travel document | User's lead days before expiry, at 09:00 in the user's timezone. |
| Custom | Trip, segment, or integration | Offset before a reference start, or explicit ISO time. |

Profile defaults are configured under **Profile → Profile**. Administrators
set defaults for newly created users under **Configuration → General**.

## Trip and segment reminder

The trip/segment UI asks for a non-negative number of minutes **before** the
start:

- `60`: one hour before;
- `1440`: one day before;
- `10080`: one week before.

A trip reminder uses 09:00 UTC on its start date as the reference. A segment
uses its stored start instant. Saving again upserts the reminder for that
source.

Authorized MCP clients can instead create a named custom reminder at an exact
ISO timestamp. This avoids the trip-date 09:00 convention.

## Automatic reminders

Creating or updating a flight schedules the owning user's check-in reminder.
Changing the user's lead setting affects subsequent generation.

A travel document with an expiry date schedules its owner's expiry reminder.
Removing the date or source record removes its generated reminder.

## Delivery

When due, Roamarr creates an in-app notification and attempts optional enabled
channels:

1. in-app, always;
2. email through personal or global SMTP;
3. signed webhook.

An optional channel failure does not make the underlying trip disappear. Check
the in-app notification and Job History. Webhook and email delivery can be
retried according to scheduler state.

See [Notifications](./notifications.md).

## Scheduler

The guarded scheduler checks every 60 seconds and processes at most 100 due
reminders per tick, oldest first. It does not overlap itself. A backlog drains
over later ticks.

A reminder that became due while Roamarr was stopped is picked up after the
next start. Delivery is at least once around a crash, so a rare duplicate is
possible.

## Manage

Open **Reminders** under **Me** to filter and inspect user reminders. Custom
reminders support safe name, description, time, and reference updates through
the available UI/API/MCP surface. Delete a reminder to cancel it.

A reminder whose new time is already past is not silently rearmed as a future
event. Review status after editing.

## Privacy

Notification payloads intentionally avoid private confirmation, membership,
policy, document, and note fields. The reminder name/description itself can
still contain sensitive user-entered text. Keep it minimal.
