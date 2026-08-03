<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Weather

Roamarr retrieves keyless forecasts from
[Open-Meteo](https://open-meteo.com/) and caches them in MongrelDB.

## When it appears

The itinerary can show weather when:

- the trip has dates within the next 14 days (live forecast), or just beyond
  that window (typical weather, see below);
- the trip destination or relevant segment has coordinates;
- the server can fetch or reuse a forecast.

For a day covered by a segment with coordinates, Roamarr can use that segment
location instead of the overall destination.

## Data

The daily display includes:

- high and low temperature;
- weather summary;
- precipitation probability;
- wind speed;
- location context.

Forecasts are fetched and cached in metric units. The display converts to
Fahrenheit and mph when your profile's **Temperature unit** preference is set
to °F; storage and the provider API stay metric.

## Typical weather beyond the forecast window

Trip days beyond the 14-day forecast horizon (up to 14 days past it) show a
climatological average instead of a forecast. Roamarr averages the same
calendar day over the previous five years from the keyless Open-Meteo archive
API. These days are labeled **typical** in the itinerary and carry only high
and low temperatures — no precipitation probability, wind, or weather code —
and they never raise advisories. Typical-weather rows are cached per location
and date for 30 days because climate normals are stable.

## Advisory thresholds

Roamarr highlights (forecast days only):

- wind at least 50 km/h;
- precipitation probability at least 80 percent with a heavy-rain code;
- low temperature at or below 0 °C.

These are planning hints, not official warnings. Follow local authorities and
the provider for safety decisions.

## Cache and privacy

Server requests send latitude/longitude rounded to two decimal places to
Open-Meteo. Browsers do not contact Open-Meteo directly.

Forecast rows are cached per rounded location and date for six hours; typical
(climate) rows for 30 days. The scheduler refreshes relevant cache entries. A
provider outage leaves the trip usable and shows forecast unavailable (or a
stale cached value).

## Limits

- Roamarr uses a 14-day forecast horizon, plus up to 14 days of
  typical-weather estimates.
- Typical days are multi-year averages, not predictions; expect variance.
- A text-only location cannot be forecast without coordinates.
- Forecasts can change and are not guaranteed.
- Cached forecast data can be up to six hours old.
- Roamarr does not provide radar, alerts from authorities, or air quality.
