<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Per-user SMTP override

Each user can configure their own SMTP server so that notifications and
itinerary-share emails are sent from their own mailbox, instead of the
admin-configured server.

Visit **SMTP** in the sidebar (under Profile).

## Configuration

| Field | Description |
| --- | --- |
| Enabled | Toggle to route your notifications through this server. |
| Host | Your SMTP server hostname. |
| Port | Typically 587 (STARTTLS) or 465 (TLS). |
| Transport security | `STARTTLS`, `SSL/TLS`, or `None`. |
| Username | SMTP authentication username. |
| Password | App password or credential. AES-256-GCM encrypted at rest; masked in the UI. |
| From address | The sender address for your outgoing notifications. |

Use **Send test email** to verify delivery. **Remove override** deletes the
configuration entirely; notifications revert to the admin SMTP server.

## Resolution order

1. If your override is **enabled** and **complete** (host + from address
   present), your SMTP server is used.
2. Otherwise, the admin SMTP server is used.
3. If neither is configured, SMTP delivery is skipped (in-app and webhook
   channels still fire).

## What uses the override

- All notification deliveries (reminders, fare alerts, etc.) that go through
  the SMTP channel.
- Emergency-contact itinerary-share emails, so the recipient sees the
  sharer's own address as the sender.
