<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Photo galleries

Saved places and trips each have a photo gallery: an ordered set of images
with optional captions. On the **Places** page, expand a place row's photo
button to manage its gallery. On a trip, the gallery lives on the
**Documents** tab next to uploaded files.

## What you can upload

- JPEG, PNG, or WebP images only — unlike [trip documents](./trip-documents.md),
  galleries reject PDF and GPX files even though the attachment store accepts
  them.
- Up to **10 MB** per image and **50 images** per place or trip.
- Content is checked against magic bytes, so the declared type must match the
  payload.

Images use the same encrypted attachment store as trip documents and expense
receipts (at-rest chunk encryption under `ATTACHMENTS_PATH`).

## Ordering, captions, and covers

Thumbnails appear in sort order. Owners and trip editors can move an image
one step earlier or later, edit its caption (at most 200 characters; empty
clears it), and delete it. Deleting an image also deletes the underlying
attachment, including the encrypted file on disk.

A place's first gallery image becomes its cover image
(`places.image_attachment_id`). Removing the cover promotes the next image
in order; removing the last image clears the cover.

Deleting a place or a trip deletes its gallery rows and attachments.

## Mobile upload

Native clients upload photos over the bearer-authenticated JSON API (see
[HTTP JSON API](./http-api.md)):

- `POST /api/mobile/trips/{id}/gallery` (`trips:write`) — owner or edit share;
- `POST /api/mobile/places/{id}/gallery` (`saved-places:write`) — owner only.

Both accept a multipart body with image files in `file` or `images` fields and
an optional `caption` (applied to the first image of the batch), and answer
`201` with the created gallery projections. The same image-type and 50-image
cap rules apply. Image bytes download with the same token from
`/trips/{id}/gallery/{imageId}` and `/places/{id}/gallery/{imageId}`.

## Visibility

- **Places** have no sharing: only the owner can see or change a place
  gallery.
- **Trips**: owners and edit shares manage the gallery. Like trip documents,
  galleries are excluded from read-share, public-link, calendar, printable,
  and notification projections. The image download route requires an
  authenticated session with trip view access, matching trip documents.

## MCP

Galleries are exposed over MCP under the `gallery:read` / `gallery:write`
scopes:

- `roamarr_gallery_list` — list photos for a place or trip;
- `roamarr_gallery_reorder` — replace the ordering (must list every image id
  exactly once);
- `roamarr_gallery_set_caption` — set or clear a caption;
- `roamarr_gallery_remove` — delete a photo (`confirm: true` required).

There is no binary upload over MCP; photos are uploaded in the web UI or via
the mobile upload endpoints above. See [MCP and AI access](./mcp-ai.md).
