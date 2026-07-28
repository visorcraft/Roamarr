<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Notes, journal, and comments

A trip has three text surfaces with different structure.

## Trip notes

Trip notes are one free-form field edited with the trip. They are visible to
the owner and edit shares. They are excluded from read-share, public-link,
calendar, and printable projections.

An MCP client can receive them only through a supported read with
`private-details:read`, after both administrator policy and user consent.
Semantic search has a separate privacy boundary and can index notes.

## Journal

Journal entries appear under the trip's **Notes** tab. Each contains:

- required date;
- required title, up to 200 characters;
- required body, up to 10,000 characters.

Owners and edit shares can create and delete entries in the current trip UI.
MCP adds list, create, update, and delete:

- `roamarr_journal_list`;
- `roamarr_journal_create`;
- `roamarr_journal_update`;
- `roamarr_journal_delete`.

The MCP list accepts a viewable trip with `journal:read`; writes require edit
access and `journal:write`. Deletion requires `confirm: true`.

## Comments

Comments are short collaborative messages on the Notes tab. Owners and edit
shares can add a nonblank comment. A user can delete their own comment.

MCP tools are:

- `roamarr_comment_list`;
- `roamarr_comment_create`;
- `roamarr_comment_delete`.

## Privacy

Journal and comment data is excluded from public links, calendars, printable
itineraries, and notification payloads. A scoped MCP read can expose it to a
user who can view the trip, so combine share permissions and OAuth scopes
carefully.

These fields are stored in the encrypted database but are not separately
field-encrypted. Avoid passwords, document numbers, or other secrets in them.
