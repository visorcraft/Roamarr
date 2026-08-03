<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Backup and restore

Roamarr's administrative backup is the disaster-recovery format. Trip JSON/CSV
export is a portability format and is not a full backup.

Only administrators can download or stage a restore. Both operations are
rate-limited.

## Create a backup

1. Open **Maintenance → Database Maintenance**.
2. Run **Flush**. Optionally run **Garbage collect** first when a smaller
   archive is worth the extra I/O.
3. Open **Maintenance → Backup & Restore**.
4. Download the `.mongreldb.tar.gz` archive.
5. Store it with the matching application secret and optional database
   credentials in a separate protected location.

The browser route permits three backup requests per minute.

## Scheduled automatic backups

Open **Maintenance → Backup & Restore → Automatic backups** to let the
scheduler create backups without a browser download. Configure:

| Setting | Purpose |
| --- | --- |
| Enable automatic backups | Master switch; off by default. |
| Interval (hours) | Minimum time between runs (default 24, maximum 720). |
| Retention (keep newest) | How many `auto-` archives to keep (default 7, maximum 100). |

The same three settings, plus the last-run timestamp and stored-archive count,
round-trip through the admin JSON API (`/api/mobile-admin`).

When enabled, the 60-second scheduler tick writes
`auto-roamarr-backup-<timestamp>.mongreldb.tar.gz` archives to a `backups/`
directory beside the database directory. The archive contents are identical to
the manual download. Each archive is written to a temporary file and renamed
into place, so an interrupted run never leaves a half-written backup. After
each run, archives beyond the retention count are pruned — oldest first, and
only files with the `auto-` prefix; any other file in the directory is never
deleted.

The page shows the last run, the next due time, and how many archives are
stored. A failed run is logged and retried at the next tick; it never blocks
other scheduler work. Move the archives off the host (or include the directory
in host-level backups) — automatic backups beside the live database do not
protect against losing the machine.

## Archive contents

A backup includes:

- the complete MongrelDB directory and schema;
- application settings, users, trips, OAuth state, audit history, and other
  database rows;
- the encrypted attachment directory;
- an empty GeoNames table structure, while omitting the large rebuildable city
  dataset.

The default attachment directory is inside the database directory and is
included automatically. A separate attachment directory below the database
path's parent is added and normalized to the archive's top-level
`attachments/` directory. An arbitrary `ATTACHMENTS_PATH` elsewhere is outside
the backup pack root. Back it up separately and verify that recovery restores
both data sets.

A backup does not include:

- `ROAMARR_SECRET`;
- `DATABASE_USER` or `DATABASE_PASS`;
- `.env` or service-manager configuration;
- application source, build output, or logs;
- the optional semantic-search model cache;
- the downloaded globe texture in the sibling `maps/` directory;
- the GeoNames city rows.

After restoring, enable or re-import Maps to recover GeoNames city
autocomplete and download the globe texture. Semantic search downloads its
model again if the cache was not separately preserved.

## Security

The database and attachment contents remain encrypted, but the archive is
still sensitive. It contains private account and travel data, hashes, metadata,
and everything needed for offline attacks against user passwords. Apply the
same access control, encryption, retention, and deletion rules used for the
live database.

Keep these recovery items together in a protected inventory:

- the backup archive;
- the exact `ROAMARR_SECRET`;
- `DATABASE_USER` and `DATABASE_PASS` when enabled;
- the Roamarr release version that created the backup;
- any separate map/model cache snapshot you intend to retain.

Do not email a production archive or place it in a public object store.

## Restore prerequisites

The restore page accepts `.mongreldb.tar.gz` and `.tar.gz` archives up to
512 MB. The adapter-node and reverse-proxy upload limits must also allow the
file. See [Deployment and upgrades](./deployment.md#adapter-node-variables).

Allow enough free storage for:

- the uploaded compressed archive;
- the extracted archive;
- the current database and attachments;
- a temporary `.old` copy during the swap.

Use the same secret and database credentials as the source installation.

## Stage and apply a restore

1. Stop normal user activity.
2. Take a backup of the current installation if it is readable.
3. Open **Maintenance → Backup & Restore**.
4. Select the archive and confirm the destructive restore.
5. Wait for upload, extraction, and validation to finish.
6. Restart the Roamarr process.
7. Wait for boot to apply the staged swap and migrations.
8. Check `/health/deep`, sign in, and inspect representative data.
9. Re-import map data and re-enable semantic search if needed.

Uploading does not mutate the open database. Roamarr extracts beside the
database and validates:

- archive structure;
- the MongrelDB `CATALOG` and `tables` layout;
- native MongrelDB doctor output;
- required Kit migration and settings tables.

Only a validated restore writes `restore-pending.json`. The next boot moves the
current database and attachments to temporary `.old` paths, swaps in the
staged data, opens and migrates it, then removes the old paths after success.

The restore endpoint allows three requests per minute.

## Restore failure

If upload fails:

- confirm the extension and 512 MB application limit;
- check `BODY_SIZE_LIMIT` and proxy limits for HTTP `413`;
- verify free disk space and service-account permissions;
- confirm the archive is a Roamarr full backup, not trip JSON/CSV;
- inspect the displayed validation error and process log.

If restart cannot open the restored database:

- stop the service;
- confirm the original secret and database credentials are present;
- preserve the staged, active, and `.old` directories before manual work;
- inspect the exact boot error;
- do not repeatedly start different Roamarr versions against the paths.

The swap is designed to retain the old data until the restored database opens
successfully. Do not delete `.old` or staging paths while diagnosing a failed
restore.

## Test a backup

The only proof of a recoverable backup is a successful test restore:

1. create an isolated host or working directory;
2. install the recorded Roamarr version;
3. configure the matching secret and database credentials;
4. restore the archive;
5. verify `/health/deep`, sign-in, trips, attachments, and security settings;
6. destroy the test copy securely.

Never test by replacing the only production instance.

## Trip export is different

[Import and export](./import-export.md) carries owned trip fields and
segments between accounts or instances. It omits accounts, security settings,
shares, attachments, private trip modules, and most application state. Exported
JSON is plaintext. It cannot recover a Roamarr installation.
