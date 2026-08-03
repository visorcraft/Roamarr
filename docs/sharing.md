<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Sharing

Only a trip owner can manage access. Open the trip menu and choose **Share**.

Roamarr supports direct users, dynamic groups, public bearer links, and a
separate calendar token.

## Direct share

Enter an email and choose:

- `read`: reduced read-only trip access;
- `edit`: trip and private-module editing.

If the address belongs to an active account, access begins immediately and
Roamarr attempts an email notification. If no account exists, Roamarr creates a
seven-day invitation. The recipient must register or sign in with that exact
normalized email to claim it.

A failed notification email does not roll back the share or invitation. Owners
can revoke pending invitations and active shares.

## Group share

Choose a group and `read` or `edit`. Group access is dynamic:

- adding a member grants access to current group shares;
- removing a member removes group-derived access;
- deleting the group removes its trip shares.

Users can have both direct and group access. Roamarr applies the access found
for the operation. See [Groups](./groups.md).

## Show details

For a read direct/group share, **Show details** adds these segment fields:

- confirmation number;
- type-specific detail JSON.

It does not add:

- trip notes;
- segment payment status;
- expenses or budgets;
- companion dietary, allergy, medical, accessibility, room, or note fields;
- documents, cards, loyalty, insurance, emergency contacts, or attachments;
- private trip planning modules.

An edit share receives the editor view and is not reduced by this read toggle.

## Public link

The owner can generate a read-only URL, optionally set an expiry, and decide
whether public **Show details** is enabled. Revocation destroys the token;
generating another URL creates a new bearer token.

The public route does not require an account. Anyone with the URL can use it
until expiry or revocation. Enabling **Show details** exposes segment
confirmation numbers and detail JSON to that audience.

Public links are rate-limited.

## Exact visibility

| Data | Owner/edit share | Read share | Public link | Calendar feed |
| --- | --- | --- | --- | --- |
| Trip name, destination, dates, status, tags | Yes | Yes | Yes | Reduced |
| Segment type, title, time, status, location, venue, meeting fields | Yes | Yes | Yes | Reduced |
| Segment confirmation and detail JSON | Yes | Optional **Show details** | Optional public **Show details** | No |
| Trip notes and segment payment status | Yes | No | No | No |
| Companion names/categories | Yes | Sanitized roster | No | No |
| Companion sensitive fields | Yes | No | No | No |
| Checklist, expenses, budgets, journal, comments, document links | Yes | No | No | No |
| Polls, home tasks, medications, requirements, important items, reminders | Yes | No | No | No |
| Travel-document numbers, cards, loyalty, insurance, emergency contacts | Owner's separate access | No | No | No |
| Receipts and private attachments | Yes | No | No | No |

Signed-in edit shares can modify private trip data. Grant edit only to someone
trusted with the whole operational trip.

## Calendar

The trip calendar token is separate from the public link and never enables
**Show details**. Manage it on the same Share page. Rotate or revoke it without
changing direct, group, or public access.

See [Calendars](./calendars.md).

## Revocation checklist

After accidental disclosure:

- remove the direct/group share or member;
- revoke a pending invitation;
- revoke/regenerate the public link;
- revoke/regenerate the calendar feed;
- rotate the account-wide calendar URL if it also leaked;
- review Audit Logs;
- remove sensitive confirmations/details that were exposed.

Duplicating a trip does not copy shares or tokens. Merging trips can reconcile
and retain shares, so review recipient access after a merge.

Share and membership changes also push a live `shares` hint to affected users'
open sessions, so revoked access stops trip-event delivery and prompts a
refetch; see [Real-time sync](./realtime.md).
