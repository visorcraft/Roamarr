<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# HTTP JSON API

Roamarr has bearer-authenticated JSON routes used by its mobile surface.
External automation should prefer [MCP](./mcp-ai.md), whose tools and schemas
are discoverable at runtime. The JSON routes below are useful when an
integration needs their exact current behavior.

## Compatibility

The JSON API is not versioned and has no published OpenAPI compatibility
contract. Route names, request bodies, and response shapes can change with a
Roamarr release. Pin the server version, test upgrades, and treat the current
route implementation as authoritative.

Only routes listed by Roamarr's OAuth scope map accept bearer access. Sending a
bearer token to another `/api/*` route returns HTTP `403` even if the browser
route works with a session cookie.

## Authentication

Two credential types work, with identical scope enforcement:

- **OAuth access token:** register an OAuth client, complete authorization
  code flow with mandatory S256 PKCE, and send
  `Authorization: Bearer <access-token>`.
- **Personal API key:** create a key under **Profile → API Keys** and send it
  as `X-Api-Token: rk_…` or `Authorization: Bearer rk_…`. No OAuth flow is
  needed; see [Personal API keys](./api-keys.md).

```http
Authorization: Bearer <access-token>
Accept: application/json
```

Read operations require `<resource>:read`; writes require
`<resource>:write`. Administrator routes additionally require an administrator
account. Normal ownership and trip-sharing checks still apply after scope
validation.

See [OAuth 2.1](./oauth.md) for discovery, registration, consent, token
exchange, and all scopes.

## Supported route families

`{id}` values are positive integer identifiers.

| Routes | Methods | Scope | Purpose |
| --- | --- | --- | --- |
| `/api/trips/autocomplete` | `GET` | `trips:read` | Search accessible trips for a picker. |
| `/api/events` | `GET` | `trips:read` | Long-lived SSE stream of trip invalidation events; see [Real-time sync](./realtime.md). |
| `/api/mobile/trips/{id}` | `GET` | `trips:read` | Load one viewable trip. |
| `/api/mobile/trips/{id}/poster` | `GET`, `POST` | `trips:read`, `trips:write` | Read or upload a trip poster. |
| `/api/mobile/trip-transfer` | `GET`, `POST` | `trips:read`, `trips:write` | Inspect or transfer an owned trip. |
| `/api/mobile/trip-merge` | `POST` | `trips:write` | Merge one owned trip into another. |
| `/api/mobile/segments` | `POST` | `segments:write` | Create a segment. |
| `/api/mobile/segments/{id}` | `GET`, `PATCH`, `DELETE` | `segments:read`, `segments:write` | Read, update, or delete a segment. |
| `/api/mobile/segments/{id}/attendees` | `GET`, `POST`, `DELETE` | `segments:read`, `segments:write` | Read or change companion attendance. |
| `/api/mobile/expenses/{id}/attachments` | `GET`, `POST` | `expenses:read`, `expenses:write` | List or upload receipt attachments. |
| `/api/mobile/trips/{id}/sharing` | `GET`, `POST` | `sharing:read`, `sharing:write` | Inspect or mutate owner-controlled sharing. |
| `/api/cards` and `/api/cards/{id}` | `GET`, `POST`, `PATCH`, `DELETE` | `cards:read`, `cards:write` | User-owned card metadata. |
| `/api/cards/{id}/benefits` and child IDs | `GET`, `POST`, `PATCH`, `DELETE` | `cards:read`, `cards:write` | Card travel benefits. |
| `/api/loyalty` and `/api/loyalty/{id}` | `GET`, `POST`, `PATCH`, `DELETE` | `loyalty:read`, `loyalty:write` | User-owned loyalty records. |
| `/api/insurance` and `/api/insurance/{id}` | `GET`, `POST`, `PATCH`, `DELETE` | `insurance:read`, `insurance:write` | User-owned insurance policies. |
| `/api/travel-documents` and `/api/travel-documents/{id}` | `GET`, `POST`, `PATCH`, `DELETE` | `travel-docs:read`, `travel-docs:write` | User-owned travel documents. |
| `/api/travel-documents/autocomplete` | `GET` | `travel-docs:read` | Find an owned document for linking. |
| `/api/reminders` and `/api/reminders/{id}` | `GET`, `DELETE` | `reminders:read`, `reminders:write` | List or cancel reminders. |
| `/api/fare-watches` | `GET`, `POST` | `fares:read`, `fares:write` | List and create fare watches. |
| `/api/fare-providers`, `/api/fare-providers/{id}`, and `/test` | `GET`, `POST`, `PATCH`, `DELETE` | `fares:read`, `fares:write` | Provider accounts and connection tests. |
| `/api/groups` | `GET` | `sharing:read` | List sharing groups. |
| `/api/groups/{id}` | `PATCH`, `DELETE` | `sharing:write` | Update or delete a sharing group. |
| `/api/cities`, `/api/cities/globe` | `GET` | `places:read` | GeoNames lookup and globe points. |
| `/api/maps/texture` | `GET` | `places:read` | Download the configured globe texture. |
| `/api/places/search` | `GET` | `saved-places:read` | Search the configured place catalog (Nominatim or Google). |
| `/api/mobile/trips/{id}/gallery` | `POST` | `trips:write` | Upload images into a trip gallery (multipart; edit access required). |
| `/api/mobile/places/{id}/gallery` | `POST` | `saved-places:write` | Upload images into a place gallery (multipart; owner only). |
| `/api/mobile/notifications` | `GET`, `PATCH` | `notifications:read`, `notifications:write` | List or mark notifications. |
| `/api/mobile/calendar` | `GET`, `POST` | `calendar:read`, `calendar:write` | Inspect or rotate the account calendar token. |
| `/api/mobile/security` | `GET`, `POST` | `security:read`, `security:write` | Mobile account-security actions. |
| `/api/webauthn/register/*` | `POST` | `security:write` | Passkey registration challenge and verification. |
| `/api/mobile/email-processing` | `GET`, `PATCH`, `POST` | `profile-prefs:read`, `profile-prefs:write` | Personal email-processing settings and tests. |
| `/api/jobs`, `/api/audit-logs` | `GET` | `admin:read` | Administrator operations data. |
| `/api/mobile-admin` | `GET`, `POST` | `admin:read`, `admin:write` | Administrator settings and actions. |
| `/api/mobile/admin-backup` | `GET`, `POST` | `admin:read`, `admin:write` | Download or stage a full backup. |
| `/api/mobile/admin-maps` | `GET`, `POST` | `admin:read`, `admin:write` | Inspect or mutate map configuration. |

Method scope is selected mechanically: `GET` and `HEAD` use `:read`; `POST`,
`PUT`, `PATCH`, and `DELETE` use `:write`.

## Bodies and uploads

Most mutation routes accept JSON and return JSON. Poster, gallery, and backup
routes use stream or multipart bodies as implemented by that endpoint. Send
`Content-Type: application/json` only for JSON.

The gallery upload routes accept one or more image files in `file` or `images`
multipart fields plus an optional `caption` (applied to the first image), and
return the created gallery projections as JSON. Uploaded image bytes are
downloadable with the same bearer token at `/trips/{id}/gallery/{imageId}` and
`/places/{id}/gallery/{imageId}`.

The `/api/mobile-admin` settings action also round-trips the scheduled-backup
settings (`backupAutoEnabled`, `backupIntervalHours`, `backupRetentionCount`,
plus the `backupLastAutoAt`/`backupStoredCount` status) and the ntfy
configuration (`ntfyServerUrl`, `ntfyTopic`, and a masked `ntfyTokenSet`; the
token keeps its stored value when omitted and clears on an explicit `null` or
`clearNtfyToken: true`).

Payload validation is strict. IDs must be safe positive integers, enum values
must match the current server definitions, and dates/times use the endpoint's
documented ISO form. Partial-update routes distinguish an omitted property from
an explicit value.

The server's `BODY_SIZE_LIMIT` and reverse-proxy limit apply before endpoint
validation.

## Response and errors

Success commonly uses:

- `200 OK` for reads and updates;
- `201 Created` for creation;
- `204 No Content` for deletion;
- streamed content for posters and backups.

Common failures:

| Status | Meaning |
| --- | --- |
| `400` | Invalid input or unsafe operation. |
| `401` | Missing, invalid, revoked, or unusable access token. |
| `403` | Missing scope, bearer use not allowed on the route, insufficient trip access, or administrator required. |
| `404` | Resource absent or hidden by ownership checks. |
| `409` | State conflict. |
| `413` | Adapter or proxy body limit exceeded. |
| `429` | Route or authentication rate limit exceeded. |

Do not parse human-readable error text as a stable machine contract.

## Privacy

An OAuth scope permits an operation but does not transfer ownership. Card,
loyalty, insurance, and document endpoints restrict lookups to the token user.
Trip endpoints enforce owner, editor, or viewer access per operation.

JSON endpoints can return private account data to a properly scoped client.
Protect access and refresh tokens, use the smallest scope set, and revoke a
client that no longer needs access.
