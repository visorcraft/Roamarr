import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { users } from '$lib/server/db/schema';

function event(locals: App.Locals) {
	return {
		locals,
		request: new Request('http://localhost/settings/backup'),
		url: new URL('http://localhost/settings/backup')
	} as any;
}

test('admin receives a SQLite snapshot download', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const admin = db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'A', role: 'admin' })
		.returning()
		.get();

	const res = await GET(event({ user: admin }));
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toBe('application/vnd.sqlite3');
	const disposition = res.headers.get('content-disposition');
	expect(disposition).toContain('attachment');
	expect(disposition).toMatch(/filename="roamarr-backup-[^"]+\.sqlite3"/);

	const body = await res.arrayBuffer();
	const header = new TextDecoder().decode(body.slice(0, 16));
	expect(header).toBe('SQLite format 3\u0000');
	expect(body.byteLength).toBeGreaterThan(0);
});

test('non-admin user gets 403', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const user = db
		.insert(users)
		.values({ email: 'user@x.c', passwordHash: 'x', displayName: 'U', role: 'user' })
		.returning()
		.get();

	try {
		await GET(event({ user }));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('anonymous user gets 401', async () => {
	try {
		await GET(event({ user: null }));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(401);
	}
});
