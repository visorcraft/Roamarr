<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# MCP / AI integration

Roamarr exposes a [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server so AI assistants (Claude Desktop, etc.) can interact with your
trips, segments, packing lists, budgets, and visited places.

`GET /.well-known/mcp.json` returns the MCP endpoint, auth metadata, and the
supported OAuth scopes. After authorization, use MCP `tools/list`,
`prompts/list`, and `resources/templates/list` for the live surface. The
current server exposes 108 tools, 16 prompts, and 9 resource templates covering
trips, segments, expenses, wallet data, travel documents, sharing, groups,
calendar, contacts, profile preferences, notifications, user SMTP, templates,
companions, polls, journal, home tasks, medications, important items, entry
requirements, comments, and search. See [OAuth 2.1 integration](./oauth.md)
for token lifecycle details.

## Overview

- **MCP endpoint:** `POST /mcp` (Streamable HTTP, stateless JSON-RPC).
- **Authentication:** OAuth 2.1 authorization-code flow with mandatory PKCE
  (S256). Full protocol reference: [OAuth 2.1 integration](./oauth.md).

## Connecting an AI assistant

1. **Create an OAuth client** at **Profile → Security → API connections**.
   Provide a name, one or more redirect URIs, and select the scopes the
   assistant needs. Save the **Client ID** and (for confidential clients) the
   **Client Secret** — the secret is shown once.

2. **Point your AI client** at Roamarr's discovery URL:
   ```
   https://your-roamarr-origin/.well-known/oauth-authorization-server
   ```

3. **Authorize:** the assistant opens a browser to `/oauth/authorize`, where
   you review the requested scopes and approve or deny. On approval, the
   assistant exchanges the authorization code for access and refresh tokens.

4. **Call the MCP server:** the assistant sends a Bearer token with every
   `/mcp` request. Roamarr verifies the token, checks scopes, and routes the
   tool call.

For token refresh, revocation, error codes, and the public-vs-confidential
client distinction, see [OAuth 2.1 integration](./oauth.md).

## Scopes

Roamarr currently exposes 58 OAuth scopes. The canonical list is returned by
`/.well-known/oauth-authorization-server` as `scopes_supported`, and the
human-readable descriptions are rendered on **Profile -> Security -> API
Clients** from `src/lib/oauthScopes.ts`.

Use read/write pairs for the specific feature the client needs: trips,
segments, packing, budgets, expenses, places, reminders, companions, sharing,
calendar, templates, travel documents, document links, fare watches, polls,
journal, important items, entry requirements, home tasks, medications, cards,
loyalty, insurance, contacts, profile preferences, notifications, user SMTP,
and comments. `profile:read` covers document-expiry summaries, and
`search:read` covers global search.

## Core Tools

| Tool | Required scope | Description |
| --- | --- | --- |
| `roamarr_trip_list` | `trips:read` | List all trips. |
| `roamarr_trip_get` | `trips:read` | Get details of a specific trip. |
| `roamarr_trip_create` | `trips:write` | Create a new trip. |
| `roamarr_trip_update` | `trips:write` | Update an existing trip. |
| `roamarr_day_plan` | `trips:write` | Create a segment (flight, hotel, event) for a trip. |
| `roamarr_upcoming_summary` | `trips:read` | Get a summary of upcoming trips. |
| `roamarr_packing_item_add` | `packing:write` | Add an item to a trip's packing checklist. |
| `roamarr_packing_list_build` | `packing:write` | Apply a packing template or list current checklist. |
| `roamarr_budget_set` | `budgets:write` | Set or update a budget category for a trip. |
| `roamarr_budget_update` | `budgets:write` | View budget categories and spent amounts. |
| `roamarr_places_list` | `places:read` | List visited countries and states. |
| `roamarr_places_mark` | `places:write` | Mark a country or state as visited. |
| `roamarr_places_unmark` | `places:write` | Remove a country or state from visited. |
| `roamarr_reminder_add` | `reminders:write` | Add a reminder to a trip. |

The full tool list is returned by MCP `tools/list` after authorization.

### Prompts

Server-defined prompts return privacy-safe, structured summaries an AI
assistant can use as context:

| Prompt | Description |
| --- | --- |
| `trip-details` | Detailed trip overview (requires `tripId`). |
| `trip-summary` | Brief summary of upcoming trips. |
| `itinerary` | Day-by-day itinerary (requires `tripId`). |
| `flight-info` | Flight segments for a trip (requires `tripId`). |
| `hotel-info` | Lodging segments for a trip (requires `tripId`). |
| `packing-check` | Packing checklist status (requires `tripId`). |
| `budget-overview` | Budget categories and spending (requires `tripId`). |
| `documents-checklist` | Travel documents and expiry summaries. |
| `weather-overview` | Weather forecast for a trip destination (requires `tripId`). |
| `places-visited` | Countries and U.S. states you have visited. |
| `upcoming-checklist` | Pre-trip prep summary (requires `tripId`). |
| `expense-summary` | Per-trip expense breakdown (requires `tripId`). |
| `wallet-overview` | Counts for cards, loyalty, and insurance with numbers redacted. |
| `doc-renewals` | Documents expiring soon, with numbers redacted. |
| `poll-status` | Polls with no votes across active trips. |
| `trip-budget-status` | Spent vs budget by category (requires `tripId`). |

### Resources

Resource templates are advertised only when the token has the matching read
scope: `trip://{tripId}`, `companion://{companionId}`, `card://{cardId}`,
`loyalty://{loyaltyId}`, `insurance://{insuranceId}`,
`document://{documentId}`, `poll://{pollId}`,
`journal://trip-{tripId}/{isoDate}`, and `fare-watch://{fareWatchId}`.

## Privacy and security

- **No sensitive plaintext** (confirmation, membership, policy numbers, notes)
  is ever returned by any tool. Reads reuse the same `viewerProjection` /
  `sharing` helpers as routes.
- **All write operations** are audit-logged and owned by the token's
  `userId`.
- **MCP never bypasses authorization** — the same `requireOwnedTrip`,
  `sharing.canView` / `canEdit` checks apply.
- **Revoking a client** (at API connections) instantly invalidates all its
  tokens.
