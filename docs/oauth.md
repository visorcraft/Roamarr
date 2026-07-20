<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# OAuth 2.1 integration

Roamarr implements the OAuth 2.1 authorization-code grant with mandatory PKCE
(SHA-256). The protocol surface is generic — any OAuth 2.1 client can integrate,
not just MCP / AI tools. The [MCP / AI integration](./mcp-ai.md) is the most
common consumer and documents the available tools, prompts, and resources on top
of this foundation.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | Discovery metadata (RFC 8414). |
| `GET /oauth/authorize` | Login + consent prompt; issues an authorization code. |
| `POST /oauth/token` | Exchanges a code or refresh token for an access token. |
| `POST /oauth/revoke` | Revokes an access or refresh token. |
| `POST /mcp` | Bearer-protected MCP JSON-RPC endpoint. |
| `GET /.well-known/mcp.json` | MCP server metadata. |

### Discovery metadata

`GET /.well-known/oauth-authorization-server` returns:

```json
{
  "issuer": "https://your-roamarr-origin",
  "authorization_endpoint": "https://your-roamarr-origin/oauth/authorize",
  "token_endpoint": "https://your-roamarr-origin/oauth/token",
  "revocation_endpoint": "https://your-roamarr-origin/oauth/revoke",
  "mcp_endpoint": "https://your-roamarr-origin/mcp",
  "mcp_metadata_endpoint": "https://your-roamarr-origin/.well-known/mcp.json",
  "scopes_supported": ["trips:read", "trips:write", "...", "search:read"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "none"]
}
```

Clients should fetch this dynamically rather than hard-code endpoint URLs.

## Scopes

Roamarr currently exposes 59 scopes. Clients should fetch
`scopes_supported` from discovery instead of hard-coding this list.
Human-readable descriptions come from `src/lib/oauthScopes.ts` and are shown on
**Profile → MCP Clients**.

Most feature scopes are read/write pairs: trips, segments, packing, budgets,
expenses, places, reminders, companions, sharing, calendar, templates, travel
documents, document links, fare watches, polls, journal, important items, entry
requirements, home tasks, medications, cards, loyalty, insurance, contacts,
profile preferences, notifications, user SMTP, and comments. `profile:read`
covers document-expiry summaries, and `search:read` covers global search.

Roamarr returns `viewerProjection`-style data through read scopes. The
`private-details:read` scope can add trip notes, confirmation numbers, and
itinerary details only when an administrator enables private MCP details and
the user selects the optional consent checkbox. Membership numbers, policy
numbers, payment card numbers, and travel document numbers stay protected.

## Authorizing a client

### Step 1 — Create a client

Sign in and visit **Profile → MCP Clients**. Provide:

- **Client name** — a human-readable label (e.g. "Claude Desktop").
- **Redirect URIs** — one per line. Must match the URI your client opens after
  authorization. For local desktop apps, use `http://localhost:<port>/callback`
  or `http://127.0.0.1:<port>/callback`.
- **Scopes** — check only the scopes your client needs.
- **Public client** — toggle ON for apps that cannot keep a secret (mobile,
  desktop, single-page apps). Such clients authenticate via PKCE only and do
  not receive a client secret. Leave OFF for server-side apps.

Submit the form. Roamarr generates the **client ID** (always) and a **client
secret** (confidential clients only). **The secret is shown exactly once** —
copy it before navigating away. If you lose it, delete the client and create a
new one.

### Step 2 — Configure the MCP and discovery URLs

Use `https://your-origin/mcp` when the client asks for the MCP server URL. Use
the following URL when it asks for OAuth discovery or issuer metadata:

```
https://your-origin/.well-known/oauth-authorization-server
```

The client should use the returned `authorization_endpoint` and
`token_endpoint` values. The discovery URL is also displayed under **Setup
instructions** on the MCP Clients page. Roamarr uses manual client registration;
it does not advertise a dynamic `registration_endpoint`.

### Step 3 — Run the authorization-code + PKCE flow

The client:

1. Generates a random `code_verifier` (43–128 chars, base64url-safe).
2. Computes `code_challenge = BASE64URL(SHA256(code_verifier))`.
3. Opens a browser to the authorize endpoint:

   ```
   /oauth/authorize
     ?response_type=code
     &client_id=<your client id>
     &redirect_uri=<exactly one of your registered URIs>
     &scope=<space-separated scopes>
     &state=<random opaque value>
     &code_challenge=<challenge>
     &code_challenge_method=S256
   ```

4. The user signs in (if not already), reviews the requested scopes on the
   consent page, and approves. Roamarr redirects to
   `<redirect_uri>?code=<auth code>&state=<state>`. Verify the state matches.

5. The client POSTs to `/oauth/token`:

   ```
   grant_type=authorization_code
   &code=<auth code>
   &client_id=<your client id>
   &code_verifier=<your verifier>
   &redirect_uri=<same redirect URI as above>
   &client_secret=<your secret, confidential clients only>
   ```

6. Roamarr returns a token response (see [Token response](#token-response)
   below). The client stores the access token (and refresh token) and uses it
   on subsequent `/mcp` calls as `Authorization: Bearer <access_token>`.

### Step 4 — Refresh

When the access token expires (1 hour), the client repeats step 5 with
`grant_type=refresh_token` and the refresh token instead of an authorization
code. Roamarr returns a fresh pair and **immediately revokes** the previous
token. Treat the old access token as invalid the moment a refresh succeeds.

### Step 5 — Revoke

To log out a client (or invalidate a leaked token), POST to `/oauth/revoke`:

```
token=<token>
&token_type_hint=access_token   # or "refresh_token"
```

Revocation is idempotent. Roamarr also auto-revokes tokens when:

- The owning user disables their account.
- The owning user deletes their account.
- The owning user changes their password.
- The owning client is deleted (all its tokens die).

## Token response

`POST /oauth/token` returns the RFC 6749 §5.1 standard fields, for both grant
types (`authorization_code` and `refresh_token`):

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "trips:read profile:read"
}
```

Error responses follow RFC 6749 §5.2:

```json
{ "error": "invalid_grant" }
```

Possible error codes: `invalid_client`, `invalid_grant`,
`unsupported_grant_type`. Rate limiting on `/oauth/token` and `/oauth/revoke`
returns HTTP 429.

## Admin: client allow-list {#admin-client-allow-list}

Admins can lock down which client IDs are allowed to be authorized. Visit
**Admin → General → OAuth clients**. The textarea accepts one client ID per
line:

- **Empty** → any client may be authorized (default for new instances).
- **Populated** → only the listed client IDs may be authorized. Authorization
  attempts with any other client_id fail with `invalid_client` at the token
  endpoint.

The allow-list does not control which scopes a user may grant; each client
still requests its own scopes and the user approves them at consent.

To rotate the allow-list without locking everyone out, paste new IDs first,
save, then remove the old ones.

## Wire examples

Fetch discovery:

```sh
curl -sS https://your-origin/.well-known/oauth-authorization-server
```

Exchange a code (confidential client):

```sh
curl -sS -X POST https://your-origin/oauth/token \
  -d grant_type=authorization_code \
  -d code=<code> \
  -d client_id=<client id> \
  -d client_secret=<client secret> \
  -d code_verifier=<verifier> \
  -d redirect_uri=<redirect uri>
```

Refresh:

```sh
curl -sS -X POST https://your-origin/oauth/token \
  -d grant_type=refresh_token \
  -d refresh_token=<refresh token> \
  -d client_id=<client id> \
  -d client_secret=<client secret>
```

Initialize the MCP endpoint:

```sh
curl -sS -X POST https://your-origin/mcp \
  -H "Authorization: Bearer <access token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0.0"}}}'
```

Keep the `Mcp-Session-Id` response header and send it with later MCP requests.
See the [MCP protocol smoke test](./mcp-ai.md) for the complete
initialize, list, call, and close sequence.

Revoke:

```sh
curl -sS -X POST https://your-origin/oauth/revoke \
  -d token=<access or refresh token>
```

## Security notes

- **No `code` reuse.** Replaying an authorization code returns `invalid_grant`.
- **PKCE is mandatory.** The server rejects requests without
  `code_challenge_method=S256`.
- **Tokens are stored hashed** (SHA-256). The plaintext access/refresh tokens
  are returned only on issue or refresh; only the client ever sees them.
- **Redirect URIs are matched exactly.** Mismatches return `invalid_grant`.
- **Disabled users cannot authenticate** — their tokens are rejected at
  `/mcp` even before natural expiry.
- **Audit-logged:** client create/delete are recorded in the admin audit log.
- **Rate-limited:** `/oauth/token`, `/oauth/revoke`, `/oauth/authorize`, and
  `/mcp` all have IP-based rate limits.

## See also

- [MCP / AI integration](./mcp-ai.md) — tools, prompts, and resources
  available on top of this OAuth surface.
- [Admin](./admin.md) — instance-wide settings, including the OAuth client
  allow-list.
- [Account security](./account-security.md) — passwords, 2FA, passkeys.
