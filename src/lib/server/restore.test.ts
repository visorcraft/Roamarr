import { test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import mongreldb from '@visorcraft/mongreldb';
import type { Database as NativeDatabase } from '@visorcraft/mongreldb/native.js';
import { schema as kitSchema } from './db/mongrelSchema';
import { migrations as kitMigrations } from './db/mongrelMigrations/0001_initial';

const NativeDatabaseClass = (mongreldb as unknown as { Database: typeof NativeDatabase }).Database;
import {
	applyPendingRestore,
	findAttachmentsDirectory,
	findMongrelDbDirectory,
	getAttachmentsPath,
	getRestoreMarkerPath,
	readRestoreMarker,
	validateRestoredDirectory,
	writeRestoreMarker
} from './restore';

let testRoot: string;
let originalDatabasePath: string | undefined;

beforeEach(() => {
	testRoot = join(tmpdir(), `roamarr-restore-test-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	originalDatabasePath = process.env.DATABASE_PATH;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
});

function makeDbDir(name = 'roamarr-db'): string {
	const dir = join(testRoot, name);
	const kitInstance = KitDatabase.openSync(dir, kitSchema);
	kitInstance.migrateSync(kitSchema, kitMigrations);
	kitInstance.close();
	return dir;
}

test('getAttachmentsPath defaults to a directory inside the database directory', () => {
	const dbPath = join(testRoot, 'roamarr-db');
	expect(getAttachmentsPath(dbPath)).toBe(join(dbPath, 'attachments'));
});

test('getAttachmentsPath respects ATTACHMENTS_PATH', () => {
	const dbPath = join(testRoot, 'roamarr-db');
	process.env.ATTACHMENTS_PATH = join(testRoot, 'custom-attachments');
	expect(getAttachmentsPath(dbPath)).toBe(join(testRoot, 'custom-attachments'));
});

test('validateRestoredDirectory accepts a valid migrated MongrelDB directory', () => {
	const dir = makeDbDir();
	expect(() => validateRestoredDirectory(dir)).not.toThrow();
});

test('validateRestoredDirectory rejects a missing settings table', () => {
	const dir = join(testRoot, 'empty-db');
	const db = NativeDatabaseClass.withPath(dir);
	db.createTable('other_table', {
		columns: [{ id: 1, name: 'x', ty: 5, primaryKey: true, nullable: false }],
		indexes: []
	});
	db.close();
	expect(() => validateRestoredDirectory(dir)).toThrow('missing required tables');
});

test('write and read restore marker', () => {
	const dbPath = join(testRoot, 'roamarr-db');
	const extractedDb = join(testRoot, 'extracted-db');
	const extractedAttachments = join(testRoot, 'extracted-attachments');
	writeRestoreMarker(extractedDb, extractedAttachments, dbPath);

	const markerPath = getRestoreMarkerPath(dbPath);
	expect(existsSync(markerPath)).toBe(true);
	expect(readRestoreMarker(dbPath)).toEqual({
		databasePath: extractedDb,
		attachmentsPath: extractedAttachments
	});
});

test('applyPendingRestore replaces the current database directory', () => {
	const currentDb = makeDbDir('current-db');
	const restoredDb = makeDbDir('restored-db');

	writeFileSync(join(restoredDb, 'marker.txt'), 'restored');
	writeRestoreMarker(restoredDb, undefined, currentDb);

	applyPendingRestore(currentDb);

	expect(existsSync(join(currentDb, 'marker.txt'))).toBe(true);
	expect(readRestoreMarker(currentDb)).toBeNull();
});

test('applyPendingRestore also replaces the attachments directory', () => {
	const currentDb = makeDbDir('current-db');
	const currentAttachments = join(testRoot, 'current-attachments');
	process.env.ATTACHMENTS_PATH = currentAttachments;
	mkdirSync(currentAttachments, { recursive: true });
	writeFileSync(join(currentAttachments, 'old.txt'), 'old');

	const restoredDb = makeDbDir('restored-db');
	const restoredAttachments = join(testRoot, 'restored-attachments');
	mkdirSync(restoredAttachments, { recursive: true });
	writeFileSync(join(restoredAttachments, 'new.txt'), 'new');

	writeRestoreMarker(restoredDb, restoredAttachments, currentDb);
	applyPendingRestore(currentDb);

	expect(existsSync(join(currentAttachments, 'new.txt'))).toBe(true);
	expect(existsSync(join(currentAttachments, 'old.txt'))).toBe(false);
});

test('findMongrelDbDirectory locates the database inside an extracted root', () => {
	const dbDir = makeDbDir('roamarr-db');
	const found = findMongrelDbDirectory(testRoot);
	expect(found).toBe(dbDir);
});

test('findAttachmentsDirectory locates the attachments inside an extracted root', () => {
	const attachmentsDir = join(testRoot, 'attachments');
	mkdirSync(attachmentsDir, { recursive: true });
	expect(findAttachmentsDirectory(testRoot)).toBe(attachmentsDir);
});
