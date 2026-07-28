<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Notifications

Roamarr delivers in-app notifications and can attempt SMTP email and one signed
webhook.

## Channels

| Channel | Enablement | Failure behavior |
| --- | --- | --- |
| In-app | Always | Stored in Notifications. |
| Email | User profile toggle plus usable personal/global SMTP | Failure is logged; other channels continue. |
| Webhook | User profile toggle plus configured global URL | Failure is logged; other channels continue. |

External channels run independently. A slow or failed SMTP service does not
prevent the webhook attempt or erase the in-app row.

Notification content is deliberately concise and avoids confirmation,
membership, policy, document-number, and private-note fields. User-written
reminder names can still contain sensitive text.

## Global SMTP

Open **Configuration → Email → Outbound Emails**. Configure:

| Field | Purpose |
| --- | --- |
| Host/port | SMTP endpoint, commonly 587 or 465. |
| Security | `STARTTLS`, `SSL/TLS`, or `None`. |
| Username/password | Optional authentication. |
| From address | Required sender for a usable global transport. |

`STARTTLS` requires an upgrade. `SSL/TLS` uses implicit TLS. `None` disables
TLS and should be confined to a trusted relay network.

The password is encrypted. Use the page's connection/test action. Roamarr uses
bounded socket/send timeouts and a small connection pool.

## Personal SMTP

When administrator policy permits it, **Profile → Email Settings → Outbound
Emails** can override global SMTP for that user. See
[Personal SMTP](./per-user-smtp.md).

## Signed webhook

Open **Configuration → Webhooks**. The request is:

```http
POST <configured URL>
Content-Type: application/json
X-Roamarr-Timestamp: <Unix seconds>
X-Roamarr-Signature: <lowercase hexadecimal HMAC-SHA256>
```

Body:

```json
{"title":"...","body":"...","link":null}
```

Verify the exact raw body:

```text
payload = X-Roamarr-Timestamp + "." + exact_raw_json_body
signature = lowercase_hex(HMAC-SHA256(ROAMARR_SECRET, payload))
```

Use the environment variable string as the HMAC key, compare signatures in
constant time, reject stale timestamps, and deduplicate repeated events.

Webhook restrictions:

- only `http` and `https`;
- no username/password inside the URL;
- literal loopback, link-local, and private IPv4/IPv6 targets are rejected;
- redirects are not followed;
- request timeout is 10 seconds.

The hostname check does not resolve DNS before validation. Put additional
egress/DNS restrictions around Roamarr when webhook SSRF resistance is part of
the threat model.

## Sources

Notifications can be created by:

- due reminders;
- changed fare-watch summaries;
- sharing/security/account workflows;
- operational tests and other application actions.

Not every data mutation sends a notification.

## User controls

Open **Profile → Profile** to enable/disable email and webhook delivery. In-app
delivery remains on. Open **Notifications** to review rows and mark them read.

Disabling a channel does not delete prior notifications or saved administrator
configuration.
