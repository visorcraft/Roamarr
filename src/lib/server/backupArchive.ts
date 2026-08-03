import { createWriteStream, unlinkSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { getDatabasePath } from './db/paths';
import { getAttachmentsPath } from './restore';
import { findGeonamesTableIds, shouldExcludeFromBackup } from './backupFilter';
import tar from 'tar-fs';

/**
 * Write a full `.mongreldb.tar.gz` backup of the database (plus attachments
 * when they live outside the database directory) to `destPath`. This is the
 * same archive routine the manual `/backup` download uses; scheduled
 * auto-backups write through it too so both paths stay identical.
 *
 * The GeoNames city catalog is re-importable reference data (~30 MB): the
 * table shell is kept so CATALOG opens, but run/index payloads are omitted.
 */
export async function createBackupArchive(
	destPath: string,
	dbPath: string = getDatabasePath()
): Promise<void> {
	const attachmentsPath = getAttachmentsPath(dbPath);

	const parentDir = dirname(dbPath);
	const dbName = basename(dbPath);
	const entries: string[] = [dbName];

	// Only include a separate attachments entry when attachments live outside the
	// database directory (e.g. via ATTACHMENTS_PATH). Otherwise the default
	// <dbDir>/attachments is already included with the database directory.
	const resolvedAttachments = resolve(attachmentsPath);
	const resolvedDbPath = resolve(dbPath);
	const attachmentsInsideDb =
		resolvedAttachments === resolvedDbPath || resolvedAttachments.startsWith(resolvedDbPath + sep);
	const attachmentsEntryName = attachmentsInsideDb ? null : basename(attachmentsPath);
	if (attachmentsEntryName) {
		entries.push(attachmentsEntryName);
	}

	const geonamesTableIds = findGeonamesTableIds(resolvedDbPath);

	try {
		const pack = tar.pack(parentDir, {
			entries,
			ignore: (name) => shouldExcludeFromBackup(name, geonamesTableIds),
			map: (header) => {
				// Normalize any out-of-tree attachments directory to "attachments/"
				// so the archive structure is predictable for restore.
				if (
					attachmentsEntryName &&
					(header.name === `${attachmentsEntryName}/` || header.name.startsWith(`${attachmentsEntryName}/`))
				) {
					header.name = `attachments${header.name.slice(attachmentsEntryName.length)}`;
				}
				return header;
			}
		});
		const gzip = createGzip();
		const out = createWriteStream(destPath);
		await pipeline(pack, gzip, out);
	} catch (err) {
		try {
			unlinkSync(destPath);
		} catch {
			// ignore best-effort cleanup failures
		}
		throw err;
	}
}
