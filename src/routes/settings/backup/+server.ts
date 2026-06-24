import { createReadStream, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { sqlite } from '$lib/server/db';

function backupFilename() {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `roamarr-backup-${stamp}.sqlite3`;
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

	const tmpPath = join(
		tmpdir(),
		`roamarr-backup-${process.hrtime.bigint().toString(36)}-${Date.now()}.sqlite3`
	);

	try {
		await sqlite.backup(tmpPath);
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
			'Content-Type': 'application/vnd.sqlite3',
			'Content-Disposition': `attachment; filename="${backupFilename()}"`
		}
	});
};
