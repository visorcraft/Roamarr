<!-- SPDX-FileCopyrightText: 2026 VisorCraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# MCP / AI integration

Roamarr exposes a Model Context Protocol (MCP) server for AI assistants and
automation clients. It can read and manage trips, itinerary segments, packing,
budgets, reminders, travel records, and other Roamarr data through OAuth 2.1.

## What your client needs

- **MCP transport:** Streamable HTTP.
- **MCP server URL:** `https://your-roamarr-origin/mcp`.
- **OAuth discovery:**
  `https://your-roamarr-origin/.well-known/oauth-authorization-server`.
- **MCP metadata:**
  `https://your-roamarr-origin/.well-known/mcp.json`.
- **Authentication:** OAuth authorization code with mandatory PKCE (`S256`).

Roamarr does not dynamically register OAuth clients. Create the client in
Roamarr first, then give its client ID to the AI client. If an AI client asks
for a server URL, enter `/mcp`; if it asks for an OAuth discovery or issuer URL,
use `/.well-known/oauth-authorization-server`.

When Roamarr is behind a reverse proxy, set `ORIGIN` to its public HTTPS origin.
The discovery document builds its endpoint URLs from that origin.

## Quick setup

1. Sign in to Roamarr and open **Profile → MCP Clients**.
2. Under **Create a client**, enter a recognizable name and the exact redirect
   URI supplied by your AI client.
3. Select only the scopes the client needs.
4. Enable **Public client** for desktop, mobile, browser, or other clients that
   cannot safely keep a secret. Leave it disabled for a trusted server-side
   client.
5. Create the client. Save the client ID and, for a confidential client, the
   one-time client secret.
6. Configure the AI client with Roamarr's `/mcp` URL, OAuth discovery URL,
   client ID, and client secret when applicable.
7. Start the connection. Roamarr opens a consent page showing every requested
   scope. Review it, then authorize.

The full OAuth flow, token exchange, refresh, and revocation rules are in
[OAuth 2.1 integration](./oauth.md).

## Recommended scope sets

Start read-only. Add write scopes only after the read connection works.

| Use case | Suggested scopes |
| --- | --- |
| Trip-aware assistant | `trips:read`, `segments:read`, `packing:read`, `reminders:read` |
| Trip planner | Read scopes above plus `trips:write`, `segments:write`, `packing:write`, `reminders:write` |
| Budget assistant | `trips:read`, `budgets:read`, `expenses:read`; add matching write scopes to edit |
| Travel wallet summary | `cards:read`, `loyalty:read`, `insurance:read`, `travel-docs:read` |
| Full pre-trip briefing | `trips:read`, `segments:read`, `packing:read`, `budgets:read`, `expenses:read`, `profile:read`, `travel-docs:read`, `polls:read`, `home-tasks:read`, `medications:read` |

Roamarr currently exposes 63 scopes. Always fetch `scopes_supported` from OAuth
discovery instead of hard-coding the full list. Scope descriptions shown in the
MCP Clients UI come from `src/lib/oauthScopes.ts`.

Use separate clients for separate assistants. This keeps grants small and lets
you revoke one integration without disrupting another.

## Using MCP well

After connection:

1. Call `tools/list`, `prompts/list`, and `resources/templates/list`. The live
   server is authoritative; prompt and resource availability depends on the
   granted read scopes.
2. Use `roamarr_trip_list` before trip-specific calls. IDs, not names, are the
   stable input to tools and resources.
3. Use prompts for compact AI context. For example, `upcoming-checklist` builds
   a pre-trip briefing, while `expense-summary` and `trip-budget-status` avoid
   fetching and recomputing every row.
4. Use resources when the client supports them. `trip://{tripId}` and the
   wallet/profile resources provide repeatable, typed reads.
5. Give write tools explicit ISO dates, ISO country codes, and ISO currency
   codes. Expense amounts are integer cents where the tool schema says so.
6. **Segment times are local wall clock + IANA zone, not pre-converted UTC.**
   See [Segment times (critical for agents)](#segment-times-critical-for-agents)
   below. Always set `startTz` / `endTz` to the place’s zone
   (`America/Chicago`, `Asia/Bangkok`, `Asia/Seoul`, …).
7. Read back important writes. For example, list the trip after creating a
   segment and show the proposed result before any destructive follow-up.
8. Destructive tools require `confirm: true`. Roamarr rejects the call without
   that explicit confirmation even when the token has the write scope.

## Segment times (critical for agents)

`roamarr_day_plan` and `roamarr_segment_update` store each segment as:

| Field | Meaning |
| --- | --- |
| `startAt` / `endAt` (stored) | Absolute **UTC** instant |
| `startTz` / `endTz` | IANA zone used to **display** that instant as local time |

When **writing**, pass the **local clock face** in that zone. Roamarr converts
to UTC. Do **not** convert to UTC yourself.

| Intent | Pass `startAt` | Pass `startTz` | Stored UTC (example) |
| --- | --- | --- | --- |
| 10:50 PM Dec 1 in Dallas | `2026-12-01T22:50:00` | `America/Chicago` | `2026-12-02T04:50:00.000Z` (CST) |
| 12:45 PM Jan 31 in Bangkok | `2027-01-31T12:45:00` | `Asia/Bangkok` | `2027-01-31T05:45:00.000Z` |
| Hotel check-in 2:00 PM Bangkok | `2026-08-15T14:00:00` | `Asia/Bangkok` | `2026-08-15T07:00:00.000Z` |

**Common agent mistake:** emitting `2026-12-01T22:50:00.000Z` and expecting
“22:50 UTC.” Roamarr treats the **digits** as wall clock in `startTz`. A
trailing `Z` or `±offset` is **ignored** so clients that always append `Z`
still get the correct local interpretation when `startTz` is set correctly.

**Flights:** use departure-airport local time + zone for `startAt`/`startTz`,
and arrival-airport local time + zone for `endAt`/`endTz` (they often differ).

**Always set the zone.** Leaving `startTz` as `UTC` while passing local Dallas
or Bangkok digits makes the UI show the wrong zone label and confuses the next
agent that reads the trip.

After writing, re-read with `roamarr_trip_get` and check that displayed local
times match the ticket/voucher before bulk-editing further segments.

Useful requests to give an AI assistant:

- "List my upcoming trips, then build a pre-trip checklist for trip 6. Do not
  make changes."
- "Show the itinerary and budget status for trip 6. Flag schedule conflicts and
  categories over budget."
- "Draft three packing items for trip 6. Show them first; add them only after I
  approve."
- "Summarize expiring travel documents without displaying document numbers."

## Surface

The current server exposes 109 tools, 16 prompts, and 9 resource templates.
Use live list methods because clients see only prompts and resources allowed by
their scopes.

### Common tools

| Tool | Required scope | Purpose |
| --- | --- | --- |
| `roamarr_trip_list` | `trips:read` | List accessible trips. |
| `roamarr_trip_get` | `trips:read` | Read one trip and its itinerary. |
| `roamarr_trip_create` | `trips:write` | Create a trip. |
| `roamarr_trip_update` | `trips:write` | Update trip details. |
| `roamarr_day_plan` | `segments:write` | Create an itinerary segment. |
| `roamarr_upcoming_summary` | `trips:read` | Summarize upcoming trips. |
| `roamarr_packing_item_add` | `packing:write` | Add one checklist item. |
| `roamarr_packing_list_build` | `packing:write` | Apply a template or list a checklist. |
| `roamarr_budget_set` | `budgets:write` | Set a trip budget category. |
| `roamarr_budget_update` | `budgets:read` | View budget and spent amounts. |
| `roamarr_places_list` | `places:read` | List visited countries and states. |
| `roamarr_reminder_add` | `reminders:write` | Add a trip reminder. |

`tools/list` returns every current tool and its JSON input schema. Treat that
schema as authoritative, especially for required IDs, enums, pagination,
amount units, and `confirm`.

### Prompts

| Prompt | Purpose |
| --- | --- |
| `trip-summary` | Brief upcoming-trip summary. |
| `trip-details` | Detailed trip overview; requires `tripId`. |
| `itinerary` | Day-by-day itinerary; requires `tripId`. |
| `flight-info` / `hotel-info` | Transport or lodging slice; requires `tripId`. |
| `packing-check` | Packing status; requires `tripId`. |
| `budget-overview` | Budget and spending; requires `tripId`. |
| `documents-checklist` | Document types and expiry summaries. |
| `weather-overview` | Destination forecast; requires `tripId`. |
| `places-visited` | Visited countries and U.S. states. |
| `upcoming-checklist` | Documents, packing, and home-task briefing; requires `tripId`. |
| `expense-summary` | Expense totals by category and currency; requires `tripId`. |
| `wallet-overview` | Card, loyalty, and insurance counts with numbers redacted. |
| `doc-renewals` | Documents expiring soon with numbers redacted. |
| `poll-status` | Active-trip polls with no votes. |
| `trip-budget-status` | Spent versus budget by category; requires `tripId`. |

### Resources

Templates appear only with their matching read scope:

- `trip://{tripId}`
- `companion://{companionId}`
- `card://{cardId}`
- `loyalty://{loyaltyId}`
- `insurance://{insuranceId}`
- `document://{documentId}`
- `poll://{pollId}`
- `journal://trip-{tripId}/{isoDate}`
- `fare-watch://{fareWatchId}`

## Protocol smoke test

Most users should let their AI client handle OAuth and MCP sessions. These
commands help administrators diagnose a connection after obtaining an access
token through the OAuth flow.

Fetch metadata:

```sh
curl -sS https://your-origin/.well-known/mcp.json
curl -sS https://your-origin/.well-known/oauth-authorization-server
```

Initialize. Keep the `Mcp-Session-Id` response header:

```sh
curl -i -sS https://your-origin/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}'
```

Send the initialized notification, then list tools. Replace `$MCP_SESSION_ID`
with the response header value:

```sh
curl -sS https://your-origin/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Mcp-Session-Id: $MCP_SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -sS https://your-origin/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Mcp-Session-Id: $MCP_SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Call a read-only tool:

```sh
curl -sS https://your-origin/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Mcp-Session-Id: $MCP_SESSION_ID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"roamarr_trip_list","arguments":{}}}'
```

Close the session when finished:

```sh
curl -sS -X DELETE https://your-origin/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Mcp-Session-Id: $MCP_SESSION_ID" \
  -H 'Accept: application/json, text/event-stream'
```

Sessions are stored in the running Roamarr process for up to one hour. A server
restart or stale session returns `404 Session not found`; initialize again.

## Privacy and safety

- Tools enforce the authenticated user and the same owner/view/edit rules as
  the web application.
- Public/share projections and AI-facing projectors remove confirmation,
  membership, policy, and document numbers plus private notes.
- Tokens are stored hashed. Deleting an API client invalidates all its tokens.
- Security-sensitive mutations are audit logged.
- Write scopes permit real data changes. Prefer read-only scopes for analysis,
  and require the assistant to preview changes before execution.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Client cannot discover endpoints | Set public `ORIGIN`, use HTTPS, and verify both well-known URLs return the public origin. |
| Client asks for dynamic registration | Roamarr uses manual registration. Create an API Client in Roamarr and enter its client ID manually. |
| `401 Bearer token required` | The client omitted the access token. Complete OAuth and send `Authorization: Bearer ...`. |
| `401 Invalid or expired token` | Refresh the token or authorize again. Refresh rotation invalidates the old token immediately. |
| `400 initialize request required` | Start a new MCP connection with `initialize`. |
| `400 mcp-session-id header required` | Send the session ID returned by initialize on later requests. |
| `404 Session not found` | The session expired or Roamarr restarted. Initialize again. |
| Tool reports missing scope | Create a replacement API Client with the required narrow scope, then authorize it. Existing clients and tokens do not gain scopes. |
| Prompt/resource is missing | Its read scope was not granted. Check the live lists after reconnecting. |
| OAuth redirect fails | The redirect URI must exactly match one registered on the API Client. |

## See also

- [OAuth 2.1 integration](./oauth.md)
- [Account security](./account-security.md)
- [Sharing](./sharing.md)
