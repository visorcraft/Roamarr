import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KitDatabase } from '@mongreldb/kit';
import { schema as kitSchema } from '$lib/server/db/mongrelSchema';
import { migrations as kitMigrations } from '$lib/server/db/mongrelMigrations/0001_initial';

import { GET as healthGet } from './+server';
import { GET as deepHealthGet } from './deep/+server';

let dbDir: string;
let originalMongrelDatabasePath: string | undefined;

beforeEach(() => {
	dbDir = join(tmpdir(), `roamarr-health-test-${Date.now()}.kitdb`);
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
	delete (globalThis as { __roamarr_scheduler?: boolean }).__roamarr_scheduler;
});

function healthEvent() {
	return { request: new Request('http://localhost/health') } as any;
}

function deepHealthEvent() {
	return { request: new Request('http://localhost/health/deep') } as any;
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
	expect(text).not.toContain('roamarr.kitdb');
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
	const bogusDir = join(tmpdir(), `roamarr-health-bogus-${Date.now()}.kitdb`);
	mkdirSync(bogusDir, { recursive: true });
	const original = process.env.MONGREL_DATABASE_PATH;
	process.env.MONGREL_DATABASE_PATH = bogusDir;
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
		process.env.MONGREL_DATABASE_PATH = original;
		rmSync(bogusDir, { recursive: true, force: true });
	}
});
