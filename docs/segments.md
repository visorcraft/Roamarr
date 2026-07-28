<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Segments

Segments are dated or contextual itinerary items inside a trip.

## Types

| Type | Typical use |
| --- | --- |
| `flight` | Airline leg |
| `hotel` | Lodging |
| `train` | Rail leg |
| `rental_car` | Vehicle reservation |
| `rideshare` | Taxi or app ride |
| `shuttle` | Airport or hotel transfer |
| `boat` | Ferry or cruise movement |
| `event` | Ticket, tour, show, or appointment |
| `food` | Restaurant or meal |
| `parking` | Parking reservation |
| `directions` | Route between places |
| `poi` | Point of interest |
| `meetup` | Meeting a person or group |
| `todo` | Itinerary task |
| `note` | Free-form itinerary note |

## Create and edit

Open a trip's **Itinerary** and choose **Add segment**. Common fields include:

- required type and title;
- local start date/time and IANA timezone;
- optional end;
- status;
- location, country, state/province, city, and coordinates;
- venue and meeting point/time;
- confirmation number;
- payment status;
- type-specific details.

Type-specific fields are stored in structured detail JSON. Forms validate
known enum, date, timezone, coordinate, and ownership values. A resolved
GeoNames city supplies map coordinates, but Maps being disabled does not block
ordinary free-text saves.

## Status

Segment statuses are:

- `planned`;
- `checked_in`;
- `boarded`;
- `arrived`;
- `completed`.

Payment statuses are:

- `quoted`;
- `deposit_paid`;
- `fully_paid`;
- `refunded`.

Status changes are explicit. Payment status is separate from an expense.

## Itinerary views

- **Timeline** groups and orders travel chronologically.
- **List** provides a dense itinerary list.
- **Board** groups segments for operational status work.

Filters and sorting change the presentation, not stored start times.

Selecting a segment opens:

- **Details** for time, location, status, and booking fields;
- **Travelers** for companion attendance;
- **Notes** for structured type-specific data;
- **Reminders** for scheduled alerts.

Editors can edit, duplicate, delete, move to another date, change status, and
add a reminder. Moving a segment preserves its time-of-day relationship while
changing the target date.

## Travelers

Link trip companions to a segment with:

- `going`;
- `maybe`;
- `not_going`.

Some imported booking details can also contain free-text traveler names. Those
names are not linked companion records.

## Cards and payment

A segment can reference one user-owned card when the operation validates
ownership. Roamarr stores card network and last four digits, never a full
payment-card number.

Payment status and booking confirmation are informational. They do not create
or settle an expense automatically.

## Privacy

| Audience | Ordinary fields | Confirmation and detail JSON | Payment status |
| --- | --- | --- | --- |
| Owner or edit share | Yes | Yes | Yes |
| Read share | Yes | Only with that share's **Show details** | No |
| Public link | Yes | Only when owner enables public **Show details** | No |
| Calendar feed | Reduced event fields | No | No |

Trip notes, money, companion-sensitive fields, wallet records, and private
planning modules are not segment projection fields.

Confirmation numbers and type-specific details can be sensitive. Keep public
**Show details** off unless every exposed field is safe for anyone holding the
link.
