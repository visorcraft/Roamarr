import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, auditLogs } from '$lib/server/db/mongrelSchema';
import { logAudit } from '$lib/server/audit';
import * as usersRepo from '$lib/server/repositories/usersRepo';

function makeUser(email: string, displayName: string, role: 'admin' | 'user' = 'user') {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: displayName,
		calendar_token: null,
		calendar_token_expires_at: null,
		...(role === 'admin' ? { role: 'admin' } : {})
	} as any);
}

beforeEach(() => {
	const kit = (ctx as any).kit;
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns empty object for admin', () => {
	const admin = makeUser('admin@x.c', 'Admin', 'admin');
	const result = load({
		locals: { user: { id: Number(admin.id), role: 'admin' } },
		url: new URL('http://localhost/audit-logs')
	} as any);
	expect(result).toEqual({});
});

test('load rejects non-admin', () => {
	const u = makeUser('user@x.c', 'User');
	try {
		load({ locals: { user: { id: Number(u.id), role: 'user' } } } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns CSV export when export=csv', () => {
	const admin = makeUser('admin-csv@x.c', 'Admin', 'admin');
	logAudit(Number(admin.id), 'settings_update', 'settings', 1, { changed: ['instanceName'] });

	const result = load({
		locals: { user: { id: Number(admin.id), role: 'admin' } },
		url: new URL('http://localhost/audit-logs?export=csv')
	} as any) as Response;

	expect(result instanceof Response).toBe(true);
	expect(result.headers.get('Content-Type')).toBe('text/csv');
});

test('load returns filtered CSV export when export=csv with filters', async () => {
	const admin = makeUser('admin-filter@x.c', 'Admin', 'admin');
	const target = makeUser('target@x.c', 'Target');

	logAudit(Number(admin.id), 'settings_update', 'settings', 1, { changed: ['instanceName'] });
	logAudit(Number(target.id), 'trip_delete', 'trip', 42, { name: 'Gone' });

	const result = load({
		locals: { user: { id: Number(admin.id), role: 'admin' } },
		url: new URL(`http://localhost/audit-logs?export=csv&userId=${target.id}&action=trip_delete`)
	} as any) as Response;

	expect(result instanceof Response).toBe(true);
	expect(result.headers.get('Content-Type')).toBe('text/csv');
	expect(result.headers.get('Content-Disposition')).toBe('attachment; filename="audit-logs.csv"');

	const csv = await result.text();
	expect(csv).toContain('trip_delete');
	expect(csv).not.toContain('settings_update');
});
