<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Saved places

Places are a per-user library of reusable points of interest under
**Plan → Places**. A place can later be pulled onto a trip as a
point-of-interest segment, and a trip's POI segment can be saved back into
the library.

## Categories

Every user gets eight default categories on first access (they are seeded
lazily, like benefit templates):

- Nature & Outdoor
- Entertainment & Leisure
- Culture
- Food & Drink
- Adventure & Sports
- Festival & Event
- Wellness
- Accommodation

Each category has a color used for list dots and map pins. Categories can be
added, renamed, recolored, and deleted on the Places page. Deleting a
category keeps its places and just unlinks them.

## Place fields

| Field | Values |
| --- | --- |
| Name | Required label. |
| Category | Optional; one of the user's categories. |
| Address | Optional free text. |
| City | Optional GeoNames city (country + autocomplete, when Maps is enabled). |
| Latitude / Longitude | Optional pair; prefilled by search or city lookup. |
| Typical visit | Optional whole minutes. |
| Price | Optional amount, stored in minor currency units (cents). |
| Notes | Optional free text; renders safe Markdown (headings, bold/italic, links, lists, code) on the Places page. |
| Status | `planned` (default) or `visited`; visited records a timestamp. |
| Favorite | Optional star flag. |

## Map

When Maps are enabled, the Places page shows all places that have
coordinates on a clustered MapLibre map. Pins use the category color;
clusters expand on click.

## Photo gallery

Each place has a photo gallery (JPEG/PNG/WebP, up to 50 images). Expand a
place row's photo button on the Places page to upload, caption, reorder, and
delete photos. The first gallery image becomes the place's cover image. See
[Photo galleries](./gallery.md).

## Links

Each place can carry external links (label + `http`/`https` URL + optional
notes) for official sites, menus, booking pages, or trail maps. Expand a
place row's link button to add, edit, and delete links; they are displayed
grouped by domain (hostname). Links open in a new tab
(`rel="noopener noreferrer"`). Roamarr validates the URL scheme but never
fetches the target — the same rules as
[trip document links](./document-links.md), which are the trip-level
equivalent.

Links are private to the place's owner (places have no sharing) and are
deleted with the place.

## GPX tracks

Each place can carry one GPX track (`.gpx`, up to 10 MB). Use the upload
button on a place row to attach a track; attaching a new one replaces the
old file. The download button saves the track, and the remove button
detaches and deletes it. Deleting a place also deletes its track.

GPX files are content-sniffed (the root element must be `<gpx>`), stored in
the encrypted attachment store, and served from `/places/{id}/gpx` as an
`attachment` download — never inline. On the Places map, tracks render as
lines in the place's category color with a **GPX tracks** toggle.

## Place search (Nominatim or Google Places)

The add/edit dialog can prefill name, address, and coordinates from a place
search provider. The default is OpenStreetMap's Nominatim service: Roamarr
identifies itself with a descriptive User-Agent, sends at most one request per
second, caches recent queries briefly, and times out quickly.

An admin can switch the provider to **Google Places** (Places API (New) Text
Search) on **Admin → General → Maps → Place search**. The Google API key is
stored encrypted at rest and masked in the UI; the same 1-request-per-second
serialization, short-lived cache, and quick timeout apply, so the dialog
behaves identically either way. If Google is selected but no API key is
configured, searches silently fall back to Nominatim and the dialog shows a
warning note.

If the instance is offline or the lookup fails, the form still saves manually
entered places.

## Trip bridge

- On a trip, a selected **Point of interest** segment offers
  **Save to places**, which copies its title, location, and coordinates into
  the library.
- When adding a POI segment, the **From places** picker prefills the form
  from a saved place and records the place id in the segment's details for
  traceability.

## Import

**Plan → Places → Import** (`/places/import`) bulk-imports saved places from
external sources, with a dry-run preview and duplicate detection before
anything is written.

Supported inputs:

- **Google Takeout "Saved" CSV** — the `Title,Note,URL,Comment` export.
  Coordinates are extracted from the Google Maps URL when present
  (`!3d…!4d…`, `/@lat,lng`, or `?q=lat,lng`); rows without coordinates still
  import (name plus a source link).
- **KML** — Placemarks with name, description, address, and Point
  coordinates (`lng,lat[,alt]`).
- **KMZ** — a zipped KML archive (the first `.kml` entry is used).
- **GeoJSON** — a FeatureCollection of Point features; the name comes from
  `properties.name`/`title`, notes from `properties.description`, and a
  `properties.category` string is matched against existing categories.
- **Pasted Google Maps links** — one `http(s)` place link per line, parsed
  locally. Short `maps.app.goo.gl` links carry no coordinates; they import
  as a named row with a source link.

The preview table shows every parsed row with its coordinates, parse
warnings, and a duplicate flag. A row counts as a duplicate when its name
exactly matches an existing place (case-insensitive) or its coordinates fall
within 50 m of one — or of an earlier row in the same import. Uncheck rows
to exclude them, optionally assign one category to the whole batch, and keep
**Skip duplicates** on (the default) to import only new places.

Limits: 20 MB per file, 10,000 rows per import. Imports are rate-limited and
recorded in the audit log (`places_import`).

The same dedupe-and-create pipeline is available over MCP as
`roamarr_saved_places_import` (`saved-places:write`, requires `confirm`),
which takes structured rows instead of files — there is no binary upload
surface over MCP.

## MCP

Saved places are exposed over MCP under the `saved-places:read` /
`saved-places:write` scopes (distinct from `places:*`, which covers visited
countries and U.S. states). Place links ride on the same scopes — they are
part of a place's data, so no separate scope group exists for them. Full
link management is available through `roamarr_place_links_list`,
`roamarr_place_links_create`, `roamarr_place_links_update`, and
`roamarr_place_links_delete`. Destructive tools require `confirm: true`.
See [MCP and AI access](./mcp-ai.md).
