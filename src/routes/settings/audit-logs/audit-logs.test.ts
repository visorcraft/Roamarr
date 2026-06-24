import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users } from '$lib/server/db/schema';
import { logAudit } from '$lib/server/audit';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from audit_logs;');
	(ctx as any).sqlite.exec('delete from users;');
});

function adminLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	return { user: u };
}

function userLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'user@x.c', passwordHash: 'x', displayName: 'User', role: 'user' })
		.returning()
		.get();
	return { user: u };
}

test('load returns recent audit logs for admin', () => {
	const db = (ctx as any).db;
	const admin = adminLocals();
	const target = db.insert(users).values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T' }).returning().get();

	logAudit(admin.user.id, 'settings_update', 'settings', 1, { changed: ['instanceName'] });
	logAudit(target.id, 'trip_delete', 'trip', 42, { name: 'Gone' });

	const result = load({ locals: admin, url: new URL('http://localhost/settings/audit-logs') } as any) as {
		logs: Array<{ action: string; user: { email: string } }>;
	};
	expect(result.logs).toHaveLength(2);
	expect(result.logs[0].action).toBe('trip_delete');
	expect(result.logs[1].action).toBe('settings_update');
	expect(result.logs[1].user.email).toBe('admin@x.c');
});

test('load rejects non-admin', () => {
	const u = userLocals();
	try {
		load({ locals: u, url: new URL('http://localhost/settings/audit-logs') } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns empty logs when no events exist', () => {
	const admin = adminLocals();
	const result = load({ locals: admin, url: new URL('http://localhost/settings/audit-logs') } as any) as {
		logs: unknown[];
	};
	expect(result.logs).toEqual([]);
});

test('load returns CSV export when export=csv', () => {
	const admin = adminLocals();
	logAudit(admin.user.id, 'settings_update', 'settings', 1, { changed: ['instanceName'] });

	const result = load({
		locals: admin,
		url: new URL('http://localhost/settings/audit-logs?export=csv')
	} as any) as Response;

	expect(result instanceof Response).toBe(true);
	expect(result.headers.get('Content-Type')).toBe('text/csv');
});
