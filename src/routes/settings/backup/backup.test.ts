import { test, expect, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import * as usersRepo from '$lib/server/repositories/usersRepo';

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
	const buf = new Uint8Array(require('node:fs').readFileSync(path));
	return new File([buf], name, { type: 'application/octet-stream' });
}

test('restore rejects an invalid SQLite file', async () => {
	const admin = adminLocals();
	const invalid = new File([Buffer.from('not a database')], 'bad.db', { type: 'application/octet-stream' });
	const form = new FormData();
	form.append('file', invalid);
	const request = new Request('http://localhost/settings/backup', { method: 'POST', body: form });
	const result = await actions.restore({ locals: admin, request, cookies: { set: vi.fn() } } as any);
	expect(result?.status).toBe(400);
});

test('restore accepts a valid Roamarr database', async () => {
	const admin = adminLocals();
	const tmp = join(tmpdir(), `roamarr-restore-test-${Date.now()}.db`);
	const restorePath = join(tmpdir(), `roamarr-restore-target-${Date.now()}.db`);
	const originalPath = process.env.DATABASE_PATH;
	process.env.DATABASE_PATH = restorePath;

	const { createDb } = await import('$lib/server/db/createDb');
	const { sqlite } = createDb(tmp);
	sqlite.exec('CREATE TABLE users (id INTEGER PRIMARY KEY);');
	sqlite.close();

	const form = new FormData();
	form.append('file', fileFrom(tmp, 'restore.db'));
	const request = new Request('http://localhost/settings/backup', { method: 'POST', body: form });
	await expect(
		actions.restore({ locals: admin, request, cookies: { set: vi.fn() } } as any)
	).rejects.toMatchObject({ status: 303, location: '/settings/backup' });

	expect(existsSync(restorePath)).toBe(true);
	unlinkSync(tmp);
	unlinkSync(restorePath);
	if (originalPath !== undefined) process.env.DATABASE_PATH = originalPath;
	else delete process.env.DATABASE_PATH;
});
