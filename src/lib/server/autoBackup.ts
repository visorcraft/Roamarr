import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getDatabasePath } from './db/paths';
import { getSettings, updateSettings } from './settings';
import { createBackupArchive } from './backupArchive';

/**
 * Scheduled automatic backups (admin-configured). Auto-backups are written to
 * a `backups/` directory beside the database directory and are distinguished
 * from manual downloads by the `auto-` filename prefix; retention pruning only
 * ever deletes `auto-` files, so manually stored archives are never touched.
 */
export const AUTO_BACKUP_PREFIX = 'auto-roamarr-backup-';
export const AUTO_BACKUP_SUFFIX = '.mongreldb.tar.gz';

export function getAutoBackupDir(dbPath: string = getDatabasePath()): string {
	return join(dirname(resolve(dbPath)), 'backups');
}

function autoBackupFilename(now: Date): string {
	const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `${AUTO_BACKUP_PREFIX}${stamp}${AUTO_BACKUP_SUFFIX}`;
}

export function listAutoBackups(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.startsWith(AUTO_BACKUP_PREFIX) && name.endsWith(AUTO_BACKUP_SUFFIX))
		.sort();
}

/**
 * Delete the oldest `auto-` archives beyond `retentionCount`. Files that do
 * not match the auto-backup naming scheme (e.g. anything an admin placed in
 * the directory manually) are left alone. Returns the deleted filenames.
 */
export function pruneAutoBackups(dir: string, retentionCount: number): string[] {
	const keep = Math.max(0, Math.floor(retentionCount));
	const files = listAutoBackups(dir);
	const excess = files.slice(0, Math.max(0, files.length - keep));
	for (const name of excess) {
		try {
			unlinkSync(join(dir, name));
		} catch (e) {
			console.error('[auto-backup] failed to prune', name, e);
		}
	}
	return excess;
}

export interface AutoBackupStatus {
	enabled: boolean;
	intervalHours: number;
	retentionCount: number;
	lastRunAt: string | null;
	nextDueAt: string | null;
	directory: string;
	storedCount: number;
}

export function autoBackupStatus(
	now: Date = new Date(),
	dbPath: string = getDatabasePath()
): AutoBackupStatus {
	const s = getSettings();
	const dir = getAutoBackupDir(dbPath);
	const lastRunAt = s.backupLastAutoAt;
	const nextDueAt =
		lastRunAt == null
			? null
			: new Date(new Date(lastRunAt).getTime() + s.backupIntervalHours * 3_600_000).toISOString();
	return {
		enabled: s.backupAutoEnabled,
		intervalHours: s.backupIntervalHours,
		retentionCount: s.backupRetentionCount,
		lastRunAt,
		// Never ran yet: due on the next scheduler tick once enabled.
		nextDueAt: s.backupAutoEnabled ? (nextDueAt ?? now.toISOString()) : null,
		directory: dir,
		storedCount: listAutoBackups(dir).length
	};
}

export type AutoBackupResult =
	| { ran: false; reason: 'disabled' | 'not-due' }
	| { ran: true; file: string; pruned: string[] };

/**
 * Run one scheduled auto-backup when enabled and the configured interval has
 * elapsed since the last run. Writes to a `.tmp` sibling and renames into
 * place so an interrupted run never leaves a half-written archive behind.
 * Throws on failure; the scheduler wraps this in its per-maintenance try/catch
 * so a backup failure can never fail the tick.
 */
export async function runAutoBackupIfDue(
	now: Date = new Date(),
	dbPath: string = getDatabasePath()
): Promise<AutoBackupResult> {
	const s = getSettings();
	if (!s.backupAutoEnabled) return { ran: false, reason: 'disabled' };
	if (s.backupLastAutoAt) {
		const elapsed = now.getTime() - new Date(s.backupLastAutoAt).getTime();
		if (elapsed < s.backupIntervalHours * 3_600_000) return { ran: false, reason: 'not-due' };
	}

	const dir = getAutoBackupDir(dbPath);
	mkdirSync(dir, { recursive: true });
	const dest = join(dir, autoBackupFilename(now));
	const tmp = `${dest}.tmp`;
	try {
		await createBackupArchive(tmp, dbPath);
		renameSync(tmp, dest);
	} catch (e) {
		try {
			unlinkSync(tmp);
		} catch {
			// ignore best-effort cleanup failures
		}
		throw e;
	}
	updateSettings({ backupLastAutoAt: now.toISOString() });
	const pruned = pruneAutoBackups(dir, s.backupRetentionCount);
	return { ran: true, file: dest, pruned };
}
