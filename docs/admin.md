<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Administration

The first setup account is an administrator. Administrative navigation is
split between **Configuration**, **Users**, **Fare providers**, and
**Maintenance**.

## Configuration → General

General settings include:

- instance name;
- default currency and timezone for new users/data;
- default date and date/time display formats;
- public self-registration;
- session-cookie `SameSite` policy (`lax` or `strict`);
- default flight check-in and document-expiry reminder leads;
- email polling interval, 1 through 1440 minutes;
- optional local semantic search.

`SameSite=Strict` forces reauthentication when arriving from some external
email or OAuth flows. The setting applies to newly issued session cookies.

Semantic search is off by default. Enabling downloads a local MiniLM ONNX model
and indexes broader trip text. Read [Search](./search.md), including its
privacy boundary, before enabling it.

## Configuration → Maps

Enable/disable Maps, import GeoNames, download the globe texture, and configure
the raster provider. API keys are encrypted. See [Maps](./maps.md).

## Configuration → Email

Tabs control:

- whether users may configure personal IMAP, SMTP, and AI parsing;
- the global inbound IMAP mailbox;
- an optional global OpenAI-compatible parsing provider;
- global outbound SMTP.

Saved passwords, keys, and client secrets are encrypted. A remote AI parser
receives email content. See [Email processing](./email-processing.md) and
[Notifications](./notifications.md).

## Configuration → Webhooks

Set one instance-wide outbound notification URL and test it. Users separately
enable webhook delivery in Profile. Roamarr signs every exact JSON body with
`ROAMARR_SECRET`.

Only `http`/`https` URLs without credentials are accepted. Literal local and
private IP ranges are rejected. Redirects are not followed. See
[Notifications](./notifications.md#signed-webhook).

## Configuration → MCP Clients

Administrators control:

- whether users can set up MCP clients;
- whether AI clients may request private trip details;
- an optional allowed client-ID list.

User MCP setup is disabled by default. A nonempty allowed-ID list disables
Dynamic Client Registration and limits authorization. Existing grants remain
independently revocable.

See [OAuth 2.1](./oauth.md) and [MCP and AI](./mcp-ai.md).

## Users

Administrators can:

- create user or administrator accounts;
- change role or email;
- disable/enable an account;
- require a password reset;
- delete an account.

Disabling blocks authentication and invalidates usable access while preserving
data. Deletion cascades according to database ownership relationships and can
remove owned trips/groups. Take a backup and verify the target before deleting.

Public registration requires completed setup and **Allow self-registration**.
Disabled users cannot sign in or use OAuth tokens.

## Fare providers

The current registry ships only **Stub (demo)**, which returns no live fare
data. Provider account keys are encrypted. See
[Fare providers](./fare-providers.md).

## Maintenance

- **Database Maintenance**: integrity, Flush, Garbage collect, Doctor.
- **Job History**: scheduler results and manual guarded run.
- **Audit Logs**: filter, inspect, and export security activity.
- **Backup & Restore**: full database/default-attachment archive and staged
  restore.
- **Seed Demo Data**: repeatable in-process demonstration dataset.

Doctor and restore can destroy data. Read [Operations](./operations.md) and
[Backup and restore](./backup-restore.md) first.

## Audit and secrets

Administrative changes are logged with actor and entity metadata. Prefer the UI
or supported API over direct database edits.

Secret fields generally show only whether a value exists. Leaving a masked
secret input blank preserves it unless the page explicitly says it clears or
removes the credential.

Administrators can read operational metadata and control integrations. Limit
the role to trusted accounts, require strong authentication, and review active
sessions and audit logs.
