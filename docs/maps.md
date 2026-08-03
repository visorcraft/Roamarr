<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Maps

Maps are an administrator-controlled optional feature. They provide local city
lookup, itinerary maps, and a 3D globe.

## Enable

Open **Configuration → Maps** and enable Maps. Roamarr imports:

- GeoNames `cities1000.zip` plus first-level administrative labels;
- NASA Blue Marble Earth texture.

The operation is idempotent. The page also offers re-import/re-download and
manual upload controls when automatic network access is unavailable.

Disabling Maps stops map/city features but keeps downloaded data. It does not
block ordinary free-text trip or segment saves.

## City data

City autocomplete uses the local GeoNames table, not a browser API call. A city
record supplies:

- canonical name;
- two-letter country code;
- optional state/province/territory code and label;
- latitude and longitude;
- population used to choose among exact-name matches.

When a country has administrative data, select the state/province before the
city to narrow lookup. Re-import GeoNames after an upgrade that adds new city
fields.

## Itinerary map and globe

The **Itinerary** tab can plot the trip destination and segments with
coordinates. The map uses MapLibre GL JS and raster tiles. The globe uses
Three.js, bundled Natural Earth borders, the downloaded NASA texture, and
GeoNames city points.

The selected upcoming city controls map focus. Items without coordinates
remain usable in the itinerary but cannot be positioned.

The **Places** page shows the saved-places library on a clustered MapLibre
map with category-colored pins. Places without coordinates appear in the
list only.

## GPX tracks

Places and trip documents can carry GPS tracks (`.gpx` files). When Maps are
enabled, tracks render as lines on the relevant map:

- **Places** map: each place's track in its category color, with a
  **GPX tracks** toggle in the top-left corner.
- **Trip** hero map: tracks attached to trip/segment documents, colored per
  segment, with the same toggle. The map reframes to include track bounds.

Tracks are fetched from the same authenticated download endpoints used for
file downloads; nothing leaves the instance.

## Tile providers

Supported choices:

| Provider | Key normally required |
| --- | --- |
| OpenStreetMap | No |
| CARTO | No |
| MapTiler | Yes |
| Stadia | Yes |
| Thunderforest | Yes |
| Jawg | Yes |
| Protomaps | Provider-dependent |
| Custom | Provider-dependent |

Commercial terms, rate limits, and attribution belong to the provider.
Roamarr encrypts saved API keys at rest.

A custom raster URL must use `{z}`, `{x}`, and `{y}` placeholders and include
correct attribution. Changing provider updates the content security policy to
permit its tile origin.

## Place search providers

The Maps tab also configures the provider behind the saved-place prefill
search (see [Saved places](./places.md#place-search-nominatim-or-google-places)):
OpenStreetMap Nominatim (default, no key) or Google Places (requires an API
key, encrypted at rest and masked in the UI). When Google is selected without
a key, searches fall back to Nominatim with a warning in the dialog.

## Network and privacy

- GeoNames and NASA downloads originate from the Roamarr server.
- City search reads the local database.
- Raster tiles are requested by the user's browser from the configured tile
  host, which sees normal request metadata and requested tile coordinates.
- The globe texture is served locally after download.

Choose a self-hosted custom tile service if browser contact with a third-party
tile provider is unacceptable.

## Storage and backup

GeoNames rows live in MongrelDB but are excluded from backup archives because
they are rebuildable. The texture is stored as `maps/earth-day.jpg` beside the
resolved database path and is also excluded.

After restore, re-import/re-download map data.

## Attribution

- Cities: [GeoNames](https://www.geonames.org/), CC BY 4.0.
- Country borders: [Natural Earth](https://www.naturalearthdata.com/), public
  domain.
- Earth texture: [NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble),
  public domain.
- Default tiles: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

Keep the active tile provider's required attribution visible.
