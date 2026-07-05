<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Getting started

Roamarr is a self-hosted, single-container travel organizer. This guide takes
you from a fresh instance to your first trip with segments on a map.

## 1. Required environment

`ROAMARR_SECRET` must be set before boot. It is a base64-encoded 32-byte key
used to encrypt sensitive fields at rest.

```sh
export ROAMARR_SECRET="$(openssl rand -base64 32)"
export DATABASE_PATH="./roamarr-db"   # data location
export ORIGIN="https://roamarr.example.com"       # public URL behind a proxy
```
| Variable | Required | Purpose |
| --- | --- | --- |
| `ROAMARR_SECRET` | yes | Encryption key. **Reuse across rebuilds** or data is lost. |
| `DATABASE_PATH` | no | MongrelDB Kit data directory or file path (default `./roamarr-db`). |
| `ORIGIN` | no | Public origin for cookies/redirects behind a proxy. |
| `PORT` / `ATTACHMENTS_PATH` | no | Listen port (3000) / receipt attachment dir. |

## 2. First-user setup

With no users present, Roamarr redirects to `/setup`. Enter an **instance
name**, your **display name**, **email**, **password**, and **timezone**. This
creates the first **admin** user and signs you in. Setup is unreachable after
the first user exists; further registration is gated by **Allow registration**.

## 3. Create your first trip

1. Click **New trip** in the sidebar.
2. Enter a **Trip name** (e.g. "Summer in Lisbon"), pick a **Destination
   country**, and use the city autocomplete for a **Destination city**.
3. Set **Start/End date** and **Base currency**.
4. Optionally start from a template, add tags, and choose a default visibility.
5. Save — the trip opens on the **Itinerary** tab.

## 4. Add segments

Click **Add segment**, pick a type (flight, hotel, event, train, etc.), then
fill in title, start/end time, location, confirmation number, and notes.
Segments appear on the itinerary timeline and, when they have a city or venue,
on the trip map.

## 5. Enable maps

The trip page renders a MapLibre GL map of your segments. For city autocomplete
and city pins, seed city data once under **Settings → Maps**: download
`cities1000.zip` from GeoNames and upload it. Confirm the **Tile provider**
(OpenStreetMap by default; commercial providers need an API key).

See [Maps](./maps.md) and [Admin](./admin.md). Next: [Trips](./trips.md),
[Segments](./segments.md), [Sharing](./sharing.md), [Reminders](./reminders.md).
