<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Reminders

Reminders nudge you before something happens. They are created on trips and
segments, then delivered on schedule by Roamarr's background scheduler.

## Reminder kinds

| Kind | Source | Fires when |
| --- | --- | --- |
| **Flight check-in** | Auto-created for flight segments | `flight_checkin_lead_hours` before departure (default 24h). |
| **Document expiry** | Travel documents | `document_expiry_lead_days` before a passport/visa expires (default 90 days). |
| **Custom** | You, on a trip or segment | A chosen offset before the trip/segment start. |

Both flight-check-in and document-expiry lead times are per-user settings,
settable from your **Profile** page (an admin can also set instance defaults
under **Settings → General**).

## Creating a custom reminder

From a trip or segment, choose **Add reminder** and pick an offset (in minutes)
relative to the start time — negative to be warned *before*, positive for a
follow-up *after*. Examples:

- `-1440` minutes → 1 day before the segment starts.
- `-60` → 1 hour before.
- `10080` → 1 week after (a follow-up).

You can have one custom reminder per trip/segment. Editing the offset re-arms
it; cancelling removes it.

## How reminders are delivered

When its `fire_at` time arrives, the scheduler marks the reminder `sending`
then `sent` and fans the notification out across your enabled channels:

1. **In-app** — always on; creates a row in the **Notifications** page.
2. **Email (SMTP)** — if SMTP is configured and email is enabled in your
   profile.
3. **Webhook** — if a webhook URL is configured and webhook delivery enabled.

See [Notifications](./notifications.md) for SMTP/webhook setup and per-user
toggles.

## The scheduler

A single guarded scheduler tick runs every 60 seconds and handles due
reminders, fare-watch checks, and expired-session cleanup. It will not start
twice or overlap itself. Reminders fire only while Roamarr is running; a
reminder whose time passed while the server was down fires on the next tick.

## Managing reminders

List and cancel your reminders from the **Profile → Reminders** page or inline
on the trip/segment. Cancelling deletes the reminder; it will not fire.
