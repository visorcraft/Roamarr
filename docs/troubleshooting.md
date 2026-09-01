<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Troubleshooting

Preserve the exact browser, process, and proxy error before changing data.
Start with `GET /health/deep`, then use the matching section below.

## Setup keeps appearing

Roamarr redirects to `/setup` until the first user exists. Confirm:

- `ROAMARR_SECRET` is present in the environment of the Node process;
- it is the output of `openssl rand -base64 32`;
- `DATABASE_PATH` points to the intended persistent volume;
- the service account can create and write that directory;
- `DATABASE_USER` and `DATABASE_PASS` are either both set or both absent.

Creating the first account makes it an administrator. After setup completes,
`/setup` is no longer available.

## Invalid or missing secret

The secret must be base64 that decodes to exactly 32 bytes. Quotes, whitespace,
a newly generated value, or a secret mounted under the wrong variable can all
cause failure.

Do not generate another secret for an existing database. Restore the original
value from the deployment secret store or backup inventory.

## Database will not open

Common causes:

- the wrong `ROAMARR_SECRET`;
- changed or missing `DATABASE_USER` / `DATABASE_PASS`;
- a missing, read-only, or partially mounted database directory;
- two processes using the same database;
- an interrupted restore;
- damaged storage.

Stop extra processes. Check mounts, ownership, disk space, and the exact boot
error. Preserve current files before repair. Use **Check integrity** before
Doctor when the UI remains reachable. Doctor can discard corrupt runs.

## `GET /health` works but `/health/deep` fails

The lightweight route checks coarse process state. The deep route exercises
database integrity and reads. Inspect the deep JSON response, process logs, and
**Maintenance → Job History**. Take a backup if possible, then run the
read-only integrity check.

## Upload returns HTTP `413`

The default adapter-node request limit is `512K`. Receipts can be up to 10 MB
and restore archives (no application size cap by default; set
`ROAMARR_MAX_RESTORE_BYTES` to impose one).

Set `BODY_SIZE_LIMIT` to the required size and configure the reverse proxy with
an equal or larger request limit:

```env
BODY_SIZE_LIMIT=Infinity
```

Restart after changing the environment. A receipt must also be JPEG, PNG,
WebP, or PDF with matching file content, not only a renamed extension.

## Restore uploads but data does not change

A valid restore is staged first and applied only on restart. Restart the sole
Roamarr process, then check `/health/deep`. If boot fails, keep the staging and
`.old` paths intact and follow [Backup and restore](./backup-restore.md).

## Public URLs, cookies, OAuth, or passkeys use the wrong host

Set `ORIGIN` to the exact public HTTPS origin. Confirm the reverse proxy
preserves host and protocol. Restart Roamarr.

Passkeys require a secure browser context, except loopback development. OAuth
redirect URIs must match the registered value exactly, including scheme, host,
port, path, and trailing slash.

## Maps or city autocomplete are empty

An administrator must enable Maps under **Configuration → Maps**. Enabling
downloads and imports GeoNames city data and the globe texture. If an automatic
download fails, use the page's manual upload or re-import controls.

Check:

- outbound access to GeoNames and NASA for imports;
- database and sibling `maps/` write permissions;
- the configured tile provider and encrypted API key;
- browser access to the tile host;
- CSP-compatible `http` or `https` tile URLs;
- exact `{z}`, `{x}`, and `{y}` placeholders for a custom provider.

Maps being disabled should not block saving ordinary free-text destinations.

## Weather is unavailable

Weather appears only for dated trips within the 14-day horizon and needs
coordinates. Roamarr calls Open-Meteo from the server and caches results for
six hours. Check outbound HTTPS, trip/segment coordinates, system time, and the
Open-Meteo response. Failure should leave the itinerary usable.

## Semantic search cannot enable

The first enable downloads the MiniLM ONNX model from Hugging Face and writes
it to `EMBEDDINGS_CACHE_PATH`. Check outbound HTTPS, free disk space, directory
permissions, and process memory. Use **Configuration → General → Reindex now**
after correcting the cause. Disabling semantic search unloads the process model
but retains cached files.

## Email does not arrive

For outbound mail:

- use **Configuration → Email → Outbound Emails** to test global SMTP;
- check host, port, TLS mode, credentials, from address, and outbound network;
- confirm the user enabled email notifications;
- inspect personal SMTP under **Profile → Email Settings** when allowed.

Roamarr records the in-app notification even when an optional email delivery
fails.

## Inbound confirmations are not imported

Check **Maintenance → Job History**, then:

- global or personal IMAP is enabled and tests successfully;
- the polling interval is between 1 and 1440 minutes;
- the message is unseen and newer than the saved IMAP UID;
- a global-inbox message's `From` address exactly matches an active user;
- no existing message has the same `Message-ID` or source hash;
- an AI parser URL/model/credential works, or local best-effort parsing can
  recognize the message.

Roamarr advances processed UIDs and marks messages Seen, including ignored
global mail from unknown or disabled senders. Moving the same message back to
unread does not defeat deduplication.

## Reminder is late

The scheduler checks every 60 seconds. A reminder can be about one tick late,
and a reminder missed during downtime runs after restart. Inspect Job History.
Confirm system time, user timezone, trip/segment timezone, and notification
channel settings.

## Webhook fails

Only `http` and `https` URLs without embedded credentials are accepted.
Literal loopback, link-local, and private-network targets are rejected.
Roamarr does not follow redirects and times out delivery.

Verify the receiver uses the exact raw JSON body and checks:

```text
HMAC-SHA256(secret, "<X-Roamarr-Timestamp>.<exact JSON body>")
```

Compare the lowercase hexadecimal result with `X-Roamarr-Signature`.

## OAuth client cannot register

Dynamic Client Registration requires **Configuration → MCP Clients → Allow
users to set up MCP Clients**. It is also disabled while the allowed-client-ID
list is nonempty.

Registration must be JSON, no larger than 16 KiB, and uses valid HTTPS or
loopback HTTP redirect URIs. Public clients use `token_endpoint_auth_method:
none`; confidential clients use `client_secret_post`.

## OAuth authorization or token exchange fails

Check:

- client ID is allowed and owned by the approving user when applicable;
- requested scopes are registered to that client;
- redirect URI is an exact match;
- PKCE uses `S256`;
- the authorization code is unused and less than five minutes old;
- a confidential client sends the correct secret;
- the user is active and not forced to reauthenticate.

Refresh rotates the token pair. Retrying an already-used refresh token fails.

## MCP returns `404` after a restart

MCP Streamable HTTP session IDs live in process memory for at most one hour.
Restarting or moving a request to another process invalidates the session.
Initialize a new MCP session. This is another reason not to load-balance one
database across several Roamarr processes.

## MCP tool returns forbidden

The access token needs the tool's OAuth scope. Private trip details additionally
need both the administrator gate and user-approved `private-details:read`.
Destructive tools require `confirm: true`. The underlying trip must also be
owned, editable, or viewable as required by that operation.

## More evidence

When requesting help, provide:

- Roamarr version and Node.js version;
- deployment method and reverse proxy;
- the exact failing route or action;
- sanitized process/proxy logs;
- `/health` and `/health/deep` results;
- whether the problem began after an upgrade, restore, or setting change.

Never post secrets, database archives, cookies, OAuth tokens, confirmation
numbers, document numbers, or SMTP/IMAP credentials.
