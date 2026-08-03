<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Trip document links

Document links are trip-scoped URLs for vouchers, reservations, shared files,
or other external material. They are different from **uploaded** trip/segment
[file documents](./trip-documents.md), from user-owned
[travel documents](./travel-documents.md), and from place-scoped
[place links](./places.md#links) in the saved-places library.

## Fields

- label, required, at most 200 characters through the web form;
- absolute `http` or `https` URL;
- optional notes, at most 2,000 characters through the web form.

Owners and edit shares can add links on the trip's **Documents** tab. The
current panel displays existing links and adds new ones. Full update/delete
management is available through:

- `roamarr_doc_link_list`;
- `roamarr_doc_link_create`;
- `roamarr_doc_link_update`;
- `roamarr_doc_link_delete`.

MCP deletion requires `confirm: true`.

## Security

Roamarr validates the URL scheme but does not fetch, scan, encrypt, or preserve
the linked file. Opening it sends the browser to another origin. That service
controls authentication, retention, tracking, and access.

Do not place credentials or bearer tokens directly in a URL. Use an external
service with its own access controls.

Document links and notes are available to owners/editors in the web trip.
They are excluded from read-share, public-link, calendar, printable, and
notification projections. Scoped MCP list access follows the tool's view rule.
