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
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { actions } from './+page.server';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { applyPendingRestore, getRestoreMarkerPath } from '$lib/server/restore';

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

	const res = await GET({ locals: adminLocals() } as any);
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

test('restore rejects an invalid archive', async () => {
	const dbDir = makeDbDir();
	process.env.DATABASE_PATH = dbDir;

	const invalid = new File([Buffer.from('not a valid tar.gz')], 'bad.mongreldb.tar.gz', {
		type: 'application/gzip'
	});
	const form = new FormData();
	form.append('file', invalid);
	const request = new Request('http://localhost/settings/backup', { method: 'POST', body: form });
	const result = await actions.restore({ locals: adminLocals(), request, cookies: { set: vi.fn() } } as any);
	expect(result?.status).toBe(400);
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
	const request = new Request('http://localhost/settings/backup', { method: 'POST', body: form });
	await expect(
		actions.restore({ locals: adminLocals(), request, cookies: { set: vi.fn() } } as any)
	).rejects.toMatchObject({ status: 303, location: '/settings/backup' });

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
