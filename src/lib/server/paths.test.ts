import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_DATABASE_PATH, getAttachmentsPath, getDatabasePath } from './paths';

const originalDatabasePath = process.env.DATABASE_PATH;

afterEach(() => {
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
});

describe('server paths', () => {
	test('uses a source-repo local database path by default', () => {
		delete process.env.DATABASE_PATH;

		expect(DEFAULT_DATABASE_PATH).toBe('./roamarr.db');
		expect(getDatabasePath()).toBe('./roamarr.db');
		expect(getAttachmentsPath()).toBe('attachments');
	});

	test('places attachments beside a configured database', () => {
		process.env.DATABASE_PATH = '/srv/roamarr/app.db';

		expect(getDatabasePath()).toBe('/srv/roamarr/app.db');
		expect(getAttachmentsPath()).toBe('/srv/roamarr/attachments');
	});
});
