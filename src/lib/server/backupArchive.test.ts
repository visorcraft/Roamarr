import { test, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
	createWriteStream,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-fs';
import { freshPlainDbDir } from '../../../tests/helpers';
import { createBackupArchive, verifyBackupArchive } from './backupArchive';

let testRoot: string;

beforeEach(() => {
	testRoot = join(
		tmpdir(),
		`roamarr-backup-archive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
	mkdirSync(testRoot, { recursive: true });
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

function makeDbDir(): string {
	// Clone the per-process migrated template: creating a full-schema database
	// from scratch per test is slow enough to time out under parallel workers.
	return freshPlainDbDir(join(testRoot, 'roamarr-db'));
}

async function makeSyntheticArchive(sourceDir: string, destPath: string): Promise<void> {
	await pipeline(tar.pack(sourceDir), createGzip(), createWriteStream(destPath));
}

test('verifyBackupArchive accepts a valid archive and returns its SHA-256', async () => {
	const dbDir = makeDbDir();
	const archivePath = join(testRoot, 'backup.mongreldb.tar.gz');
	const created = await createBackupArchive(archivePath, dbDir);

	const result = await verifyBackupArchive(archivePath);

	const expected = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
	expect(result.sha256).toBe(expected);
	expect(result.sha256).toBe(created.sha256);
	expect(result.hasCatalog).toBe(true);
	expect(result.entryCount).toBeGreaterThan(0);
});

test('verifyBackupArchive rejects a truncated archive', async () => {
	const dbDir = makeDbDir();
	const archivePath = join(testRoot, 'backup.mongreldb.tar.gz');
	await createBackupArchive(archivePath, dbDir);
	const buf = readFileSync(archivePath);
	const truncatedPath = join(testRoot, 'truncated.mongreldb.tar.gz');
	writeFileSync(truncatedPath, buf.subarray(0, Math.floor(buf.length / 2)));

	await expect(verifyBackupArchive(truncatedPath)).rejects.toThrow();
});

test('verifyBackupArchive rejects a valid archive missing CATALOG', async () => {
	const sourceDir = join(testRoot, 'source');
	mkdirSync(sourceDir, { recursive: true });
	writeFileSync(join(sourceDir, 'foo.txt'), 'hello');
	const archivePath = join(testRoot, 'no-catalog.tar.gz');
	await makeSyntheticArchive(sourceDir, archivePath);

	await expect(verifyBackupArchive(archivePath)).rejects.toThrow(
		'Backup archive verification failed: missing database CATALOG'
	);
});
