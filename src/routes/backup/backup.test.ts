import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-fs';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { schema as kitSchema } from '$lib/server/db/mongrelSchema';
import { migrations as kitMigrations } from '$lib/server/db/mongrelMigrations/0001_initial';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { actions } from './+page.server';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { applyPendingRestore, getRestoreMarkerPath } from '$lib/server/restore';
import { checkRateLimit, resetRateLimit } from '$lib/server/rateLimit';

let testRoot: string;
let originalDatabasePath: string | undefined;

function makeDbDir(): string {
	const dir = join(testRoot, `roamarr-${Date.now()}-db`);
	const kitInstance = KitDatabase.openSync(dir, kitSchema);
	kitInstance.migrateSync(kitSchema, kitMigrations);
	kitInstance.close();
	return dir;
}

function adminLocals() {
	const u = usersRepo.createUser({
		email: `admin-${Date.now()}@x.c`,
		password_hash: 'x',
		display_name: 'Admin',
		calendar_token: null,
		calendar_token_expires_at: null,
		role: 'admin'
	} as any);
	return { user: { id: Number(u.id), role: 'admin' as const } };
}

function fileFrom(path: string, name: string): File {
	const buf = new Uint8Array(readFileSync(path));
	return new File([buf], name, { type: 'application/gzip' });
}

async function createBackupArchive(dbDir: string, attachmentsDir?: string): Promise<string> {
	const archivePath = join(tmpdir(), `roamarr-backup-test-${Date.now()}.mongreldb.tar.gz`);
	const parent = join(dbDir, '..');
	const entries: string[] = [];

	const dbRel = relative(parent, dbDir);
	entries.push(dbRel);

	if (attachmentsDir) {
		const attachmentsRel = relative(parent, attachmentsDir);
		if (!attachmentsRel.startsWith(dbRel + sep)) {
			entries.push(attachmentsRel);
		}
	}

	const { createGzip } = await import('node:zlib');
	await pipeline(tar.pack(parent, { entries }), createGzip(), createWriteStream(archivePath));
	return archivePath;
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
	mkdirSync(extractDir, { recursive: true });
	await pipeline(createReadStream(archivePath), createGunzip(), tar.extract(extractDir));
}

beforeEach(() => {
	resetRateLimit();
	testRoot = join(tmpdir(), `roamarr-backup-test-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	originalDatabasePath = process.env.DATABASE_PATH;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
});

test('backup downloads a tar.gz archive of the database directory and attachments', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;

	const attachmentsDir = join(dbDir, 'attachments');
	mkdirSync(attachmentsDir, { recursive: true });
	writeFileSync(join(attachmentsDir, 'sample.txt'), 'hello');

	const res = await GET({ locals: adminLocals(), getClientAddress: () => '127.0.0.1' } as any);
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Disposition')).toContain('.mongreldb.tar.gz');

	const archivePath = join(testRoot, 'downloaded.tar.gz');
	writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

	const extractDir = join(testRoot, 'extracted');
	await extractArchive(archivePath, extractDir);

	const extractedDb = join(extractDir, dbDir.split('/').pop()!);
	expect(existsSync(join(extractedDb, 'CATALOG'))).toBe(true);
	expect(existsSync(join(extractedDb, 'tables'))).toBe(true);
	expect(existsSync(join(extractedDb, 'attachments', 'sample.txt'))).toBe(true);
});

test('backup omits GeoNames city bulk data while keeping the table shell', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;

	// Plant a fake geonames table dir with bulk payload (as on-disk MongrelDB does).
	const geoDir = join(dbDir, 'tables', '99');
	mkdirSync(join(geoDir, '_runs'), { recursive: true });
	mkdirSync(join(geoDir, '_idx'), { recursive: true });
	writeFileSync(
		join(geoDir, 'schema.json'),
		JSON.stringify({
			schema_id: 99,
			columns: [
				{ id: 1, name: 'geoname_id' },
				{ id: 2, name: 'name' }
			]
		})
	);
	writeFileSync(join(geoDir, '_mf'), 'manifest');
	writeFileSync(join(geoDir, '_runs', 'r-1.sr'), 'x'.repeat(1024));
	writeFileSync(join(geoDir, '_idx', 'global.idx'), 'y'.repeat(1024));

	const res = await GET({ locals: adminLocals(), getClientAddress: () => '127.0.0.2' } as any);
	expect(res.status).toBe(200);
	const archivePath = join(testRoot, 'downloaded-no-geo.tar.gz');
	writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

	const extractDir = join(testRoot, 'extracted-no-geo');
	await extractArchive(archivePath, extractDir);
	const extractedDb = join(extractDir, dbDir.split('/').pop()!);
	const extractedGeo = join(extractedDb, 'tables', '99');
	expect(existsSync(join(extractedGeo, 'schema.json'))).toBe(true);
	expect(existsSync(join(extractedGeo, '_mf'))).toBe(true);
	expect(existsSync(join(extractedGeo, '_runs', 'r-1.sr'))).toBe(false);
	expect(existsSync(join(extractedGeo, '_idx', 'global.idx'))).toBe(false);
});

test('restore rejects an invalid archive', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;

	const invalid = new File([Buffer.from('not a valid tar.gz')], 'bad.mongreldb.tar.gz', {
		type: 'application/gzip'
	});
	const form = new FormData();
	form.append('file', invalid);
	const request = new Request('http://localhost/backup', { method: 'POST', body: form });
	const result = await actions.restore({
		locals: adminLocals(),
		request,
		cookies: { set: vi.fn() },
		getClientAddress: () => '127.0.0.1'
	} as any);
	expect(result?.status).toBe(400);
});

test('restore rejects oversized archives before extracting', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;

	const large = new File([Buffer.from('x')], 'large.mongreldb.tar.gz', {
		type: 'application/gzip'
	});
	Object.defineProperty(large, 'size', { value: 512 * 1024 * 1024 + 1 });
	const form = new FormData();
	form.append('file', large);
	const result = await actions.restore({
		locals: adminLocals(),
		request: { formData: async () => form },
		cookies: { set: vi.fn() },
		getClientAddress: () => '127.0.0.1'
	} as any);
	expect(result?.status).toBe(400);
	expect(result?.data.error).toContain('512 MB');
});

test('restore is rate limited before parsing the archive', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;
	const ip = '7.7.7.7';
	for (let i = 0; i < 3; i++) {
		checkRateLimit(ip, 'backup:restore', { maxAttempts: 3, windowMs: 60_000 });
	}

	const invalid = new File([Buffer.from('not a valid tar.gz')], 'bad.mongreldb.tar.gz', {
		type: 'application/gzip'
	});
	const form = new FormData();
	form.append('file', invalid);
	const request = new Request('http://localhost/backup', { method: 'POST', body: form });
	const result = await actions.restore({
		locals: adminLocals(),
		request,
		cookies: { set: vi.fn() },
		getClientAddress: () => ip
	} as any);
	expect(result?.status).toBe(429);
	expect(result?.data.retryAfter).toBeGreaterThan(0);
});

test('backup downloads are rate limited', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;
	const ip = '6.6.6.6';
	for (let i = 0; i < 3; i++) {
		checkRateLimit(ip, 'backup:download', { maxAttempts: 3, windowMs: 60_000 });
	}

	await expect(GET({ locals: adminLocals(), getClientAddress: () => ip } as any)).rejects.toMatchObject({
		status: 429
	});
});

test('restore accepts a valid backup and writes a pending restore marker', async () => {
	const sourceDbDir = makeDbDir();
	const attachmentsDir = join(sourceDbDir, 'attachments');
	mkdirSync(attachmentsDir, { recursive: true });
	writeFileSync(join(attachmentsDir, 'sample.txt'), 'hello');

	const targetRoot = join(testRoot, 'target');
	mkdirSync(targetRoot, { recursive: true });
	const targetDbDir = join(targetRoot, 'roamarr-db');
	process.env.DATABASE_PATH = targetDbDir;

	const archivePath = await createBackupArchive(sourceDbDir);

	const form = new FormData();
	form.append('file', fileFrom(archivePath, 'backup.mongreldb.tar.gz'));
	const request = new Request('http://localhost/backup', { method: 'POST', body: form });
	await expect(
		actions.restore({
			locals: adminLocals(),
			request,
			cookies: { set: vi.fn() },
			getClientAddress: () => '127.0.0.1'
		} as any)
	).rejects.toMatchObject({ status: 303, location: '/backup' });

	const markerPath = getRestoreMarkerPath(targetDbDir);
	expect(existsSync(markerPath)).toBe(true);

	// The restore action must leave the extraction tree in place while a marker
	// is pending: applyPendingRestore consumes it on the next boot.
	const targetParent = dirname(targetDbDir);
	const pendingWrappers = readdirSync(targetParent).filter((name) =>
		name.startsWith('.roamarr-restore-')
	);
	expect(pendingWrappers.length).toBe(1);

	applyPendingRestore(targetDbDir);

	expect(existsSync(join(targetDbDir, 'CATALOG'))).toBe(true);
	expect(existsSync(join(targetDbDir, 'tables'))).toBe(true);
	expect(existsSync(join(targetDbDir, 'attachments', 'sample.txt'))).toBe(true);
	expect(existsSync(markerPath)).toBe(false);

	// applyPendingRestore must clean up the now-empty extraction wrapper left
	// behind by the restore action.
	const leftoverWrappers = readdirSync(targetParent).filter((name) =>
		name.startsWith('.roamarr-restore-')
	);
	expect(leftoverWrappers.length).toBe(0);
});

test('saveAutoBackup validates interval and retention bounds', async () => {
	const badInterval = new Request('http://localhost/backup', {
		method: 'POST',
		body: new URLSearchParams({ backupAutoEnabled: 'on', backupIntervalHours: '0', backupRetentionCount: '7' })
	});
	const r1 = await actions.saveAutoBackup({
		locals: adminLocals(),
		request: badInterval,
		cookies: { set: vi.fn() }
	} as any);
	expect(r1?.status).toBe(400);
	expect(r1?.data.error).toContain('interval');

	const badRetention = new Request('http://localhost/backup', {
		method: 'POST',
		body: new URLSearchParams({ backupAutoEnabled: 'on', backupIntervalHours: '24', backupRetentionCount: '0' })
	});
	const r2 = await actions.saveAutoBackup({
		locals: adminLocals(),
		request: badRetention,
		cookies: { set: vi.fn() }
	} as any);
	expect(r2?.status).toBe(400);
	expect(r2?.data.error).toContain('Retention');
});

test('saveAutoBackup persists valid settings and redirects', async () => {
	const cookies = { set: vi.fn() };
	const request = new Request('http://localhost/backup', {
		method: 'POST',
		body: new URLSearchParams({ backupAutoEnabled: 'on', backupIntervalHours: '12', backupRetentionCount: '3' })
	});
	await expect(
		actions.saveAutoBackup({ locals: adminLocals(), request, cookies } as any)
	).rejects.toMatchObject({ status: 303, location: '/backup' });

	const { getSettings, updateSettings } = await import('$lib/server/settings');
	const s = getSettings();
	expect(s.backupAutoEnabled).toBe(true);
	expect(s.backupIntervalHours).toBe(12);
	expect(s.backupRetentionCount).toBe(3);
	// Reset so no other suite in this process sees auto-backups enabled.
	updateSettings({ backupAutoEnabled: false, backupIntervalHours: 24, backupRetentionCount: 7 });
});
