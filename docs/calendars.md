<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Calendars

Roamarr provides a one-time itinerary download, a subscription feed for one
trip, and an account-wide subscription feed. All use iCalendar (`.ics`).

## Authenticated trip download

Open a viewable trip and choose **Calendar** from its menu. Roamarr downloads a
current `.ics` file. The user must be signed in and must still own or share the
trip.

This is a snapshot. Importing the file into a calendar does not keep it in sync.

## Per-trip subscription

Only the trip owner can manage the subscription token:

1. Open the trip.
2. Choose **Share**.
3. Generate the calendar feed URL and optionally set an expiry.
4. Copy the URL into a calendar application's subscription feature.

Rotating the token invalidates the old URL immediately. Expired URLs stop
working.

## Account-wide subscription

Open **Profile → Calendar** and generate a feed URL. It includes every trip the
user can currently view, whether owned or shared. Access changes are reflected
the next time a calendar client fetches the feed.

Regenerating the URL rotates the token. An optional expiry can be attached to
the new token.

## Event contents

When a trip has a start date, the feed creates an all-day trip event. A trip
end date is encoded with the iCalendar-exclusive next-day `DTEND`, so the final
travel day remains included.

Each dated segment becomes an event with:

- UTC start and optional end;
- summary built from segment type and title;
- location;
- trip/destination context.

Calendar output excludes:

- confirmation numbers and itinerary detail JSON;
- trip and segment private notes;
- payment and budget information;
- companions and emergency contacts;
- travel documents, loyalty, card, and policy data;
- attachments and receipts.

The reduced output does not change when **Show details** is enabled for another
share.

## Security

A feed URL is a bearer credential. It bypasses login and can be fetched by
anyone who has the token. Treat it like a password:

- send it only to the intended calendar service;
- do not post it in support tickets or logs;
- rotate it after accidental disclosure;
- use an expiry for temporary access;
- remove old subscriptions from calendar applications after rotation.

Calendar routes are rate-limited. Public calendar feeds are read-only.

## Calendar-client behavior

Calendar applications choose their own refresh interval. A changed itinerary
may not appear immediately even when Roamarr returns current data. Force a
refresh in the calendar client or download a fresh snapshot when timing is
critical.

If a feed fails:

- verify the token was not rotated or expired;
- copy the entire URL without punctuation or whitespace;
- confirm the trip or account still has view access;
- check that the public `ORIGIN` is correct;
- inspect proxy logs and rate limits.
