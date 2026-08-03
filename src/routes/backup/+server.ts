import { createReadStream, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { createBackupArchive } from '$lib/server/backupArchive';

const BACKUP_DOWNLOAD_RATE_LIMIT = { maxAttempts: 3, windowMs: 60_000 };

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

export const GET: RequestHandler = async ({ locals, getClientAddress }) => {
	requireAdmin(locals);
	const limit = checkRateLimit(getClientAddress(), 'backup:download', BACKUP_DOWNLOAD_RATE_LIMIT);
	if (!limit.allowed) throw error(429, `Rate limited. Try again in ${limit.retryAfter ?? 1} seconds.`);

	const tmpPath = join(
		tmpdir(),
		`roamarr-backup-${process.hrtime.bigint().toString(36)}-${Date.now()}.tar.gz`
	);

	try {
		await createBackupArchive(tmpPath);
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
