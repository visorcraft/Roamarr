<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Polls

Polls attach a question and choices to a trip.

## Rules

- Question: required, at most 500 characters.
- Options: 2 through 10.
- Option label: at most 200 characters.
- A vote belongs to a real companion on that trip.
- The `(poll, companion)` pair has one vote; another vote changes its option.
- Deleting a poll deletes options and votes.

## Access

Creation, voting, and deletion require owner or edit-share access. Voting is
recorded for a selected companion, not directly against the signed-in account.

The current trip page does not render a poll panel. Use an OAuth/MCP client:

- `roamarr_poll_list`;
- `roamarr_poll_create`;
- `roamarr_poll_cast_vote`;
- `roamarr_poll_delete`.

The list tool accepts a viewable trip and the write tools require edit access.
Grant `polls:read` and `polls:write` only as needed. MCP deletion also requires
`confirm: true`.

Polls are never part of public-link or calendar output. They do not
automatically alter itinerary or money data.
