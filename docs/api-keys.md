<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Personal API keys

Personal API keys are long-lived bearer credentials for scripts and AI agents
that call Roamarr's [HTTP JSON API](./http-api.md) or
[MCP server](./mcp-ai.md) without completing the OAuth consent flow. A key
acts as its owner within a fixed set of OAuth scopes.

## Creating a key

1. Sign in and open **Profile → API Keys**.
2. Enter a recognizable name, select the scopes the integration needs, and
   optionally pick an expiry date.
3. Create the key and copy the token immediately. It is shown exactly once;
   Roamarr stores only its SHA-256 hash.

Tokens look like `rk_` followed by 64 hexadecimal characters (32 random
bytes).

Scope rules:

- Only scopes from the OAuth scope registry can be granted.
- `admin:read` and `admin:write` can never be granted to an API key.
- `private-details:read` can be granted only while the administrator's MCP
  private-details gate is enabled, exactly as for OAuth clients.
- Scope enforcement is identical to OAuth tokens: read operations need
  `<resource>:read`, writes need `<resource>:write`, and normal ownership and
  trip-sharing checks still apply.

## Using a key

Send the token on `/api/*` or `/mcp` requests, either as a dedicated header or
as a bearer token:

```http
X-Api-Token: rk_…
```

```http
Authorization: Bearer rk_…
```

Only bearer tokens with the `rk_` prefix are treated as API keys, so a key can
never shadow a real OAuth access token. Example:

```sh
curl -H "X-Api-Token: $ROAMARR_KEY" https://your-roamarr-origin/api/trips
```

For MCP, configure the client with the `/mcp` URL and the key as a static
bearer token instead of OAuth. No client registration, consent screen, or
redirect URI is involved — the key **is** the user, so OAuth client registry
and consent restrictions do not apply, but the key's scopes still bind every
tool call. To let a key read private trip details through MCP, include
`private-details:read` in its scopes; the administrator's private-details gate
must also be enabled.

API keys never authenticate browser pages: they create no session and are
ignored outside `/api/*` and `/mcp`.

## Managing keys

**Profile → API Keys** lists each key's name, scopes, creation date, expiry,
last-used time, and revoked state. Keys can be renamed or revoked at any time.
Revocation takes effect immediately and the row is kept for the audit log;
`api_key_create` and `api_key_revoke` events appear under the account's audit
history.

A key stops authenticating when it is revoked, expires, or its owner is
disabled. Failed authentication attempts are rate-limited per IP, like login
attempts.
