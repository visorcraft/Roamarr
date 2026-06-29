<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Maps

Each trip page renders an interactive map of its segments using MapLibre GL JS.
This doc covers what powers it and how to configure it.

## What you see

On the trip page's **Itinerary** tab, the map plots a pin for:

- the trip's **destination city**, and
- every segment that has a **city** or **venue** resolved.

Hovering or selecting a pin highlights that segment on the timeline. The map is
part of the trip view — there is nothing to enable per trip beyond giving
segments a city.

## City autocomplete

City fields in the trip and segment forms use a **local** GeoNames lookup, not
a live external API. Seed it once:

1. Go to **Settings → Maps → City data**.
2. Download `cities1000.zip` from
   [download.geonames.org/export/dump/cities1000.zip](https://download.geonames.org/export/dump/cities1000.zip).
3. Upload the `.zip`. Roamarr unpacks and imports it into the local database.

Until this is done, autocomplete returns nothing and segments get no city pins.
The import is idempotent — re-uploading refreshes the data.

## Tile provider

The base map is drawn from a configurable **tile provider**, set under
**Settings → Maps → Map tiles**:

| Provider | API key | Provider | API key |
| --- | --- | --- | --- |
| OpenStreetMap | No (default) | Thunderforest | Yes |
| CARTO | No | Jawg | Yes |
| MapTiler | Yes | Protomaps | Yes |
| Stadia | Yes | Custom | Optional |

For commercial providers, paste an API key (AES-256-GCM encrypted at rest).
**Custom** lets you enter your own tile URL pattern and attribution for a
self-hosted or specialty tile server. Changing the provider updates the map for
every user immediately; Roamarr adjusts its CSP to allow the new tile origins.

## Enabling maps as admin

Maps render automatically once city data is seeded. Minimal setup:

1. Seed GeoNames `cities1000.zip` (above).
2. Leave the tile provider on OpenStreetMap, or switch and add a key.

No per-user or per-trip toggle exists; the map simply renders segments that
have a resolved city.
