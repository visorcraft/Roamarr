import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_DATABASE_PATH, getAttachmentsPath, getDatabasePath } from './paths';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalAttachmentsPath = process.env.ATTACHMENTS_PATH;

afterEach(() => {
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;

	if (originalAttachmentsPath === undefined) delete process.env.ATTACHMENTS_PATH;
	else process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
});

describe('server paths', () => {
	test('uses a source-repo local database path by default', () => {
		delete process.env.DATABASE_PATH;
		delete process.env.ATTACHMENTS_PATH;

		expect(DEFAULT_DATABASE_PATH).toBe('./roamarr-db');
		expect(getDatabasePath()).toBe('./roamarr-db');
		expect(getAttachmentsPath()).toBe('roamarr-db/attachments');
	});

	test('prefers DATABASE_PATH when set', () => {
		process.env.DATABASE_PATH = '/srv/roamarr/data';
		delete process.env.ATTACHMENTS_PATH;

		expect(getDatabasePath()).toBe('/srv/roamarr/data');
		expect(getAttachmentsPath()).toBe('/srv/roamarr/data/attachments');
	});

	test('getAttachmentsPath respects ATTACHMENTS_PATH env var', () => {
		process.env.DATABASE_PATH = '/srv/roamarr/data';
		process.env.ATTACHMENTS_PATH = '/mnt/attachments';

		expect(getAttachmentsPath()).toBe('/mnt/attachments');
	});

	test('getAttachmentsPath falls back beside a database file path', () => {
		delete process.env.ATTACHMENTS_PATH;
		process.env.DATABASE_PATH = '/data/roamarr-db/db.kitdb';

		expect(getAttachmentsPath()).toBe('/data/roamarr-db/attachments');
	});

	test('getAttachmentsPath falls back inside a database directory path', () => {
		delete process.env.ATTACHMENTS_PATH;
		process.env.DATABASE_PATH = '/data/roamarr-db';

		expect(getAttachmentsPath()).toBe('/data/roamarr-db/attachments');
	});
});
