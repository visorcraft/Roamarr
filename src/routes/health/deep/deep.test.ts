import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KitDatabase } from '@mongreldb/kit';
import { schema as kitSchema } from '$lib/server/db/mongrelSchema';
import { migrations as kitMigrations } from '$lib/server/db/mongrelMigrations/0001_initial';

vi.mock('$lib/server/scheduler', () => ({ isSchedulerRunning: vi.fn() }));

import { GET } from './+server';
import { isSchedulerRunning } from '$lib/server/scheduler';

let dbDir: string;
let originalMongrelDatabasePath: string | undefined;

beforeEach(() => {
	dbDir = join(tmpdir(), `roamarr-health-deep-test-${Date.now()}.kitdb`);
	const kitInstance = KitDatabase.openSync(dbDir, kitSchema);
	kitInstance.migrateSync(kitSchema, kitMigrations);
	kitInstance.close();
	originalMongrelDatabasePath = process.env.MONGREL_DATABASE_PATH;
	process.env.MONGREL_DATABASE_PATH = dbDir;
});

afterEach(() => {
	rmSync(dbDir, { recursive: true, force: true });
	if (originalMongrelDatabasePath === undefined) delete process.env.MONGREL_DATABASE_PATH;
	else process.env.MONGREL_DATABASE_PATH = originalMongrelDatabasePath;
});

test('deep health returns 200 when db and scheduler are healthy', () => {
	(isSchedulerRunning as any).mockReturnValue(true);
	const res = GET({} as any) as Response;
	expect(res.status).toBe(200);
});

test('deep health returns 503 when scheduler is not running', () => {
	(isSchedulerRunning as any).mockReturnValue(false);
	const res = GET({} as any) as Response;
	expect(res.status).toBe(503);
});
