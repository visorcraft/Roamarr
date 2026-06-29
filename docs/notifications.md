<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Notifications

Roamarr delivers notifications through three channels:

1. **In-app** — always on; creates a notification row visible in the
   Notifications page.
2. **Email (SMTP)** — sends an email to the user's registered address.
3. **Webhook** — POSTs a signed JSON payload to a configured URL.

Each user can independently toggle email and webhook delivery in their profile.

## Admin SMTP

The admin configures a single SMTP server under **Settings → Email (SMTP)**:

| Field | Description |
| --- | --- |
| Host | SMTP server hostname. |
| Port | Typically 587 (STARTTLS) or 465 (TLS). |
| Transport security | `STARTTLS` (recommended), `SSL/TLS` (implicit, port 465), or `None` (plaintext). |
| Username / Password | SMTP credentials. Password is AES-256-GCM encrypted at rest. |
| From address | The sender address for outgoing email. |

Use **Send test email** to verify SMTP delivery specifically (distinct from
**Send test notification**, which fans out to all enabled channels).

## Webhook

When a webhook URL is set, Roamarr POSTs:

```json
{ "title": "...", "body": "...", "link": null }
```

with two headers:
- `X-Roamarr-Signature` — HMAC-SHA256 of `{timestamp}.{body}` using
  `ROAMARR_SECRET`.
- `X-Roamarr-Timestamp` — Unix seconds.

## Per-user SMTP override

See [Per-user SMTP](./per-user-smtp.md) for sending notifications from your
own mailbox instead of the admin server.
