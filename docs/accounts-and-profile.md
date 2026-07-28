<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Account and profile

Account settings are split between **Profile**, **Security**, **Emergency
Contacts**, **Email Settings**, and the other pages under **Me**.

## Profile

Open **Profile → Profile** to set:

| Setting | Effect |
| --- | --- |
| Display name | Name shown to other signed-in users. |
| Timezone | Default wall-clock timezone for account views and new data. |
| Flight check-in lead | Hours before a flight when an automatic reminder is due. |
| Document expiry lead | Days before expiry when a travel-document reminder is due. |
| Default currency | Currency selected by money forms and budget controls. |
| Email notifications | Allows optional SMTP delivery of notifications. |
| Webhook notifications | Allows optional signed-webhook delivery. |

Lead values are non-negative whole numbers. Changing them affects reminder
generation and future behavior; it does not rewrite every historical
notification.

The default currency is a form default and display context. Roamarr does not
perform a live foreign-exchange lookup.

## Email address and password

Open **Profile → Email** to change the address. It requires the current
password and uses normalized email uniqueness rules. Open **Security → Password**
to change the password; doing so invalidates other active sessions.

An administrator can require a password reset. A user in that state can reach
only the password-change and logout flows until a new password is saved.

See [Account security](./account-security.md) for password reset, TOTP,
passkeys, backup codes, and session behavior.

## Sessions

Open **Profile → Sessions** to inspect active sessions. Each row records
creation and expiry plus best-effort client IP and user-agent metadata.
Revoke sessions you do not recognize.

Session cookies contain a random 32-byte token. Roamarr stores only its
SHA-256 hash. Sessions normally expire after 30 days. Cookies are HTTP-only and
use the administrator-selected `SameSite` policy.

## Theme

Open **Profile → Theme** to preview and save a theme. Available choices include
Follow system, Light, Dark, High Contrast, OLED Black, Midnight Travels, Gentle
Gecko, Black Knight, Diamond, Dreams, Paranoid, Red Velvet, Subspace, Tiefling,
and Vibes.

The selection belongs to the signed-in user and applies across the application.
Use High Contrast when stronger borders and text contrast are needed.

## Emergency contacts

Open **Emergency Contacts** under **Me**. A contact can contain:

- name;
- relationship;
- phone;
- email;
- primary-contact flag.

Contacts belong to the user, not to a public trip. Owners can use a contact
when sending an emergency itinerary from Roamarr. Contact details are private
and are excluded from public links, calendar feeds, and privacy-safe AI
projections.

Emailing an itinerary requires usable personal or global SMTP. Review the
printable itinerary and recipient before sending.

## Account calendar

Open **Profile → Calendar** to generate one `.ics` subscription URL containing
all trips the user can currently view. An optional expiry can be applied.
Regenerating the feed URL immediately invalidates the old token.

The URL is a bearer secret. Anyone holding it can read its reduced calendar
data until rotation or expiry. See [Calendars](./calendars.md).

## Email settings

Open **Profile → Email Settings** for:

- personal IMAP ingestion;
- a personal OpenAI-compatible parser;
- personal SMTP or reuse of inbound-mail credentials.

Administrators independently control whether users may configure each personal
integration. Saved credentials are encrypted. See
[Email processing](./email-processing.md) and
[Personal SMTP](./per-user-smtp.md).

## MCP clients

When an administrator enables user MCP setup, **Profile → MCP Clients** lets a
user create, inspect, and revoke OAuth clients and grants. Confidential client
secrets are shown once. Request only the scopes the client needs.

See [OAuth 2.1](./oauth.md) and [MCP and AI](./mcp-ai.md).

## Personal records

The **Me** and **Organizer** sections also contain user-owned records:

- [travel documents](./travel-documents.md);
- [reminders](./reminders.md);
- [loyalty programs](./loyalty.md);
- [visited places](./visited-places.md);
- [cards](./cards.md);
- [insurance policies](./insurances.md);
- [groups](./groups.md).

Repository lookups enforce the owning user. These records do not become visible
just because another user can read one of the owner's trips.

## Global search shortcut

The search control is in the application header. Press `/` while focus is not
inside a form control to focus it. Search results always pass trip-access
checks. See [Search](./search.md) for lexical and semantic behavior.
