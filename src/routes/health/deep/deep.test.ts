import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('$lib/server/scheduler', () => ({ isSchedulerRunning: vi.fn() }));

import { GET } from './+server';
import { isSchedulerRunning } from '$lib/server/scheduler';
import { getDb, closeDb } from '$lib/server/db/index';

let dbDir: string;
let originalDatabasePath: string | undefined;

beforeEach(() => {
	dbDir = mkdtempSync(join(tmpdir(), 'roamarr-health-deep-test-'));
	originalDatabasePath = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = dbDir;
	getDb();
});

afterEach(() => {
	closeDb();
	rmSync(dbDir, { recursive: true, force: true });
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
});

test('deep health returns 200 when db and scheduler are healthy', async () => {
	(isSchedulerRunning as any).mockReturnValue(true);
	const res = await GET({} as any);
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.db).toBe(true);
	expect(body.scheduler).toBe(true);
	expect(body.sqlDiagnostic).toEqual({ ok: true, rowCount: 1 });
	expect(body.check).toBeDefined();
});

test('deep health returns 503 when scheduler is not running', async () => {
	(isSchedulerRunning as any).mockReturnValue(false);
	const res = await GET({} as any);
	expect(res.status).toBe(503);
	const body = await res.json();
	expect(body.db).toBe(true);
	expect(body.scheduler).toBe(false);
});

test('deep health reports sqlDiagnostic ok false when kit singleton is not open', async () => {
	closeDb();
	(isSchedulerRunning as any).mockReturnValue(true);
	const res = await GET({} as any);
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.sqlDiagnostic).toEqual({ ok: false });
});

test('deep health masks internal error messages on integrity failure', async () => {
	(isSchedulerRunning as any).mockReturnValue(true);
	const bogusDir = mkdtempSync(join(tmpdir(), 'roamarr-health-bogus-'));
	const original = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = bogusDir;
	try {
		const res = await GET({} as any);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.db).toBe(false);
		expect(body.error).toBe('deep-health-check-failed');
		expect(JSON.stringify(body)).not.toContain(bogusDir);
	} finally {
		process.env.DATABASE_PATH = original;
		rmSync(bogusDir, { recursive: true, force: true });
	}
});
