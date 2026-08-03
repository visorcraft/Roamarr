<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# OAuth 2.1

Roamarr implements authorization code flow with mandatory S256 PKCE, refresh
token rotation, public and confidential clients, revocation, and optional
Dynamic Client Registration. OAuth protects both MCP and selected JSON API
routes.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | Authorization-server discovery. |
| `GET /.well-known/mcp.json` | MCP server metadata. |
| `GET /oauth/authorize` | Browser login and consent. |
| `POST /oauth/register` | Optional Dynamic Client Registration. |
| `POST /oauth/token` | Authorization-code exchange and refresh. |
| `POST /oauth/revoke` | Revoke an owned access-token row. |
| `POST /mcp` | Bearer-protected Streamable HTTP MCP. |

Discovery is built from `ORIGIN`. Clients should fetch it instead of
hard-coding endpoint URLs. OAuth discovery, register/token/revoke, MCP
metadata, and MCP responses permit cross-origin protocol requests.

## Administrator gates

Open **Configuration → MCP Clients**.

### Allow users to set up MCP Clients

Disabled by default. When off, users cannot manually create clients and
`POST /oauth/register` returns HTTP `403`. Existing clients and grants are not
automatically revoked.

### Allow private travel details through MCP

Disabled by default. When on, `private-details:read` becomes available for
client registration and consent. Both the administrator gate and explicit user
approval are required.

### Allowed client IDs

An empty list permits registered clients normally. A nonempty list:

- allows authorization only for listed IDs;
- disables Dynamic Client Registration;
- requires manual creation with an ID that the policy permits.

Because the normal manual form generates an ID, operators may need to clear the
list, create the client, add its generated ID, then restore the restriction.
Plan this change so an intended client is never locked out.

## Manual client registration

Open **Profile → MCP Clients**. Provide:

- client name;
- 1 or more exact redirect URIs;
- explicit scopes;
- public or confidential client type.

Public clients receive no secret and rely on PKCE. Use this for desktop,
mobile, browser, and other clients that cannot protect a secret.

Confidential clients use `client_secret_post`. The generated secret is shown
once and only its SHA-256 hash is stored. If it is lost, delete and recreate
the client.

Redirect URIs must match exactly during authorization and exchange. Include the
correct scheme, case-normalized host, port, path, query, and trailing slash.

## Dynamic Client Registration

Send JSON to `POST /oauth/register` when the administrator gate is on and the
allow-list is empty:

```json
{
  "client_name": "Example MCP client",
  "redirect_uris": ["http://127.0.0.1:33389/mcp-oauth-callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "trips:read segments:read"
}
```

Rules:

- `Content-Type: application/json`;
- body no larger than 16 KiB;
- 5 attempts per hour per client IP;
- client name 1 through 200 characters;
- 1 through 10 redirect URIs, each at most 2048 characters;
- HTTPS redirects are accepted;
- HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]`;
- public PKCE clients may use a reverse-DNS custom scheme such as
  `com.example.app:/oauth`;
- confidential clients cannot use custom schemes;
- redirects cannot contain credentials or fragments;
- `authorization_code` is required; `refresh_token` is optional;
- response type must be exactly `code`;
- auth method is `none` or `client_secret_post`.

If `scope` is omitted, registration receives every scope currently available
under administrator policy. Clients should always send a narrow explicit scope
string.

A dynamic client begins without an owning user. The first user who approves it
claims it and can then manage it under **Profile → MCP Clients**.

## Authorization flow

### 1. Create PKCE and state

Generate:

- an unpredictable verifier;
- `code_challenge = BASE64URL(SHA256(code_verifier))`;
- an unpredictable `state`.

### 2. Open authorization

```text
/oauth/authorize
?response_type=code
&client_id=<client-id>
&redirect_uri=<exact-registered-uri>
&scope=<space-separated-scopes>
&state=<opaque-state>
&code_challenge=<base64url-challenge>
&code_challenge_method=S256
```

The user signs in, reviews granted scopes, separately opts into requested
private details, and approves or denies. Roamarr filters requested scopes to
the client's registered scope set and current administrator policy.

On approval:

```text
<redirect-uri>?code=<one-time-code>&state=<state>
```

On denial:

```text
<redirect-uri>?error=access_denied&state=<state>
```

The client must verify `state`.

### 3. Exchange

The code is single-use and expires after five minutes.

```sh
curl -sS -X POST https://travel.example.com/oauth/token \
  -d grant_type=authorization_code \
  -d code='<code>' \
  -d client_id='<client-id>' \
  -d code_verifier='<verifier>' \
  -d redirect_uri='<exact-registered-uri>'
```

Add `client_secret` for a confidential client.

Response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 2147483647,
  "scope": "trips:read segments:read"
}
```

Roamarr grants are designed to remain usable until revoked. `expires_in` is
2,147,483,647 seconds, about 68 years, for client compatibility. Refresh tokens
have no independent natural expiry.

### 4. Refresh

```sh
curl -sS -X POST https://travel.example.com/oauth/token \
  -d grant_type=refresh_token \
  -d refresh_token='<refresh-token>' \
  -d client_id='<client-id>'
```

Add `client_secret` for a confidential client. A successful refresh issues a
new pair and immediately revokes the old access/refresh pair. Retrying the old
refresh token returns `invalid_grant`.

## Revocation

`POST /oauth/revoke` requires either:

- a signed-in browser session; or
- a valid access token in `Authorization: Bearer`.

Then submit an access token:

```sh
curl -sS -X POST https://travel.example.com/oauth/revoke \
  -H 'Authorization: Bearer <acting-access-token>' \
  -d token='<access-token-to-revoke>'
```

Current behavior is narrower than RFC 7009:

- the `token` lookup accepts an access token, not a refresh token;
- `token_type_hint` is ignored;
- an absent, unknown, already removed, or other-user token returns HTTP `400`;
- the operation is therefore not idempotent.

The Profile MCP-client/security UI can revoke a grant by its database row
without needing plaintext token material. Deleting a client revokes all of its
token rows. Deleting a user revokes that user's token rows. A disabled user
cannot use tokens while disabled.

Changing a password invalidates other browser sessions but does not itself
revoke OAuth grants. Revoke clients/grants separately after credential
compromise.

## Scopes

Discovery returns the current `scopes_supported`. Register and consent to the
smallest set.

| Scope | Permission |
| --- | --- |
| `trips:read` | View trips and itinerary. |
| `trips:write` | Create, update, delete, and archive trips. |
| `segments:read` | View itinerary segments. |
| `segments:write` | Create, update, delete, and reschedule segments. |
| `packing:read` | View packing checklists. |
| `packing:write` | Manage packing checklists and apply templates. |
| `budgets:read` | View trip budget categories and spending. |
| `budgets:write` | Set/update budget categories. |
| `expenses:read` | View trip expenses and receipt metadata. |
| `expenses:write` | Create, update, and delete expenses. |
| `places:read` | View visited countries/U.S. states. |
| `places:write` | Mark/unmark visited countries/U.S. states. |
| `reminders:read` | View the user's reminders. |
| `reminders:write` | Create, update, and delete reminders. |
| `profile:read` | Read travel-document summaries and prepared summaries. |
| `companions:read` | View trip companions. |
| `companions:write` | Add, update, and remove companions. |
| `sharing:read` | View trip shares and groups. |
| `sharing:write` | Create, update, or revoke trip sharing/groups. |
| `calendar:read` | View calendar feed URLs/tokens. |
| `calendar:write` | Rotate or revoke calendar feed tokens. |
| `templates:read` | View trip and packing templates. |
| `templates:write` | Create/delete trip and packing templates. |
| `travel-docs:read` | View user travel documents. |
| `travel-docs:write` | Create, update, and delete travel documents. |
| `doc-links:read` | View trip document links. |
| `doc-links:write` | Create, update, and delete document links. |
| `fares:read` | View fare providers/watches/results. |
| `fares:write` | Manage and check fare watches. |
| `polls:read` | View trip polls. |
| `polls:write` | Create polls, vote, and delete polls. |
| `journal:read` | View trip journal entries. |
| `journal:write` | Create, update, and delete journal entries. |
| `day-notes:read` | View per-day trip notes. |
| `day-notes:write` | Create, update, and delete per-day trip notes. |
| `items:read` | View important items. |
| `items:write` | Create and delete important items. |
| `requirements:read` | View entry requirements. |
| `requirements:write` | Create, update, and delete requirements. |
| `home-tasks:read` | View home tasks. |
| `home-tasks:write` | Create, toggle, and delete home tasks. |
| `medications:read` | View trip medications. |
| `medications:write` | Create and delete medications. |
| `cards:read` | View safe card metadata and benefits. |
| `cards:write` | Create, update, and delete cards/benefits. |
| `loyalty:read` | View privacy-projected loyalty records. |
| `loyalty:write` | Create, update, and delete loyalty records. |
| `insurance:read` | View privacy-projected policies. |
| `insurance:write` | Create, update, and delete policies. |
| `contacts:read` | View emergency contacts. |
| `contacts:write` | Create, update, and delete contacts. |
| `profile-prefs:read` | View timezone, reminder leads, currency, and email-processing settings. |
| `profile-prefs:write` | Update profile and email-processing settings. |
| `notifications:read` | View channel toggles. |
| `notifications:write` | Update channel toggles. |
| `user-smtp:read` | View personal SMTP configuration without password. |
| `user-smtp:write` | Set or clear personal SMTP. |
| `comments:read` | View trip comments. |
| `comments:write` | Create and delete the user's comments. |
| `gallery:read` | View place and trip photo galleries. |
| `gallery:write` | Reorder, caption, and delete gallery photos. |
| `search:read` | Run authenticated global search. |
| `private-details:read` | Add private trip notes, confirmations, and itinerary details where supported. |
| `admin:read` | View users, audit events, jobs, and statistics as an administrator. |
| `admin:write` | Perform administrator mutations. |
| `security:read` | View sessions, passkeys, OAuth clients, and security state. |
| `security:write` | Change security state and revoke credentials/sessions. |

Write scope does not imply read scope. Request both when a client needs both.
Scopes never bypass user ownership, trip access, administrator role, or an
operation's explicit confirmation.

`private-details:read` does not expose full payment-card numbers because
Roamarr never stores them. AI-facing wallet/document projectors continue to
strip membership, policy, and travel-document numbers and sensitive notes.

## Errors

Token errors use:

```json
{"error":"invalid_grant"}
```

Expected codes include `invalid_client`, `invalid_grant`, and
`unsupported_grant_type`. Registration errors include an
`error_description`. Rate limits return HTTP `429`.

Authorization-page validation can return human-readable HTTP `400` errors for
unknown client, redirect mismatch, missing challenge, unsupported response
type, or non-S256 PKCE.

## Security properties

- Authorization codes, access tokens, and refresh tokens are random.
- Only SHA-256 token/code/client-secret hashes are stored.
- Authorization codes are one-use and five minutes.
- S256 PKCE is mandatory for public and confidential clients.
- Redirect URIs are exact-match.
- Refresh rotates and revokes the old pair.
- Disabled/deleted users cannot authenticate.
- A client marked for reauthorization cannot use existing tokens until a new
  successful authorization.
- Client, consent, token revocation, and related changes are audit-logged.
- OAuth and MCP endpoints are rate-limited.

Treat both access and refresh tokens as long-lived bearer secrets. Never put
them in URLs, browser storage available to unrelated scripts, logs, or support
requests.

See [MCP and AI](./mcp-ai.md) and [HTTP JSON API](./http-api.md).
