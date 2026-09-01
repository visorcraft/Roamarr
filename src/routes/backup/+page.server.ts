import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createReadStream, createWriteStream, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { requireAdmin } from '$lib/server/auth';
import { logAudit } from '$lib/server/audit';
import { setFlash } from '$lib/server/flash';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getDatabasePath } from '$lib/server/db/paths';
import {
	findMongrelDbDirectory,
	findAttachmentsDirectory,
	validateRestoredDirectory,
	writeRestoreMarker
} from '$lib/server/restore';
import { updateSettings } from '$lib/server/settings';
import { autoBackupStatus } from '$lib/server/autoBackup';
import tar from 'tar-fs';
import type { PageServerLoad } from './$types';

function userFacingError(e: unknown, fallback: string): string {
	console.error(fallback, e);
	return fallback;
}

const ALLOWED_BACKUP_EXTENSIONS = ['.mongreldb.tar.gz', '.tar.gz'];
const RESTORE_RATE_LIMIT = { maxAttempts: 3, windowMs: 60_000 };

/** `undefined` / `0` / `unlimited` = no application cap (adapter `BODY_SIZE_LIMIT` still applies). */
export function maxRestoreBytes(): number | null {
	const raw = process.env.ROAMARR_MAX_RESTORE_BYTES?.trim();
	if (!raw || raw === '0' || raw.toLowerCase() === 'unlimited') return null;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error('ROAMARR_MAX_RESTORE_BYTES must be a positive byte count, 0, or unlimited');
	}
	return parsed;
}

function isBackupFilename(name: string): boolean {
	return ALLOWED_BACKUP_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return { autoBackup: autoBackupStatus() };
};

export const actions: Actions = {
	saveAutoBackup: async ({ request, locals, cookies }) => {
		const u = requireAdmin(locals);
		const f = await request.formData();
		const backupAutoEnabled = f.get('backupAutoEnabled') === 'on';
		const backupIntervalHours = Number(f.get('backupIntervalHours') ?? 24);
		const backupRetentionCount = Number(f.get('backupRetentionCount') ?? 7);
		if (!Number.isInteger(backupIntervalHours) || backupIntervalHours < 1 || backupIntervalHours > 720) {
			return fail(400, { error: 'Backup interval must be an integer between 1 and 720 hours' });
		}
		if (!Number.isInteger(backupRetentionCount) || backupRetentionCount < 1 || backupRetentionCount > 100) {
			return fail(400, { error: 'Retention must be an integer between 1 and 100 backups' });
		}
		updateSettings({ backupAutoEnabled, backupIntervalHours, backupRetentionCount });
		logAudit(u.id, 'settings_update', 'settings', 1, {
			changed: ['backupAutoEnabled', 'backupIntervalHours', 'backupRetentionCount']
		});
		setFlash(cookies, 'Auto-backup settings saved.');
		throw redirect(303, '/backup');
	},

	restore: async ({ locals, request, cookies, getClientAddress }) => {
		const u = requireAdmin(locals);
		const limit = checkRateLimit(getClientAddress(), 'backup:restore', RESTORE_RATE_LIMIT);
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File)) return fail(400, { error: 'Upload a file' });
		if (!isBackupFilename(file.name.toLowerCase())) {
			return fail(400, { error: 'Upload a Roamarr MongrelDB backup (.mongreldb.tar.gz)' });
		}
		const restoreLimit = maxRestoreBytes();
		if (restoreLimit !== null && file.size > restoreLimit) {
			return fail(400, {
				error: `Backup file must be ${restoreLimit} bytes or smaller`
			});
		}

		const dbPath = resolve(getDatabasePath());
		const dbParent = dirname(dbPath);
		const archivePath = join(tmpdir(), `roamarr-restore-${Date.now()}.tar.gz`);
		const extractRoot = mkdtempSync(join(dbParent, '.roamarr-restore-'));
		let markerWritten = false;

		try {
			// Stream the upload straight to disk instead of materializing the
			// archive on the heap.
			await pipeline(Readable.fromWeb(file.stream() as any), createWriteStream(archivePath));

			await pipeline(createReadStream(archivePath), createGunzip(), tar.extract(extractRoot));

			const restoredDbPath = findMongrelDbDirectory(extractRoot);
			if (!restoredDbPath) {
				return fail(400, { error: 'Backup does not contain a MongrelDB database directory' });
			}

			try {
				validateRestoredDirectory(restoredDbPath);
			} catch (e) {
				const original = e instanceof Error ? e.message : String(e);
				console.error('Backup integrity check failed:', original);
				return fail(400, {
					error: userFacingError(e, 'Backup integrity check failed')
				});
			}

			const restoredAttachmentsPath = findAttachmentsDirectory(extractRoot);
			writeRestoreMarker(restoredDbPath, restoredAttachmentsPath ?? undefined, dbPath);
			markerWritten = true;

			logAudit(u.id, 'db_restore', 'settings', 1);
			setFlash(cookies, 'Restore pending. Restart the app to complete.');
			throw redirect(303, '/backup');
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			const original = e instanceof Error ? e.message : String(e);
			console.error('Restore failed:', original);
			return fail(400, { error: userFacingError(e, 'Restore failed') });
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
