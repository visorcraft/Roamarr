<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Search

The application header searches accessible, non-archived trips. Roamarr ships
with lexical search and offers optional local semantic search.

## Lexical search

Lexical search is always available. It searches:

- owned trip names and destination cities;
- owned segment titles, locations, and confirmation numbers;
- shared trip names and destination cities.

Shared segment fields are deliberately not part of lexical search. Archived
trips are excluded. Every result is checked against current ownership and
sharing rules before it is returned.

Press `/` outside a form control to focus search.

## Semantic search

An administrator can enable semantic search under
**Configuration → General**. It uses
`sentence-transformers/all-MiniLM-L6-v2`, local ONNX inference through
`@huggingface/transformers`, and MongrelDB approximate-nearest-neighbor search.
No search text is sent to a hosted inference service.

The first enable:

1. downloads the model from Hugging Face;
2. loads it into the Node process;
3. builds search documents and embeddings for existing trips.

The model is roughly 90 MB before runtime overhead. Files are cached at
`EMBEDDINGS_CACHE_PATH`, or in `roamarr-models/` beside the database by
default. The index is stored in MongrelDB.

Use **Reindex now** after repairing a failed model download or when the
administration page reports stale index state. Disabling semantic search
unloads its in-process model. It does not delete the model cache.

## Indexed text

Semantic documents can include:

- trip name and destination;
- city, state/province, country, status, and tags;
- trip notes;
- segment type, title, location, city, country, venue, and confirmation.

Results are filtered to trips the signed-in user can view and archived trips
are excluded. If semantic search cannot return a viewable result, Roamarr falls
back to lexical search.

## Privacy boundary

Semantic indexing is an administrator opt-in because its text is broader than
lexical search. A semantic result can contain indexed trip notes or
confirmation text for a signed-in user who can view that trip. This result
path does not apply the direct-share **Show details** toggle field by field.

Before enabling it on a multi-user instance:

- review which users have read access to trips;
- remove secrets from trip notes and confirmations where possible;
- understand that embeddings and source text live in the database;
- protect the model/index host like the rest of Roamarr;
- reindex after correcting sensitive source data.

Public share and calendar routes do not expose the authenticated search
endpoint.

## Resource use and failure

Initial download and indexing use network, CPU, memory, disk, and database I/O.
Run the first enable during a quiet period on a large instance. If loading
fails, ordinary lexical search remains available.

Check outbound HTTPS to Hugging Face, `EMBEDDINGS_CACHE_PATH` permissions, free
disk space, process memory, and **Reindex now** when troubleshooting.
