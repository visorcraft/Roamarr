<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Weather forecasting

Roamarr fetches weather forecasts from [Open-Meteo](https://open-meteo.com)
(free, keyless) and caches them server-side for 6 hours.

## Where it appears

A **Weather forecast** card appears on each trip page (Itinerary tab) when the
trip has a destination with coordinates and at least one date within the
14-day forecast horizon. The card shows a compact per-day strip with:

- High/low temperature
- Weather summary (Clear sky, Partly cloudy, Rain, etc.)
- Precipitation probability
- Location label (when a segment provides the day's location)

## How it works

- **Server-side only** — all requests to Open-Meteo are made from the Roamarr
  server, never from the browser. Only rounded lat/lng (two decimal places)
  is sent to the API.
- **Per-location, per-date cache** — a `weather_cache` table stores one row
  per `location_key × date`. Cache hits skip the API call entirely.
- **Segment locations** — when a day falls within a segment's start/end and
  the segment has city coordinates, the forecast uses the segment's location
  instead of the trip destination.
- **Graceful degradation** — if the API is unreachable or the date is beyond
  the horizon, the day shows "Forecast unavailable" without throwing the trip
  page.

## Severe-weather advisories

An amber advisory chip appears at the top of the card when any forecasted day
has:
- Wind speed ≥ 50 km/h
- Heavy precipitation (≥ 80% probability + a heavy-rain weather code)
- Freezing temperatures (low ≤ 0 °C)

## Limitations

- Open-Meteo supports up to ~16 days; Roamarr caps at **14 days**.
- Units follow the server's locale for now (configurable later).
