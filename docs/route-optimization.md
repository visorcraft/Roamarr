<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Route optimization and day directions

Roamarr can reorder the untimed stops of a single itinerary day into a short
driving/walking order and export any day to Google Maps directions.

## Optimize order

Each day header on the trip page shows an **Optimize order** button when the
day has at least two untimed, coordinate-bearing segments and you can edit the
trip. Clicking it applies immediately and flashes the resulting stop count and
total distance.

The optimizer runs nearest-neighbor construction from the day's lodging (a
hotel segment covering that date, when it has coordinates) followed by a 2-opt
improvement pass over haversine distances. It is deterministic: ties break by
itinerary order.

Ordering rules:

- Only **untimed** segments — date set, start time left blank (stored as local
  midnight) — with coordinates are reordered. The result is stored per segment
  as `day_sort_order`.
- **Timed** segments always keep their local-time order and are never moved.
- Within a day, untimed segments display first (optimized order, unordered
  ones last), followed by timed segments in time order.

Days with fewer than two eligible segments are a no-op. Applying is audited as
`trip_day_optimize`.

## Open in Google Maps

Each day header with at least two coordinate-bearing segments shows an **Open
in Google Maps** link. It builds a
`google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…` URL from the
day's segments in display order: first point is the origin, last is the
destination, and up to nine middle points become waypoints (the Google Maps
URL limit); additional middle points are dropped.

## MCP tools

- `roamarr_trip_day_optimize` (`segments:write`): without `confirm: true`
  returns the proposed order as a preview and changes nothing; with
  `confirm: true` applies and persists it.
- `roamarr_trip_day_directions_url` (`segments:read`): returns the Google Maps
  directions URL for a trip day, or `null` when the day has fewer than two
  mappable points.
