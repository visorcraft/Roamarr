<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Trip and segment file documents

Roamarr stores **uploaded files** (PDF and images) for a trip or for a specific
itinerary segment. This is separate from [external document links](./document-links.md)
(URL-only) and from account-level [travel documents](./travel-documents.md)
(passports, visas).

## What you can attach

Allowed types (same rules as expense receipts):

- JPEG, PNG, WebP images
- PDF

Maximum size: **10 MB** per file. Content is checked against magic bytes so the
declared type must match the payload.

Typical uses: event QR codes, shuttle vouchers, hotel confirmations, boarding
passes, parking receipts.

## Scope

| Scope | Meaning |
| --- | --- |
| **Whole trip** | File appears on the trip **Documents** tab as “Whole trip”. |
| **Segment** | File is tied to one itinerary item; shown on that segment’s **Files** panel and on the trip Documents tab with the segment title. |

Deleting a segment removes its files. Deleting a trip removes all of its files.

## Where to upload

- **Documents** tab on the trip: choose “Whole trip” or a segment, pick a file,
  optional label and notes.
- **Selected segment → Files**: upload while reviewing the itinerary.
- **Edit segment**: list existing files and upload more under the edit card.
- **Add segment** form: multi-file picker; files attach after the segment is
  created.

## Storage and security

Files use the same encrypted attachment store as expense receipts and trip
posters (at-rest chunk encryption under `ATTACHMENTS_PATH`). Download requires
an authenticated session with trip view access. Uploads and deletes require
edit access (owner or edit share).

Files are available to owners/editors on the web trip. They are excluded from
read-share, public-link, calendar, printable, and notification projections in
the same spirit as document links.

Do not upload credentials or secrets in clear text inside PDFs if you share
edit access with others.

## Download

Each file is served from `/trips/{tripId}/documents/{documentId}` with an
`inline` disposition so PDFs and QR images can open in the browser.
