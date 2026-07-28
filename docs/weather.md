<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Weather

Roamarr retrieves keyless forecasts from
[Open-Meteo](https://open-meteo.com/) and caches them in MongrelDB.

## When it appears

The itinerary can show weather when:

- the trip has dates within the next 14 days;
- the trip destination or relevant segment has coordinates;
- the server can fetch or reuse a forecast.

For a day covered by a segment with coordinates, Roamarr can use that segment
location instead of the overall destination.

## Data

The daily display includes:

- high and low temperature in Celsius;
- weather summary;
- precipitation probability;
- wind speed in kilometers per hour;
- location context.

Units are currently metric and are not derived from server locale.

## Advisory thresholds

Roamarr highlights:

- wind at least 50 km/h;
- precipitation probability at least 80 percent with a heavy-rain code;
- low temperature at or below 0 °C.

These are planning hints, not official warnings. Follow local authorities and
the provider for safety decisions.

## Cache and privacy

Server requests send latitude/longitude rounded to two decimal places to
Open-Meteo. Browsers do not contact Open-Meteo directly.

Forecast rows are cached per rounded location and date for six hours. The
scheduler refreshes relevant cache entries. A provider outage leaves the trip
usable and shows forecast unavailable.

## Limits

- Roamarr uses a 14-day horizon.
- A text-only location cannot be forecast without coordinates.
- Forecasts can change and are not guaranteed.
- Cached data can be up to six hours old.
- Roamarr does not provide radar, alerts from authorities, air quality, or
  historical climate data.
