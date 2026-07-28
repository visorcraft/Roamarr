<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Loyalty programs

Loyalty records are user-owned and live under **Me → Loyalty**.

## Fields

- required program name;
- optional membership number;
- optional whole-number balance;
- balance-updated timestamp;
- notes.

Roamarr does not connect to airline, hotel, or rewards providers. Update
balances manually or with an authorized client.

## Privacy and storage

Membership numbers and notes are private, but they are not separately
field-encrypted. They are protected by the encrypted MongrelDB database,
filesystem controls, backups, and user ownership.

Trip sharing never grants access to another user's loyalty records. Public
links, calendars, notifications, and printable itineraries omit them.

OAuth/MCP loyalty reads use a privacy-safe projector that strips membership
numbers and notes. `private-details:read` does not override that wallet
redaction.

Avoid storing passwords, PINs, security answers, or redemption codes.
