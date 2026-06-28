# Security and Privacy

Roamarr is a self-hosted travel organizer that stores itineraries, account data,
travel documents, reminders, sharing links, notification settings, and optional
provider credentials. This document records the security expectations, the data
Roamarr touches, and how to report vulnerabilities.

## Data Roamarr Handles

Roamarr may store:

- user accounts, password hashes, session metadata, and audit logs,
- trips, itinerary segments, reminders, comments, tags, and journal entries,
- travel document metadata and encrypted document numbers,
- companion, medication, accessibility, emergency-contact, and planning data,
- expenses, receipt attachments, loyalty programs, cards, benefits, insurance,
  and policy metadata,
- SMTP settings, webhook URLs, fare provider accounts, and encrypted provider
  secrets,
- public share tokens and calendar feed tokens.

Treat the database, attachment directory, backups, logs, and environment files as
sensitive.

## Security Invariants

- `ROAMARR_SECRET` is required at boot and must be a strong Base64 32-byte key.
- Encrypted-at-rest fields include travel document numbers, fare provider API
  keys, and the SMTP password.
- Passwords use argon2id and must not be stored or logged in plaintext.
- Session cookies hold only random tokens. The database stores only
  `sha256(token)`.
- Password changes invalidate other sessions.
- Disabled users cannot authenticate.
- Password reset tokens are random, hashed, 60-minute, and single-use.
- Public shares and calendar feeds must expose only reduced viewer projections.
- Mutations must enforce sharing and ownership checks before touching
  user-owned data.
- Security-relevant mutations must be audit logged.
- Card storage is limited to network and last four digits. Never store a full
  payment card number.

Do not expose private document numbers, confirmation numbers, membership
numbers, policy numbers, card details, or notes in notifications, emails,
webhooks, calendar feeds, public shares, logs, or reduced viewer projections.

## Outbound Traffic

Roamarr is self-hosted and does not need analytics or telemetry to operate.

The application may make outbound network requests only for configured runtime
features:

1. **SMTP delivery** when an administrator configures mail settings.
2. **Signed webhook delivery** when notification webhooks are configured.
3. **Fare checks** when fare provider accounts are configured.

Operators control these destinations through app settings and environment
configuration. Do not add analytics, crash reporting, or ping-home behavior
without an explicit design decision and an opt-in privacy model.

## Local Secrets And Files

Do not commit or publish:

- real `.env` files or deployment env files,
- MongrelDB Kit data directories, transaction logs, backups, or attachment directories,
- logs, screenshots, Playwright output, build output, dependencies, or local QA
  artifacts,
- SMTP credentials, webhook secrets, API keys, generated session data, or test
  accounts from a real instance.

Use `.env.example` as the public configuration template.

## Deployment Notes

- Keep `ROAMARR_SECRET` stable for an instance. Rotating it can make encrypted
  stored values unreadable unless a migration plan is used.
- Set `ORIGIN` to the public URL when Roamarr runs behind a reverse proxy so
  cookies and redirects are generated correctly.
- Use persistent storage for the MongrelDB Kit data directory and attachments.
- Restrict filesystem permissions on the database directory, attachment directory,
  backups, and environment files to the service operator.
- Keep Node.js and npm dependencies patched.
- Put TLS termination in front of Roamarr for any non-local deployment.

## Dependency Hygiene

Roamarr bundles third-party license and credit data into the Settings/About
pages. After dependency changes, run:

```sh
npm run credits:generate
```

Run the normal checks before opening security-sensitive changes:

```sh
npm run check
npm test
```

## Reporting a Vulnerability

Do not file a public GitHub issue, discussion, or pull request for security
problems. Report privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Fill in the advisory form with the details below.

This keeps the report confidential between you and the maintainers until a fix
is ready. Please include as much as you can:

- a description of the issue and its impact,
- step-by-step reproduction steps,
- the affected Roamarr version or commit,
- relevant configuration, logs, or proof-of-concept details,
- a suggested fix or mitigation, if you have one.

## What To Expect

- Acknowledgement of your report within a few days.
- An initial assessment and, where confirmed, a remediation plan.
- Progress updates through the private advisory thread until the issue is
  resolved.
- Credit for responsible disclosure in the advisory, unless you prefer to remain
  anonymous.

We ask that you give us a reasonable opportunity to ship a fix before any public
disclosure.
