<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Groups

Groups are reusable, dynamic sets of existing Roamarr users for trip sharing.

## Create and manage

Open **Groups** under **Organizer**.

The owner can:

- create and rename a group;
- add an active existing user by email;
- remove a member;
- delete the group.

There is no group invitation for an unknown email. Create/invite the user
account first, then add it.

Members can see group names in their group list. Only the owner can open the
management page and inspect/change its roster.

## Share

On an owned trip's **Share** page, choose a group and `read` or `edit`. Only a
group owned by the sharing user is eligible for that operation.

Access follows membership:

- adding a member grants access to all current trips shared with the group;
- removing a member removes that group-derived access immediately;
- deleting the group deletes its trip-share rows.

Deletion does not convert group access into permanent direct shares. A member
with a separate direct share keeps that separate access.

## Details and privacy

A group share has its own **Show details** toggle. For a read share it controls
segment confirmation numbers and type-specific detail JSON. It does not reveal
trip notes, money, companion-sensitive data, or account records.

An edit group share grants editor access to every current member. Review group
membership before using it for private or financial trip data.

See [Sharing](./sharing.md).
