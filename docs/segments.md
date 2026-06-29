<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Segments

Segments are the individual events on a trip's itinerary: a flight, a hotel
night, a dinner, a train ride. They live on the trip page's **Itinerary** tab.

## Segment types

| Type | Use for | Type | Use for |
| --- | --- | --- | --- |
| Flight | Air travel | Boat | Ferries, cruises |
| Hotel | Accommodation | Shuttle | Airport/hotel transfers |
| Event | Tickets, shows, tours | Rideshare | Taxi/rideshare |
| Rental car | Car hire | Directions | Point-to-point routing |
| Train | Rail segments | Parking | Parking reservations |
| Food | Restaurants, meals | Point of interest | A sight or stop |
| Meet up | Meeting someone | Note | Untimed timeline note |
| Todo item | A task on the timeline | | |

## Creating a segment

1. On the trip page, click **Add segment** and pick a type.
2. Fill in the form. Common fields:

   - **Title** (required), **Start** (date/time + timezone), optional **End**.
   - **Location**/**Venue** (free text); **City** uses GeoNames autocomplete and
     adds a map pin.
   - **Confirmation number** — sensitive; hidden from public/calendar views.
   - **Status** — `planned`, `checked_in`, `boarded`, `arrived`, `completed`.
   - **Payment status** — `quoted`, `deposit_paid`, `fully_paid`, `refunded`.
   - **Meeting point/time**, and **Notes** (free text).

   Some types add type-specific fields (airline/flight number, room
   preferences, pickup location).

3. Save. The segment appears on the timeline and, if it has a city, on the map.

## Managing segments

- **Edit**, **Duplicate** (reuse details for the next leg), **Move to date**
  (reschedule without retyping), **Set status** (checked-in, arrived, …).
- **Reorder** by adjusting start times; the timeline sorts by start.
- **Delete** one segment, or **bulk delete** several at once.

## Segment attendees

Each segment can list which [companions](./companions.md) are included, with an
RSVP of `going`, `maybe`, or `not_going` — handy when the group splits up.

## Privacy

Confirmation numbers, payment details, and notes are sensitive. They show only
to the owner and to viewers with **Show details** enabled; public links and
calendar feeds never include them. See [Sharing](./sharing.md).
