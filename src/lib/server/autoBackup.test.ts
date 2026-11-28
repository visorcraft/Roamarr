import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
	removeStaleAutoBackupTempFiles,
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
	// Sibling .sha256 sidecars must be pruned alongside their archives.
	for (const name of names.filter((n) => n.startsWith('auto-') && n.endsWith('.mongreldb.tar.gz'))) {
		writeFileSync(join(dir, `${name}.sha256`), 'x');
	}

	const deleted = pruneAutoBackups(dir, 2);
	expect(deleted).toEqual(['auto-roamarr-backup-2026-07-01T00-00-00.mongreldb.tar.gz']);
	const remaining = [
		'auto-roamarr-backup-2026-07-02T00-00-00.mongreldb.tar.gz',
		'auto-roamarr-backup-2026-07-02T00-00-00.mongreldb.tar.gz.sha256',
		'auto-roamarr-backup-2026-07-03T00-00-00.mongreldb.tar.gz',
		'auto-roamarr-backup-2026-07-03T00-00-00.mongreldb.tar.gz.sha256',
		'roamarr-backup-2026-06-01T00-00-00.mongreldb.tar.gz',
		'notes.txt'
	];
	expect(readdirSync(dir).sort()).toEqual(remaining.sort());
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

test('removeStaleAutoBackupTempFiles removes only orphaned auto- temp files', () => {
	const dir = join(testRoot, 'backups');
	mkdirSync(dir, { recursive: true });
	const kept = [
		'auto-roamarr-backup-2026-07-30T00-00-00.mongreldb.tar.gz',
		'auto-roamarr-backup-2026-07-30T00-00-00.mongreldb.tar.gz.sha256',
		'roamarr-backup-2026-07-01T00-00-00.mongreldb.tar.gz.tmp',
		'auto-roamarr-backup-2026-07-29T00-00-00.mongreldb.tar.gz.tmp.bak',
		'notes.txt'
	];
	writeFileSync(join(dir, 'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.tmp'), 'x');
	writeFileSync(join(dir, 'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.sha256.tmp'), 'x');
	for (const name of kept) writeFileSync(join(dir, name), 'x');

	const removed = removeStaleAutoBackupTempFiles(dir);
	expect([...removed].sort()).toEqual([
		'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.sha256.tmp',
		'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.tmp'
	]);
	expect(readdirSync(dir).sort()).toEqual(kept.sort());

	expect(removeStaleAutoBackupTempFiles(join(testRoot, 'missing'))).toEqual([]);
});

test('a .tmp left by a killed run is removed by the next due run', async () => {
	const dir = getAutoBackupDir(dbDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.tmp'), 'x');
	updateSettings({ backupAutoEnabled: true });

	const result = await runAutoBackupIfDue(new Date('2026-08-01T06:00:00Z'), dbDir);
	expect(result.ran).toBe(true);
	if (!result.ran) return;
	const archiveName = 'auto-roamarr-backup-2026-08-01T06-00-00.mongreldb.tar.gz';
	expect(readdirSync(dir).sort()).toEqual([archiveName, `${archiveName}.sha256`]);
	// Sidecar matches sha256sum format and the real file's SHA-256.
	const realHash = createHash('sha256').update(readFileSync(result.file)).digest('hex');
	expect(result.sha256).toBe(realHash);
	expect(readFileSync(`${result.file}.sha256`, 'utf8')).toBe(`${realHash}  ${archiveName}\n`);
});

test('orphan cleanup does not run when disabled or not due', async () => {
	const dir = getAutoBackupDir(dbDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.tmp'), 'x');
	const orphan = 'auto-roamarr-backup-2026-07-31T00-00-00.mongreldb.tar.gz.tmp';

	// Disabled: no-op, orphan untouched.
	const disabled = await runAutoBackupIfDue(new Date('2026-08-01T06:00:00Z'), dbDir);
	expect(disabled).toEqual({ ran: false, reason: 'disabled' });
	expect(existsSync(join(dir, orphan))).toBe(true);

	// Enabled but not due: orphan untouched.
	updateSettings({ backupAutoEnabled: true, backupLastAutoAt: '2026-08-01T05:00:00.000Z' });
	const notDue = await runAutoBackupIfDue(new Date('2026-08-01T06:00:00Z'), dbDir);
	expect(notDue).toEqual({ ran: false, reason: 'not-due' });
	expect(existsSync(join(dir, orphan))).toBe(true);
});

test('a future-dated last-run stamp is treated as due', async () => {
	updateSettings({
		backupAutoEnabled: true,
		backupLastAutoAt: '2026-08-10T00:00:00.000Z'
	});
	const now = new Date('2026-08-01T06:00:00Z');
	const result = await runAutoBackupIfDue(now, dbDir);
	expect(result.ran).toBe(true);
	expect(getSettings().backupLastAutoAt).toBe(now.toISOString());
});

test('an unparseable last-run stamp still runs', async () => {
	updateSettings({ backupAutoEnabled: true, backupLastAutoAt: 'not-a-date' });
	const result = await runAutoBackupIfDue(new Date('2026-08-01T06:00:00Z'), dbDir);
	expect(result.ran).toBe(true);
});

test('autoBackupStatus reports due-now for a future-dated or unparseable stamp', () => {
	const now = new Date('2026-08-01T06:00:00Z');
	for (const stamp of ['2026-08-10T00:00:00.000Z', 'not-a-date']) {
		updateSettings({ backupAutoEnabled: true, backupIntervalHours: 24, backupLastAutoAt: stamp });
		expect(() => autoBackupStatus(now, dbDir)).not.toThrow();
		expect(autoBackupStatus(now, dbDir).nextDueAt).toBe(now.toISOString());
	}
});

test('a run exactly one interval after the last one is due', async () => {
	updateSettings({ backupAutoEnabled: true, backupIntervalHours: 24 });
	const first = new Date('2026-08-01T06:00:00Z');
	await runAutoBackupIfDue(first, dbDir);

	const second = new Date('2026-08-02T06:00:00Z');
	const result = await runAutoBackupIfDue(second, dbDir);
	expect(result.ran).toBe(true);
});
