import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-fs';
import { extract as tarExtract } from 'tar-stream';
import { getDatabasePath } from './db/paths';
import { getAttachmentsPath } from './restore';
import { findGeonamesTableIds, shouldExcludeFromBackup } from './backupFilter';

export interface BackupVerificationResult {
	sha256: string;
	entryCount: number;
	hasCatalog: boolean;
}

/**
 * Verify a `.mongreldb.tar.gz` archive: it must gunzip and parse as a tar
 * stream containing at least one entry and a database CATALOG file. Returns
 * the SHA-256 of the compressed bytes (the file as written), the number of
 * tar entries seen, and whether the CATALOG was detected. Rejects cleanly on
 * truncated/corrupt archives without leaking file descriptors.
 */
export async function verifyBackupArchive(archivePath: string): Promise<BackupVerificationResult> {
	const hash = createHash('sha256');
	let entryCount = 0;
	let hasCatalog = false;

	const hasher = new Transform({
		transform(chunk, _encoding, callback) {
			hash.update(chunk);
			callback(null, chunk);
		}
	});

	const extract = tarExtract();
	extract.on('entry', (header, stream, next) => {
		entryCount += 1;
		if (header.name === 'CATALOG' || header.name.endsWith('/CATALOG')) hasCatalog = true;
		stream.on('end', next);
		stream.resume();
	});

	await pipeline(createReadStream(archivePath), hasher, createGunzip(), extract);

	if (entryCount === 0 || !hasCatalog) {
		throw new Error('Backup archive verification failed: missing database CATALOG');
	}

	return { sha256: hash.digest('hex'), entryCount, hasCatalog };
}

/**
 * Write a full `.mongreldb.tar.gz` backup of the database (plus attachments
 * when they live outside the database directory) to `destPath`. This is the
 * same archive routine the manual `/backup` download uses; scheduled
 * auto-backups write through it too so both paths stay identical.
 *
 * The GeoNames city catalog is re-importable reference data (~30 MB): the
 * table shell is kept so CATALOG opens, but run/index payloads are omitted.
 *
 * The archive is verified immediately after writing; on any failure the
 * partial archive is removed and the error is rethrown.
 */
export async function createBackupArchive(
	destPath: string,
	dbPath: string = getDatabasePath()
): Promise<BackupVerificationResult> {
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
	const attachmentsEntryName =
		!attachmentsInsideDb &&
		existsSync(resolvedAttachments) &&
		dirname(resolvedAttachments) === resolve(parentDir)
			? basename(attachmentsPath)
			: null;
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
		return await verifyBackupArchive(destPath);
	} catch (err) {
		try {
			unlinkSync(destPath);
		} catch {
			// ignore best-effort cleanup failures
		}
		throw err;
	}
}
