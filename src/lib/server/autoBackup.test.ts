import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshPlainDbDir } from '../../../tests/helpers';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	autoBackupStatus,
	getAutoBackupDir,
	listAutoBackups,
	pruneAutoBackups,
	runAutoBackupIfDue
} from './autoBackup';
import { getSettings, updateSettings } from './settings';

let testRoot: string;
let dbDir: string;
let originalDatabasePath: string | undefined;

function makeDbDir(): string {
	// Clone the per-process migrated template: creating a full-schema database
	// from scratch per test is slow enough to time out under parallel workers.
	return freshPlainDbDir(join(testRoot, 'roamarr-db'));
}

beforeEach(() => {
	testRoot = join(tmpdir(), `roamarr-autobackup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	dbDir = makeDbDir();
	originalDatabasePath = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = dbDir;
	updateSettings({ backupAutoEnabled: false, backupIntervalHours: 24, backupRetentionCount: 7, backupLastAutoAt: null });
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
});

test('disabled auto-backup is a no-op and creates no directory', async () => {
	const result = await runAutoBackupIfDue(new Date('2026-08-01T00:00:00Z'), dbDir);
	expect(result).toEqual({ ran: false, reason: 'disabled' });
	expect(existsSync(getAutoBackupDir(dbDir))).toBe(false);
});

test('first due run writes a timestamped auto- archive and stamps the settings row', async () => {
	updateSettings({ backupAutoEnabled: true });
	const now = new Date('2026-08-01T06:00:00Z');
	const result = await runAutoBackupIfDue(now, dbDir);
	expect(result.ran).toBe(true);
	if (!result.ran) return;
	expect(result.file).toContain('auto-roamarr-backup-2026-08-01T06-00-00.mongreldb.tar.gz');
	expect(existsSync(result.file)).toBe(true);
	// No half-written temp file left behind.
	expect(readdirSync(getAutoBackupDir(dbDir)).some((n) => n.endsWith('.tmp'))).toBe(false);
	expect(getSettings().backupLastAutoAt).toBe(now.toISOString());
});

test('a second run inside the interval is skipped, after the interval it runs again', async () => {
	updateSettings({ backupAutoEnabled: true, backupIntervalHours: 24 });
	const first = new Date('2026-08-01T06:00:00Z');
	await runAutoBackupIfDue(first, dbDir);

	const early = new Date('2026-08-01T12:00:00Z');
	expect(await runAutoBackupIfDue(early, dbDir)).toEqual({ ran: false, reason: 'not-due' });
	expect(listAutoBackups(getAutoBackupDir(dbDir))).toHaveLength(1);

	const later = new Date('2026-08-02T07:00:00Z');
	const second = await runAutoBackupIfDue(later, dbDir);
	expect(second.ran).toBe(true);
	expect(listAutoBackups(getAutoBackupDir(dbDir))).toHaveLength(2);
});

test('pruneAutoBackups removes only the oldest auto- archives beyond retention', () => {
	const dir = getAutoBackupDir(dbDir);
	mkdirSync(dir, { recursive: true });
	const names = [
		'auto-roamarr-backup-2026-07-01T00-00-00.mongreldb.tar.gz',
		'auto-roamarr-backup-2026-07-02T00-00-00.mongreldb.tar.gz',
		'auto-roamarr-backup-2026-07-03T00-00-00.mongreldb.tar.gz',
		// Manually stored archives (no auto- prefix) must never be pruned.
		'roamarr-backup-2026-06-01T00-00-00.mongreldb.tar.gz',
		'notes.txt'
	];
	for (const name of names) writeFileSync(join(dir, name), 'x');

	const deleted = pruneAutoBackups(dir, 2);
	expect(deleted).toEqual(['auto-roamarr-backup-2026-07-01T00-00-00.mongreldb.tar.gz']);
	expect(readdirSync(dir).sort()).toEqual(names.slice(1).sort());
});

test('runAutoBackupIfDue enforces retention across runs', async () => {
	updateSettings({ backupAutoEnabled: true, backupRetentionCount: 1 });
	await runAutoBackupIfDue(new Date('2026-08-01T06:00:00Z'), dbDir);
	const second = await runAutoBackupIfDue(new Date('2026-08-03T06:00:00Z'), dbDir);
	expect(second.ran).toBe(true);
	if (!second.ran) return;
	expect(second.pruned).toEqual(['auto-roamarr-backup-2026-08-01T06-00-00.mongreldb.tar.gz']);
	expect(listAutoBackups(getAutoBackupDir(dbDir))).toEqual([
		'auto-roamarr-backup-2026-08-03T06-00-00.mongreldb.tar.gz'
	]);
});

test('autoBackupStatus reports last run, next due, and stored count', async () => {
	updateSettings({ backupAutoEnabled: true, backupIntervalHours: 12 });
	const now = new Date('2026-08-01T06:00:00Z');
	await runAutoBackupIfDue(now, dbDir);

	const status = autoBackupStatus(new Date('2026-08-01T08:00:00Z'), dbDir);
	expect(status.enabled).toBe(true);
	expect(status.lastRunAt).toBe(now.toISOString());
	expect(status.nextDueAt).toBe(new Date('2026-08-01T18:00:00Z').toISOString());
	expect(status.storedCount).toBe(1);
	expect(status.directory).toBe(getAutoBackupDir(dbDir));

	updateSettings({ backupAutoEnabled: false });
	expect(autoBackupStatus(new Date(), dbDir).nextDueAt).toBeNull();
});

test('autoBackupStatus reports due immediately when enabled but never run', () => {
	updateSettings({ backupAutoEnabled: true, backupLastAutoAt: null });
	const now = new Date('2026-08-01T00:00:00Z');
	const status = autoBackupStatus(now, dbDir);
	expect(status.lastRunAt).toBeNull();
	expect(status.nextDueAt).toBe(now.toISOString());
});
