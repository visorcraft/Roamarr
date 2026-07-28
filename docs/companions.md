<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Companions

Companions are trip-scoped people. Add and manage them under a trip's
**People** tab.

## Categories and fields

Categories are `adult`, `child`, `other`, `guide`, and `driver`.

A companion can record:

- name;
- category;
- dietary requirements, allergies, and medical notes;
- child car-seat, stroller, crib, meal, and ticket needs;
- seat and bed preferences;
- accessibility needs;
- room notes and general notes.

Most of this is highly sensitive. Enter only information needed for the trip
and delete it when retention is no longer justified.

## Link an existing user

An editor can select an active Roamarr user as a companion. Roamarr maintains a
single self-companion link for that account on the trip. Linked identity
enables consistent invitations and access checks.

## Invite a traveler

An ordinary adult/child/other companion can be associated with an email and
optionally invited. A known user can receive immediate trip access. An unknown
address receives a seven-day invitation and must claim it with the exact email.

Guide and driver categories cannot be invited as users.

A mail-delivery failure does not remove the created companion, share, or
pending invitation.

## Assignments

Companions can be used for:

- segment attendance (`going`, `maybe`, `not_going`);
- checklist responsibility;
- expense payer and split information;
- a linked travel document.

Free-text traveler names imported inside booking detail JSON are not companion
records until explicitly linked.

## Travel documents

A user-owned travel document may link to a companion on that user's trip.
Document numbers remain encrypted and ownership-checked. Deleting the
companion deletes a directly linked companion document, so review links first.

See [Travel documents](./travel-documents.md).

## Visibility

- Owners and edit shares receive the full companion data needed by the trip.
- Read shares receive a sanitized roster containing names/categories, not
  dietary, allergy, medical, accessibility, room, or note fields.
- Public links and calendar feeds receive no companion roster.
- Wallet/document projectors never expose protected numbers merely because a
  trip is shared.

The authenticated printable itinerary includes a traveler roster. Review it
before printing, saving a PDF, or emailing it.

## Delete

Deletion removes the trip companion and dependent attendance/link rows.
Because companions can be referenced by money, checklist, and document data,
review those modules after deletion. Deletion does not delete the linked
Roamarr user account.
