import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createReadStream, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { getDatabasePath } from '$lib/server/db/paths';
import {
	findMongrelDbDirectory,
	findAttachmentsDirectory,
	validateRestoredDirectory,
	writeRestoreMarker
} from '$lib/server/restore';
import tar from 'tar-fs';

const ALLOWED_BACKUP_EXTENSIONS = ['.mongreldb.tar.gz', '.tar.gz'];

function isBackupFilename(name: string): boolean {
	return ALLOWED_BACKUP_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const actions: Actions = {
	restore: async ({ locals, request, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File)) return fail(400, { error: 'Upload a file' });
		if (!isBackupFilename(file.name.toLowerCase())) {
			return fail(400, { error: 'Upload a Roamarr MongrelDB backup (.mongreldb.tar.gz)' });
		}

	const dbPath = resolve(getDatabasePath());
	const dbParent = dirname(dbPath);
	const archivePath = join(tmpdir(), `roamarr-restore-${Date.now()}.tar.gz`);
	const extractRoot = mkdtempSync(join(dbParent, '.roamarr-restore-'));
	let markerWritten = false;

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		writeFileSync(archivePath, buffer);

		await pipeline(createReadStream(archivePath), createGunzip(), tar.extract(extractRoot));

		const restoredDbPath = findMongrelDbDirectory(extractRoot);
		if (!restoredDbPath) {
			return fail(400, { error: 'Backup does not contain a MongrelDB database directory' });
		}

		try {
			validateRestoredDirectory(restoredDbPath);
		} catch (e) {
			return fail(400, {
				error: e instanceof Error ? e.message : 'Backup integrity check failed'
			});
		}

		const restoredAttachmentsPath = findAttachmentsDirectory(extractRoot);
		writeRestoreMarker(restoredDbPath, restoredAttachmentsPath ?? undefined, dbPath);
		markerWritten = true;

		logAudit(u.id, 'db_restore', 'settings', 1);
		setFlash(cookies, 'Restore pending. Restart the app to complete.');
		throw redirect(303, '/settings/backup');
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return fail(400, { error: e instanceof Error ? e.message : 'Restore failed' });
	} finally {
		try {
			unlinkSync(archivePath);
		} catch {}
		// When the marker was not written (validation failure, extract error,
		// etc.) the extraction tree is dead weight next to the live database and
		// must come down now. When the marker WAS written, applyPendingRestore
		// owns the tree on the next boot and cleans it up itself.
		if (!markerWritten) {
			try {
				rmSync(extractRoot, { recursive: true, force: true });
			} catch {}
		}
	}
	}
};
