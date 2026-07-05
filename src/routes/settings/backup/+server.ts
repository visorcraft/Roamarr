import { createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getDatabasePath } from '$lib/server/db/paths';
import { getAttachmentsPath } from '$lib/server/restore';
import tar from 'tar-fs';

function backupFilename() {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `roamarr-backup-${stamp}.mongreldb.tar.gz`;
}

function cleanupTemp(path: string) {
	try {
		unlinkSync(path);
	} catch {
		// ignore best-effort cleanup failures
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);

	const dbPath = getDatabasePath();
	const attachmentsPath = getAttachmentsPath(dbPath);
	const tmpPath = join(
		tmpdir(),
		`roamarr-backup-${process.hrtime.bigint().toString(36)}-${Date.now()}.tar.gz`
	);

	const parentDir = dirname(dbPath);
	const dbName = basename(dbPath);
	const entries: string[] = [dbName];

	// Only include a separate attachments entry when attachments live outside the
	// database directory (e.g. via ATTACHMENTS_PATH). Otherwise the default
	// <dbDir>/attachments is already included with the database directory.
	const resolvedAttachments = resolve(attachmentsPath);
	const resolvedDbPath = resolve(dbPath);
	const attachmentsInsideDb = resolvedAttachments === resolvedDbPath || resolvedAttachments.startsWith(resolvedDbPath + sep);
	const attachmentsEntryName = attachmentsInsideDb ? null : basename(attachmentsPath);
	if (attachmentsEntryName) {
		entries.push(attachmentsEntryName);
	}

	try {
		const pack = tar.pack(parentDir, {
			entries,
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
		const out = createWriteStream(tmpPath);
		await pipeline(pack, gzip, out);
	} catch (err) {
		cleanupTemp(tmpPath);
		throw err;
	}

	const file = createReadStream(tmpPath);
	const stream = new ReadableStream({
		start(controller) {
			file.on('data', (chunk) => controller.enqueue(chunk));
			file.on('end', () => {
				cleanupTemp(tmpPath);
				controller.close();
			});
			file.on('error', (err) => {
				cleanupTemp(tmpPath);
				controller.error(err);
			});
		},
		cancel() {
			file.destroy();
			cleanupTemp(tmpPath);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': `attachment; filename="${backupFilename()}"`
		}
	});
};
