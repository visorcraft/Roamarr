<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Personal SMTP

Personal SMTP sends a user's notifications and itinerary emails through that
user's mailbox. An administrator must first enable personal SMTP under
**Configuration → Email → User Access**.

## Configure

Open **Profile → Email Settings → Outbound Emails**. Choose either:

- reuse the personal inbound IMAP host/username/password for SMTP; or
- enter a separate SMTP host, port, security mode, username, password, and from
  address.

Reuse mode uses STARTTLS on port 587. Separate mode supports:

- `STARTTLS`;
- `SSL/TLS`;
- `None`.

Use a provider-specific app password when available. The saved password is
encrypted and is not returned to the browser.

## Resolution order

For mail associated with a user:

1. usable personal Email Settings, when administrator policy allows it;
2. a compatible saved legacy personal SMTP override, when present and allowed;
3. global SMTP;
4. skip email when none is usable.

In-app and webhook delivery remain independent.

## Uses

Personal SMTP can send:

- reminder and fare-watch notification email;
- inbound-confirmation processing replies;
- emergency-contact itinerary email;
- other user-addressed application mail.

The recipient and message are chosen by the calling workflow. Enabling
personal SMTP does not turn Roamarr into a general mail client.

## Disable or clear

Disable personal sending to fall back to global SMTP while retaining saved
fields. Use an explicit clear/remove control to delete saved credentials.
Leaving a masked password field blank preserves the existing password unless
the page says otherwise.

An administrator can disable personal SMTP for every user. That immediately
changes transport selection to global SMTP without exposing or decrypting
personal credentials.

## Troubleshooting

- Test the exact transport from Email Settings.
- Confirm the provider permits the chosen From address.
- Use port 465 with `SSL/TLS`, or port 587 with `STARTTLS`, unless the provider
  documents another setting.
- Check firewall/DNS access from the Roamarr server.
- Confirm email notifications are enabled under Profile.
- Inspect process logs for bounded SMTP connection, greeting, socket, or send
  timeout errors.

Do not use `None` over an untrusted network.
