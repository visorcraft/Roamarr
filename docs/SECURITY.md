<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Security and privacy

Roamarr stores account, itinerary, identity, health, location, and financial
metadata. Operators are responsible for host security, TLS, storage, backups,
network policy, retention, and access to the self-hosted instance.

This page documents the current protection boundary and private vulnerability
reporting process.

## Sensitive data

Roamarr can hold:

- user identities, password hashes, sessions, passkeys, TOTP state, OAuth
  grants, and audit history;
- dates, locations, booking confirmations, itinerary details, notes, comments,
  and journal entries;
- companion dietary, allergy, medical, accessibility, and child-travel data;
- travel documents and expiry dates;
- medication, entry-requirement, emergency-contact, home-security, serial
  number, and tracker data;
- expenses, receipt attachments, card metadata, loyalty memberships, and
  insurance policies;
- SMTP, IMAP, map, parser, OAuth-client, and fare-provider credentials;
- direct/group shares, invitations, public links, and calendar tokens.

Treat the database, attachments, backups, exported files, logs, environment,
browser sessions, OAuth tokens, public URLs, and generated PDFs as sensitive.

## Encryption and hashing

`ROAMARR_SECRET` must be base64 that decodes to exactly 32 bytes. It unlocks
the encrypted MongrelDB database and protects application data. Keep it stable
for the life of an installation.

Separately encrypted fields include:

- travel-document numbers;
- fare-provider API keys;
- global and personal SMTP passwords;
- global and personal IMAP passwords;
- map-tile API keys;
- TOTP secrets;
- AI parser API/subscription keys and OAuth client secrets.

Protected fields use AES-256-GCM. Receipt attachments are encrypted in
authenticated 64 KiB chunks with a derived key.

Passwords use argon2id. Session, password-reset, authorization-code, access
token, refresh token, OAuth client-secret, and TOTP backup-code values are
stored as hashes rather than plaintext.

Several private fields are not separately field-encrypted, including booking
confirmation numbers, loyalty membership numbers, insurance policy numbers,
important-item serial/tracker IDs, and free-form notes. They still rely on the
encrypted database and access controls. Do not enter unrelated secrets in
free-form fields.

Roamarr stores only card network and last four digits. Never enter a full PAN,
CVV/CVC, PIN, magnetic-stripe data, bank password, or one-time code.

## Authentication

- Password length: 8 through 1024 bytes.
- Session token: random 32 bytes; only SHA-256 hash stored.
- Session lifetime: normally 30 days.
- Password reset: random, hashed, one use, 60 minutes.
- TOTP: encrypted secret plus 10 one-use hashed backup codes.
- Passkeys: WebAuthn public credential and counter; private key stays with the
  authenticator.
- OAuth: mandatory S256 PKCE and one-use five-minute authorization codes.

Password changes invalidate other browser sessions. They do not automatically
revoke OAuth grants. Disabled users cannot authenticate or use bearer tokens.

Login, registration, setup, password reset, 2FA, WebAuthn, OAuth, MCP, public
share, calendar, maintenance, and other sensitive routes are rate-limited.
Security mutations are audit-logged.

## Authorization

Trip access uses centralized levels:

- owner-only for shares, public/calendar tokens, archive, duplicate, merge,
  and other ownership actions;
- owner or edit-share for trip mutations and private planning modules;
- owner or any current share for reduced reads.

Per-user cards, loyalty, insurance, documents, contacts, and credentials
perform owner-scoped lookups. Foreign references are validated before writes.

Group access follows live membership. Removing a member or group removes its
derived access.

## Projection boundaries

Read shares and public links receive a reduced trip/segment projection. It
excludes trip notes, payment status, money, private modules, account wallet,
documents, contacts, and attachments.

The owner can enable **Show details** separately for a read share or public
link. This adds segment confirmation numbers and type-specific detail JSON.
Treat such a public URL as highly sensitive.

Calendar feeds always use a smaller projection and never include confirmation
or detail JSON.

MCP tools enforce OAuth scopes plus their operation-specific trip access.
The optional `private-details:read` scope adds private trip notes,
confirmations, and itinerary details only when both administrator policy and
user consent permit it. Card, loyalty, insurance, and travel-document
projectors continue to strip protected numbers and sensitive notes.

Some feature-specific MCP list tools accept any viewable trip when their
specific scope is granted. This includes journal, medications, important
items, home tasks, requirements, and polls. Consider both the underlying trip
share and the OAuth scope when evaluating exposure.

Optional semantic search can index notes and confirmation text and return it to
an authenticated user who can view the trip. Read [Search](./search.md) before
enabling it on a multi-user instance.

## Attachments and uploads

Receipt and document uploads:

- maximum 10 MB;
- JPEG, PNG, WebP, PDF, or GPX (`.gpx` only, sniffed for a `<gpx>` root);
- content-signature validation;
- randomized storage name;
- chunked authenticated encryption.

Restore uploads undergo archive-layout and MongrelDB validation before
staging. Adapter and reverse-proxy body limits apply first. An optional
`ROAMARR_MAX_RESTORE_BYTES` cap can bound the archive further.

Never serve the attachment or database directories directly from the reverse
proxy.

## Webhook boundary

Webhook payloads are signed with HMAC-SHA256 over
`<Unix timestamp>.<exact JSON body>` using `ROAMARR_SECRET`. Receivers must
verify the exact body, compare in constant time, reject stale timestamps, and
deduplicate.

Roamarr accepts only `http`/`https` URLs without embedded credentials, rejects
literal local/private address ranges, does not follow redirects, and times out
after 10 seconds. It does not resolve a hostname before the private-address
check. Apply host firewall, DNS, and egress controls for stronger SSRF
protection.

## Outbound traffic

Roamarr has no analytics or mandatory telemetry. Enabled features can contact:

| Destination | Trigger | Data |
| --- | --- | --- |
| SMTP server | Mail delivery/test | Recipient, subject, body, link, SMTP credential. |
| IMAP server | Confirmation polling | Mailbox credential and message retrieval. |
| Configured webhook | Notification/test | Signed title/body/link JSON. |
| OpenAI-compatible parser/token URL | AI email parsing | Email subject/body and parser credential. |
| Open-Meteo | Weather | Coordinates rounded to two decimals and dates. |
| GeoNames | Map enable/import | Public dataset download. |
| NASA | Globe enable/import | Public texture download. |
| Hugging Face | Semantic-search enable | Model download. |
| Fare-provider endpoint | Enabled provider check | Provider-defined request and credential. |
| Raster tile host | Map viewed in browser | Tile coordinates and normal browser metadata. |

The currently bundled fare provider is a stub and makes no live fare request.

Use network policy to permit only integrations chosen by the operator. Do not
add analytics, crash reporting, or ping-home behavior without an explicit
opt-in design change.

## Public and bearer secrets

These values grant access without a password:

- session cookies;
- OAuth access/refresh tokens;
- public trip URLs;
- trip calendar-feed URLs;
- account calendar-feed URLs;
- password reset/invitation URLs until used or expired.

Do not log, paste, or publish them. Rotate/revoke after disclosure. A calendar
application may cache data even after token rotation.

## Backup and retention

Full backups contain database data and the default attachment directory, but
not `ROAMARR_SECRET`, database credentials, GeoNames rows, map texture, or
semantic model cache. A custom attachment path outside the database parent
needs a separate backup. Protect and restore-test every required backup.

Deleting a trip/user or rotating a token affects the live database. It cannot
recall prior backups, trip exports, printed pages, calendar caches, webhook
receivers, email, or PDFs. Operators must define retention and secure deletion
for those copies.

Scheduler cleanup removes expired sessions, challenges, authorization codes,
invitations/share windows, and rate-limit state. OAuth grants otherwise remain
until revoked. Audit retention and external logs remain operator concerns.

## Deployment controls

- Use the latest stable Roamarr and supported Node.js release.
- Use HTTPS for every non-loopback installation.
- Set `ORIGIN` to the exact public HTTPS origin.
- Run one application process per database.
- Give the service account narrow filesystem permissions.
- Keep database, attachments, and secrets outside web-served directories.
- Preserve the exact secret and optional database credentials separately.
- Restrict proxy forwarded-header trust.
- Monitor `/health` and `/health/deep`.
- Review Audit Logs, Sessions, users, shares, public tokens, and OAuth clients.
- Back up before upgrades, restore, Doctor, or destructive administration.

See [Deployment and upgrades](./deployment.md),
[Operations](./operations.md), and
[Backup and restore](./backup-restore.md).

## Repository hygiene

Never commit or publish:

- real `.env` or deployment environment files;
- databases, WAL/runs, backups, or attachments;
- credentials, tokens, real account/session data, or production exports;
- logs, screenshots, Playwright output, build output, dependencies, or
  machine-local state.

Use `.env.example` for public configuration.

After dependency changes:

```sh
npm run credits:generate
npm run check
npm test
```

## Report a vulnerability

Do not open a public issue, discussion, pull request, or social-media post for a
suspected vulnerability.

Use GitHub private vulnerability reporting:

1. Open the repository **Security** tab.
2. Choose **Report a vulnerability**.
3. Submit the private advisory form.

Include:

- affected version or commit;
- impact and affected data/roles;
- prerequisites and configuration;
- precise reproduction steps;
- minimal proof of concept;
- sanitized logs or responses;
- proposed mitigation, if known.

Never attach real secrets, production databases, or another person's private
travel data unless maintainers explicitly arrange a secure transfer.

Maintainers will acknowledge, assess, coordinate a normal semantic patch when
needed, and keep discussion in the private advisory until disclosure is safe.
Credit is available unless the reporter prefers anonymity.
