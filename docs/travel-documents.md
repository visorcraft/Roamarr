<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Travel documents

Travel documents are user-owned records under **Me → Documents**.

## Types and fields

Supported types:

- passport;
- driver's license;
- Global Entry;
- visa.

Fields:

- type;
- document number;
- issuing authority;
- expiry date;
- optional companion owner;
- notes.

The companion must be accessible to the document owner. Leaving Companion
blank means the document belongs to the user.

## Encryption

Document numbers are encrypted at rest with AES-256-GCM. Notes and other
metadata are private but not separately field-encrypted. The entire MongrelDB
database is also encrypted.

Do not put passwords, PINs, or unnecessary identity data in Notes.

## Expiry reminder

Saving an expiry date schedules a document-expiry reminder at 09:00 in the
user's timezone, the configured number of days beforehand. The default user
lead is 90 days. Editing/removing the date re-arms/removes the generated
reminder.

See [Reminders](./reminders.md).

## Companion deletion

A document linked directly to a companion is deleted when that companion is
deleted. Review document ownership before removing a trip companion.

## Visibility

Document rows remain user-owned even when linked to a companion on a shared
trip. Public links, calendars, notifications, and printable itineraries never
include document numbers.

OAuth/MCP travel-document safe projectors redact numbers and notes. The
`private-details:read` trip scope does not remove that redaction.
