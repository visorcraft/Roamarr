<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Real-time sync

When two users — or two tabs — have the same trip open, changes made by one
appear for the other without a manual refresh. Roamarr does this with a
Server-Sent Events (SSE) invalidation stream, not an operational-transform or
CRDT layer: the stream carries lightweight "something changed" hints, and
clients simply refetch.

## Behavior

- The trip detail page opens an `EventSource` connection to `/api/events` on
  mount and closes it on unmount.
- Trip mutations (segments, trip fields, day notes, gallery, expenses,
  comments, and anything else that bumps the trip) publish a trip event:
  `{type:'trip', id, rev, origin}`, where `rev` is a monotonic per-trip
  counter held in memory (it resets on restart; it is an ordering hint, not a
  durable version).
- The page coalesces events into a single trailing refetch every 500 ms, so a
  burst of edits causes one reload, not a storm.
- A `shares` event means the user's share graph changed (a share was granted
  or revoked, or group membership changed). Open pages refetch, so revoked
  access surfaces promptly (the next load fails authorization).
- There is no echo suppression: a tab receives events for its own edits too
  and refetches. SvelteKit invalidation is cheap and the response is
  identical to what the form action already returned, so the extra load is
  harmless. (`origin` is reserved for this and currently always `null`.)
- Events are live-only. Nothing is replayed after a reconnect; a client that
  missed events simply refetches on the next one. `EventSource` reconnects
  automatically and honors the server's `retry: 3000` hint.

## Endpoint

`GET /api/events` returns `text/event-stream`. Authentication is the browser
session cookie, or an OAuth bearer token / personal API key with the
`trips:read` scope (see [HTTP API](./http-api.md)). `EventSource` cannot set
authorization headers, so API-key scripts should poll the REST API instead of
consuming the stream.

Each connection also receives a heartbeat comment (`: hb`) every 25 seconds
so reverse proxies and browsers do not idle the socket out. Configure proxies
to allow long-lived response streams (no response buffering) for this route.

## Privacy

A subscriber only ever receives trip ids they could already load. Each
connection caches the user's viewable-trip id set at subscribe time and drops
events outside it, so no database read happens per event. The set is
recomputed in place when a `shares` user event arrives — revoked access stops
delivery within one event. Event payloads contain no trip data, only the id
and revision.

## Limits

- At most 5 concurrent streams per user and 500 per process; beyond that the
  endpoint returns `429`.
- Connection attempts are rate-limited per client IP.
- The bus is in-process. Roamarr ships as a single Node process, so this is
  sufficient; a hypothetical multi-process deployment would need an external
  broker (Redis pub/sub, NATS, …), which is out of scope.

## For client code

`src/lib/liveEvents.ts` wraps the stream: `subscribeLiveEvents(handler)`
dispatches parsed events and returns a close function, and
`coalesceTrailing(fn, waitMs)` collapses bursts into one trailing call. Pages
subscribe on mount and unsubscribe on destroy; see the trip detail page for
the reference usage.
