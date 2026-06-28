import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_DATABASE_PATH, getAttachmentsPath, getDatabasePath } from './paths';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalMongrelDatabasePath = process.env.MONGREL_DATABASE_PATH;

afterEach(() => {
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
	if (originalMongrelDatabasePath === undefined) delete process.env.MONGREL_DATABASE_PATH;
	else process.env.MONGREL_DATABASE_PATH = originalMongrelDatabasePath;
});

describe('server paths', () => {
	test('uses a source-repo local database path by default', () => {
		delete process.env.DATABASE_PATH;
		delete process.env.MONGREL_DATABASE_PATH;

		expect(DEFAULT_DATABASE_PATH).toBe('./roamarr.kitdb');
		expect(getDatabasePath()).toBe('./roamarr.kitdb');
		expect(getAttachmentsPath()).toBe('attachments');
	});

	test('prefers the MongrelDB path when set', () => {
		delete process.env.DATABASE_PATH;
		process.env.MONGREL_DATABASE_PATH = '/srv/roamarr/kit';

		expect(getDatabasePath()).toBe('/srv/roamarr/kit');
		expect(getAttachmentsPath()).toBe('/srv/roamarr/attachments');
	});

	test('falls back to DATABASE_PATH when it looks like a directory', () => {
		delete process.env.MONGREL_DATABASE_PATH;
		process.env.DATABASE_PATH = '/srv/roamarr/data';

		expect(getDatabasePath()).toBe('/srv/roamarr/data');
		expect(getAttachmentsPath()).toBe('/srv/roamarr/attachments');
	});

	test('ignores DATABASE_PATH that looks like a legacy SQLite file', () => {
		delete process.env.MONGREL_DATABASE_PATH;
		process.env.DATABASE_PATH = '/srv/roamarr/app.db';

		expect(getDatabasePath()).toBe('./roamarr.kitdb');
	});
});
