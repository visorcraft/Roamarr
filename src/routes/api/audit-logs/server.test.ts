import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeAdmin, makeUser } from '../../../../tests/helpers';
import { logAudit } from '$lib/server/repositories/auditRepo';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated audit logs with nested user', async () => {
	const admin = makeAdmin(ctx.kit);
	const user = makeUser(ctx.kit, { email: 'actor@example.com' });
	logAudit(user.id, 'login', 'session', user.id, { ip: '1.2.3.4' });

	const res = await GET(makeEvent('/api/audit-logs', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(1);
	expect(body.rows).toHaveLength(1);
	expect(body.rows[0]).toMatchObject({
		action: 'login',
		entityType: 'session',
		entityId: user.id,
		user: {
			id: user.id,
			email: 'actor@example.com'
		}
	});
	expect(body.rows[0].createdAt).toBeDefined();
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent('/api/audit-logs', null))).rejects.toMatchObject({ status: 401 });
});

test('rejects non-admin users', async () => {
	const user = makeUser(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs', user))).rejects.toMatchObject({ status: 403 });
});

test('rejects invalid from date', async () => {
	const admin = makeAdmin(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs?from=not-a-date', admin))).rejects.toMatchObject({
		status: 400
	});
});

test('rejects invalid to date', async () => {
	const admin = makeAdmin(ctx.kit);
	await expect(GET(makeEvent('/api/audit-logs?to=bad', admin))).rejects.toMatchObject({ status: 400 });
});
