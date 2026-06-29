<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# MCP / AI integration

Roamarr exposes a [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server so AI assistants (Claude Desktop, etc.) can interact with your
trips, segments, packing lists, budgets, and visited places.

## Overview

- **MCP endpoint:** `POST /mcp` (Streamable HTTP, stateless JSON-RPC).
- **Authentication:** OAuth 2.1 authorization-code flow with mandatory PKCE
  (S256).
- **Discovery:** `GET /.well-known/oauth-authorization-server` returns all
  endpoint URLs and supported features.

## Connecting an AI assistant

1. **Create an OAuth client** at **Security → API connections → Create a
   client**. Provide a name, one or more redirect URIs, and select the scopes
   the assistant needs. Save the **Client ID** and **Client Secret** (shown
   once).

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

## Scopes

| Scope | Allows |
| --- | --- |
| `trips:read` | List/view trips, itinerary, segments, map data |
| `trips:write` | Create and update trips and segments |
| `packing:write` | Manage packing templates and trip checklists |
| `budgets:write` | Manage trip budgets and expenses |
| `places:write` | Mark/unmark visited countries and U.S. states |
| `reminders:write` | Create and update reminders |
| `profile:read` | Read non-sensitive profile and document-expiry summaries |

`trips:read` and `profile:read` form the minimal read-only set. The full
automation bundle is all write scopes plus the reads.

## Available tools

| Tool | Required scope | Description |
| --- | --- | --- |
| `roamarr_trip_list` | `trips:read` | List all trips. |
| `roamarr_trip_get` | `trips:read` | Get details of a specific trip. |
| `roamarr_trip_create` | `trips:write` | Create a new trip. |
| `roamarr_upcoming_summary` | `trips:read` | Get a summary of upcoming trips. |
| `roamarr_places_list` | `places:write` | List visited countries and states. |
| `roamarr_places_mark` | `places:write` | Mark a country or state as visited. |
| `roamarr_reminder_add` | `reminders:write` | Add a reminder to a trip. |

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
