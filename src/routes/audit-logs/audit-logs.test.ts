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
import { resetRateLimit } from '$lib/server/rateLimit';
import * as usersRepo from '$lib/server/repositories/usersRepo';

function makeLoadEvent(user: unknown, url: URL) {
	return {
		locals: { user },
		url,
		getClientAddress: () => '127.0.0.1'
	} as any;
}

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
	resetRateLimit();
	const kit = (ctx as any).kit;
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns filters for admin', () => {
	const admin = makeUser('admin@x.c', 'Admin', 'admin');
	const result = load(makeLoadEvent({ id: Number(admin.id), role: 'admin' }, new URL('http://localhost/audit-logs')));
	expect(result).toEqual({
		filters: { userId: '', action: '', entityType: '', from: '', to: '' }
	});
});

test('load parses and returns URL filter params', () => {
	const admin = makeUser('admin@x.c', 'Admin', 'admin');
	const result = load(
		makeLoadEvent(
			{ id: Number(admin.id), role: 'admin' },
			new URL(
				'http://localhost/audit-logs?userId=3&action=login&entityType=session&from=2024-01-01&to=2024-01-31'
			)
		)
	);
	expect(result).toEqual({
		filters: {
			userId: '3',
			action: 'login',
			entityType: 'session',
			from: '2024-01-01',
			to: '2024-01-31'
		}
	});
});

test('load rejects non-admin', () => {
	const u = makeUser('user@x.c', 'User');
	try {
		load(makeLoadEvent({ id: Number(u.id), role: 'user' }, new URL('http://localhost/audit-logs')));
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns CSV export when export=csv', () => {
	const admin = makeUser('admin-csv@x.c', 'Admin', 'admin');
	logAudit(Number(admin.id), 'settings_update', 'settings', 1, { changed: ['instanceName'] });

	const result = load(
		makeLoadEvent({ id: Number(admin.id), role: 'admin' }, new URL('http://localhost/audit-logs?export=csv'))
	) as Response;

	expect(result instanceof Response).toBe(true);
	expect(result.headers.get('Content-Type')).toBe('text/csv');
});

test('load returns filtered CSV export when export=csv with filters', async () => {
	const admin = makeUser('admin-filter@x.c', 'Admin', 'admin');
	const target = makeUser('target@x.c', 'Target');

	logAudit(Number(admin.id), 'settings_update', 'settings', 1, { changed: ['instanceName'] });
	logAudit(Number(target.id), 'trip_delete', 'trip', 42, { name: 'Gone' });

	const result = load(
		makeLoadEvent(
			{ id: Number(admin.id), role: 'admin' },
			new URL(`http://localhost/audit-logs?export=csv&userId=${target.id}&action=trip_delete`)
		)
	) as Response;

	expect(result instanceof Response).toBe(true);
	expect(result.headers.get('Content-Type')).toBe('text/csv');
	expect(result.headers.get('Content-Disposition')).toBe('attachment; filename="audit-logs.csv"');

	const csv = await result.text();
	expect(csv).toContain('trip_delete');
	expect(csv).not.toContain('settings_update');
});

test('load rejects CSV export with invalid userId', () => {
	const admin = makeUser('admin-bad-id@x.c', 'Admin', 'admin');
	try {
		load(
			makeLoadEvent(
				{ id: Number(admin.id), role: 'admin' },
				new URL('http://localhost/audit-logs?export=csv&userId=abc')
			)
		);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('load rejects CSV export with invalid from date', () => {
	const admin = makeUser('admin-bad-from@x.c', 'Admin', 'admin');
	try {
		load(
			makeLoadEvent(
				{ id: Number(admin.id), role: 'admin' },
				new URL('http://localhost/audit-logs?export=csv&from=not-a-date')
			)
		);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('load rejects CSV export with invalid to date', () => {
	const admin = makeUser('admin-bad-to@x.c', 'Admin', 'admin');
	try {
		load(
			makeLoadEvent(
				{ id: Number(admin.id), role: 'admin' },
				new URL('http://localhost/audit-logs?export=csv&to=bad')
			)
		);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('load rate limits CSV export', () => {
	const admin = makeUser('admin-rate@x.c', 'Admin', 'admin');
	for (let i = 0; i < 10; i++) {
		const result = load(
			makeLoadEvent({ id: Number(admin.id), role: 'admin' }, new URL('http://localhost/audit-logs?export=csv'))
		) as Response;
		expect(result instanceof Response).toBe(true);
		expect(result.status).toBe(200);
	}
	try {
		load(makeLoadEvent({ id: Number(admin.id), role: 'admin' }, new URL('http://localhost/audit-logs?export=csv')));
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(429);
	}
});

test('load initializes userId filter from URL for dropdown', () => {
	const admin = makeUser('admin-user-filter@x.c', 'Admin', 'admin');
	const target = makeUser('target@x.c', 'Target');
	const result = load(
		makeLoadEvent(
			{ id: Number(admin.id), role: 'admin' },
			new URL(`http://localhost/audit-logs?userId=${target.id}`)
		)
	) as { filters: { userId: string } };
	expect(result.filters.userId).toBe(String(target.id));
});
