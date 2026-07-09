import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { GET as healthGet } from './+server';
import { GET as deepHealthGet } from './deep/+server';
import { getDb, closeDb } from '$lib/server/db/index';
import { resetRateLimit } from '$lib/server/rateLimit';

let dbDir: string;
let originalDatabasePath: string | undefined;

beforeEach(() => {
	resetRateLimit();
	dbDir = mkdtempSync(join(tmpdir(), 'roamarr-health-test-'));
	originalDatabasePath = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = dbDir;
	getDb();
});

afterEach(() => {
	closeDb();
	rmSync(dbDir, { recursive: true, force: true });
	if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
	else process.env.DATABASE_PATH = originalDatabasePath;
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
});

function healthEvent() {
	return { request: new Request('http://localhost/health') } as any;
}

function deepHealthEvent() {
	return {
		request: new Request('http://localhost/health/deep'),
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('health returns ok when db directory and scheduler are healthy', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	const res = await healthGet(healthEvent());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: true, db: true, scheduler: true });
});

test('health reports false when db directory is missing', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	rmSync(dbDir, { recursive: true, force: true });
	const res = await healthGet(healthEvent());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: false, db: false, scheduler: true });
});

test('health reports scheduler false when scheduler is not running', async () => {
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
	const res = await healthGet(healthEvent());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: false, db: true, scheduler: false });
});

test('health does not leak sensitive data', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	const res = await healthGet(healthEvent());
	const text = await res.text();
	expect(text).not.toContain('roamarr-db');
	expect(text).not.toContain('secret');
	expect(text).toMatch(/^\{["']ok["']/);
});

test('deep health returns 200 when integrity check passes', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	const res = await deepHealthGet(deepHealthEvent());
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.db).toBe(true);
	expect(body.scheduler).toBe(true);
	expect(body.sqlDiagnostic).toEqual({ ok: true, rowCount: 1 });
	expect(body.check).toBeDefined();
});

test('deep health returns 503 when scheduler is not running', async () => {
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
	const res = await deepHealthGet(deepHealthEvent());
	expect(res.status).toBe(503);
	const body = await res.json();
	expect(body.db).toBe(true);
	expect(body.scheduler).toBe(false);
});

test('deep health masks internal error messages on integrity failure', async () => {
	(globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler = true;
	// Point the database path at an empty directory so the native open succeeds
	// but the integrity check fails. The error detail must NOT surface raw.
	const bogusDir = join(tmpdir(), `roamarr-health-bogus-${Date.now()}-db`);
	mkdirSync(bogusDir, { recursive: true });
	const original = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = bogusDir;
	try {
		const res = await deepHealthGet(deepHealthEvent());
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.db).toBe(false);
		// The masked marker is stable and does not leak filesystem paths or
		// native engine internals.
		expect(body.error).toBe('deep-health-check-failed');
		expect(JSON.stringify(body)).not.toContain(bogusDir);
	} finally {
		process.env.DATABASE_PATH = original;
		rmSync(bogusDir, { recursive: true, force: true });
	}
});
