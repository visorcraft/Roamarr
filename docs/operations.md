<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Operations

Administrative operations live under **Maintenance**. They cover scheduler
runs, health checks, audit records, backups, database maintenance, and demo
data.

## Runtime ownership

Run one Roamarr process per database. The MongrelDB Kit handle is
process-affine. A sidecar process can appear to write successfully while the
running application cannot see those writes. Do not use a second Roamarr,
seeder, or maintenance process against a live database.

Application boot opens and migrates the database before the scheduler starts.
The guarded scheduler runs once every 60 seconds, never overlaps itself, and
abandons a tick after its deadline rather than starting concurrent work.

## Scheduler work

Each tick can:

- send due reminders;
- check due fare watches;
- refresh weather cache entries;
- poll the global and enabled personal IMAP inboxes;
- remove expired sessions and passkey challenges;
- remove expired OAuth authorization data and rate-limit buckets;
- expire share and invitation windows;
- flush MongrelDB memtables.

Compaction runs hourly. Old scheduler-run records are pruned to the latest 100.
A service outage does not discard a due reminder; it is processed after the
next successful start.

Open **Maintenance → Job History** to inspect start time, finish time, result,
and errors. **Run scheduler now** requests an immediate guarded tick. It does
not create a second overlapping run.

## Health endpoints

Both health routes are intentionally public so infrastructure can call them
before setup or sign-in:

| Route | Cost | Success | Failure |
| --- | --- | --- | --- |
| `GET /health` | Lightweight | JSON with `ok`, database, and scheduler state | JSON diagnostics |
| `GET /health/deep` | Database diagnostics | HTTP `200` | HTTP `503` |

The deep route performs integrity and read-only query checks and is
rate-limited. A healthy result covers Roamarr and MongrelDB, not external
SMTP, IMAP, webhooks, map tiles, Open-Meteo, Hugging Face, or an AI parser.

## Audit logs

**Maintenance → Audit Logs** records security-relevant activity such as:

- authentication and security changes;
- user administration;
- sharing and public-token changes;
- OAuth client and consent changes;
- settings changes;
- backup, restore, and maintenance actions.

Filter records by available fields, open a row for metadata, or export the
current result as CSV. Audit metadata can contain identifiers and operational
context. Treat an export as private administrative data.

Audit logs are useful evidence, not a replacement for host, proxy, and process
logs. Roamarr does not manage log rotation for the process supervisor.

## Database maintenance

Open **Maintenance → Database Maintenance**.

### Check integrity

Runs read-only MongrelDB checks and reports their output. Start here when
`/health/deep` fails, after an unclean shutdown, or before and after deeper
maintenance.

### Flush

Forces current memtable writes to persistent runs. The scheduler normally does
this each tick. Use it before a backup or garbage collection when you want an
explicit synchronization point.

### Garbage collect

Compacts and vacuums database storage to reclaim obsolete run and WAL space.
For maximum reclamation, run **Flush** first. This can be I/O intensive; use a
quiet period and keep a current backup.

### Doctor

Runs MongrelDB repair diagnostics. Doctor is destructive: corrupt runs may be
quarantined or dropped to recover an openable database. Download a backup
first when the database is still readable. Review the complete result and
recheck integrity afterward.

Do not edit database files while Roamarr is running.

## Backup and restore

Use **Maintenance → Backup & Restore**. A backup combines the MongrelDB
directory and its default encrypted attachment directory in one archive. A
custom attachment path outside the database parent needs a separate backup. A
restore is staged, validated, and applied on the next restart. It replaces
current data.

Read [Backup and restore](./backup-restore.md) before relying on a backup or
starting a restore.

## Demo data

Use **Maintenance → Seed Demo Data** to add repeatable demonstration data
through the running application process. The operation removes prior
non-administrator demo rows, then recreates the sample. It leaves the
administrator's real trips and other real users alone.

Still take a backup before seeding an important instance. Demo records are not
appropriate for production data.

`npm run db:seed` and the low-level `DatabaseSeeder` are full bootstrap/reset
tools. Use them only against an offline disposable database. They are not the
safe in-app demo workflow.

## Routine checks

Daily or after deploy:

- `/health` succeeds.
- Job History shows recent successful ticks.
- Process and proxy logs contain no repeating boot or scheduler error.

Weekly:

- `/health/deep` succeeds.
- Recent reminders and enabled email processing have completed.
- Free disk space covers database growth, attachment growth, and a staged
  restore.
- Audit Logs contain only expected administrative activity.

Before every upgrade or risky maintenance:

- download a fresh full backup;
- verify the secret and optional database credentials;
- record the current version;
- ensure enough disk space for the active data, uploaded archive, extracted
  restore, and temporary `.old` copy.

Periodically:

- restore a backup in an isolated test installation;
- review active users, sessions, passkeys, OAuth clients, shares, and public
  tokens;
- remove unused credentials and integrations;
- run Flush then Garbage collect if storage growth warrants it.

## Incident order

When the application is unhealthy:

1. preserve process and proxy logs;
2. avoid repeated restarts or repair attempts;
3. verify the environment and storage are mounted;
4. call `/health/deep`;
5. inspect Job History and the boot error;
6. make a copy or backup of current data if possible;
7. run read-only integrity checks;
8. use Doctor only after preserving recoverable data;
9. restore a known-good archive if repair cannot safely recover the database.

See [Troubleshooting](./troubleshooting.md) for common failures.
