<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Email processing

Roamarr can poll a shared IMAP inbox, personal IMAP inboxes, or both. It parses
travel confirmations, matches them to an owned trip, and creates itinerary
data through the same running application process.

## Administrator policy

Open **Configuration → Email**.

### User Access

Controls whether users may save personal:

- IMAP inboxes;
- SMTP senders;
- AI parsing providers.

Personal IMAP access is enabled by default. Personal SMTP and parser access are
disabled by default.

### Inbound Emails

Configures the optional global IMAP inbox. Enable it only after connection
details test successfully. The default instance is enabled logically but does
nothing until valid details exist.

### AI Parsing

Configures an optional global OpenAI-compatible parser:

- provider base URL;
- exact model ID;
- API/subscription key, or OAuth client credentials and token URL.

### Outbound Emails

Configures global SMTP for system notifications and ingestion replies. It does
not receive inbound messages.

Set **Email polling interval** under **Configuration → General**. Valid values
are 1 through 1440 minutes; the default is 5.

## Personal settings

Open **Profile → Email Settings**.

- **Inbound Emails** configures the signed-in user's IMAP mailbox.
- **AI Parsing** configures a personal provider when administrator policy
  allows it.
- **Outbound Emails** configures personal SMTP or reuses the inbound mailbox
  credentials when allowed.

Disabling a personal integration stops its use without exposing the saved
password. Clear credentials only through an explicit clear/reset control.

## Global-inbox identity

For the global inbox, Roamarr matches the message's `From` address exactly to a
normalized email address of an active user.

- A known active sender imports into that user's owned trips.
- An unknown or disabled sender is ignored.
- Ignored mail is marked Seen and its UID is advanced.
- Roamarr does not reply to an unknown global sender.

Forwarding can change the envelope or `From` value. Confirm that the message
visible to IMAP uses the Roamarr account email.

## Personal-inbox identity

A personal inbox belongs to one user, so incoming messages are processed for
that user without global sender matching. Each poll handles at most 20 unseen
messages with UIDs newer than the saved cursor.

## Deduplication

Roamarr deduplicates with the message's `Message-ID` when available, otherwise
with a SHA-256 hash of the complete source. Processed messages are marked Seen
and the last UID advances.

Marking an old message unread or copying it back into the inbox does not
guarantee another import. Deduplication is intentional.

## Parser selection

Parser priority is:

1. enabled personal AI provider, when administrator policy allows it;
2. enabled global AI provider;
3. built-in heuristic parser.

A provider failure falls back instead of stopping the inbox. Local parsing is
best effort. It recognizes common flight, hotel, train, rental-car, boat, and
event language plus dates, destinations, and confirmation codes.

## OpenAI-compatible request

Roamarr sends a `POST` request to the provider's `/chat/completions` endpoint
with:

- the configured model;
- `temperature: 0`;
- JSON-object response format;
- a structured extraction prompt;
- message subject and body, capped at 60,000 characters.

Authentication is either:

- `Authorization: Bearer <configured key>`; or
- OAuth `client_credentials`, using HTTP Basic client authentication at the
  configured token URL.

The remote provider receives the email content. That can include names,
booking details, confirmation numbers, and travel plans. Review the provider's
retention and training policy before enabling it. Use the local parser when
mail must not leave the server.

## Trip matching

Parsed data is scored only against trips owned by the target user:

- parsed date inside the trip: 70 points;
- parsed date within seven days of trip start: 45 points;
- destination/title word overlap: 15 points per word, capped at 30.

A score of at least 70 attaches the segment to the best match. Otherwise
Roamarr creates a new trip. A match can expand the trip's date range.

A segment with the same type and confirmation number is not added twice.
Imported segment timezones default to UTC.

Review imported trips and times. Email parsing is not authoritative, and
timezone-free confirmations are ambiguous.

## Replies

Roamarr attempts an acknowledgement using the user's resolved outgoing SMTP
configuration. It can report a successful import, ignored content, or parsing
failure. A reply failure does not undo an imported trip or segment.

Personal SMTP is preferred when allowed and enabled. Global SMTP is the
fallback. See [Personal SMTP](./per-user-smtp.md).

## Scheduler behavior

Inbox polling runs inside the guarded scheduler. The scheduler checks every
60 seconds, then respects the configured polling interval. It does not overlap
itself.

Inspect **Maintenance → Job History** for polling failures. A mailbox outage
does not block the rest of Roamarr.

## Security

IMAP and SMTP passwords, API keys, OAuth client secrets, and provider tokens
are encrypted at rest. Administrators should still:

- use a dedicated mailbox where possible;
- grant the smallest mailbox permissions;
- require TLS;
- rotate credentials after suspected disclosure;
- restrict personal providers according to organizational policy;
- avoid sending an entire general-purpose mailbox to an AI parser.

Email is untrusted input. Always review imported dates, locations, and
confirmation data before relying on them.
